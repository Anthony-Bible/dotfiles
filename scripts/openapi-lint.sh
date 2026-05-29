#!/usr/bin/env bash
set -euo pipefail

# Source common utilities
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/format-common.sh"

# Help function
show_help() {
    cat << EOF
USAGE: $0 [OPTIONS] [FILES...]

OpenAPI specification validation and linting tool.

OPTIONS:
    -h, --help      Show this help message and exit
    -v, --verbose   Enable verbose output
    -q, --quiet     Suppress non-error output

DESCRIPTION:
    Runs lint-openapi on OpenAPI/YAML files. Automatically detects OpenAPI specs.

EXAMPLES:
    # Lint all YAML files
    $0 ./...

    # Lint specific files
    $0 api.yaml openapi.yaml

EOF
}

# Tool-specific processing with OpenAPI detection
process_openapi_files() {
    local filepath="$1"

    # Check if it's an OpenAPI file
    if ! check_openapi_file "$filepath"; then
        if [[ "$VERBOSE" == "true" ]]; then
            echoinfo "Skipping $filepath (not an OpenAPI file)"
        fi
        return 0
    fi

    run_tool "lint-openapi" "lint-openapi" "lint-openapi" "$filepath"
}

# Main execution
parse_common_args "$@"
[[ "$HELP_REQUESTED" == "true" ]] && { show_help; exit 0; }

# Process files (supports both .yaml and .yml)
process_hook_input "lint-openapi" ".yaml,.yml" "process_openapi_files" "$@"

# Finalize
finalize_format_script "OpenAPI linting"