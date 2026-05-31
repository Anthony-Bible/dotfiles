#!/usr/bin/env bash
# Development tools component - Coordinator for git, nvim, tmux, wezterm

# Source setup utilities (not component-api to avoid function name conflicts)
source "$(dirname "${BASH_SOURCE[0]}")/../../core/init.sh"
source "$(dirname "${BASH_SOURCE[0]}")/../../core/utils.sh"

# Sub-components for dev-tools
install_tmux() {
    if [ ! -d "$HOME/.tmux/plugins/tpm" ]; then
        print_status "Cloning tmux plugin manager"
        execute git clone https://github.com/tmux-plugins/tpm ~/.tmux/plugins/tpm
    else
        # Check if the directory is a git repository
        if git -C "$HOME/.tmux/plugins/tpm" rev-parse --git-dir > /dev/null 2>&1; then
            print_status "Pulling tmux plugin manager"
            execute git -C "$HOME/.tmux/plugins/tpm" pull
        else
            print_status "Warning: $HOME/.tmux/plugins/tpm exists but is not a git repository"
            print_status "Removing existing directory and cloning fresh"
            execute rm -rf "$HOME/.tmux/plugins/tpm"
            execute git clone https://github.com/tmux-plugins/tpm ~/.tmux/plugins/tpm
        fi
    fi
}

install_wezterm() {
    if ! command_exists wezterm; then
        if [[ $OS_TYPE == "Linux" ]]; then
            print_status "Installing wezterm"
            local wezterm_file="WezTerm-20230408-112425-69ae8472-Ubuntu20.04.AppImage"
            local wezterm_url="https://github.com/wez/wezterm/releases/download/20230408-112425-69ae8472/$wezterm_file"
            local wezterm_checksum="24281a5369fb56144b4dcaafcaa1df621c2941b1a2d2e5576d76454d287cfd07"

            execute mkdir -p ~/.local/bin

            # Secure download with checksum verification
            secure_download "$wezterm_url" "$wezterm_file" "$wezterm_checksum"
            execute chmod +x "$wezterm_file"
            execute mv "$wezterm_file" ~/.local/bin/wezterm
        elif [[ $OS_TYPE == "Darwin" ]]; then
            print_status "Installing wezterm"
            execute brew install --cask wezterm
        fi
    fi
}

stow_wezterm_config() {
    print_status "Stowing wezterm files"
    if [[ -z "${XDG_CONFIG_HOME:-}" ]]; then
        print_status "XDG_CONFIG_HOME is not set, using $HOME/.config/wezterm for configuration store"
        execute mkdir -p "$HOME/.config/wezterm"
        cd "$SETUP_ROOT" || exit 1
        execute stow -R -t "$HOME/.config/wezterm" wezterm
    else
        print_status "XDG_CONFIG_HOME is set, using $XDG_CONFIG_HOME/wezterm for configuration store"
        execute mkdir -p "$XDG_CONFIG_HOME/wezterm"
        cd "$SETUP_ROOT" || exit 1
        execute stow -R -t "$XDG_CONFIG_HOME/wezterm" wezterm
    fi
}

install_aichat() {
    if ! command_exists aichat; then
        if [[ $OS_TYPE == "Darwin" ]]; then
            print_status "Installing aichat with brew"
            execute brew install aichat
        elif [[ $OS_TYPE == "Linux" ]]; then
            print_status "You can get aichat from https://github.com/sigoden/aichat?tab=readme-ov-file"
        fi
    fi
}

install_ast_grep() {
    if ! command -v ast-grep &> /dev/null && [ ! -f ~/bin/sg ]; then
        print_status "Installing ast-grep"
        execute mkdir -p ~/bin

        # Define checksums for AST-grep binaries (pinned to version 0.43.0)
        local ast_grep_version="0.43.0"
        declare -A ASTGREP_CHECKSUMS=(
            ["app-aarch64-unknown-linux-gnu.zip"]="e706846148493967f3ab8011334817edd86ce5acbec10718b2a7b40799c640ff"
            ["app-x86_64-unknown-linux-gnu.zip"]="a26253a9c821d935f7e383e40f0de7c2ca62a4121de1f73a6d81ec32eae631e0"
            ["app-aarch64-apple-darwin.zip"]="8c847d0a29aa4b3101b3361e0b3ee7fb53c7e497adc9ed1afc9615538cd40782"
            ["app-x86_64-apple-darwin.zip"]="6d703090b106747b2f56086b6ccc7e798fe78bcae70257aa20519b220153555b"
        )

        local zip_file
        local ast_grep_url
        local expected_checksum

        if [[ $OS_TYPE == "Linux" ]]; then
            if [[ $ARCH == "aarch64" ]]; then
                zip_file="app-aarch64-unknown-linux-gnu.zip"
            else
                zip_file="app-x86_64-unknown-linux-gnu.zip"
            fi
        elif [[ $OS_TYPE == "Darwin" ]]; then
            if [[ $ARCH == "arm64" ]]; then
                zip_file="app-aarch64-apple-darwin.zip"
            else
                zip_file="app-x86_64-apple-darwin.zip"
            fi
        fi

        ast_grep_url="https://github.com/ast-grep/ast-grep/releases/download/${ast_grep_version}/$zip_file"
        expected_checksum="${ASTGREP_CHECKSUMS[$zip_file]}"

        secure_download "$ast_grep_url" "$zip_file" "$expected_checksum"
        execute unzip "$zip_file"
        execute mv sg ast-grep ~/bin/
        execute rm "$zip_file"
    fi
}

# Component interface implementation
check_dependencies() {
    # Check for basic tools
    command -v git &> /dev/null || {
        print_error "git is required for dev-tools component"
        return 1
    }
    command -v stow &> /dev/null || {
        print_error "stow is required for dev-tools component"
        return 1
    }
}

install_component() {
    local mode="${1:-install}"

    case "$mode" in
        install)
            install_tmux
            install_wezterm
            install_aichat
            install_ast_grep
            ;;
        update)
            install_tmux  # This updates existing installation
            ;;
        remove)
            print_status "Removing dev-tools is not implemented"
            ;;
        *)
            print_error "Unknown mode: $mode"
            return 1
            ;;
    esac
}

configure_component() {
    # Stow wezterm configuration
    stow_wezterm_config
}

cleanup_component() {
    # Clean up temporary files if any
    true
}