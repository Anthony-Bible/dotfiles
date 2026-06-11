-- [[ plugins/ui.lua ]]
return {
  -- Filesystem navigation
  {
    "kyazdani42/nvim-tree.lua",
    dependencies = { "kyazdani42/nvim-web-devicons" }, -- filesystem icons
    config = function()
      require("nvim-tree").setup({})
    end,
  },

  -- Statusline
  {
    "nvim-lualine/lualine.nvim",
    dependencies = { "kyazdani42/nvim-web-devicons" },
    config = function()
      require("lualine").setup({
        options = {
          theme = "dracula-nvim",
        },
      })
    end,
  },

  { "mhinz/vim-startify" },          -- start screen
  { "DanilaMihailov/beacon.nvim" },  -- cursor jump highlight
  { "majutsushi/tagbar" },           -- code structure
  { "Yggdroot/indentLine" },         -- show indentation
}
