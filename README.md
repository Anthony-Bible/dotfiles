# Dotfiles

Personal configuration files for Linux development environments. Includes shell, editor, terminal, and Claude Code plugin setup.

## Features

- **Nix & Home Manager**: Reproducible environment setup using Nix flakes and Home Manager (`flake.nix`, `home.nix`, `configuration.nix`). (work in progress)
- **Shell Customization**: Zsh (with Oh My Zsh), custom functions, and AI-powered helpers (see `dot-zsh-functions/`).
- **Neovim**: Lua-based configuration with plugins and custom keybindings (`nvim/`).
- **Tmux**: Custom tmux and tmuxp session management (`tmux/`).
- **WezTerm**: Terminal emulator configuration (`wezterm/`).
- **Claude Code Plugin**: Auto-formatting hooks and TDD agents available as a Claude Code marketplace plugin (see `claude-plugin/`).
- **Setup Script**: `setup.sh` automates stowing configs, installing dependencies, and setting up the environment.

## Gemini CLI Extension

This repository also functions as a **Gemini CLI extension**, providing custom TDD agents, context from `GEMINI.md`, and specialized development workflows.

### Installing the Extension

**From your Terminal:**

```bash
gemini extensions install https://github.com/Anthony-Bible/dotfiles --auto-update
```

**From within Gemini CLI:**

```bash
/extensions install https://github.com/Anthony-Bible/dotfiles --auto-update
```

### Features

- **TDD Agents**: Ported from the Claude plugin, available as sub-agents in Gemini CLI.
- **Contextual Knowledge**: Automatically includes `GEMINI.md` for project-specific rules and instructions.
- **Deadpool Mode**: Experience the "Uncensored Chaos Edition" for a more... colorful development experience.

---

## Claude Code Plugin

This repo acts as a **Claude Code plugin marketplace**. The `dotfiles-dev-tools` plugin provides:

- **Auto-formatting hooks** that run after every file write/edit:
  - Go (`gofmt`/`goimports`)
  - Shell scripts (`shfmt`)
  - Protobuf (`clang-format`)
  - OpenAPI specs (linting)
- **TDD agents** for the full red-green-refactor cycle:
  - `red-phase-tester` — writes failing tests before implementation
  - `green-phase-implementer` — writes minimal code to pass tests
  - `tdd-refactor-specialist` — cleans up code after tests go green
  - `tdd-review-agent` — verifies completeness after refactoring
  - `security-auditor` — finds vulnerabilities in code

### Installing the Plugin

**1. Add this repo as a marketplace:**

```sh
claude plugin marketplace add Anthony-Bible/dotfiles
```

**2. Install the plugin:**

```sh
claude plugin install dotfiles-dev-tools@anthony-bible-dotfiles
```

Or from within Claude Code interactive mode:

```
/plugin install dotfiles-dev-tools@anthony-bible-dotfiles
```

### How the Marketplace Works

The marketplace is defined by `.claude-plugin/marketplace.json` at the root of this repo. It lists available plugins and points to their source directories.

Each plugin lives in its own subdirectory (e.g., `claude-plugin/`) and contains:

| Path | Purpose |
|------|---------|
| `.claude-plugin/plugin.json` | Plugin metadata (name, version, description) |
| `hooks/hooks.json` | PostToolUse/PreToolUse hooks with shell commands |
| `agents/*.md` | Custom agents with frontmatter metadata |
| `.mcp.json` | MCP servers bundled with the plugin |
| `.lsp.json` | LSP servers bundled with the plugin |

When Claude Code installs a plugin, it copies the plugin directory to `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/` and activates hooks, agents, MCP servers, and LSP servers from that directory. The `${CLAUDE_PLUGIN_ROOT}` environment variable is set to the installed plugin path at runtime.

### Plugin Structure

```
.claude-plugin/
  marketplace.json          # Marketplace index listing all plugins

claude-plugin/              # dotfiles-dev-tools plugin source
  .claude-plugin/
    plugin.json             # Plugin metadata
  hooks/
    hooks.json              # Auto-format hooks (PostToolUse)
  agents/
    red-phase-tester.md
    green-phase-implementer.md
    tdd-refactor-specialist.md
    tdd-review-agent.md
    security-auditor.md
  scripts/
    goformat.sh
    shellformat.sh
    protoformat.sh
    openapi-lint.sh
    format-common.sh
  .mcp.json                 # MCP servers (sequential-thinking)
  .lsp.json                 # LSP servers (gopls)
```

### Other Marketplace Commands

```sh
# List all registered marketplaces
claude plugin marketplace list

# Update marketplace plugin listings
claude plugin marketplace update anthony-bible-dotfiles

# Remove the marketplace
claude plugin marketplace remove anthony-bible-dotfiles

# Validate the plugin/marketplace structure
claude plugin validate .
```

## Directory Structure

```
.claude-plugin/          # Claude Code marketplace definition
claude-plugin/           # Claude Code plugin (dotfiles-dev-tools)
configuration.nix        # NixOS or Home Manager configuration
flake.nix                # Nix flake for reproducible setup
home.nix                 # Home Manager user configuration
setup.sh                 # Setup and bootstrap script
.lsp.json                # Global LSP configuration (gopls)
.mcp.json                # Global MCP server configuration
dot-oh-my-zsh/           # Oh My Zsh themes and customizations
dot-zsh-functions/       # Custom Zsh functions and widgets
nvim/                    # Neovim configuration (Lua)
tmux/                    # Tmux and tmuxp configuration
wezterm/                 # WezTerm configuration
```

## Zsh Functions

The `dot-zsh-functions/` directory enhances the shell experience:

- **`dot-zsh-functions`**: Aliases, environment variables, and `CheckIfDotDirFilesChanged`.
- **`dot-ai-functions`**: AI-powered shell helpers via Claude:
  - `command_not_found_handler`: Suggests commands for unknown input.
  - `explain` / `explain:`: Explains a given command.
  - `Alt-e` ZLE widget: Sends current command line to Claude and replaces it with the result.
  - `ai_commit_msg` / `Alt-g`: Generates commit messages from staged changes using `fzf` + Claude.
- **`dot-tcn-functions`**: Work-specific helpers (DokuWiki, PostgreSQL, Kamailio, GCP IAM).

## Getting Started

### Prerequisites

- [Nix](https://nixos.org/download.html) (with flakes enabled)
- [Home Manager](https://nix-community.github.io/home-manager/)
- [GNU Stow](https://www.gnu.org/software/stow/)
- [Claude Code](https://claude.ai/code) (for the plugin features)

### Installation

1. **Clone the repository:**
   ```sh
   git clone https://github.com/Anthony-Bible/dotfiles.git
   cd dotfiles
   ```

2. **Run the setup script:**
   ```sh
   ./setup.sh
   ```

3. **Activate Home Manager configuration:**
   ```sh
   nix run .#homeConfigurations.$USER.activationPackage
   ```

4. **Install the Claude Code plugin** (see [Installing the Plugin](#installing-the-plugin) above).

## License

MIT License. See individual files for copyright.
