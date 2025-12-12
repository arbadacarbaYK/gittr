package main

import (
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/arbadacarbaYK/gitnostr"
	"github.com/arbadacarbaYK/gitnostr/bridge"
)

func isReadAllowed(rights *string) bool {
	return rights != nil && (*rights == "ADMIN" || *rights == "READ" || *rights == "WRITE")
}

func isWriteAllowed(rights *string) bool {
	return rights != nil && (*rights == "ADMIN" || *rights == "WRITE")
}

func isAdminAllowed(rights *string) bool {
	return rights != nil && (*rights == "ADMIN")
}

func main() {
	if len(os.Args) > 1 && os.Args[1] == "license" {
		fmt.Println(gitnostr.Licenses)
		os.Exit(1)
	}

	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "interactive login not allowed")
		os.Exit(1)
	}

	targetPubKey := os.Args[1]

	sshCommand := os.Getenv("SSH_ORIGINAL_COMMAND")
	if sshCommand == "" {
		fmt.Fprintln(os.Stderr, "interactive login not allowed")
		os.Exit(1)
	}

	cfg, err := bridge.LoadConfig("~/.config/git-nostr")
	if err != nil {
		fmt.Fprintf(os.Stderr, "fatal: failed to load bridge configuration: %v\n", err)
		fmt.Fprintf(os.Stderr, "hint: Ensure git-nostr-bridge is properly configured at ~/.config/git-nostr\n")
		os.Exit(1)
	}

	split := strings.SplitN(sshCommand, " ", 2)
	if len(split) < 2 {
		fmt.Fprintf(os.Stderr, "fatal: invalid git command format\n")
		fmt.Fprintf(os.Stderr, "hint: Expected format: git-upload-pack '<owner-pubkey>/<repo-name>' or git-receive-pack '<owner-pubkey>/<repo-name>'\n")
		os.Exit(1)
	}
	verb := split[0]
	repoParam := strings.Trim(split[1], "'")
	repoSplit := strings.SplitN(repoParam, "/", 2)
	if len(repoSplit) != 2 {
		fmt.Fprintf(os.Stderr, "fatal: invalid repository path format: '%s'\n", repoParam)
		fmt.Fprintf(os.Stderr, "hint: Repository path must be: <owner-pubkey>/<repo-name>\n")
		fmt.Fprintf(os.Stderr, "hint: Example: 9a83779e75080556c656d4d418d02a4d7edbe288a2f9e6dd2b48799ec935184c/repo-name\n")
		os.Exit(1)
	}

	ownerPubKey := repoSplit[0]
	_, err = hex.DecodeString(ownerPubKey)
	if err != nil {
		fmt.Fprintf(os.Stderr, "fatal: invalid repository owner pubkey in '%s'\n", repoParam)
		fmt.Fprintf(os.Stderr, "hint: Repository path must be in format: <64-char-hex-pubkey>/<repo-name>\n")
		fmt.Fprintf(os.Stderr, "hint: Example: git@gittr.space:9a83779e75080556c656d4d418d02a4d7edbe288a2f9e6dd2b48799ec935184c/repo-name.git\n")
		os.Exit(1)
	}

	repoName := repoSplit[1]
	// Remove .git suffix if present (git adds it automatically)
	repoName = strings.TrimSuffix(repoName, ".git")
	if !bridge.IsValidRepoName(repoName) {
		fmt.Fprintf(os.Stderr, "fatal: invalid repository name '%s'\n", repoName)
		fmt.Fprintf(os.Stderr, "hint: Repository names must be valid (alphanumeric, hyphens, underscores)\n")
		os.Exit(1)
	}

	reposDir, err := gitnostr.ResolvePath(cfg.RepositoryDir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "fatal: failed to resolve repository directory: %v\n", err)
		fmt.Fprintf(os.Stderr, "hint: Check bridge configuration for RepositoryDir setting\n")
		os.Exit(1)
	}

	repoParentPath := filepath.Join(reposDir, ownerPubKey)

	repoPath := filepath.Join(repoParentPath, repoName+".git")
	_, err = os.Stat(repoPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "fatal: repository '%s/%s' not found\n", ownerPubKey, repoName)
		fmt.Fprintf(os.Stderr, "hint: The repository may not exist yet on the bridge.\n")
		fmt.Fprintf(os.Stderr, "hint: If you just created it, wait a moment for the bridge to process the Nostr event.\n")
		fmt.Fprintf(os.Stderr, "hint: Or push the repository via the web UI first to ensure it's created on the bridge.\n")
		os.Exit(1)
	}

	db, err := bridge.OpenDb(cfg.DbFile)
	if err != nil {
		fmt.Fprintf(os.Stderr, "fatal: failed to open bridge database: %v\n", err)
		fmt.Fprintf(os.Stderr, "hint: Ensure git-nostr-bridge database is accessible\n")
		os.Exit(1)
	}
	defer db.Close()

	row := db.QueryRow("SELECT Repository.PublicRead,Repository.PublicWrite,RepositoryPermission.Permission FROM Repository LEFT OUTER JOIN RepositoryPermission ON Repository.OwnerPubKey=RepositoryPermission.OwnerPubKey AND Repository.RepositoryName=RepositoryPermission.RepositoryName AND TargetPubKey=? WHERE Repository.OwnerPubKey=? AND Repository.RepositoryName=?", targetPubKey, ownerPubKey, repoName)

	var publicRead bool
	var publicWrite bool
	var permission *string
	err = row.Scan(&publicRead, &publicWrite, &permission)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			// Repository exists but not in database - this can happen for newly created repos
			// Allow the operation to continue, permission checks will use defaults
		} else {
			fmt.Fprintf(os.Stderr, "fatal: failed to check repository permissions: %v\n", err)
			fmt.Fprintf(os.Stderr, "hint: Database error while checking access permissions\n")
			os.Exit(1)
		}
	}

	row = db.QueryRow("SELECT PublicRead,PublicWrite FROM RepositoryPermission WHERE OwnerPubKey=? AND RepositoryName=? AND TargetPubKey=?", ownerPubKey, repoName, targetPubKey)

	switch verb {
	case "git-upload-pack":
		if !publicRead && !isReadAllowed(permission) {
			fmt.Fprintf(os.Stderr, "fatal: permission denied for read operation on '%s/%s'\n", ownerPubKey, repoName)
			fmt.Fprintf(os.Stderr, "hint: This repository is not publicly readable and you don't have read permission.\n")
			fmt.Fprintf(os.Stderr, "hint: Contact the repository owner to request access.\n")
			os.Exit(1)
		}
	case "git-receive-pack":
		if !publicWrite && !isWriteAllowed(permission) {
			fmt.Fprintf(os.Stderr, "fatal: permission denied for write operation on '%s/%s'\n", ownerPubKey, repoName)
			fmt.Fprintf(os.Stderr, "hint: This repository is not publicly writable and you don't have write permission.\n")
			fmt.Fprintf(os.Stderr, "hint: Only repository owners and users with WRITE or ADMIN permissions can push.\n")
			fmt.Fprintf(os.Stderr, "hint: Contact the repository owner to request write access.\n")
			os.Exit(1)
		}
	default:
		if !isAdminAllowed(permission) {
			fmt.Fprintf(os.Stderr, "fatal: permission denied for admin operation on '%s/%s'\n", ownerPubKey, repoName)
			fmt.Fprintf(os.Stderr, "hint: This operation requires ADMIN permission.\n")
			os.Exit(1)
		}
	}

	c := exec.Command("git", "shell", "-c", verb+" '"+repoPath+"'")
	c.Stdout = os.Stdout
	c.Stdin = os.Stdin
	c.Stderr = os.Stderr

	err = c.Run()
	if err != nil {
		fmt.Fprintln(os.Stderr, "git error:", err)
		if e := (&exec.ExitError{}); errors.As(err, &e) {
			os.Exit(e.ExitCode())
		} else {
			os.Exit(1)
		}
	}
}
