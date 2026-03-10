#!/usr/bin/env bash
set -euo pipefail

# This script handles Claude and Gemini configuration setup

# Source setup utilities
DOTFILESDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export SETUP_ROOT="$DOTFILESDIR"
source "$DOTFILESDIR/setup/core/utils.sh"

# Colors are already defined in init.sh (sourced by utils.sh)

# Setup Claude configuration
print_status "Setting up Claude configuration"
CLAUDE_HOOKS_FILE="$DOTFILESDIR/claude-hooks.json"
CLAUDE_SETTINGS_FILE="$HOME/.claude/settings.json"

if [[ -f "$CLAUDE_HOOKS_FILE" ]]; then
    mkdir -p "$HOME/.claude"
    if [[ -f "$CLAUDE_SETTINGS_FILE" ]]; then
        print_status "Merging Claude hooks into existing settings"
        jq -s '.[0] * .[1]' "$CLAUDE_SETTINGS_FILE" "$CLAUDE_HOOKS_FILE" > "$CLAUDE_SETTINGS_FILE.tmp"
        mv "$CLAUDE_SETTINGS_FILE.tmp" "$CLAUDE_SETTINGS_FILE"
    else
        print_status "Creating new Claude settings file with hooks"
        jq '. + {"model": "sonnet"}' "$CLAUDE_HOOKS_FILE" > "$CLAUDE_SETTINGS_FILE"
    fi
else
    print_warning "$CLAUDE_HOOKS_FILE not found, skipping Claude hooks setup"
fi

# Setup Gemini configuration
print_status "Setting up Gemini configuration"
GEMINI_SETTINGS_FILE="$HOME/.gemini/settings.json"

if [[ -f "$CLAUDE_HOOKS_FILE" ]]; then
    mkdir -p "$HOME/.gemini"
    # Transform PostToolUse -> AfterTool and expand $DOTFILESDIR
    TRANSFORMED_HOOKS=$(jq --arg DOTFILESDIR "$DOTFILESDIR" '
        .hooks.AfterTool = .hooks.PostToolUse |
        del(.hooks.PostToolUse) |
        walk(if type == "string" then 
            gsub("\\$DOTFILESDIR"; $DOTFILESDIR) |
            gsub("Write"; "write_file") |
            gsub("Edit"; "replace")
        else . end)
    ' "$CLAUDE_HOOKS_FILE")

    if [[ -f "$GEMINI_SETTINGS_FILE" ]]; then
        print_status "Merging Gemini hooks into existing settings"
        echo "$TRANSFORMED_HOOKS" | jq -s '.[0] * .[1]' "$GEMINI_SETTINGS_FILE" - > "$GEMINI_SETTINGS_FILE.tmp"
        mv "$GEMINI_SETTINGS_FILE.tmp" "$GEMINI_SETTINGS_FILE"
    else
        print_status "Creating new Gemini settings file with hooks"
        echo "$TRANSFORMED_HOOKS" | jq '. + {"model": "gemini"}' > "$GEMINI_SETTINGS_FILE"
    fi
else
    print_warning "$CLAUDE_HOOKS_FILE not found, skipping Gemini hooks setup"
fi

# Setup agents for both
CLAUDE_AGENTS_DIR="$DOTFILESDIR/.claude/agents"
copy_agent_files "$CLAUDE_AGENTS_DIR" "$HOME/.claude/agents" "Claude"
copy_agent_files "$CLAUDE_AGENTS_DIR" "$HOME/.gemini/agents" "Gemini"

# Transform Gemini agents to remove color:, model:, quote descriptions, and add max_turns
GEMINI_AGENTS_DIR="$HOME/.gemini/agents"
if [[ -d "$GEMINI_AGENTS_DIR" ]]; then
    print_status "Transforming Gemini agents"
    find "$GEMINI_AGENTS_DIR" -name "*.md" -type f | while read -r agent_file; do
        # Remove color: line
        sed -i '/^color:/d' "$agent_file"
        # Remove model: line
        sed -i '/^model:/d' "$agent_file"
        # Quote description: value if not already quoted
        sed -i 's|^description: \([^"].*\)$|description: "\1"|' "$agent_file"
        # Add max_turns: 30 to frontmatter after description line
        sed -i '/^description:/a\max_turns: 30' "$agent_file"
    done
fi

# Setup global CLAUDE.md and gemini.md
CLAUDE_MD_DOTFILES="$DOTFILESDIR/.claude/CLAUDE.md.dotfiles"
CLAUDE_MD_TARGET="$HOME/.claude/CLAUDE.md"
if [[ -f "$CLAUDE_MD_DOTFILES" ]]; then
    update_managed_section "$CLAUDE_MD_TARGET" "$CLAUDE_MD_DOTFILES"
else
    print_warning "$CLAUDE_MD_DOTFILES not found, skipping CLAUDE.md setup"
fi

GEMINI_MD_DOTFILES="$DOTFILESDIR/.gemini/gemini.md.dotfiles"
GEMINI_MD_TARGET="$HOME/.gemini/GEMINI.md"
if [[ -f "$GEMINI_MD_DOTFILES" ]]; then
    update_managed_section "$GEMINI_MD_TARGET" "$GEMINI_MD_DOTFILES"
else
    print_warning "$GEMINI_MD_DOTFILES not found, skipping gemini.md setup"
fi

print_success "Claude and Gemini configuration setup complete"
