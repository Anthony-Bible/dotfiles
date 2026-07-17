#!/usr/bin/env bash
#
# claude-deeplink.sh — build (and optionally open) a Claude Code deep link.
#
# A deep link is a `claude-cli://open` URL that opens Claude Code in a new
# terminal window with a working directory chosen and a prompt pre-filled
# (but NOT sent — you review and press Enter yourself).
#
# See: https://code.claude.com/docs/en/deep-links
#
# By default it COPIES a portable link (no cwd) to the clipboard and prints it
# to stdout, so you can share it; pass -o/--open to actually launch a session.
#
# Examples:
#   claude-deeplink.sh "review the open PRs"        # copy + print a shareable link
#   claude-deeplink.sh -o -d "$PWD" "review the open PRs"     # open a session here
#   claude-deeplink.sh -r acme/payments "fix the deploy"     # copy a repo-scoped link
#   claude-deeplink.sh -p -H "onboarding walkthrough"         # print a home-dir link
#   claude-deeplink.sh --code -d /path/to/proj "explain this" # VS Code tab handler

set -euo pipefail

PROG="${0##*/}"

usage() {
	cat <<EOF
$PROG — build a Claude Code deep link (claude-cli://open).

Usage:
  $PROG [options] [prompt words...]

The prompt may be given with -q/--prompt or as trailing positional words.

Working directory (pick at most one; default: send neither, so the link
stays portable — safe to share, since it carries no machine-local path):
  -d, --cwd PATH     Absolute working directory for the session.
  -r, --repo SLUG    GitHub owner/name; resolves to a local clone you've
                     opened before. If none is found, opens your home dir.
                     (cwd wins over repo if both are given.)
  -H, --home         Open in the home directory (send neither cwd nor repo).
                     This is also the default when no directory is given.

Prompt:
  -q, --prompt TEXT  Prompt text to pre-fill (max 5000 chars; use real
                     newlines, they're encoded for you).

Action (default: copy to clipboard and print):
  -c, --copy         Copy the URL to the clipboard and print it (default).
  -p, --print        Print the URL to stdout only; do not copy or open.
  -o, --open         Open the link with the OS handler (launches a session).

Other:
      --code         Use the VS Code handler (opens an editor tab instead of
                     a terminal): vscode://anthropic.claude-code/open
  -h, --help         Show this help.
EOF
}

# Percent-encode stdin per RFC 3986 (encodeURIComponent-compatible: keeps
# A-Z a-z 0-9 - _ . ! ~ * ' ( ), encodes everything else including newline).
urlencode() {
	local LC_ALL=C
	local string="$1"
	local i c out=""
	for ((i = 0; i < ${#string}; i++)); do
		c="${string:i:1}"
		case "$c" in
		[a-zA-Z0-9.~_-]) out+="$c" ;;
		*) printf -v c '%%%02X' "'$c"; out+="$c" ;;
		esac
	done
	printf '%s' "$out"
}

# --- argument parsing -------------------------------------------------------
prompt=""
cwd=""
repo=""
home=0
action="copy"
use_code=0
prompt_set=0

positional=()

while [[ $# -gt 0 ]]; do
	case "$1" in
	-q | --prompt) prompt="$2"; prompt_set=1; shift 2 ;;
	-d | --cwd) cwd="$2"; shift 2 ;;
	-r | --repo) repo="$2"; shift 2 ;;
	-H | --home) home=1; shift ;;
	-o | --open) action="open"; shift ;;
	-p | --print) action="print"; shift ;;
	-c | --copy) action="copy"; shift ;;
	--code) use_code=1; shift ;;
	-h | --help) usage; exit 0 ;;
	--) shift; positional+=("$@"); break ;;
	-*) echo "$PROG: unknown option: $1" >&2; usage >&2; exit 2 ;;
	*) positional+=("$1"); shift ;;
	esac
done

# Trailing words become the prompt if -q wasn't used.
if [[ $prompt_set -eq 0 && ${#positional[@]} -gt 0 ]]; then
	prompt="${positional[*]}"
fi

if [[ ${#prompt} -gt 5000 ]]; then
	echo "$PROG: prompt is ${#prompt} chars; the limit is 5000." >&2
	exit 2
fi

# --- resolve working directory ---------------------------------------------
# Precedence: --home clears everything; else explicit cwd; else repo; else
# send neither. We deliberately do NOT default to $PWD: a link is often shared
# with others, and a machine-local path would be meaningless (or wrong) on
# their machine. Omitting both is the portable default (handler opens home).
# cwd and repo are mutually informative, but the handler ignores repo when cwd
# is present, so we mirror that.
if [[ $home -eq 1 ]]; then
	cwd=""
	repo=""
fi

# --- build query string -----------------------------------------------------
query=""
append() { # key value
	local enc
	enc="$(urlencode "$2")"
	if [[ -z "$query" ]]; then query="$1=$enc"; else query="$query&$1=$enc"; fi
}

[[ -n "$cwd" ]] && append cwd "$cwd"
# repo is only meaningful when cwd is absent (handler ignores it otherwise).
[[ -z "$cwd" && -n "$repo" ]] && append repo "$repo"
[[ -n "$prompt" ]] && append q "$prompt"

if [[ $use_code -eq 1 ]]; then
	base="vscode://anthropic.claude-code/open"
else
	base="claude-cli://open"
fi

if [[ -n "$query" ]]; then
	url="$base?$query"
else
	url="$base"
fi

# --- act --------------------------------------------------------------------
open_url() {
	case "$(uname -s)" in
	Darwin) open "$1" ;;
	Linux) xdg-open "$1" ;;
	*) echo "$PROG: don't know how to open URLs on this OS; here it is:" >&2
	   printf '%s\n' "$1"; return 1 ;;
	esac
}

copy_url() {
	if command -v pbcopy >/dev/null 2>&1; then
		printf '%s' "$1" | pbcopy
	elif command -v xclip >/dev/null 2>&1; then
		printf '%s' "$1" | xclip -selection clipboard
	elif command -v wl-copy >/dev/null 2>&1; then
		printf '%s' "$1" | wl-copy
	else
		echo "$PROG: no clipboard tool (pbcopy/xclip/wl-copy) found." >&2
		return 1
	fi
}

case "$action" in
print)
	printf '%s\n' "$url"
	;;
copy)
	printf '%s\n' "$url"
	if copy_url "$url"; then
		echo "$PROG: copied to clipboard." >&2
	fi
	;;
open)
	printf '%s\n' "$url"
	open_url "$url"
	;;
esac
