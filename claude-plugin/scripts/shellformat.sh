#!/usr/bin/env bash
set -euo pipefail

# Source common utilities
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/format-common.sh"

# Help function
show_help() {
    cat << EOF
USAGE: $0 [OPTIONS] [FILES...]

Shell script linting tool using shellcheck.

OPTIONS:
    -h, --help      Show this help message and exit
    -v, --verbose   Enable verbose output
    -q, --quiet     Suppress non-error output

DESCRIPTION:
    Runs shellcheck on .sh files for potential issues and best practices.

EXAMPLES:
    # Lint all shell scripts
    $0 ./...

    # Lint specific scripts
    $0 setup.sh scripts/*.sh

EOF
}

# Tool-specific processing
process_shell_files() {
    local filepath="$1"
    run_tool "shellcheck" "shellcheck" "shellcheck --format=tty --severity=warning" "$filepath"
}

# Main execution
parse_common_args "$@"
[[ "$HELP_REQUESTED" == "true" ]] && { show_help; exit 0; }

# Process files
process_hook_input "shellcheck" ".sh" "process_shell_files" "$@"

# Finalize
finalize_format_script "shell script linting"