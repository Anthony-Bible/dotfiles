#!/usr/bin/env bash
set -euo pipefail

# Source common utilities
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/format-common.sh"

# Help function
show_help() {
    cat << EOF
USAGE: $0 [OPTIONS] [FILES...]

Go code formatting and linting tool.

OPTIONS:
    -h, --help      Show this help message and exit
    -v, --verbose   Enable verbose output
    -q, --quiet     Suppress non-error output
    --dry-run       Show what would be done without executing

DESCRIPTION:
    Runs gofumpt and golangci-lint on Go files. Can be used directly or as a Git hook.
    When called via Git hook, expects JSON input with 'files' array.

EXAMPLES:
    # Run on all Go files
    $0 ./...

    # Run on specific files
    $0 main.go utils.go

    # Show what would be done
    $0 --dry-run main.go

    # Run with verbose output
    $0 --verbose ./...

EXIT CODES:
    0   Success
    1   General error
    2   lint check failed
EOF
}

# Tool-specific processing
process_go_files() {
    local filepath="$1"
    local pkg_dir
    pkg_dir=$(dirname "$filepath")

    # Format with gofumpt (note: uses golangci-lint fmt command)
    # Run on package directory for consistency with linting
    run_tool "golangci-lint" "golangci-lint" "golangci-lint fmt" "$pkg_dir" || return 2

    # Lint with output filtering
    # Run on package directory so cross-file type references resolve correctly
    local output
    output=$(golangci-lint run --fix "$pkg_dir" 2>&1 || true)
    if [[ -n "$output" ]]; then
        local file_specific
        file_specific=$(filter_output_by_file "$output" "$filepath")
        if [[ -n "$file_specific" ]]; then
            echoerr "golangci-lint found issues: $file_specific"
            return 2
        fi
    fi

    return 0
}

# Main execution
parse_common_args "$@"
[[ "$HELP_REQUESTED" == "true" ]] && { show_help; exit 0; }

# Check if golangci-lint is installed
if ! command -v golangci-lint &> /dev/null; then
    echoerr "golangci-lint is not installed. Please install it first: https://golangci-lint.run/usage/install/"
    exit 2
fi

# Process files
process_hook_input "golangci-lint" ".go" "process_go_files" "$@"

# Finalize
finalize_format_script "golangci-lint formatting and linting"