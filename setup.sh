#!/usr/bin/env bash
# Dotfiles setup script - Configure your development environment
# This script maintains backward compatibility while using the new modular system

set -euo pipefail

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Check if the new modular system exists and use it
if [[ -f "$SCRIPT_DIR/setup/main.sh" ]]; then
    # Delegate to the new modular setup system
    exec "$SCRIPT_DIR/setup/main.sh" "$@"
else
    # Fallback message if modular system not found
    echo "Error: Modular setup system not found at $SCRIPT_DIR/setup/main.sh" >&2
    echo "Please ensure the setup directory and its contents are properly installed." >&2
    exit 1
fi