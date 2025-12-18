#!/usr/bin/env bash
set -euo pipefail

echoerr() {
    echo -e "\033[31m$*\033[0m" >&2
}

# Source security functions
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$SCRIPT_DIR/../lib/security.sh" ]]; then
    source "$SCRIPT_DIR/../lib/security.sh"
fi

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
    Runs buf on .proto files for linting and formatting.

EXAMPLES:
    # Lint all proto files
    $0 ./...

    # Lint specific files
    $0 service.proto proto/*.proto

EOF
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            show_help
            exit 0
            ;;
        -v|--verbose)
            shift
            ;;
        -q|--quiet)
            exec 1>/dev/null
            shift
            ;;
        -*)
            echoerr "Unknown option: $1"
            show_help
            exit 1
            ;;
        *)
            break
            ;;
    esac
done

if ! command -v buf &> /dev/null; then
    echoerr "buf is not installed. Please install it first: https://buf.build/docs/installation"
    exit 2
fi

final_exit_code=0

# Check if arguments are provided (direct command usage)
if [[ $# -gt 0 ]]; then
    # Process arguments directly
    for filepath in "$@"; do
        # Only process .proto files
        if [[ "$filepath" != *.proto ]]; then
            continue
        fi

        echo "Formatting and checking file: $filepath"
        if [[ ! -f "$filepath" ]]; then
            echoerr "File not found: $filepath"
            exit 2
        fi

        # Format with buf
        echo "Running buf fmt on $filepath"
        buf fmt -w "$filepath"
        format_exit_code=$?

        if [[ $format_exit_code -ne 0 ]]; then
            echoerr "buf fmt failed on $filepath"
            final_exit_code=2
        else
            echo "File formatted successfully with buf fmt"
        fi

        # Lint with buf
        echo "Running buf lint on $filepath"
        buf_output=$(buf lint "$filepath" 2>&1)
        lint_exit_code=$?

        if [[ $lint_exit_code -ne 0 ]]; then
            echoerr "buf lint found issues: $buf_output"
            final_exit_code=2
        else
            echo "No buf lint issues found"
        fi
    done
else
    # Read from stdin and parse JSON (hook usage)
    INPUT=$(cat )
    if [[ -z "$INPUT" ]]; then
        echoerr "No input provided. Please provide a JSON input."
        exit 2
    fi
    echo "Input received: $INPUT"
    files_changed=$(echo "$INPUT" | jq -r '.tool_input.file_path | select(endswith(".proto"))')
    if [[ -z "$files_changed" ]]; then
        echo "No .proto files found in the input."
        exit 0
    fi
    for filepath in $files_changed; do

        echo "Formatting and checking file: $filepath"
        if [[ ! -f "$filepath" ]]; then
            echoerr "File not found: $filepath"
            exit 2
        fi

        # Format with buf
        echo "Running buf fmt on $filepath"
        buf fmt -w "$filepath"
        format_exit_code=$?

        if [[ $format_exit_code -ne 0 ]]; then
            echoerr "buf fmt failed on $filepath"
            final_exit_code=2
        else
            echo "File formatted successfully with buf fmt"
        fi

        # Lint with buf
        echo "Running buf lint on $filepath"
        buf_output=$(buf lint "$filepath" 2>&1)
        lint_exit_code=$?
        filepath_without_pwd=$(echo "$filepath" | sed "s|$(pwd)/||")
        if [[ $lint_exit_code -ne 0 ]]; then
            filespecific=$(echo "$buf_output" | grep "$filepath_without_pwd" || true)
        fi

        if [[ -n $filespecific ]]; then
            echoerr "buf lint found issues in $filepath: $filespecific"
            final_exit_code=2
        else
            echo "No buf lint issues found"
        fi
    done
fi

if [[ $final_exit_code -eq 0 ]]; then
    echo "All files passed formatting and linting."
fi

exit $final_exit_code