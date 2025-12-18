#!/usr/bin/env bash
# Component API - Standard interface for all setup components

# Source core utilities
source "$(dirname "${BASH_SOURCE[0]}")/../core/init.sh"
source "$(dirname "${BASH_SOURCE[0]}")/../core/utils.sh"

# Registry for components
declare -A COMPONENTS
declare -A COMPONENT_DESCRIPTIONS

# Register a component
register_component() {
    local name="$1"
    local path="$2"
    local description="$3"

    COMPONENTS["$name"]="$path"
    COMPONENT_DESCRIPTIONS["$name"]="$description"
}

# List all registered components
list_components() {
    for name in "${!COMPONENTS[@]}"; do
        echo "  $name - ${COMPONENT_DESCRIPTIONS[$name]}"
    done
}

# Load a component
load_component() {
    local name="$1"
    local component_path="${COMPONENTS[$name]}"

    if [[ -z "$component_path" ]]; then
        print_error "Component '$name' not found"
        return 1
    fi

    if [[ -f "$component_path" ]]; then
        source "$component_path"
        return 0
    else
        print_error "Component file not found: $component_path"
        return 1
    fi
}

# Execute a component function safely
execute_component_function() {
    local component="$1"
    local function="$2"
    shift 2
    local args=("$@")

    # Load the component
    if ! load_component "$component"; then
        return 1
    fi

    # For the install_component function, we need to check if it's the wrapper or the component's own function
    # If it's install_component, we already know the mode is passed in the args
    # The component's install_component expects mode as first arg

    # Check if the function exists
    if declare -F "$function" &> /dev/null; then
        verbose "Running $function for $component component"
        "$function" "${args[@]}"
    else
        print_error "Function $function not found in component $component"
        return 1
    fi
}

# Standard component interface
# All components should implement these functions:

# Wrapper functions that handle component loading before calling actual functions
# Note: These use _component suffix to avoid naming conflicts with component functions

_check_dependencies() {
    local component="$1"
    execute_component_function "$component" "check_dependencies" 2>/dev/null || true
}

# _install_component() - Installation with optional mode (install/update/remove)
_install_component() {
    local component="$1"
    local mode="${2:-install}"
    shift 2
    local args=("$@")

    execute_component_function "$component" "install_component" "$mode" "${args[@]}"
}

# _configure_component() - Post-installation configuration
_configure_component() {
    local component="$1"
    shift
    local args=("$@")

    execute_component_function "$component" "configure_component" "${args[@]}"
}

# _cleanup_component() - Cleanup old versions
_cleanup_component() {
    local component="$1"
    shift
    local args=("$@")

    execute_component_function "$component" "cleanup_component" "${args[@]}"
}


# Run a complete component installation
run_component() {
    local component="$1"
    local mode="${2:-install}"

    if ! should_run_component "$component"; then
        verbose "Skipping $component component as requested"
        return 0
    fi

    print_status "Installing $component component"

    # Check dependencies
    _check_dependencies "$component" || {
        print_error "Dependency check failed for $component"
        return 1
    }

    # Install component
    _install_component "$component" "$mode" || {
        print_error "Installation failed for $component"
        return 1
    }

    # Configure component
    _configure_component "$component" || {
        print_error "Configuration failed for $component"
        return 1
    }

    # Cleanup if needed
    _cleanup_component "$component"

    print_success "Successfully installed $component component"
}

# Run multiple components
run_components() {
    local mode="$1"
    shift
    local components=("$@")
    local failed_components=()

    if [[ ${#components[@]} -eq 0 ]]; then
        # Run all registered components
        components=("${!COMPONENTS[@]}")
    fi

    verbose "Running components in mode: $mode"
    verbose "Components: ${components[*]}"

    for component in "${components[@]}"; do
        if ! run_component "$component" "$mode"; then
            failed_components+=("$component")
        fi
    done

    if [[ ${#failed_components[@]} -gt 0 ]]; then
        print_error "Failed components: ${failed_components[*]}"
        return 1
    fi

    print_success "All components installed successfully"
}

# Auto-register components from the components directory
auto_register_components() {
    local components_dir="$(dirname "${BASH_SOURCE[0]}")/../components"

    # Register main component files
    if [[ -d "$components_dir" ]]; then
        for component_dir in "$components_dir"/*; do
            if [[ -d "$component_dir" && -f "$component_dir/main.sh" ]]; then
                local component_name=$(basename "$component_dir")
                register_component "$component_name" "$component_dir/main.sh" "Component: $component_name"
            fi
        done
    fi
}