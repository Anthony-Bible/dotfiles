# Dotfiles

This repository contains personal configuration files (dotfiles) for Linux development environments. It includes setup for shells, editors, terminal emulators, and automation scripts to streamline your workflow.

## Features

- **Nix & Home Manager**: Reproducible environment setup using Nix flakes and Home Manager (`flake.nix`, `home.nix`, `configuration.nix`). (work in progress)
- **Shell Customization**: Zsh (with Oh My Zsh), custom functions, and AI-powered helpers (see `dot-zsh-functions/`).
- **Neovim**: Lua-based configuration with plugins and custom keybindings (`nvim/`).
- **Tmux**: Custom tmux and tmuxp session management (`tmux/`).
- **WezTerm**: Terminal emulator configuration (`wezterm/`).
- **AI Chat Integration**: Zsh functions for using [aichat](https://github.com/sigoden/aichat) to explain commands and handle unknown commands interactively.
- **Setup Script**: `setup.sh` automates stowing configs, installing dependencies, and setting up the environment.

## Zsh Functions

The `dot-zsh-functions/` directory contains several files that enhance the shell experience:

- **`dot-zsh-functions`**:
    - Sets up aliases for common commands (e.g., `k=kubectl`, `vi=nvim`).
    - Exports essential environment variables (e.g., `EDITOR`, `VISUAL`, `GOPATH`, `PATH`).
    - Defines `CheckIfDotDirFilesChanged`: A function that checks if the dotfiles directory has uncommitted changes or is not up-to-date with the remote repository.
    - Sources other function files.
- **`dot-ai-functions`**:
    - Integrates `aichat` for AI-powered command assistance.
    - `command_not_found_handler`: Uses `aichat` to suggest commands when an unknown command is entered.
    - `explain` / `explain:`: Explains a given command using `aichat`.
    - `_aichat_zsh` (ZLE widget, bound to `Alt-e`): Sends the current command line buffer to `aichat` and replaces it with the AI's suggestion.
    - `ai_commit_msg`: Generates a commit message for staged changes using `aichat`.
    - `_ai_commit_msg_zsh` (ZLE widget, bound to `Alt-g`): Interactively selects files (staged, modified, untracked, deleted) using `fzf` and then uses `aichat` to generate a commit message for the selected and staged files.
- **`dot-tcn-functions`**:
    - `dokuwiki_users`: A function to process a list of users for DokuWiki.
    - `slumbering`: A function likely related to checking a PostgreSQL replication slot's status.
    - `kamailio_compute`: A function for a specific calculation, possibly related to Kamailio.
    - `get_iam`: A function to fetch IAM policy for a Google Cloud IAP-secured web resource.
    - Exports various Ansible and Google Cloud related environment variables.

## Directory Structure

```
configuration.nix        # NixOS or Home Manager configuration
flake.nix                # Nix flake for reproducible setup
home.nix                 # Home Manager user configuration
setup.sh                 # Setup and bootstrap script
dot-oh-my-zsh/           # Oh My Zsh themes and customizations
dot-zsh-functions/       # Custom Zsh functions and widgets
nvim/                    # Neovim configuration (Lua)
tmux/                    # Tmux and tmuxp configuration
wezterm/                 # WezTerm configuration
```

## Getting Started

### Prerequisites
- [Nix](https://nixos.org/download.html) (with flakes enabled)
- [Home Manager](https://nix-community.github.io/home-manager/)
- [GNU Stow](https://www.gnu.org/software/stow/)
- [aichat](https://github.com/sigoden/aichat) (optional, for AI command explanations)

### Installation

1. **Clone the repository:**
   ```sh
   git clone https://github.com/anthony-bible/dotfiles.git
   cd dotfiles
   ```
2. **Run the setup script:**
   ```sh
   ./setup.sh
   ```
   This will stow configuration files, set up directories, and install optional tools.
3. **Activate Home Manager configuration:**
   ```sh
   nix run .#homeConfigurations.$USER.activationPackage
   ```
   Or use the `home-manager` command as appropriate.

### Using AI Command Explanations

- Type `explain <command>` in your shell to get an explanation via aichat.
- Unknown commands in Zsh will be passed to aichat for suggestions.
- Press `Alt-e` in Zsh to send the current command line to aichat and replace it with the result.

## Customization

- Edit `home.nix` and `configuration.nix` for Nix-based configuration.
- Add or modify shell functions in `dot-zsh-functions/`.
- Update Neovim settings in `nvim/`.
- Adjust terminal and tmux settings in their respective folders.

## License

MIT License. See individual files for copyright.
