package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/nbd-wtf/go-nostr"
	"github.com/arbadacarbaYK/gitnostr"
	"github.com/arbadacarbaYK/gitnostr/bridge"
	"github.com/arbadacarbaYK/gitnostr/protocol"
)

func handleRepositoryEvent(event nostr.Event, db *sql.DB, cfg bridge.Config) error {
	var repo protocol.Repository
	var repoName string
	var cloneUrls []string
	var sourceUrl string
	var isDeleted bool
	var isArchived bool

	// Handle NIP-34 events (kind 30617) - data is in tags, not content
	if event.Kind == protocol.KindRepositoryNIP34 {
		// Extract repository name from "d" tag
		for _, tag := range event.Tags {
			if len(tag) >= 2 && tag[0] == "d" {
				repoName = tag[1]
				break
			}
		}
		if repoName == "" {
			return fmt.Errorf("NIP-34 event missing 'd' tag with repository name")
		}

		// Extract clone URLs from "clone" tags
		for _, tag := range event.Tags {
			if len(tag) >= 2 && tag[0] == "clone" {
				cloneUrl := tag[1]
				if cloneUrl != "" {
					cloneUrls = append(cloneUrls, cloneUrl)
				}
			}
			if len(tag) >= 2 && tag[0] == "source" {
				sourceUrl = tag[1]
			}
		}

		// Extract deleted/archived flags from content (if present) or tags
		if event.Content != "" {
			err := json.Unmarshal([]byte(event.Content), &repo)
			if err == nil {
				isDeleted = repo.Deleted
				isArchived = repo.Archived
			}
		}
		// Also check for deleted/archived in tags (some implementations use this)
		for _, tag := range event.Tags {
			if len(tag) >= 2 && tag[0] == "deleted" && tag[1] == "true" {
				isDeleted = true
			}
			if len(tag) >= 2 && tag[0] == "archived" && tag[1] == "true" {
				isArchived = true
			}
		}

		// Set default values for NIP-34
		repo.RepositoryName = repoName
		repo.PublicRead = true  // Default for NIP-34
		repo.PublicWrite = false // Default for NIP-34
		repo.Deleted = isDeleted
		repo.Archived = isArchived
	} else {
		// Legacy kind 51 - parse from JSON content
	err := json.Unmarshal([]byte(event.Content), &repo)
	if err != nil {
		return fmt.Errorf("malformed repository: %w : %v", err, event.Content)
	}
		repoName = repo.RepositoryName
	}

	if !bridge.IsValidRepoName(repoName) {
		return fmt.Errorf("invalid repository name: %v", repoName)
	}

	reposDir, err := gitnostr.ResolvePath(cfg.RepositoryDir)
	if err != nil {
		return fmt.Errorf("resolve repos path : %w", err)
	}
	repoParentPath := filepath.Join(reposDir, event.PubKey)
	repoPath := filepath.Join(repoParentPath, repoName+".git")

	if repo.Deleted {
		log.Printf("🗑️ [Bridge] Repository marked deleted: pubkey=%s repo=%s\n", event.PubKey, repoName)
		_, err := db.Exec("DELETE FROM Repository WHERE OwnerPubKey=? AND RepositoryName=?;", event.PubKey, repoName)
		if err != nil {
			return fmt.Errorf("delete repository row failed: %w", err)
		}
		_, err = db.Exec("DELETE FROM RepositoryPermission WHERE OwnerPubKey=? AND RepositoryName=?;", event.PubKey, repoName)
		if err != nil {
			return fmt.Errorf("delete repository permissions failed: %w", err)
		}
		if err := os.RemoveAll(repoPath); err != nil && !errors.Is(err, fs.ErrNotExist) {
			return fmt.Errorf("remove repository path failed: %w", err)
		}
		return nil
	}

	updatedAt := event.CreatedAt.Unix()
	res, err := db.Exec("INSERT INTO Repository (OwnerPubKey,RepositoryName,PublicRead,PublicWrite,UpdatedAt) VALUES (?,?,?,?,?) ON CONFLICT DO UPDATE SET PublicRead=?,PublicWrite=?,UpdatedAt=? WHERE UpdatedAt<?;", event.PubKey, repoName, repo.PublicRead, repo.PublicWrite, updatedAt, repo.PublicRead, repo.PublicWrite, updatedAt, updatedAt)
	if err != nil {
		return fmt.Errorf("insert repository failed: %w", err)
	}

	affected, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("rows affected failed: %w", err)
	}

	if affected == 1 {
		log.Printf("✅ [Bridge] Repository updated: pubkey=%s repo=%s\n", event.PubKey, repoName)
	}

	err = os.MkdirAll(repoParentPath, 0700)
	if err != nil {
		if errors.Is(err, fs.ErrExist) {
			//Ignore
		} else {
			return fmt.Errorf("repository path mkdir: %w", err)
		}
	}

	// Check if repository already exists
	repoExists := false
	_, err = os.Stat(repoPath)
	if err == nil {
		repoExists = true
	} else if !errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("git repository stat: %w", err)
	}

	// If repo doesn't exist, try to clone from source URL or clone URLs
	if !repoExists {
		// Priority 1: Try to clone from source URL (GitHub/GitLab/Codeberg)
		if sourceUrl != "" && (strings.Contains(sourceUrl, "github.com") || strings.Contains(sourceUrl, "gitlab.com") || strings.Contains(sourceUrl, "codeberg.org")) {
			// Convert source URL to clone URL
			cloneUrl := sourceUrl
			if !strings.HasSuffix(cloneUrl, ".git") {
				cloneUrl = cloneUrl + ".git"
			}
			log.Printf("🔍 [Bridge] Attempting to clone from source URL: %s\n", cloneUrl)
			err := cloneRepository(cloneUrl, repoPath)
			if err == nil {
				log.Printf("✅ [Bridge] Successfully cloned repository from source URL: %s\n", cloneUrl)
				return nil
			}
			log.Printf("⚠️ [Bridge] Failed to clone from source URL, will try clone URLs: %v\n", err)
		}

		// Priority 2: Try to clone from clone URLs (prefer HTTPS)
		if len(cloneUrls) > 0 {
			// Prefer HTTPS URLs over SSH
			var httpsUrl string
			for _, url := range cloneUrls {
				if strings.HasPrefix(url, "https://") || strings.HasPrefix(url, "http://") {
					httpsUrl = url
					break
				}
			}
			// If no HTTPS found, use first clone URL
			if httpsUrl == "" {
				httpsUrl = cloneUrls[0]
			}

			log.Printf("🔍 [Bridge] Attempting to clone from clone URL: %s\n", httpsUrl)
			err := cloneRepository(httpsUrl, repoPath)
			if err == nil {
				log.Printf("✅ [Bridge] Successfully cloned repository from clone URL: %s\n", httpsUrl)
				return nil
			}
			log.Printf("⚠️ [Bridge] Failed to clone from clone URL, will create empty repo: %v\n", err)
		}

		// Fallback: Create empty bare repository
		log.Printf("📦 [Bridge] Creating empty bare repository: %s\n", repoName+".git")
		cmd := exec.Command("git", "init", "--bare", repoName+".git")
		cmd.Dir = repoParentPath

		err = cmd.Run()
		if err != nil {
			return fmt.Errorf("git init --bare failed : %w", err)
		}

		// CRITICAL: Set HEAD to "main" branch so git clone works properly
		// This ensures empty repos can be cloned and pushed to immediately
		// Without this, git clone may fail or create a repo with no default branch
		headCmd := exec.Command("git", "--git-dir", repoPath, "symbolic-ref", "HEAD", "refs/heads/main")
		err = headCmd.Run()
		if err != nil {
			// If main fails, try master (some systems default to master)
			headCmd = exec.Command("git", "--git-dir", repoPath, "symbolic-ref", "HEAD", "refs/heads/master")
			err = headCmd.Run()
			if err != nil {
				log.Printf("⚠️ [Bridge] Warning: Failed to set HEAD for empty repo %s: %v\n", repoName, err)
				// Continue anyway - repo is created, user can set branch on first push
			} else {
				log.Printf("✅ [Bridge] Set HEAD to master for empty repo: %s\n", repoName)
			}
		} else {
			log.Printf("✅ [Bridge] Set HEAD to main for empty repo: %s\n", repoName)
		}
	}

	return nil
}

// Clone repository from URL to path
func cloneRepository(cloneUrl, repoPath string) error {
	// Normalize URL: convert git:// to https://, git@ to https://
	normalizedUrl := cloneUrl
	if strings.HasPrefix(normalizedUrl, "git://") {
		normalizedUrl = strings.Replace(normalizedUrl, "git://", "https://", 1)
	} else if strings.HasPrefix(normalizedUrl, "git@") {
		// Convert git@host:path to https://host/path
		normalizedUrl = strings.Replace(normalizedUrl, "git@", "https://", 1)
		normalizedUrl = strings.Replace(normalizedUrl, ":", "/", 1)
	}

	// Ensure parent directory exists
	parentDir := filepath.Dir(repoPath)
	err := os.MkdirAll(parentDir, 0700)
	if err != nil {
		return fmt.Errorf("failed to create parent directory: %w", err)
		}

	// Clone repository
	log.Printf("🔍 [Bridge] Executing: git clone --bare %s %s\n", normalizedUrl, repoPath)
	cmd := exec.Command("git", "clone", "--bare", normalizedUrl, repoPath)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	err = cmd.Run()
	if err != nil {
		return fmt.Errorf("git clone failed: %w", err)
	}

	return nil
}

func handleRepositorPermission(event nostr.Event, db *sql.DB, cfg bridge.Config) error {

	var perm protocol.RepositoryPermission
	err := json.Unmarshal([]byte(event.Content), &perm)
	if err != nil {
		return fmt.Errorf("malformed permission: %w : %v", err, event.Content)
	}

	if !bridge.IsValidRepoName(perm.RepositoryName) {
		return fmt.Errorf("invalid repository name: %v", perm.RepositoryName)
	}

	updatedAt := event.CreatedAt.Unix()
	res, err := db.Exec("INSERT INTO RepositoryPermission (OwnerPubKey,RepositoryName,TargetPubKey,Permission,UpdatedAt) VALUES (?,?,?,?,?) ON CONFLICT DO UPDATE SET Permission=?,UpdatedAt=? WHERE UpdatedAt<?;", event.PubKey, perm.RepositoryName, perm.TargetPubKey, perm.Permission, updatedAt, perm.Permission, updatedAt, updatedAt)
	if err != nil {
		return fmt.Errorf("insert permission failed: %w", err)
	}

	affected, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("rows affected failed: %w", err)
	}

	if affected == 1 {
		log.Println("permission updated", event.Content)
	}

	return nil
}
