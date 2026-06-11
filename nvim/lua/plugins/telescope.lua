-- [[ plugins/telescope.lua ]]
-- NOTE: telescope's live_grep/grep need the `ripgrep` binary on your PATH.
-- That is a SYSTEM dependency, not a plugin: `brew install ripgrep`.
return {
  {
    "nvim-telescope/telescope.nvim",
    dependencies = { "nvim-lua/plenary.nvim" }, -- fuzzy finder
  },
}
