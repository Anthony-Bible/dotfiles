#!/usr/bin/env bash
set -euo pipefail

# Source common utilities
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/format-common.sh"

# Help function
show_help() {
    cat << EOF
USAGE: $0 [OPTIONS] [FILES...]

Protocol buffer formatting and validation tool.

OPTIONS:
    -h, --help      Show this help message and exit
    -v, --verbose   Enable verbose output
    -q, --quiet     Suppress non-error output

DESCRIPTION:
    Runs buf fmt and buf lint on .proto files.

EXAMPLES:
    # Lint all proto files
    $0 ./...

    # Lint specific files
    $0 service.proto proto/*.proto

EOF
}

# Tool-specific processing
process_proto_files() {
    local filepath="$1"

    # Format with buf
    run_tool "buf fmt" "buf" "buf fmt -w" "$filepath" || return 2

    # Lint with buf
    local output
    output=$(buf lint "$filepath" 2>&1 || true)
    if [[ -n "$output" ]]; then
        local file_specific
        file_specific=$(filter_output_by_file "$output" "$filepath")
        if [[ -n "$file_specific" ]]; then
            echoerr "buf lint found issues: $file_specific"
            return 2
        fi
    fi

    return 0
}

# Main execution
parse_common_args "$@"
[[ "$HELP_REQUESTED" == "true" ]] && { show_help; exit 0; }

# Process files
process_hook_input "buf" ".proto" "process_proto_files" "$@"

# Finalize
finalize_format_script "proto formatting and linting"