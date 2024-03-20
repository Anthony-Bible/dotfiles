{pkgs, ...}: {
    home.username = "anthony";
    home.homeDirectory = "/home/anthony";
    home.packages = [
        pkgs.nixpkgs-fmt
        pkgs.cowsay
#        pkgs.vim
#        pkgs.git
#        pkgs.zsh
#        pkgs.ripgrep
#        pkgs.fd
#        pkgs.bash
        ];
#    home.stateVersion = "22.11"; # To figure this out you can comment out the line and see what version it expected.
    programs.home-manager.enable = true;
}
