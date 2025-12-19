#!/usr/bin/env bash
# Cloud component - Coordinator for minikube and kubectl

# Source setup utilities
source "$(dirname "${BASH_SOURCE[0]}")/../../core/init.sh"
source "$(dirname "${BASH_SOURCE[0]}")/../../core/utils.sh"

# Install minikube with security checksums
install_minikube() {
    if ! command -v minikube &> /dev/null; then
        print_status "Installing minikube"
        execute mkdir -p ~/.local/bin

        # Define checksums for minikube binaries
        declare -A MINIKUBE_CHECKSUMS=(
            ["minikube-linux-amd64"]="d5cf561c71171152ff67d799f041ac0f65c235c87a1e9fc02a6a17b8226214d0"
            ["minikube-darwin-arm64"]="5e0914c3559f6713295119477a6f5dc29862596effbfc764a61757bb314901d2"
            ["minikube-darwin-amd64"]="4c32b9e5fed64a311db9a40d6fdcc8fa794bc5bbc546545f4d187e9d416a74cb"
        )

        local minikube_file
        local minikube_url
        local expected_checksum

        if [[ $OS_TYPE == "Linux" ]]; then
            minikube_file="minikube-linux-amd64"
            minikube_url="https://storage.googleapis.com/minikube/releases/latest/$minikube_file"
            expected_checksum="${MINIKUBE_CHECKSUMS[$minikube_file]}"
        elif [[ $OS_TYPE == "Darwin" ]]; then
            if [[ $ARCH == "arm64" ]]; then
                minikube_file="minikube-darwin-arm64"
            else
                minikube_file="minikube-darwin-amd64"
            fi
            minikube_url="https://storage.googleapis.com/minikube/releases/latest/$minikube_file"
            expected_checksum="${MINIKUBE_CHECKSUMS[$minikube_file]}"
        fi

        secure_download "$minikube_url" "$minikube_file" "$expected_checksum"
        execute install "$minikube_file" "$HOME/.local/bin/minikube"
        execute rm "$minikube_file"
    else
        print_status "minikube is already installed"
    fi
}

# Install kubectl
install_kubectl() {
    if ! command -v kubectl &> /dev/null; then
        print_status "Installing kubectl"

        # Determine latest stable kubectl version
        local kubectl_version
        kubectl_version="$(curl -L -s https://dl.k8s.io/release/stable.txt)"
        if [[ -z "$kubectl_version" ]]; then
            print_error "Failed to determine latest kubectl version"
            return 1
        fi

        local kubectl_url
        local kubectl_checksum_url
        local kubectl_checksum

        if [[ $OS_TYPE == "Linux" ]]; then
            kubectl_url="https://dl.k8s.io/release/${kubectl_version}/bin/linux/amd64/kubectl"
            kubectl_checksum_url="https://dl.k8s.io/release/${kubectl_version}/bin/linux/amd64/kubectl.sha256"
        elif [[ $OS_TYPE == "Darwin" ]]; then
            if [[ $ARCH == "arm64" ]]; then
                kubectl_url="https://dl.k8s.io/release/${kubectl_version}/bin/darwin/arm64/kubectl"
                kubectl_checksum_url="https://dl.k8s.io/release/${kubectl_version}/bin/darwin/arm64/kubectl.sha256"
            else
                kubectl_url="https://dl.k8s.io/release/${kubectl_version}/bin/darwin/amd64/kubectl"
                kubectl_checksum_url="https://dl.k8s.io/release/${kubectl_version}/bin/darwin/amd64/kubectl.sha256"
            fi
        fi

        if [[ -z "$kubectl_url" || -z "$kubectl_checksum_url" ]]; then
            print_error "Unsupported OS or architecture for kubectl installation"
            return 1
        fi

        # Fetch checksum for kubectl binary
        kubectl_checksum="$(curl -L -s "$kubectl_checksum_url")"
        if [[ -z "$kubectl_checksum" ]]; then
            print_error "Failed to download kubectl checksum from $kubectl_checksum_url"
            return 1
        fi

        # Download kubectl with checksum verification
        secure_download "$kubectl_url" "kubectl" "$kubectl_checksum"

        if [[ $OS_TYPE == "Linux" ]]; then
            execute sudo install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl
        elif [[ $OS_TYPE == "Darwin" ]]; then
            execute chmod +x ./kubectl
            execute sudo mv ./kubectl /usr/local/bin/kubectl
        fi

        # Clean up downloaded file
        if [[ -f "kubectl" ]]; then
            execute rm kubectl
        fi
    else
        print_status "kubectl is already installed"
    fi
}

# Component interface implementation
check_dependencies() {
    # Check for curl needed for downloads
    command -v curl &> /dev/null || {
        print_error "curl is required for cloud component"
        return 1
    }
}

install_component() {
    local mode="${1:-install}"

    case "$mode" in
        install)
            install_minikube
            install_kubectl
            ;;
        update)
            print_status "Updating cloud tools not implemented (please reinstall)"
            ;;
        remove)
            print_status "Removing cloud tools not implemented"
            ;;
        *)
            print_error "Unknown mode: $mode"
            return 1
            ;;
    esac
}

configure_component() {
    # No special configuration needed for cloud tools
    true
}

cleanup_component() {
    # Clean up temporary files if any
    true
}