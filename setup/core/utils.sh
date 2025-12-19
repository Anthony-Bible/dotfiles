#!/usr/bin/env bash
# Common utility functions for the modular setup system

# Ensure SETUP_ROOT is defined
if [[ -z "${SETUP_ROOT:-}" ]]; then
    SETUP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
fi

# Ensure we have core utilities (init.sh should already be sourced by main.sh)
if ! declare -f print_status &> /dev/null; then
    source "$(dirname "${BASH_SOURCE[0]}")/init.sh"
fi

# Required packages for the setup
REQUIRED_PACKAGES=(stow tmuxp git git-lfs)

# Directories that must exist
REQUIRED_DIRS=(
    "$HOME/.config/nvim"
    "$HOME/.config/nix"
    "$HOME/.tmux/plugins/tpm"
    "$HOME/.config/wezterm/logs"
)

# Check and install required packages
check_required_packages() {
    local packages_to_install=()

    verbose "Checking required packages: ${REQUIRED_PACKAGES[*]}"

    for package in "${REQUIRED_PACKAGES[@]}"; do
        if ! command -v "$package" &> /dev/null; then
            packages_to_install+=("$package")
        fi
    done

    if [ ${#packages_to_install[@]} -ne 0 ]; then
        print_status "Attempting to install missing packages: ${packages_to_install[*]}"
        if [[ $(uname) == "Linux" ]]; then
            execute sudo apt-get update && sudo apt-get install -y "${packages_to_install[@]}"
        elif [[ $(uname) == "Darwin" ]]; then
            execute brew install "${packages_to_install[@]}"
        else
            print_error "Unsupported OS for automatic installation. Please install manually: ${packages_to_install[*]}"
            return 1
        fi
    fi

    # Final verification
    local missing_packages=()
    for package in "${REQUIRED_PACKAGES[@]}"; do
        if ! command -v "$package" &> /dev/null; then
            print_error "$package could not be found or installed."
            missing_packages+=("$package")
        fi
    done

    if [ ${#missing_packages[@]} -ne 0 ]; then
        print_error "The following required packages are missing: ${missing_packages[*]}."
        exit 1
    fi
}

# Initialize git-lfs if installed
init_git_lfs() {
    if command -v git-lfs &> /dev/null; then
        print_status "Running git-lfs install"
        if [[ $(uname) == "Darwin" ]]; then
            execute git-lfs install --local
        else
            execute git-lfs install
        fi
    fi
}

# Detect OS type
detect_os() {
    uname
}

# Detect architecture
detect_arch() {
    uname -m
}

# Setup sed for macOS
setup_sed() {
    if [[ $(detect_os) == "Darwin" ]]; then
        if ! command -v gsed &> /dev/null; then
            print_error "gsed could not be found"
            exit 1
        fi
        echo "gsed"
    else
        echo "sed"
    fi
}

# Create necessary directories
create_required_dirs() {
    verbose "Creating required directories"

    mkdir -p ~/.local/bin

    for folder in "${REQUIRED_DIRS[@]}"; do
        if [ ! -d "$folder" ]; then
            print_status "$folder does not exist, creating it"
            execute mkdir -p "$folder"
        fi
    done
}

# Stow configuration files
stow_configs() {
    local dotfiles_dir="${1:-$SETUP_ROOT}"

    verbose "Stowing configuration files from $dotfiles_dir"

    # Stow neovim files
    print_status "Stowing neovim files"
    cd "$dotfiles_dir" || exit 1
    execute stow -R -t "$HOME/.config/nvim" nvim

    # Stow tmux files
    print_status "Stowing tmux files"
    execute stow -R -t "$HOME" --dotfiles tmux

    # Export DOTFILESDIR in .zshrc if not already present
    grep -q -F "export DOTFILESDIR=" "$HOME/.zshrc" || echo "export DOTFILESDIR=\"$dotfiles_dir\"" >> "$HOME/.zshrc"

    # Stow zsh functions
    print_status "Stowing zsh files"
    execute stow -R -t "$HOME" --dotfiles dot-zsh-functions

    # Stow golangci config
    print_status "Stowing golangci files"
    execute stow -R -t "$HOME" --dotfiles dot-config-files
}

# Install Neovim on Linux
install_nvim_linux() {
    if [[ $(detect_os) == "Linux" ]] && ! command -v nvim &> /dev/null; then
        print_status "Installing Neovim for Linux"
        execute curl -LO https://github.com/neovim/neovim/releases/latest/download/nvim.appimage
        execute chmod u+x nvim.appimage
        execute mv nvim.appimage ~/.local/bin/nvim
    fi
}

# Common initialization that should run for all setups
init_common() {
    verbose "Initializing common setup utilities"

    # Set global variables for components to use
    OS_TYPE=$(detect_os)
    ARCH=$(detect_arch)
    export OS_TYPE ARCH

    # Setup sed command
    _sed=$(setup_sed)
    export _sed

    # Run common setup steps
    check_required_packages
    init_git_lfs
    create_required_dirs
    install_nvim_linux
    stow_configs
}

# Check if a command exists
command_exists() {
    command -v "$1" &> /dev/null
}

# Download with retry
download_with_retry() {
    local url="$1"
    local output="$2"
    local max_attempts=3
    local attempt=1

    while [ $attempt -le $max_attempts ]; do
        if curl -fsSL "$url" -o "$output"; then
            return 0
        fi
        print_error "Download attempt $attempt failed for $url"
        sleep 2
        ((attempt++))
    done

    print_error "Failed to download after $max_attempts attempts: $url"
    return 1
}

# Get checksum for a file
get_checksum() {
    local file="$1"
    if [[ -f "$file" ]]; then
        sha256sum "$file" | awk '{print $1}'
    fi
}

# Verify file checksum
verify_checksum() {
    local file="$1"
    local expected="$2"
    local actual

    actual=$(get_checksum "$file")
    if [[ "$actual" == "$expected" ]]; then
        return 0
    else
        print_error "Checksum verification failed for $file"
        print_error "Expected: $expected"
        print_error "Actual: $actual"
        return 1
    fi
}