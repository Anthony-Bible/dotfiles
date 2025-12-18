#!/usr/bin/env bash
set -euo pipefail

# random-quote.sh - Pick a random inspirational quote from quotes.json
# Usage: ./random-quote.sh [path/to/quotes.json]

# Source security functions
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$SCRIPT_DIR/lib/security.sh" ]]; then
    source "$SCRIPT_DIR/lib/security.sh"
fi

# Default quotes file path
QUOTES_FILE="${1:-quotes.json}"
# Check if jq is installed
if ! command -v jq &> /dev/null; then
    echo "Error: jq is required but not installed. Please install jq first." >&2
    echo "On Ubuntu/Debian: sudo apt install jq" >&2
    echo "On macOS: brew install jq" >&2
    exit 1
fi

# Check if quotes file exists
if [[ ! -f "$QUOTES_FILE" ]]; then
    echo "Error: Quotes file '$QUOTES_FILE' not found." >&2
    echo "" >&2
    echo "Expected JSON format:" >&2
    echo '{' >&2
    echo '  "quotes": [' >&2
    echo '    {' >&2
    echo '      "text": "The only way to do great work is to love what you do.",' >&2
    echo '      "author": "Steve Jobs"' >&2
    echo '    },' >&2
    echo '    {' >&2
    echo '      "text": "Innovation distinguishes between a leader and a follower.",' >&2
    echo '      "author": "Steve Jobs"' >&2
    echo '    }' >&2
    echo '  ]' >&2
    echo '}' >&2
    exit 1
fi

# Validate JSON format
if ! jq empty "$QUOTES_FILE" 2>/dev/null; then
    echo "Error: '$QUOTES_FILE' contains invalid JSON." >&2
    exit 1
fi

# Check if quotes array exists
if ! jq -e '.quotes' "$QUOTES_FILE" &>/dev/null; then
    echo "Error: '$QUOTES_FILE' must contain a 'quotes' array." >&2
    exit 1
fi

# Get total number of quotes
QUOTE_COUNT=$(jq '.quotes | length' "$QUOTES_FILE")

# Check if there are any quotes
if [[ "$QUOTE_COUNT" -eq 0 ]]; then
    echo "Error: No quotes found in '$QUOTES_FILE'." >&2
    exit 1
fi

# Generate random index (0-based)
RANDOM_INDEX=$((RANDOM % QUOTE_COUNT))

# Extract the random quote
QUOTE_TEXT=$(jq -r ".quotes[$RANDOM_INDEX].text" "$QUOTES_FILE")
QUOTE_AUTHOR=$(jq -r ".quotes[$RANDOM_INDEX].author" "$QUOTES_FILE")

# Color codes
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
BOLD='\033[1m'
RESET='\033[0m'

# Display the quote with nice formatting and colors
echo ""
echo -e "${CYAN}💭 Random Inspirational Quote:${RESET}"
echo ""
echo -e "${BOLD}\"${YELLOW}$QUOTE_TEXT${RESET}${BOLD}\"${RESET}"
echo ""
if [[ "$QUOTE_AUTHOR" != "null" && -n "$QUOTE_AUTHOR" ]]; then
    echo -e "${GREEN}— $QUOTE_AUTHOR${RESET}"
else
    echo -e "${GREEN}— Anonymous${RESET}"
fi
echo ""
