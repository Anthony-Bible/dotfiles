-- [[init.lua ]]

-- LEADER
-- These keybindings need to be defined before the first /
-- is called; otherwise, it will default to "\"
vim.api.nvim_set_keymap("", "<Space>", "<Nop>", { noremap = true, silent = true })
vim.g.mapleader = " "
vim.g.localleader = " "

-- IMPORTS

require('plug')      -- Plugin
require('vars')      -- Variables

require('keys')      -- Keymaps

require('lsp_config')
require('opts')      -- Options
require('ale') -- ale setup
-- PLUGINS: Add this section
require('nvim-tree').setup{}

-- Add the block below
require('lualine').setup {
  options = {
    theme = 'dracula-nvim'
  }
}
require('nvim-autopairs').setup{}
vim.cmd([[
  augroup packer_user_config
    autocmd!
    autocmd BufWritePost plugins.lua source <afile> | PackerCompile
  augroup end
]])


local format_sync_grp = vim.api.nvim_create_augroup("GoImport", {})
vim.api.nvim_create_autocmd("BufWritePre", {
  pattern = "*.go",
  callback = function()
   require('go.format').goimport()
  end,
  group = format_sync_grp,
})


vim.cmd([[set showtabline=2]])
--call deoplete#custom#option('omni_patterns', { 'go': '[^. *\t]\.\w*' })
vim.api.nvim_create_autocmd("User", {
	pattern = "DevcontainerBuildProgress",
	callback = function()
		vim.cmd("redrawstatus")
	end,
})
-- for ray-x/go.nvim
local format_sync_grp = vim.api.nvim_create_augroup("GoFormat", {})
vim.api.nvim_create_autocmd("BufWritePre", {
  pattern = "*.go",
  callback = function()
   require('go.format').goimport()
  end,
  group = format_sync_grp,
})
