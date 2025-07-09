#!/usr/bin/env bash
echoerr() {
    echo -e "\033[31m$*\033[0m" >&2
}
#if [[ $# -lt 1 ]]; then
#    echoerr "Usage: $0 <file(s)>"
#    exit 1
#fi
if ! command -v shellcheck &> /dev/null; then
    echoerr "shellcheck is not installed. Please install it first."
    exit 2
fi
final_exit_code=0
while IFS= read -r filepath; do
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
if  [[ $final_exit_code -eq 0 ]]; then
    echo "All files passed shellcheck."
fi
exit $final_exit_code
