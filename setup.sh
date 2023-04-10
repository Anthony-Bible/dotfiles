#!/usr/bin/env bash
#
# This script is used to copy files to proper directories
# and to create symlinks to the dotfiles in this repo.
YELLOW='\033[1;33m'
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color
required_packages=(stow nvim tmuxp git)
# Check if required packages are installed
for package in "${required_packages[@]}"; do
    if ! command -v "$package" &> /dev/null; then
        echo -e "${RED}$package could not be found${NC}"
        exit
    fi
done

folders_that_must_exist=("$HOME/.config/nvim" "$HOME/.tmux/plugins/tpm")
# Check if folders that must exist exist
for folder in "${folders_that_must_exist[@]}"; do
    if [ ! -d "$folder" ]; then
	echo -e "${YELLOW}$folder does not exist, creating it${NC}"
	mkdir -p "$folder"
    fi
done
# Link files to proper directories
# stow neovim files
echo -e "${GREEN}Stowing neovim files${NC}"
stow -R -t "$HOME/.config/nvim" nvim

# stow .tmux.conf ile in home directory
echo -e "${GREEN}Stowing tmux files${NC}"
stow -R -t "$HOME" --dotfiles tmux

#Get current directory
DOTFILESDIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
# stow .zshrc functions file in home directory
echo -e "${GREEN}Stowing zsh files${NC}"
# Put a line to export DOTFILESDIR in .zshrc only if it doesn't already exist
grep -q -F "export DOTFILESDIR=$DOTFILESDIR" "$HOME/.zshrc" || echo "export DOTFILESDIR=$DOTFILESDIR" >> "$HOME/.zshrc"
stow -R -t "$HOME" --dotfiles dot-zsh-functions

# Clone the tmux plugin manager
# Only clone if it does not exist otherwise pull the repo
if [ ! -d "$HOME/.tmux/plugins/tpm" ]; then
    echo -e "${GREEN}Cloning tmux plugin manager${NC}"
    git clone https://github.com/tmux-plugins/tpm ~/.tmux/plugins/tpm
else
    echo -e "${YELLOW}Pulling tmux plugin manager${NC}"
    git -C "$HOME/.tmux/plugins/tpm" pull
fi

# Get hostname to see if it matches tcn
if [[ $(hostname) == "tcn" ]]; then
    # Put a line to source .tcn-functions in .zshrc only if it doesn't already exist
    grep -q -F 'source $HOME/.tcn-functions' "$HOME/.zshrc" || echo "source \$HOME/.tcn-functions" >> "$HOME/.zshrc"
fi
# Put in .zshrc a line to source .zsh-functions only if line doesn't exist
grep -q -F 'source $HOME/.zsh-functions' "$HOME/.zshrc" || echo "source \$HOME/.zsh-functions" >> "$HOME/.zshrc"


# check if linux or mac and install wezterm
OSTYPE=$(uname)
if [[ $OSTYPE == "Linux" ]]; then
    # install wezterm
    if ! command -v wezterm &> /dev/null; then
        echo -e "${GREEN}Installing wezterm${NC}"
        curl -LO https://github.com/wez/wezterm/releases/download/20230326-111934-3666303c/WezTerm-20230326-111934-3666303c-Ubuntu20.04.AppImage
        chmod +x WezTerm-20230326-111934-3666303c-Ubuntu20.04.AppImage
        mv WezTerm-20230326-111934-3666303c-Ubuntu20.04.AppImage ~/.local/bin/wezterm
    fi
elif [[ $OSTYPE == "Darwin" ]]; then
    # install wezterm
    if ! command -v wezterm &> /dev/null; then
        echo -e "${GREEN}Installing wezterm${NC}"
        brew install --cask wezterm
    fi
fi

# see if variable XDG_CONFIG_HOME is set
echo -e "${GREEN}Stowing wezterm files${NC}"
if [[ -z "$XDG_CONFIG_HOME" ]]; then
    echo -e "${YELLOW}XDG_CONFIG_HOME is not set, using $HOME/.config/wezterm for configuration store${NC}"
    mkdir -p "$HOME/.config/wezterm"
    stow -R -t "$HOME/.config/wezterm" wezterm
else
    echo -e "${YELLOW}XDG_CONFIG_HOME is set, using $XDG_CONFIG_HOME/wezterm for configuration store${NC}"
    mkdir -p "$XDG_CONFIG_HOME/wezterm"
    stow -R -t "$XDG_CONFIG_HOME/wezterm" wezterm
fi


# setopt combining_chars if shell=zsh
if [[ $SHELL =~ "zsh" ]]; then
    echo -e "${YELLOW}Setting combining_chars option in zsh${NC}"
    # only add line if it doesn't exist
    grep -q -F 'setopt combining_chars' "$HOME/.zshrc" || echo "setopt combining_chars" >> "$HOME/.zshrc"
fi


