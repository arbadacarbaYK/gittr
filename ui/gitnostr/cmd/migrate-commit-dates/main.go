package main

import (
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/arbadacarbaYK/gitnostr/bridge"
	"github.com/arbadacarbaYK/gitnostr"
)

func main() {
	log.Println("🔄 Starting commit date migration...")
	log.Println("📋 This script will update commit dates in bridge repos to match their UpdatedAt timestamps from the database")

	// Try to load config from git-nostr user's home first, then fallback to current user
	configPath := "/home/git-nostr/.config/git-nostr"
	if _, err := os.Stat(configPath); os.IsNotExist(err) {
		// Fallback to current user's config
		configPath = "~/.config/git-nostr"
	}
	cfg, err := bridge.LoadConfig(configPath)
	if err != nil {
		log.Fatalf("fatal: failed to load bridge configuration: %v", err)
	}

	// Open database (use same method as bridge)
	db, err := bridge.OpenDb(cfg.DbFile)
	if err != nil {
		log.Fatalf("fatal: failed to open database: %v", err)
	}
	defer db.Close()

	// Resolve repository directory
	reposDir, err := gitnostr.ResolvePath(cfg.RepositoryDir)
	if err != nil {
		log.Fatalf("fatal: failed to resolve repository directory: %v", err)
	}

	log.Printf("📁 Repository directory: %s", reposDir)
	log.Printf("💾 Database: %s", cfg.DbFile)

	// Query all repositories with their UpdatedAt timestamps
	rows, err := db.Query("SELECT OwnerPubKey, RepositoryName, UpdatedAt FROM Repository ORDER BY OwnerPubKey, RepositoryName")
	if err != nil {
		log.Fatalf("fatal: failed to query repositories: %v", err)
	}
	defer rows.Close()

	migratedCount := 0
	skippedCount := 0
	errorCount := 0

	for rows.Next() {
		var ownerPubkey, repoName string
		var updatedAt int64

		if err := rows.Scan(&ownerPubkey, &repoName, &updatedAt); err != nil {
			log.Printf("⚠️ Error scanning row: %v", err)
			errorCount++
			continue
		}

		repoPath := filepath.Join(reposDir, ownerPubkey, repoName+".git")

		// Check if repo exists
		if _, err := os.Stat(repoPath); os.IsNotExist(err) {
			log.Printf("⏭️  Skipping %s/%s (repo not found on disk)", safePubkeyDisplay(ownerPubkey), repoName)
			skippedCount++
			continue
		}

		// Get the latest commit SHA for the default branch
		cmd := exec.Command("git", "--git-dir", repoPath, "rev-parse", "HEAD")
		output, err := cmd.Output()
		if err != nil {
			log.Printf("⚠️  Failed to get HEAD for %s/%s: %v", safePubkeyDisplay(ownerPubkey), repoName, err)
			errorCount++
			continue
		}

		latestCommitSHA := strings.TrimSpace(string(output))
		if len(latestCommitSHA) < 40 {
			log.Printf("⚠️  Invalid commit SHA for %s/%s: %s", safePubkeyDisplay(ownerPubkey), repoName, latestCommitSHA)
			errorCount++
			continue
		}

		// Get current commit date
		cmd = exec.Command("git", "--git-dir", repoPath, "log", "-1", "--format=%ct", latestCommitSHA)
		output, err = cmd.Output()
		if err != nil {
			log.Printf("⚠️  Failed to get commit date for %s/%s: %v", safePubkeyDisplay(ownerPubkey), repoName, err)
			errorCount++
			continue
		}

		var currentCommitTime int64
		if _, err := fmt.Sscanf(string(output), "%d", &currentCommitTime); err != nil {
			log.Printf("⚠️  Failed to parse commit date for %s/%s: %v", safePubkeyDisplay(ownerPubkey), repoName, err)
			errorCount++
			continue
		}

		// Check if commit date matches UpdatedAt (within 5 seconds tolerance)
		if abs(currentCommitTime-updatedAt) <= 5 {
			log.Printf("✅ %s/%s: Commit date already matches UpdatedAt (%s)", safePubkeyDisplay(ownerPubkey), repoName, time.Unix(updatedAt, 0).Format(time.RFC3339))
			skippedCount++
			continue
		}

		log.Printf("🔄 Migrating %s/%s: Updating commit date from %s to %s", 
			safePubkeyDisplay(ownerPubkey), repoName,
			time.Unix(currentCommitTime, 0).Format(time.RFC3339),
			time.Unix(updatedAt, 0).Format(time.RFC3339))

		// CRITICAL: Fix ownership before running filter-branch to avoid permission errors
		// Ensure git-nostr user owns the repo directory and all its contents
		// This is needed because filter-branch needs to write to .git/objects
		// Try chown directly first (works if running as root), then try sudo (works if git-nostr has sudo)
		chownCmd := exec.Command("chown", "-R", "git-nostr:git-nostr", repoPath)
		if _, chownErr := chownCmd.CombinedOutput(); chownErr != nil {
			// Try with sudo (might work if git-nostr has sudo privileges)
			chownCmd2 := exec.Command("sudo", "chown", "-R", "git-nostr:git-nostr", repoPath)
			if chownOutput2, chownErr2 := chownCmd2.CombinedOutput(); chownErr2 != nil {
				log.Printf("⚠️  Failed to fix ownership for %s/%s (tried direct and sudo): %v\nOutput: %s", safePubkeyDisplay(ownerPubkey), repoName, chownErr2, string(chownOutput2))
				// Continue anyway - might still work if permissions are already correct
			}
		}

		// Update commit date using git filter-branch
		// Format: git filter-branch -f --env-filter 'export GIT_AUTHOR_DATE="..." GIT_COMMITTER_DATE="..."' HEAD
		commitDateRFC2822 := time.Unix(updatedAt, 0).UTC().Format(time.RFC1123Z)
		envFilter := fmt.Sprintf("export GIT_AUTHOR_DATE=\"%s\" GIT_COMMITTER_DATE=\"%s\"", commitDateRFC2822, commitDateRFC2822)

		cmd = exec.Command("git", "--git-dir", repoPath, "filter-branch", "-f", "--env-filter", envFilter, "HEAD")
		cmd.Env = append(os.Environ(), "FILTER_BRANCH_SQUELCH_WARNING=1") // Suppress warnings
		output, err = cmd.CombinedOutput()
		if err != nil {
			log.Printf("❌ Failed to update commit date for %s/%s: %v\nOutput: %s", safePubkeyDisplay(ownerPubkey), repoName, err, string(output))
			errorCount++
			continue
		}

		// Clean up filter-branch backup refs
		cmd = exec.Command("git", "--git-dir", repoPath, "for-each-ref", "--format=%(refname)", "refs/original/")
		output, err = cmd.Output()
		if err == nil && len(output) > 0 {
			// Remove backup refs
			cmd = exec.Command("git", "--git-dir", repoPath, "for-each-ref", "--format=%(refname)", "refs/original/")
			refsOutput, _ := cmd.Output()
			if len(refsOutput) > 0 {
				// Remove each backup ref
				refs := string(refsOutput)
				for _, ref := range splitLines(refs) {
					if ref != "" {
						exec.Command("git", "--git-dir", repoPath, "update-ref", "-d", ref).Run()
					}
				}
			}
		}

		// Verify the update
		cmd = exec.Command("git", "--git-dir", repoPath, "log", "-1", "--format=%ct", "HEAD")
		output, err = cmd.Output()
		if err == nil {
			var newCommitTime int64
			if _, err := fmt.Sscanf(string(output), "%d", &newCommitTime); err == nil {
				if abs(newCommitTime-updatedAt) <= 5 {
					log.Printf("✅ %s/%s: Successfully updated commit date", safePubkeyDisplay(ownerPubkey), repoName)
					migratedCount++
				} else {
					log.Printf("⚠️  %s/%s: Commit date updated but doesn't match (got %d, expected %d)", safePubkeyDisplay(ownerPubkey), repoName, newCommitTime, updatedAt)
					errorCount++
				}
			}
		}
	}

	if err := rows.Err(); err != nil {
		log.Fatalf("fatal: error iterating rows: %v", err)
	}

	log.Println("\n📊 Migration Summary:")
	log.Printf("   ✅ Migrated: %d repos", migratedCount)
	log.Printf("   ⏭️  Skipped: %d repos (already correct or not found)", skippedCount)
	log.Printf("   ❌ Errors: %d repos", errorCount)

	if errorCount == 0 {
		log.Println("✅ Migration completed successfully!")
	} else {
		log.Println("⚠️  Migration completed with errors. Please check logs above.")
		os.Exit(1)
	}
}

func abs(x int64) int64 {
	if x < 0 {
		return -x
	}
	return x
}

func splitLines(s string) []string {
	return strings.FieldsFunc(s, func(c rune) bool {
		return c == '\n' || c == '\r'
	})
}

// safePubkeyDisplay safely truncates a pubkey for display purposes
// Returns first 8 characters if available, or the full string if shorter
func safePubkeyDisplay(pubkey string) string {
	if len(pubkey) >= 8 {
		return pubkey[:8]
	}
	return pubkey
}

