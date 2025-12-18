#!/usr/bin/env bash
# Shared utility library for format scripts
set -euo pipefail

# =============================================================================
# COLOR OUTPUT FUNCTIONS
# =============================================================================
echoerr() { echo -e "\033[31m$*\033[0m" >&2; }
echosuccess() { echo -e "\033[32m$*\033[0m"; }
echowarn() { echo -e "\033[33m$*\033[0m"; }
echoinfo() { echo -e "\033[34m$*\033[0m"; }

# =============================================================================
# GLOBAL VARIABLES (managed by common functions)
# =============================================================================
VERBOSE=false
QUIET=false
DRY_RUN=false
HELP_REQUESTED=false
FINAL_EXIT_CODE=0

# =============================================================================
# COMMON ARGUMENT PARSING
# =============================================================================
parse_common_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            -h|--help) HELP_REQUESTED=true; shift ;;
            -v|--verbose) VERBOSE=true; shift ;;
            -q|--quiet) QUIET=true; exec 1>/dev/null; shift ;;
            --dry-run) DRY_RUN=true; shift ;;
            *) break ;;
        esac
    done
}

# =============================================================================
# HOOK INPUT PROCESSING
# =============================================================================
process_hook_input() {
    local tool_name="$1"
    local file_extensions="$2"  # Comma-separated: ".go,.proto"
    local process_func="$3"
    shift 3
    local extra_args=("$@")

    # Read from stdin (hook mode) or process arguments (direct mode)
    if [[ $# -gt 0 ]]; then
        # Direct command usage
        for filepath in "$@"; do
            process_single_file "$tool_name" "$filepath" "$file_extensions" "$process_func"
        done
    else
        # Hook mode - read JSON from stdin
        local input
        input=$(cat)

        if [[ -z "$input" ]]; then
            echoerr "No input provided. Please provide a JSON input."
            exit 2
        fi

        echoinfo "Input received: $input"

        # Build jq filter for multiple extensions
        local jq_filter=".tool_input.file_path"
        local extension_filters=()
        IFS=',' read -ra EXTENSIONS <<< "$file_extensions"
        for ext in "${EXTENSIONS[@]}"; do
            extension_filters+=("endswith(\"$ext\")")
        done

        # Join filters with " or "
        local filter_string
        filter_string=$(IFS=' or '; echo "${extension_filters[*]}")
        jq_filter+=" | select($filter_string)"

        local files
        files=$(echo "$input" | jq -r "$jq_filter" 2>/dev/null || echo "")


        if [[ -z "$files" ]]; then
            local ext_list="${file_extensions//,/ }"
            echoinfo "No $ext_list files found in the input."
            exit 0
        fi

        for filepath in $files; do
            process_single_file "$tool_name" "$filepath" "$file_extensions" "$process_func"
        done
    fi
}

# =============================================================================
# INDIVIDUAL FILE PROCESSING
# =============================================================================
process_single_file() {
    local tool_name="$1"
    local filepath="$2"
    local file_extensions="$3"
    local process_func="$4"

    # Check file extension
    local matches_extension=false
    IFS=',' read -ra EXTENSIONS <<< "$file_extensions"
    for ext in "${EXTENSIONS[@]}"; do
        if [[ "$filepath" == *"$ext" ]]; then
            matches_extension=true
            break
        fi
    done

    if [[ "$matches_extension" == "false" ]]; then
        return 0
    fi

    # Check if file exists
    if [[ ! -f "$filepath" ]]; then
        echoerr "File not found: $filepath"
        FINAL_EXIT_CODE=2
        return 2
    fi

    # Verbose logging
    if [[ "$VERBOSE" == "true" ]]; then
        echoinfo "Processing $filepath with $tool_name"
    fi

    # Execute tool-specific processing
    "$process_func" "$filepath"
    local exit_code=$?

    if [[ $exit_code -ne 0 ]]; then
        FINAL_EXIT_CODE=$exit_code
    fi
}

# =============================================================================
# TOOL EXECUTION WRAPPERS
# =============================================================================
run_tool() {
    local tool_name="$1"
    local check_cmd="$2"
    local run_cmd="$3"
    shift 3
    local args=("$@")

    # Check if tool is installed
    if ! command -v "$check_cmd" &> /dev/null; then
        echoerr "$tool_name is not installed. Please install it first."
        return 2
    fi

    # Handle dry-run mode
    if [[ "$DRY_RUN" == "true" ]]; then
        echoinfo "[DRY-RUN] Would run: $run_cmd ${args[*]}"
        return 0
    fi

    # Execute tool
    if [[ "$VERBOSE" == "true" ]]; then
        echoinfo "Running $tool_name on ${args[*]}"
    fi
    if ! eval "$run_cmd ${args[*]}"; then
        echoerr "$tool_name failed on: ${args[*]}"
        return 2
    fi

    if [[ "$VERBOSE" == "true" ]]; then
        echosuccess "$tool_name completed successfully on: ${args[*]}"
    fi
    return 0
}

# =============================================================================
# UTILITIES FOR SPECIFIC TOOLS
# =============================================================================
check_openapi_file() {
    local filepath="$1"
    grep -q "openapi:" "$filepath" || grep -q "swagger:" "$filepath"
}

filter_output_by_file() {
    local output="$1"
    local filepath="$2"
    local filepath_without_pwd
    filepath_without_pwd=$(echo "$filepath" | sed "s|$(pwd)/||")
    echo "$output" | grep "$filepath_without_pwd" || true
}

# =============================================================================
# FINALIZATION
# =============================================================================
finalize_format_script() {
    local tool_name="$1"

    if [[ $FINAL_EXIT_CODE -eq 0 ]]; then
        echosuccess "All files passed $tool_name."
    else
        echoerr "$tool_name detected issues that need to be fixed."
    fi

    exit $FINAL_EXIT_CODE
}

# =============================================================================
# INITIALIZATION
# =============================================================================
init_format_script() {
    # Source security functions if available
    local script_dir
    script_dir="$(cd "$(dirname "${BASH_SOURCE[1]}")" && pwd)"
    if [[ -f "$script_dir/../lib/security.sh" ]]; then
        source "$script_dir/../lib/security.sh"
    fi
}

# Initialize when sourced
init_format_script