#!/usr/bin/env bash

if ! command -v shellcheck &> /dev/null; then
    echo "shellformat is not installed. Please install it first."
    exit 1
fi

if [[ -z "$1" ]]; then
    echo "Usage: $0 <file>"
    exit 1
fi
file="$1"

if [[ ! -f "$file" ]]; then
    echo "File not found: $file"
    exit 1
fi

shellcheck_output=$(shellcheck "$file" --format=tty --severity=warning 2>&1)
exit_code=$?

if [[ $exit_code -ne 0 ]]; then
    echo "Script has shellcheck errors, fix these one by one: $shellcheck_output" >&2
    exit 2
else
    echo "No shellcheck problems found"
fi
