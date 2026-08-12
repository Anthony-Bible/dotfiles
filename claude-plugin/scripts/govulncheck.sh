#!/usr/bin/env bash
set -euo pipefail

# Source common utilities
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/format-common.sh"

# Scan timeout in seconds; a slow scan warns rather than blocks.
SCAN_TIMEOUT="${GOVULNCHECK_TIMEOUT:-180}"

show_help() {
    cat << EOF
USAGE: $0 [OPTIONS] [DIR]

Go dependency vulnerability scanner.

OPTIONS:
    -h, --help      Show this help message and exit
    -v, --verbose   Enable verbose output
    -q, --quiet     Suppress non-error output
    --dry-run       Show what would be done without executing

DESCRIPTION:
    Runs govulncheck and blocks on vulnerabilities that are actually reachable
    from your code. Can be used directly or as a Claude Code PostToolUse hook.

    As a hook it only scans when dependencies could have changed: an edit to
    go.mod/go.sum, or a Bash command matching 'go get', 'go install',
    'go mod tidy|download|edit', or 'go work'. Every other tool call is a no-op,
    so this never runs on an ordinary source edit.

    Only findings whose trace reaches one of your call sites are reported;
    vulnerabilities in code you require but never call are ignored. Standard
    library findings are reported as warnings only -- they are fixed by
    upgrading the Go toolchain, not by the edit that triggered the scan.

ENVIRONMENT:
    GOVULNCHECK_TIMEOUT  Seconds before a scan is abandoned (default: 180)

EXAMPLES:
    # Scan the module in the current directory
    $0

    # Scan a specific module directory
    $0 ./services/api

EXIT CODES:
    0   Success (or non-blocking warning emitted)
    2   Reachable dependency vulnerabilities found
EOF
}

# Locate the nearest enclosing module root, since govulncheck must run inside one.
find_module_root() {
    local dir="$1"
    while [[ "$dir" != "/" && -n "$dir" ]]; do
        if [[ -f "$dir/go.mod" ]]; then
            echo "$dir"
            return 0
        fi
        dir=$(dirname "$dir")
    done
    return 1
}

# macOS ships without GNU timeout unless coreutils is installed.
run_with_timeout() {
    if command -v timeout &> /dev/null; then
        timeout "$SCAN_TIMEOUT" "$@"
    elif command -v gtimeout &> /dev/null; then
        gtimeout "$SCAN_TIMEOUT" "$@"
    else
        "$@"
    fi
}

# Decide whether this hook invocation could have changed dependencies.
# Echoes the directory to scan, or nothing when the call is irrelevant.
resolve_scan_dir_from_hook() {
    local input="$1"
    local tool_name file_path command cwd
    tool_name=$(jq -r '.tool_name // ""' <<< "$input")
    file_path=$(jq -r '.tool_input.file_path // ""' <<< "$input")
    command=$(jq -r '.tool_input.command // ""' <<< "$input")
    cwd=$(jq -r '.cwd // ""' <<< "$input")

    if [[ "$file_path" == *"/go.mod" || "$file_path" == "go.mod" \
       || "$file_path" == *"/go.sum" || "$file_path" == "go.sum" ]]; then
        dirname "$file_path"
        return 0
    fi

    if [[ "$tool_name" == "Bash" ]] \
       && grep -Eq '(^|[;&|[:space:]])go[[:space:]]+(get|install)([[:space:]]|$)|(^|[;&|[:space:]])go[[:space:]]+mod[[:space:]]+(tidy|download|edit)([[:space:]]|$)|(^|[;&|[:space:]])go[[:space:]]+work([[:space:]]|$)' <<< "$command"; then
        echo "${cwd:-$PWD}"
        return 0
    fi

    return 0
}

scan_module() {
    local scan_dir="$1"
    local module_root

    if ! module_root=$(find_module_root "$(cd "$scan_dir" 2> /dev/null && pwd || echo "$scan_dir")"); then
        echoinfo "No go.mod found at or above $scan_dir; skipping vulnerability scan."
        return 0
    fi

    if [[ "$DRY_RUN" == "true" ]]; then
        echoinfo "[DRY-RUN] Would run: govulncheck -C $module_root -format json ./..."
        return 0
    fi

    [[ "$VERBOSE" == "true" ]] && echoinfo "Scanning $module_root with govulncheck"

    # govulncheck exits 0 in JSON mode even when vulnerabilities exist, so the
    # findings themselves -- not the exit status -- decide whether to block.
    local output
    if ! output=$(run_with_timeout govulncheck -C "$module_root" -format json ./... 2> /dev/null); then
        echowarn "govulncheck did not complete for $module_root (timeout ${SCAN_TIMEOUT}s or scan error); skipping."
        return 0
    fi

    # A finding is reachable only when its first trace frame names a function.
    local jq_reachable='select(.finding != null and .finding.trace[0].function != null)'

    local deps
    deps=$(jq -r "$jq_reachable"' | select(.finding.trace[0].module != "stdlib")
        | "  \(.finding.osv)  \(.finding.trace[0].module)@\(.finding.trace[0].version // "?")  -> fixed in \(.finding.fixed_version // "no fix available")"' \
        <<< "$output" | sort -u)

    local stdlib_count
    stdlib_count=$(jq -r "$jq_reachable"' | select(.finding.trace[0].module == "stdlib") | .finding.osv' \
        <<< "$output" | sort -u | wc -l | tr -d ' ')

    if [[ "$stdlib_count" -gt 0 ]]; then
        echowarn "govulncheck: $stdlib_count reachable stdlib vulnerability(ies) in $(go version | awk '{print $3}'). Fix by upgrading the Go toolchain, not this change."
    fi

    if [[ -n "$deps" ]]; then
        echoerr "govulncheck found reachable dependency vulnerabilities in $module_root:
$deps
Upgrade the affected modules (go get <module>@<fixed version> && go mod tidy). Run 'govulncheck -C $module_root -show traces ./...' for full call traces."
        return 2
    fi

    echosuccess "govulncheck: no reachable dependency vulnerabilities in $module_root."
    return 0
}

# Main execution
parse_common_args "$@"
[[ "$HELP_REQUESTED" == "true" ]] && { show_help; exit 0; }

if ! command -v govulncheck &> /dev/null; then
    # Do not block real work over a missing optional scanner.
    echowarn "govulncheck is not installed; skipping vulnerability scan. Install: go install golang.org/x/vuln/cmd/govulncheck@latest"
    exit 0
fi

if [[ $# -gt 0 ]]; then
    # Direct command usage
    for dir in "$@"; do
        # shellcheck disable=SC2034 # consumed by finalize_format_script
        scan_module "$dir" || FINAL_EXIT_CODE=$?
    done
else
    # Hook mode - read JSON from stdin
    hook_input=$(cat)
    if [[ -z "$hook_input" ]]; then
        echoerr "No input provided. Please provide a JSON input."
        exit 2
    fi

    target_dir=$(resolve_scan_dir_from_hook "$hook_input")
    if [[ -z "$target_dir" ]]; then
        echoinfo "No dependency changes in this tool call; skipping vulnerability scan."
        exit 0
    fi

    # shellcheck disable=SC2034 # consumed by finalize_format_script
    scan_module "$target_dir" || FINAL_EXIT_CODE=$?
fi

finalize_format_script "govulncheck"
