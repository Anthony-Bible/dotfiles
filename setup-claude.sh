#!/usr/bin/env bash
set -euo pipefail

# This script handles Claude preferences, CLAUDE.md, and Gemini configuration setup.
# Claude hooks and agents are now provided by the claude-plugin/
# Install with: claude plugin install ~/dotfiles/claude-plugin --scope user

# Source setup utilities
DOTFILESDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export SETUP_ROOT="$DOTFILESDIR"
source "$DOTFILESDIR/setup/core/utils.sh"

# Colors are already defined in init.sh (sourced by utils.sh)

# Ensure showClearContextOnPlanAccept is set in Claude settings
CLAUDE_SETTINGS_FILE="$HOME/.claude/settings.json"
mkdir -p "$HOME/.claude"
if [[ -f "$CLAUDE_SETTINGS_FILE" ]]; then
    jq '. + {"showClearContextOnPlanAccept": true}' "$CLAUDE_SETTINGS_FILE" > "$CLAUDE_SETTINGS_FILE.tmp"
    mv "$CLAUDE_SETTINGS_FILE.tmp" "$CLAUDE_SETTINGS_FILE"
else
    echo '{"showClearContextOnPlanAccept": true}' > "$CLAUDE_SETTINGS_FILE"
fi
print_status "Set showClearContextOnPlanAccept in Claude settings"

# Setup Gemini configuration
print_status "Setting up Gemini configuration"
GEMINI_SETTINGS_FILE="$HOME/.gemini/settings.json"
PLUGIN_HOOKS_FILE="$DOTFILESDIR/claude-plugin/hooks/hooks.json"

if [[ -f "$PLUGIN_HOOKS_FILE" ]]; then
    mkdir -p "$HOME/.gemini"
    # Transform PostToolUse -> AfterTool, expand ${CLAUDE_PLUGIN_ROOT} to absolute path,
    # and rename tool matchers for Gemini
    TRANSFORMED_HOOKS=$(jq --arg PLUGINDIR "$DOTFILESDIR/claude-plugin" '
        .hooks.AfterTool = .hooks.PostToolUse |
        del(.hooks.PostToolUse) |
        walk(if type == "string" then
            gsub("\\$\\{CLAUDE_PLUGIN_ROOT\\}"; $PLUGINDIR) |
            gsub("Write"; "write_file") |
            gsub("Edit"; "replace")
        else . end)
    ' "$PLUGIN_HOOKS_FILE")

    if [[ -f "$GEMINI_SETTINGS_FILE" ]]; then
        print_status "Merging Gemini hooks into existing settings"
        echo "$TRANSFORMED_HOOKS" | jq -s '.[0] * .[1]' "$GEMINI_SETTINGS_FILE" - > "$GEMINI_SETTINGS_FILE.tmp"
        mv "$GEMINI_SETTINGS_FILE.tmp" "$GEMINI_SETTINGS_FILE"
    else
        print_status "Creating new Gemini settings file with hooks"
        echo "$TRANSFORMED_HOOKS" | jq '. + {"model": "gemini"}' > "$GEMINI_SETTINGS_FILE"
    fi
else
    print_warning "$PLUGIN_HOOKS_FILE not found, skipping Gemini hooks setup"
fi

# Setup agents for Gemini (Claude agents are provided by the plugin)
PLUGIN_AGENTS_DIR="$DOTFILESDIR/claude-plugin/agents"
copy_agent_files "$PLUGIN_AGENTS_DIR" "$HOME/.gemini/agents" "Gemini"

# Setup Claude rules
CLAUDE_RULES_SOURCE="$DOTFILESDIR/.claude/rules"
CLAUDE_RULES_TARGET="$HOME/.claude/rules"
if [[ -d "$CLAUDE_RULES_SOURCE" ]]; then
    print_status "Setting up Claude rules"
    mkdir -p "$CLAUDE_RULES_TARGET"
    # Use -r to preserve directory structure (e.g. conductor/ subfolder)
    cp -r "$CLAUDE_RULES_SOURCE"/. "$CLAUDE_RULES_TARGET/"
    print_success "Claude rules setup complete"
else
    print_warning "$CLAUDE_RULES_SOURCE not found, skipping Claude rules setup"
fi

# Transform Gemini agents to remove color:, model:, quote descriptions, and add max_turns
GEMINI_AGENTS_DIR="$HOME/.gemini/agents"
if [[ -d "$GEMINI_AGENTS_DIR" ]]; then
    print_status "Transforming Gemini agents"
    # Use gsed on macOS for GNU sed compatibility
    SED="sed"
    if [[ "$(uname)" == "Darwin" ]]; then
        SED="gsed"
    fi

    find "$GEMINI_AGENTS_DIR" -name "*.md" -type f | while read -r agent_file; do
        # Remove color: line
        "$SED" -i '/^color:/d' "$agent_file"
        # Remove model: line
        "$SED" -i '/^model:/d' "$agent_file"
        # Quote description: value if not already quoted
        "$SED" -i 's|^description: \([^"].*\)$|description: "\1"|' "$agent_file"
        # Add max_turns: 30 to frontmatter after description line
        "$SED" -i '/^description:/a\max_turns: 30' "$agent_file"
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
