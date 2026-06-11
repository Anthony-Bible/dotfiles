-- [[ plugins/treesitter.lua ]]
return {
  {
    "nvim-treesitter/nvim-treesitter",
    -- Pin to the classic `master` branch: the new default `main` branch is a
    -- rewrite that removed the `nvim-treesitter.configs` setup API used below.
    branch = "master",
    build = ":TSUpdate",
    config = function()
      require("nvim-treesitter.configs").setup({
        ensure_installed = { "jsonc" },
        sync_install = true,
      })
    end,
  },
}
