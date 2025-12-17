#!/usr/bin/env bash
#
# This script handles Claude-specific configuration setup
YELLOW='\033[1;33m'
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

#Get current directory
DOTFILESDIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"

# Setup Claude hooks configuration
echo -e "${GREEN}Setting up Claude hooks configuration${NC}"
CLAUDE_HOOKS_FILE="$DOTFILESDIR/claude-hooks.json"
CLAUDE_SETTINGS_FILE="$HOME/.claude/settings.json"

if [[ -f "$CLAUDE_HOOKS_FILE" ]]; then
    # Create .claude directory if it doesn't exist
    mkdir -p "$HOME/.claude"
    
    if [[ -f "$CLAUDE_SETTINGS_FILE" ]]; then
        # Merge hooks into existing settings
        echo -e "${YELLOW}Merging Claude hooks into existing settings${NC}"
        jq -s '.[0] * .[1]' "$CLAUDE_SETTINGS_FILE" "$CLAUDE_HOOKS_FILE" > "$CLAUDE_SETTINGS_FILE.tmp"
        mv "$CLAUDE_SETTINGS_FILE.tmp" "$CLAUDE_SETTINGS_FILE"
    else
        # Create new settings file with hooks
        echo -e "${YELLOW}Creating new Claude settings file with hooks${NC}"
        jq '. + {"model": "sonnet"}' "$CLAUDE_HOOKS_FILE" > "$CLAUDE_SETTINGS_FILE"
    fi
else
    echo -e "${RED}Warning: $CLAUDE_HOOKS_FILE not found, skipping Claude hooks setup${NC}"
fi

# Setup Claude agents
echo -e "${GREEN}Setting up Claude agents${NC}"
CLAUDE_AGENTS_DIR="$DOTFILESDIR/.claude/agents"
if [[ -d "$CLAUDE_AGENTS_DIR" ]]; then
    # Create .claude/agents directory if it doesn't exist
    mkdir -p "$HOME/.claude/agents"
    
    # Copy all agent files from dotfiles to home directory
    echo -e "${YELLOW}Copying Claude agents to ~/.claude/agents/${NC}"
    cp -r "$CLAUDE_AGENTS_DIR"/* "$HOME/.claude/agents/"
else
    echo -e "${RED}Warning: $CLAUDE_AGENTS_DIR not found, skipping Claude agents setup${NC}"
fi

# Setup global CLAUDE.md
echo -e "${GREEN}Setting up global CLAUDE.md${NC}"
CLAUDE_MD_DOTFILES="$DOTFILESDIR/.claude/CLAUDE.md.dotfiles"
CLAUDE_MD_TARGET="$HOME/.claude/CLAUDE.md"

if [[ -f "$CLAUDE_MD_DOTFILES" ]]; then
    # Marker to identify managed section
    MARKER_START="# === BEGIN DOTFILES MANAGED SECTION ==="
    MARKER_END="# === END DOTFILES MANAGED SECTION ==="

    if [[ -f "$CLAUDE_MD_TARGET" ]]; then
        # Remove old managed section if it exists
        if grep -q "$MARKER_START" "$CLAUDE_MD_TARGET"; then
            echo -e "${YELLOW}Updating dotfiles-managed section in CLAUDE.md${NC}"
            # Remove everything between markers (inclusive)
            sed -i "/$MARKER_START/,/$MARKER_END/d" "$CLAUDE_MD_TARGET"
        else
            echo -e "${YELLOW}Appending dotfiles section to existing CLAUDE.md${NC}"
        fi
    else
        echo -e "${YELLOW}Creating new CLAUDE.md${NC}"
        touch "$CLAUDE_MD_TARGET"
    fi

    # Append managed section
    {
        echo ""
        echo "$MARKER_START"
        cat "$CLAUDE_MD_DOTFILES"
        echo "$MARKER_END"
    } >> "$CLAUDE_MD_TARGET"

    echo -e "${GREEN}CLAUDE.md updated at $CLAUDE_MD_TARGET${NC}"
else
    echo -e "${RED}Warning: $CLAUDE_MD_DOTFILES not found, skipping CLAUDE.md setup${NC}"
fi

echo -e "${GREEN}Claude configuration setup complete${NC}"