#{
#
#  outputs = { nixpkgs, home-manager, ... }: let
#    let
#      withArch = arch:
#        home-manager.lib.homeManagerConfiguration {
#          pkgs = nixpkgs.legacyPackages.${arch};
#          modules = [ ./home.nix nix-index-database.hmModules.nix-index ];
#        };
#    in {
#      defaultPackage = {
#        x86_64-darwin = home-manager.defaultPackage.x86_64-darwin;
#        aarch64-darwin = home-manager.defaultPackage.aarch64-darwin;
#        aarch64-linux = home-manager.defaultPackage.aarch64-linux;
#      };
#
#      homeConfigurations = {
#        "arkham@metal" = withArch "aarch64-darwin";
#        "arkham@mine" = withArch "x86_64-darwin";
#        "arkham@iMuck" = withArch "x86_64-darwin";
#        "arkham@pi" = withArch "aarch64-linux";
#      };
#    };
#}


{
  description = "Home Manager configuration";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixpkgs-unstable";
    home-manager = {
      url = "github:nix-community/home-manager";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    flake-utils.url = "github:numtide/flake-utils";
  };
#  description = "A flake for my systems";
#
#  inputs = {
#    nixpkgs.url = "github:NixOS/nixpkgs/nixos-21.05";
#    home-manager.url = "github:nix-community/home-manager/release-21.05";
#  };
#
  outputs = { self, nixpkgs, home-manager, flake-utils, ... }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs {
          inherit system;
        };
        lib = pkgs.lib;
        hm = import home-manager {
          inherit pkgs;
          inherit system;
        };
        isLinux = system == "x86_64-linux";
        isDarwin = system == "x86_64-darwin";
      in {
        homeConfigurations = {
          my-machine = hm.homeManagerConfiguration {
            configuration = { config, pkgs, ... }: {
              # Common settings
              home.username = "myuser";
              home.homeDirectory = "/home/myuser";
              programs.git.enable = true;

              # System-specific packages
              home.packages = with pkgs; [
                git
                htop
              ] ++ lib.optionals isLinux [
                gnome3.gnome-terminal
              ] ++ lib.optionals isDarwin [
                iterm2
              ];

              # Conditional Home Manager modules
              imports = lib.optionals isLinux [
                ./linux-x11.nix
              ] ++ lib.optionals isDarwin [
                ./macos-dock.nix
              ];
            };
          };
        };
      }
    );
}
