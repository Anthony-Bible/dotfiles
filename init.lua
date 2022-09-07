-- [[init.lua ]]

-- LEADER
-- These keybindings need to be defined before the first /
-- is called; otherwise, it will default to "\"
vim.api.nvim_set_keymap("", "<Space>", "<Nop>", { noremap = true, silent = true })
vim.g.mapleader = " "
vim.g.localleader = " "

-- IMPORTS

require('vars')      -- Variables

require('keys')      -- Keymaps

require('plug')      -- Plugin
require('lsp_config')
require('opts')      -- Options
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
    autocmd BufWritePre *.go lua vim.lsp.buf.formatting()
    autocmd BufWritePre *.go lua goimports(1000)
  augroup end
]])


vim.cmd([[set showtabline=2]])
--call deoplete#custom#option('omni_patterns', { 'go': '[^. *\t]\.\w*' })
vim.api.nvim_create_autocmd("User", {
	pattern = "DevcontainerBuildProgress",
	callback = function()
		vim.cmd("redrawstatus")
	end,
})

