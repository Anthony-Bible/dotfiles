{
  description = "Flake utils demo";

  inputs = {
    flake-utils.url = "github:numtide/flake-utils";
    home-manager = {
      url = "github:nix-community/home-manager";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, flake-utils, home-manager, ... }@inputs:
    flake-utils.lib.eachDefaultSystem (system: let
      pkgs = nixpkgs.legacyPackages.${system};
    in rec {
      packages = rec {
        hello = pkgs.hello;
      };

      defaultPackage = packages.hello; # Set the default package

      nixosConfigurations = {
        myConfiguration = nixpkgs.lib.nixosSystem {
          inherit system;
          specialArgs = { inherit inputs; }; # Makes `inputs` available in NixOS modules
          modules = [
            ./configuration.nix
            home-manager.nixosModules.home-manager
            ({
              home-manager.useGlobalPkgs = true;
              home-manager.useUserPackages = true;
              home-manager.users.anthony = import ./home.nix;
            })
          ];
        };
      };

      apps = rec {
        hello = flake-utils.lib.mkApp { drv = self.packages.${system}.hello; };
        defaultApp = apps.hello; # Set the default application
      };
    });
}

