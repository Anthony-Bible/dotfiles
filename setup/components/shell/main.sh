#!/usr/bin/env bash
# Shell component - Coordinator for zsh configuration, themes, functions, and nix

# Source setup utilities
source "$(dirname "${BASH_SOURCE[0]}")/../../core/init.sh"
source "$(dirname "${BASH_SOURCE[0]}")/../../core/utils.sh"

# Configure zsh with themes and options
configure_zsh() {
    # Set combining_chars option if using zsh
    if [[ $SHELL =~ "zsh" ]]; then
        print_status "Setting combining_chars option in zsh"
        # Only add line if it doesn't exist
        if ! grep -q -F 'setopt combining_chars' "$HOME/.zshrc"; then
            echo "setopt combining_chars" >> "$HOME/.zshrc"
        fi

        # Check if oh-my-zsh is installed
        if [ ! -d "$HOME/.oh-my-zsh" ]; then
            print_status "oh-my-zsh is not installed, won't install theme"
        else
            # Check if variable ZSH_CUSTOM is set
            if [[ -z "${ZSH_CUSTOM:-}" ]]; then
                print_status "ZSH_CUSTOM is not set, using $HOME/.oh-my-zsh/custom for custom themes"
                ZSH_CUSTOM="$HOME/.oh-my-zsh/custom"
            else
                print_status "ZSH_CUSTOM is set, using $ZSH_CUSTOM for custom themes"
            fi

            # Install theme
            print_status "Installing theme"
            execute mkdir -p "$ZSH_CUSTOM/themes"
            cd "$SETUP_ROOT" || exit 1
            execute stow -R --dotfiles -t "$ZSH_CUSTOM" dot-oh-my-zsh

            # Get theme file name in dot-oh-my-zsh/themes
            local theme_file
            local theme_files=("$SETUP_ROOT/dot-oh-my-zsh/themes"/*.zsh-theme)

            # Handle cases where there are zero, one, or multiple theme files
            if [[ ! -e "${theme_files[0]}" ]]; then
                print_status "No .zsh-theme files found in $SETUP_ROOT/dot-oh-my-zsh/themes; leaving ZSH_THEME unchanged"
                theme_file=""
            elif (( ${#theme_files[@]} > 1 )); then
                print_status "Multiple .zsh-theme files found in $SETUP_ROOT/dot-oh-my-zsh/themes; using ${theme_files[0]}"
                theme_file=$(basename "${theme_files[0]}")
                theme_file=${theme_file%.zsh-theme}
            else
                theme_file=$(basename "${theme_files[0]}")
                # Remove .zsh-theme extension
                theme_file=${theme_file%.zsh-theme}
            fi

            # Change variable ZSH_THEME to theme name in .zshrc
            if [[ -n "$theme_file" ]]; then
                if [[ -n "${_sed:-}" ]]; then
                    "$_sed" -i "s/ZSH_THEME=.*/ZSH_THEME=\"$theme_file\"/" "$HOME/.zshrc"
                else
                    sed -i "s/ZSH_THEME=.*/ZSH_THEME=\"$theme_file\"/" "$HOME/.zshrc"
                fi
            fi
        fi
    fi
}

# Setup shell functions
setup_shell_functions() {
    # Get hostname for tcn-specific configuration
    if [[ $(hostname) == "tcn" ]]; then
        # Put a line to source .tcn-functions in .zshrc only if it doesn't already exist
        if ! grep -q -F 'source $HOME/.tcn-functions' "$HOME/.zshrc"; then
            echo "source \$HOME/.tcn-functions" >> "$HOME/.zshrc"
        fi
    fi

    # Put in .zshrc a line to source .zsh-functions only if line doesn't exist
    if ! grep -q -F 'source $HOME/.zsh-functions' "$HOME/.zshrc"; then
        echo "source \$HOME/.zsh-functions" >> "$HOME/.zshrc"
    fi
}

# Install nix package manager
install_nix() {
    if ! command -v nix > /dev/null; then
        # Interactive confirmation for nix installation
        if [ "$DRY_RUN" = "true" ]; then
            print_status "DRY_RUN is enabled; skipping interactive nix installation prompt"
        else
            while true; do
                echo "Do you want to continue? (y/n)"
                read -n 1 -r input
                echo # Move to a new line

                # Convert to lowercase
                input=${input,,}

                case $input in
                    y)
                        echo "Continuing..."
                        break # Exit the loop
                        ;;
                    n)
                        echo "Not continuing. Skipping nix installation..."
                        return 0
                        ;;
                    *)
                        echo "Invalid input. Please enter 'y' or 'n'."
                        ;;
                esac
            done
        fi

        execute sh <(curl -L https://nixos.org/nix/install) --daemon
    fi

    # Allow nix flakes to be used and stow nix files
    print_status "Stowing nix files"
    cd "$SETUP_ROOT" || exit 1
    execute stow -R -t "$HOME/.config/nix" nix
}

# Warn about aichat configuration
check_aichat_config() {
    if [ ! -f "$HOME/.config/aichat/config.yaml" ]; then
        print_status "Warning: $HOME/.config/aichat/config.yaml does not exist. You may want to make sure the config exists with models and API keys."
    fi
}

# Component interface implementation
check_dependencies() {
    # Check for basic shell
    command -v zsh &> /dev/null || {
        print_error "zsh is recommended for shell component"
        # Not mandatory, continue with warning
    }

    # Check for curl needed for nix
    command -v curl &> /dev/null || {
        print_error "curl is required for shell component"
        return 1
    }
}

install_component() {
    local mode="${1:-install}"

    case "$mode" in
        install)
            configure_zsh
            setup_shell_functions
            install_nix
            ;;
        update)
            print_status "Updating shell component not implemented (shell configs are typically static)"
            ;;
        remove)
            print_status "Removing shell component is not implemented"
            ;;
        *)
            print_error "Unknown mode: $mode"
            return 1
            ;;
    esac
}

configure_component() {
    # Additional configuration and checks
    check_aichat_config
}

cleanup_component() {
    # No cleanup needed for shell configuration
    true
}