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
      homeConfigurations = {
        "anthony" =  home-manager.lib.homeManagerConfiguration{
        inherit pkgs;
          modules = [
            ./home.nix
          ];
        };
      };

      };

      defaultPackage = home-manager.defaultPackage.${system};

      apps = rec {
        hello = flake-utils.lib.mkApp { drv = self.packages.${system}.hello; };
        defaultApp = apps.hello; # Set the default application
      };
    });
}

