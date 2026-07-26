package main

import (
	"strings"
	"testing"
)

// Mirrors relaxed validation in handleSshKeyEvent (sshkey.go).
func validateSshKeyContent(keyData string) (normalized string, errMsg string) {
	keyData = strings.TrimSpace(keyData)
	parts := strings.Fields(keyData)
	if len(parts) < 2 {
		return "", "need at least type and key"
	}
	keyType := parts[0]
	keyBody := parts[1]
	if !strings.HasPrefix(keyType, "ssh-") && !strings.HasPrefix(keyType, "ecdsa-") {
		return "", "invalid key type"
	}
	if keyBody == "" {
		return "", "missing key material"
	}
	if len(parts) > 2 {
		return keyType + " " + keyBody + " " + strings.Join(parts[2:], " "), ""
	}
	return keyType + " " + keyBody, ""
}

func TestValidateSshKeyContent(t *testing.T) {
	cases := []struct {
		in      string
		wantOK  bool
		wantHas string
	}{
		{"ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakeKeyMaterialHere== my laptop", true, "my laptop"},
		{"ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakeKeyMaterialHere==", true, "ssh-ed25519"},
		{"ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakeKeyMaterialHere== title with spaces here", true, "title with spaces here"},
		{"not-a-key abc", false, ""},
		{"ssh-ed25519", false, ""},
		{"", false, ""},
	}
	for _, c := range cases {
		got, errMsg := validateSshKeyContent(c.in)
		if c.wantOK {
			if errMsg != "" {
				t.Fatalf("expected ok for %q, got %s", c.in, errMsg)
			}
			if !strings.Contains(got, c.wantHas) {
				t.Fatalf("normalized %q missing %q", got, c.wantHas)
			}
		} else if errMsg == "" {
			t.Fatalf("expected error for %q", c.in)
		}
	}
}
