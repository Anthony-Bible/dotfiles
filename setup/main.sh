#!/usr/bin/env bash
# Modular setup orchestrator - Coordinates component installations

set -euo pipefail

# Source core initialization, utilities, and component API
SETUP_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SETUP_ROOT="$(cd "$SETUP_SCRIPT_DIR/.." && pwd)"
export SETUP_SCRIPT_DIR SETUP_ROOT
source "$SETUP_SCRIPT_DIR/core/init.sh"
source "$SETUP_SCRIPT_DIR/core/utils.sh"
source "$SETUP_SCRIPT_DIR/lib/component-api.sh"

# Main execution function
main() {
    # Parse command line arguments
    parse_args "$@"

    # Set up common utilities and directories
    init_common

    # Auto-register all components
    auto_register_components

    # Determine which components to run
    local components_to_run=()

    if [[ ${#ONLY_COMPONENTS[@]} -gt 0 ]]; then
        # Use only specified components
        components_to_run=("${ONLY_COMPONENTS[@]}")
    else
        # Use all components, except those skipped
        for component in "${!COMPONENTS[@]}"; do
            if should_run_component "$component"; then
                components_to_run+=("$component")
            fi
        done
    fi

    # If dry-run, show what would be done
    if [[ "$DRY_RUN" == "true" ]]; then
        print_status "Dry-run mode: Would install the following components:"
        for component in "${components_to_run[@]}"; do
            echo "  - $component"
        done
        return 0
    fi

    # Run the components
    if [[ ${#components_to_run[@]} -eq 0 ]]; then
        print_status "No components to install"
        return 0
    fi

    print_status "Starting installation of: ${components_to_run[*]}"

    # Execute components
    if run_components install "${components_to_run[@]}"; then
        print_success "Setup completed successfully!"

        # Run Claude configuration if it exists
        if [[ -f "$SETUP_ROOT/setup-claude.sh" ]]; then
            print_status "Running Claude configuration setup"
            bash "$SETUP_ROOT/setup-claude.sh"
        else
            print_status "Note: setup-claude.sh not found, skipping Claude configuration"
        fi
    else
        print_error "Setup failed. Check the error messages above."
        exit 1
    fi
}

# Show available components if requested
if [[ "${1:-}" == "--list-components" ]]; then
    # Initialize components first
    auto_register_components
    echo "Available components:"
    list_components
    exit 0
fi

# Run main function with all arguments
main "$@"