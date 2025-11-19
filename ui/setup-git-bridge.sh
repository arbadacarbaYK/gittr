#!/bin/bash
# Setup script for git-nostr-bridge (for development/testing)
# For production, see GIT_NOSTR_BRIDGE_SETUP.md

set -e

echo "========================================="
echo "Git-Nostr-Bridge Setup Script"
echo "========================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if running as root
if [ "$EUID" -eq 0 ]; then 
   echo -e "${RED}ERROR: Do not run this script as root!${NC}"
   echo "The git-nostr-bridge should NOT run as root for security reasons."
   echo "For production, create a dedicated user (see GIT_NOSTR_BRIDGE_SETUP.md)"
   exit 1
fi

# Check Go installation
echo "Checking Go installation..."
if ! command -v go &> /dev/null; then
    echo -e "${YELLOW}Go is not installed.${NC}"
    echo "Installing Go 1.21.5..."
    
    # Detect OS
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        echo "Downloading Go for Linux..."
        wget -q https://go.dev/dl/go1.21.5.linux-amd64.tar.gz
        sudo rm -rf /usr/local/go
        sudo tar -C /usr/local -xzf go1.21.5.linux-amd64.tar.gz
        rm go1.21.5.linux-amd64.tar.gz
        
        # Add to PATH
        if ! grep -q '/usr/local/go/bin' ~/.bashrc; then
            echo 'export PATH=$PATH:/usr/local/go/bin' >> ~/.bashrc
        fi
        export PATH=$PATH:/usr/local/go/bin
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        echo "For macOS, please install Go using Homebrew:"
        echo "  brew install go"
        exit 1
    else
        echo -e "${RED}Unsupported OS. Please install Go manually.${NC}"
        exit 1
    fi
fi

GO_VERSION=$(go version | awk '{print $3}')
echo -e "${GREEN}✓ Go installed: $GO_VERSION${NC}"

# Check Go version (need 1.20+)
GO_MAJOR=$(echo $GO_VERSION | cut -d. -f1 | sed 's/go//')
GO_MINOR=$(echo $GO_VERSION | cut -d. -f2)
if [ "$GO_MAJOR" -lt 1 ] || ([ "$GO_MAJOR" -eq 1 ] && [ "$GO_MINOR" -lt 20 ]); then
    echo -e "${RED}ERROR: Go 1.20+ required. Current version: $GO_VERSION${NC}"
    exit 1
fi

# Navigate to gitnostr directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
GITNOSTR_DIR="$SCRIPT_DIR/gitnostr"

if [ ! -d "$GITNOSTR_DIR" ]; then
    echo -e "${RED}ERROR: gitnostr directory not found at $GITNOSTR_DIR${NC}"
    exit 1
fi

cd "$GITNOSTR_DIR"

echo ""
echo "Building git-nostr-bridge..."
make git-nostr-bridge

if [ ! -f "./bin/git-nostr-bridge" ]; then
    echo -e "${RED}ERROR: Failed to build git-nostr-bridge${NC}"
    exit 1
fi

if [ ! -f "./bin/git-nostr-ssh" ]; then
    echo -e "${RED}ERROR: Failed to build git-nostr-ssh${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Build successful!${NC}"

# Initialize config if it doesn't exist
CONFIG_DIR="$HOME/.config/git-nostr"
CONFIG_FILE="$CONFIG_DIR/git-nostr-bridge.json"

if [ ! -f "$CONFIG_FILE" ]; then
    echo ""
    echo "Creating initial configuration..."
    mkdir -p "$CONFIG_DIR"
    
    # Run bridge once to generate default config
    ./bin/git-nostr-bridge &
    BRIDGE_PID=$!
    sleep 2
    kill $BRIDGE_PID 2>/dev/null || true
    wait $BRIDGE_PID 2>/dev/null || true
    
    if [ -f "$CONFIG_FILE" ]; then
        echo -e "${GREEN}✓ Configuration file created at $CONFIG_FILE${NC}"
        echo ""
        echo -e "${YELLOW}Please edit $CONFIG_FILE and add:${NC}"
        echo "  - Your Nostr relays (relays array)"
        echo "  - Your Nostr pubkey (gitRepoOwners array)"
        echo ""
        echo "Example:"
        echo '{'
        echo '    "repositoryDir": "~/git-nostr-repositories",'
        echo '    "DbFile": "~/.config/git-nostr/git-nostr-db.sqlite",'
        echo '    "relays": ["wss://relay.damus.io", "wss://nos.lol"],'
        echo '    "gitRepoOwners": ["<your-pubkey-here>"]'
        echo '}'
    else
        echo -e "${YELLOW}⚠ Could not auto-generate config.${NC}"
        echo "You'll need to run ./bin/git-nostr-bridge once manually to generate it."
    fi
else
    echo -e "${GREEN}✓ Configuration file already exists at $CONFIG_FILE${NC}"
fi

echo ""
echo "========================================="
echo "Setup Complete!"
echo "========================================="
echo ""
echo "Next steps:"
echo "1. Edit $CONFIG_FILE with your relays and pubkey"
echo "2. Start the bridge: cd $GITNOSTR_DIR && ./bin/git-nostr-bridge"
echo ""
echo "For production deployment, see: GIT_NOSTR_BRIDGE_SETUP.md"
echo ""

