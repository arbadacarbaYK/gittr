package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/nbd-wtf/go-nostr"
	"github.com/arbadacarbaYK/gitnostr"
	"github.com/arbadacarbaYK/gitnostr/protocol"
)

func repoCreate(cfg Config, pool *nostr.RelayPool) {
	flags := flag.NewFlagSet("repo create", flag.ContinueOnError)

	flags.Parse(os.Args[3:])

	repoName := flags.Args()[0]

	log.Println("repo create ", repoName)

	// NIP-34: Build tags array with required metadata
	// Content MUST be empty per NIP-34 spec - all metadata goes in tags
	// NOTE: Privacy is NOT encoded in NIP-34 events (per spec)
	// Privacy is enforced via the "maintainers" tag (NIP-34 spec) and bridge access control
	tags := nostr.Tags{
		{"d", repoName}, // Replaceable event identifier (NIP-34 required)
		{"name", repoName}, // Human-readable project name
		{"description", fmt.Sprintf("Repository: %s", repoName)}, // Description
	}

	// Add clone tag if GitSshBase is configured
	// Convert SSH base to HTTPS clone URL if possible
	if cfg.GitSshBase != "" {
		// Try to extract domain from GitSshBase (format: git@domain or domain)
		cloneUrl := cfg.GitSshBase
		if strings.Contains(cloneUrl, "@") {
			// Format: git@domain -> https://domain
			parts := strings.Split(cloneUrl, "@")
			if len(parts) == 2 {
				cloneUrl = "https://" + parts[1]
			}
		} else if !strings.Contains(cloneUrl, "://") {
			// No protocol specified, assume HTTPS
			cloneUrl = "https://" + cloneUrl
		}
		tags = append(tags, []string{"clone", cloneUrl})
	}

	// NIP-34: Content field MUST be empty - all metadata in tags
	_, statuses, err := pool.PublishEvent(&nostr.Event{
		CreatedAt: time.Now(),
		Kind:      protocol.KindRepositoryNIP34, // NIP-34: Use kind 30617
		Tags:      tags,
		Content:   "", // NIP-34: Content MUST be empty
	})
	if err != nil {
		log.Fatal(err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	publishSuccess := false

	for {
		select {
		case <-ctx.Done():
			if !publishSuccess {
				fmt.Printf("repository was not published")
				os.Exit(1)
			}
			return
		case status := <-statuses:
			switch status.Status {
			case nostr.PublishStatusSent:
				publishSuccess = true
				fmt.Printf("published repository to '%s'.\n", status.Relay)
			case nostr.PublishStatusFailed:
				fmt.Printf("failed to publish repository to '%s'.\n", status.Relay)
			case nostr.PublishStatusSucceeded:
				publishSuccess = true
				fmt.Printf("published repository to '%s'.\n", status.Relay)
			}
		}
	}
}

func repoPermission(cfg Config, pool *nostr.RelayPool) {

	targetPubKey, err := gitnostr.ResolveHexPubKey(os.Args[4])
	if err != nil {
		log.Fatal(err)
	}

	permJson, err := json.Marshal(protocol.RepositoryPermission{
		RepositoryName: os.Args[3],
		TargetPubKey:   targetPubKey,
		Permission:     os.Args[5],
	})

	if err != nil {
		log.Fatal("permission marshal :", err)
	}

	var tags nostr.Tags
	_, statuses, err := pool.PublishEvent(&nostr.Event{
		CreatedAt: time.Now(),
		Kind:      protocol.KindRepositoryPermission,
		Tags:      tags,
		Content:   string(permJson),
	})
	if err != nil {
		log.Fatal(err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	publishSuccess := false

	for {
		select {
		case <-ctx.Done():
			if !publishSuccess {
				fmt.Printf("permission was not published")
				os.Exit(1)
			}
			return
		case status := <-statuses:
			switch status.Status {
			case nostr.PublishStatusSent:
				publishSuccess = true
				fmt.Printf("published permission to '%s'.\n", status.Relay)
			case nostr.PublishStatusFailed:
				fmt.Printf("failed to publish permission to '%s'.\n", status.Relay)
			case nostr.PublishStatusSucceeded:
				publishSuccess = true
				fmt.Printf("published permission to '%s'.\n", status.Relay)
			}
		}
	}

}

func repoClone(cfg Config, pool *nostr.RelayPool) {

	repoParam := os.Args[3]
	// steve@localhost:public

	split := strings.SplitN(repoParam, ":", 2)

	name := split[0]
	repoName := split[1]

	identifier, err := gitnostr.ResolveHexPubKey(name)
	if err != nil {
		log.Fatal(err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Query for both legacy (kind 51) and NIP-34 (kind 30617) events
	_, subchan := pool.Sub(nostr.Filters{{Kinds: []int{protocol.KindRepository, protocol.KindRepositoryNIP34}, Authors: []string{identifier}}})

	var pubKey string
	var repository protocol.Repository

	for {
		select {
		case <-ctx.Done():
			if pubKey != "" {
				log.Println("git", "clone", repository.GitSshBase+":"+pubKey+"/"+repoName)
				cmd := exec.Command("git", "clone", repository.GitSshBase+":"+pubKey+"/"+repoName)
				cmd.Stdout = os.Stdout
				cmd.Stdin = os.Stdin
				cmd.Stderr = os.Stderr
				err := cmd.Run()
				if err != nil {
					log.Fatal(err)
				}
			} else {
				log.Fatal("Repo not found")
			}

			return
		case event := <-subchan:
			var checkRepo protocol.Repository
			var checkRepoName string

			// Handle NIP-34 events (kind 30617) - data is in tags, not content
			if event.Event.Kind == protocol.KindRepositoryNIP34 {
				// Extract repository name from "d" tag
				for _, tag := range event.Event.Tags {
					if len(tag) >= 2 && tag[0] == "d" {
						checkRepoName = tag[1]
						break
					}
				}
				// Set default values for NIP-34
				checkRepo.RepositoryName = checkRepoName
				checkRepo.PublicRead = true
				checkRepo.PublicWrite = false
				// Extract GitSshBase from clone tags if available
				for _, tag := range event.Event.Tags {
					if len(tag) >= 2 && tag[0] == "clone" {
						cloneUrl := tag[1]
						// Try to extract domain from clone URL
						if strings.HasPrefix(cloneUrl, "https://") {
							domain := strings.TrimPrefix(cloneUrl, "https://")
							domain = strings.Split(domain, "/")[0]
							checkRepo.GitSshBase = "git@" + domain
						} else if strings.HasPrefix(cloneUrl, "http://") {
							domain := strings.TrimPrefix(cloneUrl, "http://")
							domain = strings.Split(domain, "/")[0]
							checkRepo.GitSshBase = "git@" + domain
						}
						break
					}
				}
			} else {
				// Legacy kind 51 - parse from JSON content
				err := json.Unmarshal([]byte(event.Event.Content), &checkRepo)
				if err != nil {
					log.Println("Failed to parse repository.")
					continue
				}
				checkRepoName = checkRepo.RepositoryName
			}

			if checkRepoName == repoName {
				repository = checkRepo
				pubKey = event.Event.PubKey
			}
		}
	}
}
