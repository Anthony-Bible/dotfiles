-- [[ plugins/editing.lua ]]
return {
  {
    "windwp/nvim-autopairs", -- auto close brackets, quotes, etc.
    config = function()
      require("nvim-autopairs").setup({})
    end,
  },
  { "tpope/vim-surround" }, -- manipulate surroundings (quotes, tags, ...)
  { "mattn/emmet-vim" },    -- HTML/CSS expansion
  { "SirVer/ultisnips" },   -- snippet engine
  { "jayli/vim-easycomplete" }, -- completion
}
