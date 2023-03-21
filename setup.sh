#!/usr/bin/env bash
#
# This script is used to copy files to proper directories
# and to create symlinks to the dotfiles in this repo.
YELLOW='\033[1;33m'
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color
required_packages=(stow git)
# Check if required packages are installed
for package in "${required_packages[@]}"; do
    if ! command -v $package &> /dev/null; then
        echo -e "${RED}$package could not be found${NC}"
        exit
    fi
done

folders_that_must_exist=("$HOME/.config/nvim" "$HOME/.tmux/plugins/tpm")
# Check if folders that must exist exist
for folder in "${folders_that_must_exist[@]}"; do
    if [ ! -d $folder ]; then
	echo "${YELLOW}$folder does not exist, creating it${NC}"
	mkdir -p "$folder"
    fi
done
# Link files to proper directories
# stow neovim files
stow -t "$HOME/.config/nvim" nvim

# stow .tmux.conf file in home directory
stow -t "$HOME" --dotfiles tmux

# Clone the tmux plugin manager
#
git clone https://github.com/tmux-plugins/tpm ~/.tmux/plugins/tpm
