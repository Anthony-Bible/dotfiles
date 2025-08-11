#!/usr/bin/env bash
echoerr() {
    echo -e "\033[31m$*\033[0m" >&2
}

if ! command -v gofumpt &> /dev/null; then
    echoerr "gofumpt is not installed. Please install it first: go install mvdan.cc/gofumpt@latest"
    exit 2
fi

if ! command -v golangci-lint &> /dev/null; then
    echoerr "golangci-lint is not installed. Please install it first: https://golangci-lint.run/usage/install/"
    exit 2
fi

final_exit_code=0

# Check if arguments are provided (direct command usage)
if [[ $# -gt 0 ]]; then
    # Process arguments directly
    for filepath in "$@"; do
        # Only process .go files
        if [[ "$filepath" != *.go ]]; then
            continue
        fi
        
        echo "Formatting and checking file: $filepath"
        if [[ ! -f "$filepath" ]]; then
            echoerr "File not found: $filepath"
            exit 2
        fi
        
        # Format with gofumpt
        echo "Running gofumpt on $filepath"
        gofumpt -w "$filepath"
        format_exit_code=$?
        
        if [[ $format_exit_code -ne 0 ]]; then
            echoerr "gofumpt failed on $filepath"
            final_exit_code=2
        else
            echo "File formatted successfully with gofumpt"
        fi
        
        # Lint with golangci-lint
        echo "Running golangci-lint on $filepath"
        golangci_output=$(golangci-lint run ./... 2>&1)
        lint_exit_code=$?

        if [[ $lint_exit_code -ne 0 ]]; then
            echoerr "golangci-lint found issues, fix these one by one: $golangci_output" 
            final_exit_code=2
        else
            echo "No golangci-lint issues found"
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
    files_changed=$(echo "$INPUT" | jq -r '.tool_input.file_path | select(endswith(".go"))')
    if [[ -z "$files_changed" ]]; then
        echo "No .go files found in the input."
        exit 0
    fi
    for filepath in $files_changed; do

        echo "Formatting and checking file: $filepath"
        if [[ ! -f "$filepath" ]]; then
            echoerr "File not found: $filepath"
            exit 2
        fi
        
        # Format with gofumpt
        echo "Running gofumpt on $filepath"
        gofumpt -w "$filepath"
        format_exit_code=$?
        
        if [[ $format_exit_code -ne 0 ]]; then
            echoerr "gofumpt failed on $filepath"
            final_exit_code=2
        else
            echo "File formatted successfully with gofumpt"
        fi
        
        # Lint with golangci-lint
        echo "Running golangci-lint on $filepath"
        golangci_output=$(golangci-lint run ./... 2>&1)
        lint_exit_code=$?

        if [[ $lint_exit_code -ne 0 ]]; then
            echoerr "golangci-lint found issues, fix these one by one: $golangci_output" 
            final_exit_code=2
        else
            echo "No golangci-lint issues found"
        fi
    done
fi

if [[ $final_exit_code -eq 0 ]]; then
    echo "All files passed formatting and linting."
fi

exit $final_exit_code
