#!/usr/bin/env bash
# Languages component - Coordinator for Go, Python (Miniconda), and Node.js

# Source setup utilities
source "$(dirname "${BASH_SOURCE[0]}")/../../core/init.sh"
source "$(dirname "${BASH_SOURCE[0]}")/../../core/utils.sh"

# Install Go and packages
install_go() {
    if ! command -v go &> /dev/null; then
        print_status "Installing golang"
        if [[ $OS_TYPE == "Linux" ]]; then
            execute sudo apt install golang
        elif [[ $OS_TYPE == "Darwin" ]]; then
            execute brew install golang
        fi
    fi

    # Install all go packages from file
    if [[ -f "$SETUP_ROOT/go-packages.txt" ]]; then
        print_status "Installing go packages"
        while IFS= read -r go_package; do
            # Skip empty or whitespace-only lines
            [[ -z "$go_package" ]] && continue
            print_status "Installing $go_package"
            execute go install "$go_package"
        done < "$SETUP_ROOT/go-packages.txt"
    fi

    # Install gofumpt
    if ! command -v gofumpt &> /dev/null; then
        print_status "Installing gofumpt"
        execute go install mvdan.cc/gofumpt@latest
    fi
}

# Install or update golangci-lint
install_golangci_lint() {
    if ! command -v golangci-lint &> /dev/null; then
        print_status "Installing golangci-lint"
        if [[ $OS_TYPE == "Linux" ]]; then
            execute curl -sSfL https://raw.githubusercontent.com/golangci/golangci-lint/HEAD/install.sh | sh -s -- -b "$(go env GOPATH)/bin" v2.3.1
        elif [[ $OS_TYPE == "Darwin" ]]; then
            execute brew install golangci-lint
        fi
    else
        print_status "golangci-lint is already installed"
    fi
}

# Install Miniconda
install_miniconda() {
    if ! command -v conda &> /dev/null; then
        print_status "Installing Miniconda"
        local miniconda_script

        if [[ $OS_TYPE == "Linux" ]]; then
            miniconda_script=Miniconda3-latest-Linux-x86_64.sh
            if [[ $ARCH == "aarch64" ]]; then
                miniconda_script=Miniconda3-latest-Linux-aarch64.sh
            fi
        elif [[ $OS_TYPE == "Darwin" ]]; then
            if [[ $ARCH == "arm64" ]]; then
                miniconda_script=Miniconda3-latest-MacOSX-arm64.sh
            else
                miniconda_script=Miniconda3-latest-MacOSX-x86_64.sh
            fi
        fi

        execute curl -LO "https://repo.anaconda.com/miniconda/$miniconda_script"
        execute bash "$miniconda_script" -b -p "$HOME/miniconda3"
        execute rm "$miniconda_script"

        # Add conda to PATH in .zshrc if not already present
        if ! grep -qF "$HOME/miniconda3/bin" "$HOME/.zshrc"; then
            echo 'export PATH="$HOME/miniconda3/bin:$PATH"' >> "$HOME/.zshrc"
        fi
    fi
}

# Install NVM and Node.js
install_nodejs() {
    if ! command -v nvm &> /dev/null; then
        print_status "Installing nvm"
        execute curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash

        # Source nvm in current shell for immediate use
        export NVM_DIR="$HOME/.nvm"
        [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

        # Add nvm source lines to .zshrc if not already present
        if ! grep -q 'NVM_DIR' "$HOME/.zshrc"; then
            cat <<'EOF' >> "$HOME/.zshrc"
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
EOF
        fi
    else
        export NVM_DIR="$HOME/.nvm"
        [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    fi

    if command -v nvm &> /dev/null; then
        print_status "Ensuring Node.js v20 is installed and set as default"
        execute nvm install 20
        execute nvm alias default 20

        # Install npm packages
        install_npm_packages
    fi
}

# Install global npm packages
install_npm_packages() {
    if command -v npm &> /dev/null; then
        # Install claude-code
        if ! command -v claude &> /dev/null; then
            print_status "Installing claude-code"
            execute npm install -g @anthropic-ai/claude-code
        fi

        # Update gemini-cli
        print_status "Updating gemini-cli"
        execute npm update -g @google/gemini-cli

        # Install ibm-openapi-validator
        if ! command -v lint-openapi &> /dev/null; then
            print_status "Installing ibm-openapi-validator"
            execute npm install -g ibm-openapi-validator
        fi
    fi
}

# Component interface implementation
check_dependencies() {
    # Check for curl needed for downloads
    command -v curl &> /dev/null || {
        print_error "curl is required for languages component"
        return 1
    }
}

install_component() {
    local mode="${1:-install}"

    case "$mode" in
        install)
            install_go
            install_golangci_lint
            install_miniconda
            install_nodejs
            ;;
        update)
            install_npm_packages  # Update npm packages
            ;;
        remove)
            print_status "Removing languages is not implemented"
            ;;
        *)
            print_error "Unknown mode: $mode"
            return 1
            ;;
    esac
}

configure_component() {
    # Configuration is handled during installation
    # (Adding to .zshrc, setting up aliases, etc.)
    true
}

cleanup_component() {
    # Clean up installation files if any
    true
}