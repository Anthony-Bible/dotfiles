#!/usr/bin/env bash
echoerr() {
    echo -e "\033[31m$*\033[0m" >&2
}

if ! command -v shellcheck &> /dev/null; then
    echoerr "shellcheck is not installed. Please install it first."
    exit 2
fi

final_exit_code=0

# Check if arguments are provided (direct command usage)
if [[ $# -gt 0 ]]; then
    # Process arguments directly
    for filepath in "$@"; do
        # Only process .sh files
        if [[ "$filepath" != *.sh ]]; then
            continue
        fi
        
        echo "Checking file: $filepath"
        if [[ ! -f "$filepath" ]]; then
            echoerr "File not found: $filepath"
            exit 2
        fi
        
        shellcheck_output=$(shellcheck "$filepath" --format=tty --severity=warning 2>&1)
        exit_code=$?

        if [[ $exit_code -ne 0 ]]; then
            echoerr "Script has shellcheck errors, fix these one by one: $shellcheck_output" 
            final_exit_code=2
        else
            echo "No shellcheck problems found"
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
    files_changed=$(echo "$INPUT" | jq -r '.tool_input.file_path | select(endswith(".sh"))')
    if [[ -z "$files_changed" ]]; then
        echo "No .sh files found in the input."
        exit 0
    fi
    for filepath in $files_changed; do

        echo "Checking file: $filepath"
        if [[ ! -f "$filepath" ]]; then
            echoerr "File not found: $filepath"
            exit 2
        fi
        shellcheck_output=$(shellcheck "$filepath" --format=tty --severity=warning 2>&1)
        exit_code=$?

        if [[ $exit_code -ne 0 ]]; then
            echoerr "Script has shellcheck errors, fix these one by one: $shellcheck_output" 
            final_exit_code=2
        else
            echo "No shellcheck problems found"
        fi
    done
fi

if [[ $final_exit_code -eq 0 ]]; then
    echo "All files passed shellcheck."
fi

exit $final_exit_code
