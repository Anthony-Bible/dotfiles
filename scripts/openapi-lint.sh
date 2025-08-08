#!/usr/bin/env bash
echoerr() {
    echo -e "\033[31m$*\033[0m" >&2
}

if ! command -v lint-openapi &> /dev/null; then
    echoerr "lint-openapi is not installed. Please install it first."
    exit 2
fi

final_exit_code=0

# Check if arguments are provided (direct command usage)
if [[ $# -gt 0 ]]; then
    # Process arguments directly
    for filepath in "$@"; do
        # Only process .yaml and .yml files
        if [[ "$filepath" != *.yaml && "$filepath" != *.yml ]]; then
            continue
        fi
        
        # Check if it's an OpenAPI file by looking for openapi/swagger field
        if ! (grep -q "openapi:" "$filepath" || grep -q "swagger:" "$filepath"); then
            echo "Skipping $filepath (not an OpenAPI file)"
            continue
        fi
        
        echo "Checking file: $filepath"
        if [[ ! -f "$filepath" ]]; then
            echoerr "File not found: $filepath"
            exit 2
        fi
        
        lint_output=$(lint-openapi "$filepath" 2>&1)
        exit_code=$?

        if [[ $exit_code -ne 0 ]]; then
            echoerr "OpenAPI spec has lint errors, fix these one by one: $lint_output" 
            final_exit_code=2
        else
            echo "No lint-openapi problems found"
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
    files_changed=$(echo "$INPUT" | jq -r '.tool_input.file_path | select(endswith(".yaml") or endswith(".yml"))')
    if [[ -z "$files_changed" ]]; then
        echo "No .yaml/.yml files found in the input."
        exit 0
    fi
    for filepath in $files_changed; do
        # Check if it's an OpenAPI file by looking for openapi/swagger field
        if ! (grep -q "openapi:" "$filepath" || grep -q "swagger:" "$filepath"); then
            echo "Skipping $filepath (not an OpenAPI file)"
            continue
        fi

        echo "Checking file: $filepath"
        if [[ ! -f "$filepath" ]]; then
            echoerr "File not found: $filepath"
            exit 2
        fi
        lint_output=$(lint-openapi "$filepath" 2>&1)
        exit_code=$?

        if [[ $exit_code -ne 0 ]]; then
            echoerr "OpenAPI spec has lint errors, fix these one by one: $lint_output" 
            final_exit_code=2
        else
            echo "No lint-openapi problems found"
        fi
    done
fi

if [[ $final_exit_code -eq 0 ]]; then
    echo "All files passed lint-openapi."
fi

exit $final_exit_code