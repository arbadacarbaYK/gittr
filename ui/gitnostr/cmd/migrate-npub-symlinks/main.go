package main

import (
	"encoding/hex"
	"log"
	"os"
	"path/filepath"

	"github.com/nbd-wtf/go-nostr/nip19"
	"github.com/arbadacarbaYK/gitnostr"
	"github.com/arbadacarbaYK/gitnostr/bridge"
)

func main() {
	cfg, err := bridge.LoadConfig("~/.config/git-nostr")
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	reposDir, err := gitnostr.ResolvePath(cfg.RepositoryDir)
	if err != nil {
		log.Fatalf("Failed to resolve repos directory: %v", err)
	}

	log.Printf("🔍 Scanning repository directory: %s\n", reposDir)

	// Read all directories in reposDir
	entries, err := os.ReadDir(reposDir)
	if err != nil {
		log.Fatalf("Failed to read repos directory: %v", err)
	}

	created := 0
	updated := 0
	skipped := 0
	errors := 0

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		hexPubkey := entry.Name()

		// Check if it's a valid hex pubkey (64 chars)
		if len(hexPubkey) != 64 {
			log.Printf("⏭️  Skipping non-hex directory: %s\n", hexPubkey)
			continue
		}

		// Validate hex format
		if _, err := hex.DecodeString(hexPubkey); err != nil {
			log.Printf("⏭️  Skipping invalid hex directory: %s\n", hexPubkey)
			continue
		}

		// Encode hex to npub
		// nip19.EncodePublicKey(publicKeyHex string, masterRelay string)
		// masterRelay can be empty string for npub encoding
		npub, err := nip19.EncodePublicKey(hexPubkey, "")
		if err != nil {
			log.Printf("❌ Failed to encode %s to npub: %v\n", hexPubkey, err)
			errors++
			continue
		}

		hexPath := filepath.Join(reposDir, hexPubkey)
		npubPath := filepath.Join(reposDir, npub)

		// Check if symlink already exists
		linkInfo, err := os.Lstat(npubPath)
		if err == nil {
			// Symlink exists, check if it points to correct target
			target, err := os.Readlink(npubPath)
			if err == nil {
				// Resolve relative symlinks
				if !filepath.IsAbs(target) {
					target = filepath.Join(reposDir, target)
				}
				// Normalize paths for comparison
				hexPathAbs, _ := filepath.Abs(hexPath)
				targetAbs, _ := filepath.Abs(target)
				if hexPathAbs == targetAbs {
					log.Printf("✅ Symlink already exists and is correct: %s -> %s\n", npub, hexPubkey)
					skipped++
					continue
				} else {
					// Symlink exists but points to wrong target, update it
					log.Printf("🔄 Updating symlink (wrong target): %s -> %s (was: %s)\n", npub, hexPubkey, target)
					os.Remove(npubPath)
					err = os.Symlink(hexPubkey, npubPath)
					if err != nil {
						log.Printf("❌ Failed to update symlink %s: %v\n", npub, err)
						errors++
						continue
					}
					updated++
					continue
				}
			} else if linkInfo.IsDir() {
				// npub directory exists as a real directory (not symlink)
				log.Printf("⚠️  npub directory exists as real directory (not symlink): %s\n", npub)
				log.Printf("   This shouldn't happen - skipping to avoid conflicts\n")
				errors++
				continue
			}
		}

		// Create new symlink
		err = os.Symlink(hexPubkey, npubPath)
		if err != nil {
			log.Printf("❌ Failed to create symlink %s -> %s: %v\n", npub, hexPubkey, err)
			errors++
			continue
		}

		log.Printf("🔗 Created symlink: %s -> %s\n", npub, hexPubkey)
		created++
	}

	log.Printf("\n📊 Migration Summary:")
	log.Printf("   Created: %d symlinks", created)
	log.Printf("   Updated: %d symlinks", updated)
	log.Printf("   Skipped: %d (already correct)", skipped)
	log.Printf("   Errors: %d", errors)
	log.Printf("   Total hex directories processed: %d\n", len(entries))

	if errors > 0 {
		log.Printf("⚠️  Some errors occurred during migration. Review the logs above.\n")
		os.Exit(1)
	} else {
		log.Printf("✅ Migration completed successfully!\n")
	}
}

