#!/usr/bin/env bash
# Core initialization and argument parsing for modular setup system

# Get the project root directory
# Use SETUP_ROOT if defined, otherwise calculate from this file's location
if [[ -n "${SETUP_ROOT:-}" ]]; then
    SCRIPT_DIR="$SETUP_ROOT"
else
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
fi

# Color definitions
YELLOW='\033[1;33m'
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

# Global variables
VERBOSE=false
QUIET=false
DRY_RUN=false
SKIP_COMPONENTS=()
ONLY_COMPONENTS=()

# Source security functions from the project root
if [[ -f "$SCRIPT_DIR/lib/security.sh" ]]; then
    source "$SCRIPT_DIR/lib/security.sh"
fi

# Help function
show_help() {
    cat << EOF
USAGE: setup.sh [OPTIONS] [COMPONENTS...]

Dotfiles Setup Script - Automate your development environment

OPTIONS:
    -h, --help          Show this help message and exit
    -v, --verbose       Enable verbose output
    -q, --quiet         Suppress non-error output
    --dry-run           Show what would be done without executing
    --skip COMPONENT    Skip installation of specific component
    --only COMPONENT    Only install specific component(s)

COMPONENTS:
    dev-tools       Development tools (git, tmux, nvim, wezterm)
    languages       Language runtimes (Node.js, Python, Go)
    cloud           Container and cloud tools (minikube, kubectl)
    shell           Shell configuration (zsh, themes, functions)
    all             Install all components (default)

EXAMPLES:
    # Interactive setup with all components
    setup.sh

    # Install only development tools and shell config
    setup.sh --only dev-tools,shell

    # Skip cloud tools installation
    setup.sh --skip cloud

    # Preview changes without applying
    setup.sh --dry-run

    # Verbose installation
    setup.sh --verbose

DESCRIPTION:
    This script installs and configures a complete development environment including:
    - Development tools: git, tmux, neovim, wezterm
    - Language runtimes: Node.js, Python (miniconda), Go
    - Cloud tools: minikube, kubectl
    - Shell: zsh with custom themes and functions
    - All downloads are verified with checksums for security

ENVIRONMENT VARIABLES:
    DOTFILESDIR    Override dotfiles directory location
    ARCH          Override architecture detection (x86_64/aarch64)

EOF
}

# Parse command line arguments
parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            -h|--help)
                show_help
                exit 0
                ;;
            -v|--verbose)
                VERBOSE=true
                shift
                ;;
            -q|--quiet)
                QUIET=true
                shift
                ;;
            --dry-run)
                DRY_RUN=true
                shift
                ;;
            --skip)
                IFS=',' read -ra SKIP_COMPONENTS <<< "$2"
                shift 2
                ;;
            --only)
                IFS=',' read -ra ONLY_COMPONENTS <<< "$2"
                shift 2
                ;;
            -*)
                echo -e "${RED}Unknown option: $1${NC}" >&2
                show_help
                exit 1
                ;;
            *)
                echo -e "${RED}Unknown argument: $1${NC}" >&2
                show_help
                exit 1
                ;;
        esac
    done
}

# Check if a component should be run
should_run_component() {
    local component="$1"

    # If ONLY_COMPONENTS is set, only run those
    if [[ ${#ONLY_COMPONENTS[@]} -gt 0 ]]; then
        for only in "${ONLY_COMPONENTS[@]}"; do
            if [[ "$component" == "$only" ]]; then
                return 0
            fi
        done
        return 1
    fi

    # If SKIP_COMPONENTS is set, skip those
    for skip in "${SKIP_COMPONENTS[@]}"; do
        if [[ "$component" == "$skip" ]]; then
            return 1
        fi
    done

    return 0
}

# Print status messages
print_status() {
    if [[ "$QUIET" != "true" ]]; then
        local message="$1"
        echo -e "${YELLOW}${message}${NC}"
    fi
}

print_success() {
    if [[ "$QUIET" != "true" ]]; then
        local message="$1"
        echo -e "${GREEN}${message}${NC}"
    fi
}

print_error() {
    local message="$1"
    echo -e "${RED}${message}${NC}" >&2
}

# Verbose output helper
verbose() {
    if [[ "$VERBOSE" == "true" ]]; then
        echo "$@"
    fi
}