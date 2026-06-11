-- [[ plugins/git.lua ]]
return {
  { "tpope/vim-fugitive" }, -- git integration
  {
    "junegunn/gv.vim", -- commit history browser (needs fugitive)
    dependencies = { "tpope/vim-fugitive" },
  },
}
