#!/usr/bin/env bash
set -euo pipefail

# Security utility functions for dotfiles scripts
# Provides safe download, input validation, and error handling

# Secure download function with checksum verification
secure_download() {
    local url="$1"
    local output="$2"
    local expected_sha256="${3:-}"

    # Input validation
    [[ "$url" =~ ^https?:// ]] || {
        echo "ERROR: Invalid URL format: $url" >&2
        return 1
    }

    [[ "$output" =~ ^[a-zA-Z0-9._/-]+$ ]] || {
        echo "ERROR: Invalid output filename: $output" >&2
        return 1
    }

    # Download with temporary file
    local temp_file="${output}.tmp.$$"
    echo "Downloading: $url"
    curl --fail --silent --show-error --location --output "$temp_file" "$url" || {
        echo "ERROR: Failed to download from $url" >&2
        rm -f "$temp_file"
        return 1
    }

    # Verify checksum if provided
    if [[ -n "$expected_sha256" ]]; then
        local actual_sha256
        actual_sha256=$(sha256sum "$temp_file" | cut -d' ' -f1)
        if [[ "$actual_sha256" != "$expected_sha256" ]]; then
            echo "ERROR: Checksum verification failed!" >&2
            echo "Expected: $expected_sha256" >&2
            echo "Actual: $actual_sha256" >&2
            rm -f "$temp_file"
            return 1
        fi
        echo "✓ Checksum verified: $output"
    fi

    # Move to final location
    mv "$temp_file" "$output"
    echo "✓ Downloaded: $output"
}

# Validate path argument to prevent path traversal
validate_path() {
    local path="$1"
    local allow_absolute="${2:-false}"

    # Check for path traversal
    if [[ "$path" =~ \.\./|\.\. ]]; then
        echo "ERROR: Path traversal detected: $path" >&2
        return 1
    fi

    if [[ "$allow_absolute" == "true" ]]; then
        [[ "$path" =~ ^[a-zA-Z0-9._/-]+$ ]] || {
            echo "ERROR: Invalid path: $path" >&2
            return 1
        }
    else
        [[ "$path" =~ ^[a-zA-Z0-9._-]+$ ]] && [[ "$path" != */* ]] || {
            echo "ERROR: Invalid filename: $path" >&2
            return 1
        }
    fi
}

# Validate environment variables
validate_environment() {
    local required_vars=("$@")

    for var in "${required_vars[@]}"; do
        if [[ -z "${!var:-}" ]]; then
            echo "ERROR: Required environment variable $var is not set" >&2
            exit 1
        fi
    done
}

# Safe command execution with error handling
safe_exec() {
    local cmd="$1"
    shift
    local args=("$@")

    # Validate command exists
    command -v "$cmd" >/dev/null 2>&1 || {
        echo "ERROR: Command not found: $cmd" >&2
        return 1
    }

    # Execute with error handling
    if ! "$cmd" "${args[@]}"; then
        echo "ERROR: Command failed: $cmd ${args[*]}" >&2
        return 1
    fi
}

# Progress indicator for downloads
progress_download() {
    local url="$1"
    local output="$2"
    echo "Downloading: $(basename "$url")"
    curl -L --progress-bar "$url" -o "$output"
}

# Error handling with recovery suggestions
handle_error() {
    local exit_code="$1"
    local operation="$2"

    echo "ERROR: $operation failed with exit code $exit_code" >&2
    echo "Troubleshooting tips:" >&2
    echo "  1. Check your internet connection" >&2
    echo "  2. Verify permissions for target directory" >&2
    echo "  3. Try running with --verbose for more details" >&2
    echo "  4. See README.md for setup instructions" >&2
}

# Dry run mode execution
DRY_RUN=false

execute() {
    local cmd="$*"
    if [[ "$DRY_RUN" == "true" ]]; then
        echo "[DRY-RUN] Would execute: $cmd"
    else
        eval "$cmd"
    fi
}

# Validate file operations
validate_file_operation() {
    local operation="$1"
    local file="$2"

    validate_path "$file" true

    case "$operation" in
        "read")
            [[ -f "$file" ]] || { echo "ERROR: File does not exist: $file" >&2; return 1; }
            [[ -r "$file" ]] || { echo "ERROR: File not readable: $file" >&2; return 1; }
            ;;
        "write")
            local dir
            dir=$(dirname "$file")
            [[ -d "$dir" ]] || { echo "ERROR: Directory does not exist: $dir" >&2; return 1; }
            [[ -w "$dir" ]] || { echo "ERROR: Directory not writable: $dir" >&2; return 1; }
            ;;
    esac
}

# Show progress for operations
show_progress() {
    local current="$1"
    local total="$2"
    local desc="$3"
    printf "[%3d%%] %s\n" $((current * 100 / total)) "$desc"
}