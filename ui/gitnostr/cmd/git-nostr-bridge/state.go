package main

import (
	"database/sql"
	"errors"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/nbd-wtf/go-nostr"
	"github.com/arbadacarbaYK/gitnostr"
	"github.com/arbadacarbaYK/gitnostr/bridge"
)

// ErrRepositoryNotExists is returned when a state event arrives before the repository is created.
// This error indicates that the event should not be marked as processed (updateSince should be skipped)
// so it can be reprocessed when the repository is eventually created.
var ErrRepositoryNotExists = errors.New("repository does not exist yet")

// handleRepositoryStateEvent processes NIP-34 state events (kind 30618)
// These events contain refs and commits that need to be updated in the git repository
func handleRepositoryStateEvent(event nostr.Event, db *sql.DB, cfg bridge.Config) error {
	// Extract repository name from "d" tag (must match announcement event)
	var repoName string
	for _, tag := range event.Tags {
		if len(tag) >= 2 && tag[0] == "d" {
			repoName = tag[1]
			break
		}
	}
	if repoName == "" {
		return fmt.Errorf("state event missing 'd' tag with repository name")
	}

	// Resolve repository path (same as announcement event)
	reposDir, err := gitnostr.ResolvePath(cfg.RepositoryDir)
	if err != nil {
		return fmt.Errorf("resolve repos path: %w", err)
	}
	repoParentPath := filepath.Join(reposDir, event.PubKey)
	repoPath := filepath.Join(repoParentPath, repoName+".git")

	// Check if repository exists
	if _, err := os.Stat(repoPath); os.IsNotExist(err) {
		log.Printf("⚠️ [Bridge] State event received but repository does not exist: pubkey=%s repo=%s\n", event.PubKey, repoName)
		log.Printf("💡 [Bridge] Repository will be created when announcement event (30617) is received\n")
		log.Printf("💡 [Bridge] State event will be reprocessed after repository creation (not marking as processed)\n")
		return ErrRepositoryNotExists // Return special error to prevent updateSince
	}

	// Extract refs from tags
	// NIP-34 format: ["refs/heads/main", "commit-sha"] where tag name is ref path, value is commit SHA
	var refsToUpdate []struct {
		ref    string
		commit string
	}
	var headRef string

	for _, tag := range event.Tags {
		if len(tag) < 2 {
			continue
		}

		tagName := tag[0]
		tagValue := tag[1]

		// Handle HEAD tag: ["HEAD", "ref: refs/heads/main"]
		if tagName == "HEAD" && strings.HasPrefix(tagValue, "ref: ") {
			headRef = strings.TrimPrefix(tagValue, "ref: ")
			log.Printf("📌 [Bridge] State event HEAD: %s\n", headRef)
		} else if strings.HasPrefix(tagName, "refs/") {
			// Handle ref tags: ["refs/heads/main", "commit-sha"]
			refsToUpdate = append(refsToUpdate, struct {
				ref    string
				commit string
			}{
				ref:    tagName,
				commit: tagValue,
			})
		}
	}

	// Only return early if there are no refs AND no HEAD to update
	// A state event might contain only a HEAD tag without refs
	if len(refsToUpdate) == 0 && headRef == "" {
		log.Printf("⚠️ [Bridge] State event has no refs or HEAD to update: pubkey=%s repo=%s\n", event.PubKey, repoName)
		return nil // Not an error - state event might have empty refs initially
	}

	log.Printf("🔄 [Bridge] Processing state event: pubkey=%s repo=%s refs=%d\n", event.PubKey, repoName, len(refsToUpdate))

	// Update refs in git repository
	for _, ref := range refsToUpdate {
		if ref.commit == "" {
			log.Printf("⚠️ [Bridge] Skipping ref %s (empty commit SHA)\n", ref.ref)
			continue
		}

		// CRITICAL: Validate commit exists before updating ref
		// This handles cases where state events have invalid commit SHAs (e.g., after migration)
		// Check if commit exists using git cat-file -e (exits with 0 if exists, 1 if not)
		checkCmd := exec.Command("git", "--git-dir", repoPath, "cat-file", "-e", ref.commit)
		checkErr := checkCmd.Run()
		if checkErr != nil {
			// Commit doesn't exist - try to fallback to current HEAD of this ref
			commitDisplay := ref.commit
			if len(ref.commit) > 8 {
				commitDisplay = ref.commit[:8]
			}
			log.Printf("⚠️ [Bridge] Commit %s doesn't exist (possibly invalid after migration), trying HEAD fallback for ref %s\n", commitDisplay, ref.ref)
			
			// Try to get current HEAD commit of this ref
			headCmd := exec.Command("git", "--git-dir", repoPath, "rev-parse", ref.ref)
			headOutput, headErr := headCmd.Output()
			if headErr == nil {
				headCommit := strings.TrimSpace(string(headOutput))
				if headCommit != "" {
					log.Printf("💡 [Bridge] Using HEAD commit %s for ref %s (fallback from invalid commit %s)\n", headCommit[:8], ref.ref, commitDisplay)
					ref.commit = headCommit // Update to use HEAD commit
				} else {
					log.Printf("⚠️ [Bridge] Ref %s has no HEAD commit, skipping update\n", ref.ref)
					continue
				}
			} else {
				log.Printf("⚠️ [Bridge] Ref %s doesn't exist yet, skipping update (commit %s invalid)\n", ref.ref, commitDisplay)
				continue
			}
		}

		// CRITICAL: Check if the commit is empty (has no files)
		// If the commit is empty and the current ref points to a commit with files, don't overwrite it
		// This prevents state events from overwriting valid commits (e.g., from GitHub clones) with empty commits
		lsTreeCmd := exec.Command("git", "--git-dir", repoPath, "ls-tree", "-r", "--name-only", ref.commit)
		lsTreeOutput, lsTreeErr := lsTreeCmd.Output()
		if lsTreeErr == nil {
			files := strings.TrimSpace(string(lsTreeOutput))
			if files == "" {
				commitDisplay := ref.commit
				if len(ref.commit) > 8 {
					commitDisplay = ref.commit[:8]
				}
				log.Printf("⚠️ [Bridge] Commit %s is empty (no files), checking if current ref has files\n", commitDisplay)
				
				// Check if current ref exists and has files
				currentRefCmd := exec.Command("git", "--git-dir", repoPath, "rev-parse", ref.ref)
				currentRefOutput, currentRefErr := currentRefCmd.Output()
				if currentRefErr == nil {
					currentCommit := strings.TrimSpace(string(currentRefOutput))
					if currentCommit != "" && currentCommit != ref.commit {
						// Check if current commit has files
						currentLsTreeCmd := exec.Command("git", "--git-dir", repoPath, "ls-tree", "-r", "--name-only", currentCommit)
						currentLsTreeOutput, currentLsTreeErr := currentLsTreeCmd.Output()
						if currentLsTreeErr == nil {
							currentFiles := strings.TrimSpace(string(currentLsTreeOutput))
							if currentFiles != "" {
								// Current ref has files, but new commit is empty - don't overwrite
								currentCommitDisplay := currentCommit
								if len(currentCommit) > 8 {
									currentCommitDisplay = currentCommit[:8]
								}
								log.Printf("🛡️ [Bridge] Skipping update: new commit %s is empty, but current ref %s points to commit %s with files\n", commitDisplay, ref.ref, currentCommitDisplay)
								log.Printf("💡 [Bridge] This prevents overwriting valid commits (e.g., from GitHub clones) with empty commits from state events\n")
								continue // Skip this ref update
							}
						}
					}
				}
			}
		}

		// Update ref using git update-ref
		// Format: git update-ref refs/heads/main commit-sha
		cmd := exec.Command("git", "--git-dir", repoPath, "update-ref", ref.ref, ref.commit)
		output, err := cmd.CombinedOutput()
		if err != nil {
			// Safely truncate commit SHA for logging (handle short SHAs)
			commitDisplay := ref.commit
			if len(ref.commit) > 8 {
				commitDisplay = ref.commit[:8]
			}
			log.Printf("⚠️ [Bridge] Failed to update ref %s to %s: %v\n", ref.ref, commitDisplay, err)
			log.Printf("🔍 [Bridge] Git output: %s\n", string(output))
			continue // Continue with other refs even if one fails
		}
		// Safely truncate commit SHA for logging (handle short SHAs)
		commitDisplay := ref.commit
		if len(ref.commit) > 8 {
			commitDisplay = ref.commit[:8]
		}
		log.Printf("✅ [Bridge] Updated ref %s to %s\n", ref.ref, commitDisplay)
	}

	// Update HEAD if specified
	if headRef != "" {
		cmd := exec.Command("git", "--git-dir", repoPath, "symbolic-ref", "HEAD", headRef)
		output, err := cmd.CombinedOutput()
		if err != nil {
			log.Printf("⚠️ [Bridge] Failed to update HEAD to %s: %v\n", headRef, err)
			log.Printf("🔍 [Bridge] Git output: %s\n", string(output))
		} else {
			log.Printf("✅ [Bridge] Updated HEAD to %s\n", headRef)
		}
	}

	log.Printf("✅ [Bridge] Successfully processed state event: pubkey=%s repo=%s\n", event.PubKey, repoName)
	return nil
}

