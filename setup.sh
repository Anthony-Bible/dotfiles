#!/usr/bin/env bash
#
# This script is used to copy files to proper directories
# and to create symlinks to the dotfiles in this repo.
YELLOW='\033[1;33m'
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color
required_packages=(stow tmuxp git git-lfs)
packages_to_install=()
for package in "${required_packages[@]}"; do
    if ! command -v "$package" &> /dev/null; then
        packages_to_install+=("$package")
    fi
done

if [ ${#packages_to_install[@]} -ne 0 ]; then
    echo -e "${YELLOW}Attempting to install missing packages: ${packages_to_install[*]}${NC}"
    if [[ $(uname) == "Linux" ]]; then
        sudo apt-get update && sudo apt-get install -y "${packages_to_install[@]}"
    elif [[ $(uname) == "Darwin" ]]; then
        brew install "${packages_to_install[@]}"
    else
        echo -e "${RED}Unsupported OS for automatic installation. Please install manually: ${packages_to_install[*]}${NC}"
    fi
fi

# Final check to populate missing_packages for the following check
missing_packages=()
for package in "${required_packages[@]}"; do
    if ! command -v "$package" &> /dev/null; then
        echo -e "${RED}$package could not be found or installed.${NC}"
        missing_packages+=("$package")
    fi
done

if [ ${#missing_packages[@]} -ne 0 ]; then
    echo -e "${RED}The following required packages are missing: ${missing_packages[*]}.${NC}"
    exit 1
fi

# Ensure git-lfs is initialized for the user
if command -v git-lfs &> /dev/null; then
    echo -e "${GREEN}Running git-lfs install${NC}"
    if [[ $(uname) == "Darwin" ]]; then
        git-lfs install --local
    else
        git-lfs install
    fi
fi

# if macos use gsed instead of sed
if [[ $(uname) == "Darwin" ]]; then
    if ! command -v gsed &> /dev/null; then
        echo -e "${RED}gsed could not be found${NC}"
        exit
    fi
    _sed=$(which gsed)
else
    _sed=$(which sed)
fi

mkdir -p ~/.local/bin
OSTYPE=$(uname)
ARCH=$(uname -m)
if [[ $OSTYPE == "Linux" ]]; then
   if ! command -v nvim &> /dev/null; then
    curl -LO https://github.com/neovim/neovim/releases/latest/download/nvim.appimage
    chmod u+x nvim.appimage
    mv nvim.appimage ~/.local/bin/nvim
   fi
fi
folders_that_must_exist=("$HOME/.config/nvim" "$HOME/.config/nix" "$HOME/.tmux/plugins/tpm" "$HOME/.config/wezterm/logs")
# Check if folders that must exist exist
for folder in "${folders_that_must_exist[@]}"; do
    if [ ! -d "$folder" ]; then
	echo -e "${YELLOW}$folder does not exist, creating it${NC}"
	mkdir -p "$folder"
    fi
done
# Link files to proper directories
# stow neovim files
echo -e "${GREEN}Stowing neovim files${NC}"
stow -R -t "$HOME/.config/nvim" nvim

# stow .tmux.conf ile in home directory
echo -e "${GREEN}Stowing tmux files${NC}"
stow -R -t "$HOME" --dotfiles tmux

#Get current directory
DOTFILESDIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
# stow .zshrc functions file in home directory
echo -e "${GREEN}Stowing zsh files${NC}"
# Put a line to export DOTFILESDIR in .zshrc only if it doesn't already exist
grep -q -F "export DOTFILESDIR=" "$HOME/.zshrc" || echo "export DOTFILESDIR=\"$DOTFILESDIR\"" >> "$HOME/.zshrc"
stow -R -t "$HOME" --dotfiles dot-zsh-functionsa

# stow .golangci.yaml file in home directory
echo -e "${GREEN}Stowing golangci files${NC}"
stow -R -t "$HOME" --dotfiles dot-config-files

# Clone the tmux plugin manager
# Only clone if it does not exist otherwise pull the repo
if [ ! -d "$HOME/.tmux/plugins/tpm" ]; then
    echo -e "${GREEN}Cloning tmux plugin manager${NC}"
    git clone https://github.com/tmux-plugins/tpm ~/.tmux/plugins/tpm
else
    # Check if the directory is a git repository
    if git -C "$HOME/.tmux/plugins/tpm" rev-parse --git-dir > /dev/null 2>&1; then
        echo -e "${YELLOW}Pulling tmux plugin manager${NC}"
        git -C "$HOME/.tmux/plugins/tpm" pull
    else
        echo -e "${RED}Warning: $HOME/.tmux/plugins/tpm exists but is not a git repository${NC}"
        echo -e "${YELLOW}Removing existing directory and cloning fresh${NC}"
        rm -rf "$HOME/.tmux/plugins/tpm"
        git clone https://github.com/tmux-plugins/tpm ~/.tmux/plugins/tpm
    fi
fi

# Get hostname to see if it matches tcn
if [[ $(hostname) == "tcn" ]]; then
    # Put a line to source .tcn-functions in .zshrc only if it doesn't already exist
    grep -q -F 'source $HOME/.tcn-functions' "$HOME/.zshrc" || echo "source \$HOME/.tcn-functions" >> "$HOME/.zshrc"
fi
# Put in .zshrc a line to source .zsh-functions only if line doesn't exist
grep -q -F 'source $HOME/.zsh-functions' "$HOME/.zshrc" || echo "source \$HOME/.zsh-functions" >> "$HOME/.zshrc"


# check if linux or mac and install wezterm
if [[ $OSTYPE == "Linux" ]]; then
    # install wezterm
    if ! command -v wezterm &> /dev/null; then
        echo -e "${GREEN}Installing wezterm${NC}"
        curl -LO https://github.com/wez/wezterm/releases/download/20230408-112425-69ae8472/WezTerm-20230408-112425-69ae8472-Ubuntu20.04.AppImage
        chmod +x WezTerm-20230408-112425-69ae8472-Ubuntu20.04.AppImage
        mv WezTerm-20230408-112425-69ae8472-Ubuntu20.04.AppImage ~/.local/bin/wezterm
    fi
elif [[ $OSTYPE == "Darwin" ]]; then
    # install wezterm
    if ! command -v wezterm &> /dev/null; then
        echo -e "${GREEN}Installing wezterm${NC}"
                    brew install --cask wezterm
        fi
fi

# see if variable XDG_CONFIG_HOME is set
echo -e "${GREEN}Stowing wezterm files${NC}"
if [[ -z "$XDG_CONFIG_HOME" ]]; then
    echo -e "${YELLOW}XDG_CONFIG_HOME is not set, using $HOME/.config/wezterm for configuration store${NC}"
    mkdir -p "$HOME/.config/wezterm"
    stow -R -t "$HOME/.config/wezterm" wezterm
else
    echo -e "${YELLOW}XDG_CONFIG_HOME is set, using $XDG_CONFIG_HOME/wezterm for configuration store${NC}"
    mkdir -p "$XDG_CONFIG_HOME/wezterm"
    stow -R -t "$XDG_CONFIG_HOME/wezterm" wezterm
fi

# see if variable XDG_CONFIG_HOME is set
echo -e "${GREEN}Checking for aichat${NC}"
if [[ $OSTYPE == "Darwin" ]]; then
    if ! command -v aichat &> /dev/null; then
        echo -e "${GREEN}Installing aichat with brew${NC}"
        brew install aichat
    fi
elif [[ $OSTYPE == "Linux" ]]; then
    echo -e "${YELLOW}You can get aichat from https://github.com/sigoden/aichat?tab=readme-ov-file${NC}"
fi

# setopt combining_chars if shell=zsh
if [[ $SHELL =~ "zsh" ]]; then
    echo -e "${YELLOW}Setting combining_chars option in zsh${NC}"
    # only add line if it doesn't exist
    grep -q -F 'setopt combining_chars' "$HOME/.zshrc" || echo "setopt combining_chars" >> "$HOME/.zshrc"

    #check if oh-my-zsh is installed
    if [ ! -d "$HOME/.oh-my-zsh" ]; then
        echo -e "${YELLOW}oh-my-zsh is not installed, won't install theme${NC}"
    else
        #check if variable ZSH_CUSTOM is set
        if [[ -z "$ZSH_CUSTOM" ]]; then
            echo -e "${YELLOW}ZSH_CUSTOM is not set, using $HOME/.oh-my-zsh/custom for custom themes${NC}"
            ZSH_CUSTOM="$HOME/.oh-my-zsh/custom"
        else
            echo -e "${YELLOW}ZSH_CUSTOM is set, using $ZSH_CUSTOM for custom themes${NC}"
        fi
        # install theme
        echo -e "${GREEN}Installing theme${NC}"
        mkdir -p "$ZSH_CUSTOM/themes"
        stow -R --dotfiles -t "$ZSH_CUSTOM" dot-oh-my-zsh
        # Get file name in dot-oh-my-zsh/themes
        theme_file=$(ls -1 "$DOTFILESDIR/dot-oh-my-zsh/themes")
        #remove .zsh-theme extension
        theme_file=${theme_file%.zsh-theme}
        echo $theme_file
        #change variable ZSH_THEME to "$theme_file" in .zshrc
        #
        $_sed -i "s/ZSH_THEME=.*/ZSH_THEME=\"$theme_file\"/" "$HOME/.zshrc"
    fi
fi

# install golang
if ! command -v go &> /dev/null; then
    echo -e "${GREEN}Installing golang${NC}"
    if [[ $OSTYPE == "Linux" ]]; then
        sudo apt install golang
    elif [[ $OSTYPE == "Darwin" ]]; then
        brew install golang
    fi
fi

#install all go packages from file
echo -e "${GREEN}Installing go packages${NC}"
for go_package in $(cat "$DOTFILESDIR/go-packages.txt"); do
    echo -e "${YELLOW}Installing $go_package${NC}"
    go install "$go_package"
done

# Install gofumpt
if ! command -v gofumpt &> /dev/null; then
    echo -e "${GREEN}Installing gofumpt${NC}"
    go install mvdan.cc/gofumpt@latest
fi

# install ast-grep/sg
if ! command -v ast-grep &> /dev/null && [ ! -f ~/bin/sg ]; then
    echo -e "${GREEN}Installing ast-grep${NC}"
    mkdir -p ~/bin
    if [[ $OSTYPE == "Linux" ]]; then
        if [[ $ARCH == "aarch64" ]]; then
            curl -LO https://github.com/ast-grep/ast-grep/releases/latest/download/app-aarch64-unknown-linux-gnu.zip
            unzip app-aarch64-unknown-linux-gnu.zip
            mv sg ast-grep ~/bin/
            rm app-aarch64-unknown-linux-gnu.zip
        else
            curl -LO https://github.com/ast-grep/ast-grep/releases/latest/download/app-x86_64-unknown-linux-gnu.zip
            unzip app-x86_64-unknown-linux-gnu.zip
            mv sg ast-grep ~/bin/
            rm app-x86_64-unknown-linux-gnu.zip
        fi
    elif [[ $OSTYPE == "Darwin" ]]; then
        if [[ $ARCH == "arm64" ]]; then
            curl -LO https://github.com/ast-grep/ast-grep/releases/latest/download/app-aarch64-apple-darwin.zip
            unzip app-aarch64-apple-darwin.zip
            mv sg ast-grep ~/bin/
            rm app-aarch64-apple-darwin.zip
        else
            curl -LO https://github.com/ast-grep/ast-grep/releases/latest/download/app-x86_64-apple-darwin.zip
            unzip app-x86_64-apple-darwin.zip
            mv sg ast-grep ~/bin/
            rm app-x86_64-apple-darwin.zip
        fi
    fi
fi


#The fuck has problems sos we're commenting it out
# # install thefuck
# if [[ $OSTYPE == "Linux" ]]; then
#  #Check if it's ubuntu or debian
#  distro=$(lsb_release -i | awk -F':' '{print $2}')
#  if [[ $distro =~ "Ubuntu" ]]; then
#      sudo apt update -y &&  sudo apt install -y python3-dev python3-pip python3-setuptools
#      pip3 install thefuck --user
#   else
#       if ! command -v pip 2> /dev/null; then
#           echo "please install pip"
#           exit 1
#       fi
#       pip install thefuck
#   fi
# elif [[ $OSTYPE == "Darwin" ]]; then
#    brew install thefuck
# fi
# Uninstall thefuck if installed
if command -v thefuck &> /dev/null; then
    echo -e "${YELLOW}Uninstalling thefuck${NC}"
    if [[ $OSTYPE == "Linux" ]]; then
        pip3 uninstall -y thefuck 2>/dev/null || pip uninstall -y thefuck 2>/dev/null
        sudo apt-get remove -y thefuck 2>/dev/null
    elif [[ $OSTYPE == "Darwin" ]]; then
        brew uninstall thefuck 2>/dev/null
        pip3 uninstall -y thefuck 2>/dev/null || pip uninstall -y thefuck 2>/dev/null
    fi
    # Remove any thefuck lines from .zshrc
    $_sed -i '/thefuck/d' "$HOME/.zshrc"
fi
#Install minikube
if [[ $OSTYPE == "Linux" ]]; then
    curl -LO https://storage.googleapis.com/minikube/releases/latest/minikube-linux-amd64
    install minikube-linux-amd64 $HOME/.local/bin/minikube
elif [[ $OSTYPE == "Darwin" ]]; then
    if [[ $ARCH == "arm64" ]]; then
        curl -LO https://storage.googleapis.com/minikube/releases/latest/minikube-darwin-arm64
        install minikube-darwin-arm64 $HOME/.local/bin/minikube
    else
        curl -LO https://storage.googleapis.com/minikube/releases/latest/minikube-darwin-amd64
        install minikube-darwin-amd64 $HOME/.local/bin/minikube
    fi
fi

#install kubectl
if [[ $OSTYPE == "Linux" ]]; then
       curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
       sudo install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl
elif [[ $OSTYPE == "Darwin" ]]; then
if ! command -v kubectl &> /dev/null; then
    if [[ $ARCH == "arm64" ]]; then
        curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/darwin/arm64/kubectl"
        chmod +x ./kubectl
        sudo mv ./kubectl /usr/local/bin/kubectl
    else
        curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/darwin/amd64/kubectl"
        chmod +x ./kubectl
        sudo mv ./kubectl /usr/local/bin/kubectl
    fi
    fi
fi

# Install Miniconda if not already installed
if ! command -v conda &> /dev/null; then
    echo -e "${GREEN}Installing Miniconda${NC}"
    if [[ $OSTYPE == "Linux" ]]; then
        MINICONDA_SCRIPT=Miniconda3-latest-Linux-x86_64.sh
        if [[ $ARCH == "aarch64" ]]; then
            MINICONDA_SCRIPT=Miniconda3-latest-Linux-aarch64.sh
        fi
    elif [[ $OSTYPE == "Darwin" ]]; then
        if [[ $ARCH == "arm64" ]]; then
            MINICONDA_SCRIPT=Miniconda3-latest-MacOSX-arm64.sh
        else
            MINICONDA_SCRIPT=Miniconda3-latest-MacOSX-x86_64.sh
        fi
    fi
    curl -LO "https://repo.anaconda.com/miniconda/$MINICONDA_SCRIPT"
    bash "$MINICONDA_SCRIPT" -b -p "$HOME/miniconda3"
    rm "$MINICONDA_SCRIPT"
    # Add conda to PATH in .zshrc if not already present
    grep -qF "$HOME/miniconda3/bin" "$HOME/.zshrc" || echo 'export PATH="$HOME/miniconda3/bin:$PATH"' >> "$HOME/.zshrc"
fi

#check if nix is installed
if ! command -v nix > /dev/null; then
    curl -L https://nixos.org/nix/install
    # See if the user wants to continue

    while true; do
        echo "Do you want to continue? (y/n)"
        read -n 1 -r input
        echo # Move to a new line

        # Convert to lowercase
        input=${input,,}

        case $input in
            y)
                echo "Continuing..."
                # Place your commands here
                break # Exit the loop
                ;;
            n)
                echo "Not continuing. Exiting..."
                exit 1
                ;;
            *)
                echo "Invalid input. Please enter 'y' or 'n'."
                ;;
        esac
    done
    sh <(curl -L https://nixos.org/nix/install) --daemon
fi
# allow nix flakes to be used

echo -e "${GREEN}Stowing nix files${NC}"
stow -R -t "$HOME/.config/nix" nix

# Warn if aichat config does not exist
if [ ! -f "$HOME/.config/aichat/config.yaml" ]; then
    echo -e "${YELLOW}Warning: $HOME/.config/aichat/config.yaml does not exist. You may want to make sure the config exists with models and API keys.${NC}"
fi

# Install nvm and set default Node.js version to 20
if ! command -v nvm &> /dev/null; then
    echo -e "${GREEN}Installing nvm${NC}"
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
    # Source nvm in current shell for immediate use
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    # Add nvm source lines to .zshrc if not already present
    grep -q 'NVM_DIR' "$HOME/.zshrc" || cat <<'EOF' >> "$HOME/.zshrc"
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
EOF
else
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
fi

if command -v nvm &> /dev/null; then
    echo -e "${GREEN}Ensuring Node.js v20 is installed and set as default${NC}"
    nvm install 20
    nvm alias default 20
    # Install claude-code
    if ! command -v claude &> /dev/null; then
        echo -e "${GREEN}Installing claude-code${NC}"
        npm install -g @anthropic-ai/claude-code
    fi
    echo -e "${GREEN}Updating gemini-cli${NC}"
    npm update -g @google/gemini-cli
fi
# Install ibm-openapi-validator globally
if ! command -v lint-openapi &> /dev/null; then
    echo -e "${GREEN}Installing ibm-openapi-validator${NC}"
    npm install -g ibm-openapi-validator
fi
# insstall golangci-lint
# Check if golangci-lint is installed
if ! command -v golangci-lint &> /dev/null; then
    echo -e "${GREEN}Installing golangci-lint${NC}"
    if [[ $OSTYPE == "Linux" ]]; then
        curl -sSfL https://raw.githubusercontent.com/golangci/golangci-lint/HEAD/install.sh | sh -s -- -b "$(go env GOPATH)/bin" v2.3.1
    elif [[ $OSTYPE == "Darwin" ]]; then
        brew install golangci-lint
    fi
else
    echo -e "${YELLOW}golangci-lint is already installed${NC}"
fi
# Setup Claude configuration
echo -e "${GREEN}Running Claude configuration setup${NC}"
if [[ -f "$DOTFILESDIR/setup-claude.sh" ]]; then
    bash "$DOTFILESDIR/setup-claude.sh"
else
    echo -e "${RED}Warning: setup-claude.sh not found, skipping Claude configuration${NC}"
fi

