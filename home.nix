{ pkgs, ... }: {
  home.username = "anthony"; # REPLACE ME
  home.homeDirectory = "/home/anthony"; # REPLACE ME
  home.stateVersion = "22.11";
  programs.home-manager.enable = true;
}
