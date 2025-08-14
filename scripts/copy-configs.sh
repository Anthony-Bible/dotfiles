#!/usr/bin/env bash

# Script to copy dotfiles configuration files to the home directory
# This script copies various configuration files from the dotfiles directory to the home directory

set -euo pipefail

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOTFILES_DIR="$(dirname "$SCRIPT_DIR")"

# Function to copy file if it exists
copy_if_exists() {
    local source="$1"
    local dest="$2"
    
    if [[ -f "$source" ]]; then
        echo "Copying $source to $dest"
        cp "$source" "$dest"
    else
        echo "Warning: $source not found, skipping"
    fi
}

echo "Copying configuration files to home directory..."

# Copy .golangci.yaml
copy_if_exists "$DOTFILES_DIR/.golangci.yaml" "$HOME/.golangci.yaml"

echo "Configuration files copied successfully!"
