package main

import (
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/arbadacarbaYK/gitnostr"
	"github.com/arbadacarbaYK/gitnostr/bridge"
	"github.com/arbadacarbaYK/gitnostr/protocol"
	"github.com/nbd-wtf/go-nostr"
	"github.com/nbd-wtf/go-nostr/nip19"
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
		// and visibility tags (gittr extension: ["public-read","true|false"],
		// ["public-write","true|false"]). Missing tags keep the NIP-34 defaults
		// (public read, owner-only write) so older announcements stay public.
		publicRead := true
		publicWrite := false
		for _, tag := range event.Tags {
			if len(tag) >= 2 && tag[0] == "deleted" && tag[1] == "true" {
				isDeleted = true
			}
			if len(tag) >= 2 && tag[0] == "archived" && tag[1] == "true" {
				isArchived = true
			}
			if len(tag) >= 2 && tag[0] == "public-read" && tag[1] == "false" {
				publicRead = false
			}
			if len(tag) >= 2 && tag[0] == "public-write" && tag[1] == "true" {
				publicWrite = true
			}
		}

		// Set values for NIP-34 (visibility from tags, defaults above)
		repo.RepositoryName = repoName
		repo.PublicRead = publicRead
		repo.PublicWrite = publicWrite
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
		_, _ = db.Exec("DELETE FROM RepositoryPushPolicy WHERE OwnerPubKey=? AND RepositoryName=?;", event.PubKey, repoName)
		_, _ = db.Exec("DELETE FROM RepositoryPushPayment WHERE OwnerPubKey=? AND RepositoryName=?;", event.PubKey, repoName)
		if err := os.RemoveAll(repoPath); err != nil && !errors.Is(err, fs.ErrNotExist) {
			return fmt.Errorf("remove repository path failed: %w", err)
		}
		return nil
	}

	updatedAt := event.CreatedAt.Unix()
	// HostedAt set only on INSERT (first host); UPDATEs must not rewind it.
	res, err := db.Exec("INSERT INTO Repository (OwnerPubKey,RepositoryName,PublicRead,PublicWrite,UpdatedAt,HostedAt) VALUES (?,?,?,?,?,?) ON CONFLICT DO UPDATE SET PublicRead=?,PublicWrite=?,UpdatedAt=? WHERE UpdatedAt<?;", event.PubKey, repoName, repo.PublicRead, repo.PublicWrite, updatedAt, updatedAt, repo.PublicRead, repo.PublicWrite, updatedAt, updatedAt)
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

	// Sync NIP-34 maintainers into RepositoryPermission (Permission=WRITE) so
	// SSH and web-API ACLs cover gittr contributors. gittr publishes no kind-50
	// permission events — the 30617 announcement is the source of truth, so
	// stale rows for this repo are replaced whenever a newer event arrives.
	if event.Kind == protocol.KindRepositoryNIP34 {
		var maintainers []string
		for _, tag := range event.Tags {
			if len(tag) >= 2 && (tag[0] == "maintainers" || tag[0] == "merge_maintainers") {
				for _, v := range tag[1:] {
					v = strings.ToLower(strings.TrimSpace(v))
					if len(v) == 64 {
						if _, err := hex.DecodeString(v); err == nil {
							maintainers = append(maintainers, v)
						}
					}
				}
			}
		}
		if _, err := db.Exec("DELETE FROM RepositoryPermission WHERE OwnerPubKey=? AND RepositoryName=? AND UpdatedAt<?;", event.PubKey, repoName, updatedAt); err != nil {
			log.Printf("⚠️ [Bridge] Failed to clear stale permissions for %s/%s: %v\n", event.PubKey, repoName, err)
		}
		for _, m := range maintainers {
			if strings.EqualFold(m, event.PubKey) {
				continue // owner has implicit ADMIN
			}
			if _, err := db.Exec("INSERT INTO RepositoryPermission (OwnerPubKey,RepositoryName,TargetPubKey,Permission,UpdatedAt) VALUES (?,?,?,?,?) ON CONFLICT DO UPDATE SET Permission=?,UpdatedAt=? WHERE UpdatedAt<?;", event.PubKey, repoName, m, "WRITE", updatedAt, "WRITE", updatedAt, updatedAt); err != nil {
				log.Printf("⚠️ [Bridge] Failed to sync maintainer permission %s on %s/%s: %v\n", m, event.PubKey, repoName, err)
			}
		}
	}

	// Optional repo-level push cost policy from NIP-34 tags.
	// Tag format: ["push_cost_sats", "<integer>"].
	pushCostSats := 0
	for _, tag := range event.Tags {
		if len(tag) >= 2 && tag[0] == "push_cost_sats" {
			if parsed, parseErr := strconv.Atoi(strings.TrimSpace(tag[1])); parseErr == nil && parsed >= 0 {
				pushCostSats = parsed
			}
			break
		}
	}
	_, err = db.Exec(
		"INSERT INTO RepositoryPushPolicy (OwnerPubKey,RepositoryName,PushCostSats,UpdatedAt) VALUES (?,?,?,?) ON CONFLICT DO UPDATE SET PushCostSats=?,UpdatedAt=? WHERE UpdatedAt<=?;",
		event.PubKey, repoName, pushCostSats, updatedAt,
		pushCostSats, updatedAt, updatedAt,
	)
	if err != nil {
		return fmt.Errorf("insert push policy failed: %w", err)
	}

	hostedHere := cloneUrlsHostOnOurGrasp(cloneUrls)

	// Check if repository already exists on disk
	repoExists := false
	if _, errStat := os.Stat(repoPath); errStat == nil {
		repoExists = true
	} else if !errors.Is(errStat, fs.ErrNotExist) {
		return fmt.Errorf("git repository stat: %w", errStat)
	}

	// Only create owner dirs when we host this repo (or it already exists).
	if hostedHere || repoExists {
		if err = os.MkdirAll(repoParentPath, 0750); err != nil && !errors.Is(err, fs.ErrExist) {
			return fmt.Errorf("repository path mkdir: %w", err)
		}
		// HTTPS git (git-http-backend via fcgiwrap as www-data) must traverse owner dirs.
		if st, errStat := os.Stat(repoParentPath); errStat == nil && st.IsDir() {
			_ = os.Chmod(repoParentPath, 0750)
		}
	}

	// Public GRASP retention: only materialize / refresh bare repos we host.
	// clone[] must include this bridge (git.gittr.space). Do NOT git-clone every
	// foreign GitHub/ngit announce onto disk — that mirrored the whole Nostr-git
	// network. UI still browses foreign remotes via temp shallow fetch.

	// Existing hosted repos: refresh forge tip when source is set (import/sync).
	if repoExists && hostedHere && sourceUrl != "" && looksLikeExternalGitRemote(sourceUrl) {
		upstreamCloneUrl := sourceUrl
		if !strings.HasSuffix(upstreamCloneUrl, ".git") {
			upstreamCloneUrl = upstreamCloneUrl + ".git"
		}
		setCmd := exec.Command("git", "--git-dir", repoPath, "remote", "set-url", "upstream", upstreamCloneUrl)
		if setCmd.Run() != nil {
			addCmd := exec.Command("git", "--git-dir", repoPath, "remote", "add", "upstream", upstreamCloneUrl)
			if err := addCmd.Run(); err != nil {
				log.Printf("⚠️ [Bridge] Could not set upstream remote to %s: %v\n", upstreamCloneUrl, err)
			} else {
				log.Printf("🔗 [Bridge] Added upstream remote: %s\n", upstreamCloneUrl)
			}
		} else {
			log.Printf("🔗 [Bridge] Updated upstream remote: %s\n", upstreamCloneUrl)
		}
		fetchCmd := exec.Command("git", "--git-dir", repoPath, "fetch", "--prune", "upstream", "+refs/heads/*:refs/heads/*", "+refs/tags/*:refs/tags/*")
		if out, err := fetchCmd.CombinedOutput(); err != nil {
			log.Printf("⚠️ [Bridge] Upstream fetch failed for %s: %v (%s)\n", upstreamCloneUrl, err, string(out))
		} else {
			log.Printf("✅ [Bridge] Refreshed bare mirror from upstream: %s\n", upstreamCloneUrl)
			ensureRepoOwnedByGitNostr(repoPath)
		}
	}

	if !repoExists {
		if !hostedHere {
			// SQLite/ACL row already upserted above — skip disk for foreign-only announces.
			log.Printf("⏭️ [Bridge] Skip bare materialize (no git.gittr.space clone tag): pubkey=%s repo=%s\n", event.PubKey, repoName)
		} else {
			// Hosted on this GRASP: empty bare ready for push/import (do not clone foreign remotes here).
			// Forge fill is explicit via UI sync-from-source / import APIs.
			log.Printf("📦 [Bridge] Creating empty bare repository (hosted on this GRASP): %s\n", repoName+".git")
			cmd := exec.Command("git", "init", "--bare", repoName+".git")
			cmd.Dir = repoParentPath

			err = cmd.Run()
			if err != nil {
				return fmt.Errorf("git init --bare failed : %w", err)
			}

			ensureUploadPackBrowserCaps(repoPath)
			ensureRepoOwnedByGitNostr(repoPath)

			headCmd := exec.Command("git", "--git-dir", repoPath, "symbolic-ref", "HEAD", "refs/heads/main")
			err = headCmd.Run()
			if err != nil {
				headCmd = exec.Command("git", "--git-dir", repoPath, "symbolic-ref", "HEAD", "refs/heads/master")
				err = headCmd.Run()
				if err != nil {
					log.Printf("⚠️ [Bridge] Warning: Failed to set HEAD for empty repo %s: %v\n", repoName, err)
				} else {
					log.Printf("✅ [Bridge] Set HEAD to master for empty repo: %s\n", repoName)
				}
			} else {
				log.Printf("✅ [Bridge] Set HEAD to main for empty repo: %s\n", repoName)
			}
		}
	}

	// npub→hex symlink only when we actually host a directory for this owner
	if (hostedHere || repoExists) && event.PubKey != "" && len(event.PubKey) == 64 {
		// Check if pubkey is valid hex
		if _, err := hex.DecodeString(event.PubKey); err == nil {
			// Encode hex pubkey to npub format
			// go-nostr nip19 package: EncodePublicKey(publicKeyHex string, masterRelay string)
			// masterRelay can be empty string for npub encoding
			npub, err := nip19.EncodePublicKey(event.PubKey, "")
			if err == nil {
				npubParentPath := filepath.Join(reposDir, npub)
				// Create symlink from npub to hex directory
				// Only create if it doesn't exist or is broken
				if _, err := os.Lstat(npubParentPath); os.IsNotExist(err) {
					err = os.Symlink(event.PubKey, npubParentPath)
					if err == nil {
						log.Printf("🔗 [Bridge] Created npub symlink: %s -> %s\n", npub, event.PubKey)
					} else {
						log.Printf("⚠️ [Bridge] Failed to create npub symlink: %v\n", err)
					}
				} else {
					// Check if existing symlink points to correct target
					target, err := os.Readlink(npubParentPath)
					if err == nil && target != event.PubKey {
						// Symlink exists but points to wrong target, update it
						os.Remove(npubParentPath)
						err = os.Symlink(event.PubKey, npubParentPath)
						if err == nil {
							log.Printf("🔗 [Bridge] Updated npub symlink: %s -> %s\n", npub, event.PubKey)
						}
					}
				}
			}
		}
	}

	return nil
}

// isOurGraspHostUrl is true for clone URLs that point at this bridge's public GRASP.
func isOurGraspHostUrl(u string) bool {
	lower := strings.ToLower(strings.TrimSpace(u))
	if lower == "" {
		return false
	}
	return strings.Contains(lower, "git.gittr.space")
}

func cloneUrlsHostOnOurGrasp(cloneUrls []string) bool {
	for _, u := range cloneUrls {
		if isOurGraspHostUrl(u) {
			return true
		}
	}
	return false
}

// looksLikeExternalGitRemote is true for public HTTPS/HTTP/git@ remotes the bridge
// can git-clone as NIP-34 source (GitHub, GitLab, Codeberg, Gitea, self-hosted).
// False for empty URLs and Nostr GRASP paths that already use /npub1…/repo.
func looksLikeExternalGitRemote(sourceUrl string) bool {
	u := strings.TrimSpace(sourceUrl)
	if u == "" {
		return false
	}
	lower := strings.ToLower(u)
	if strings.Contains(lower, "/npub1") {
		return false
	}
	if strings.HasPrefix(lower, "git@") {
		parts := strings.SplitN(u, ":", 2)
		return len(parts) == 2 && strings.Contains(parts[1], "/")
	}
	if strings.HasPrefix(lower, "https://") || strings.HasPrefix(lower, "http://") {
		withoutScheme := lower
		if strings.HasPrefix(withoutScheme, "https://") {
			withoutScheme = withoutScheme[len("https://"):]
		} else {
			withoutScheme = withoutScheme[len("http://"):]
		}
		pathParts := strings.Split(withoutScheme, "/")
		// host + at least owner + repo
		return len(pathParts) >= 3 && pathParts[0] != "" && pathParts[1] != "" && pathParts[2] != ""
	}
	return false
}

// Clone repository from URL to path
// ensureUploadPackBrowserCaps advertises partial-clone filter + tip SHA wants.
// gitworkshop's explorer requires the "filter" capability; without it info/refs
// succeeds but tree fetch fails as "upload-pack failed".
func ensureUploadPackBrowserCaps(repoPath string) {
	_ = exec.Command("git", "--git-dir", repoPath, "config", "uploadpack.allowFilter", "true").Run()
	_ = exec.Command("git", "--git-dir", repoPath, "config", "uploadpack.allowAnySHA1InWant", "true").Run()
	_ = exec.Command("git", "--git-dir", repoPath, "config", "uploadpack.allowReachableSHA1InWant", "true").Run()
}

func ensureRepoOwnedByGitNostr(repoPath string) {
	// Bridge may run as root (systemd) while SSH git runs as git-nostr — root-owned
	// bare repos cause "detected dubious ownership" / exit 128 for clones.
	chownCmd := exec.Command("chown", "-R", "git-nostr:git-nostr", repoPath)
	if out, err := chownCmd.CombinedOutput(); err != nil {
		chownCmd2 := exec.Command("sudo", "chown", "-R", "git-nostr:git-nostr", repoPath)
		if out2, err2 := chownCmd2.CombinedOutput(); err2 != nil {
			log.Printf("⚠️  [Bridge] Failed to chown %s to git-nostr: %v / %v (%s %s)", repoPath, err, err2, string(out), string(out2))
		}
	}
	parent := filepath.Dir(repoPath)
	_ = exec.Command("chown", "git-nostr:git-nostr", parent).Run()
	_ = os.Chmod(parent, 0750)
}

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

	ensureRepoOwnedByGitNostr(repoPath)
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
