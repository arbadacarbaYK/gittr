package main

import (
	"database/sql"
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
		return nil // Not an error - repo will be created by announcement event
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

