-- [[ init.lua ]]

-- LEADER
-- These must be set BEFORE lazy.nvim loads so plugin mappings are correct.
vim.api.nvim_set_keymap("", "<Space>", "<Nop>", { noremap = true, silent = true })
vim.g.mapleader = " "
vim.g.maplocalleader = "\\"

-- PLUGINS
-- Bootstraps lazy.nvim and loads every spec under lua/plugins/.
-- Plugin setup() calls (nvim-tree, lualine, nvim-autopairs, treesitter,
-- go.nvim, which-key) now live in their lua/plugins/*.lua specs.
require("config.lazy")

-- CONFIG (required AFTER lazy so plugins are on the runtimepath)
require("vars")       -- Variables
require("opts")       -- Options (also sets `colorscheme nord`)
require("keys")       -- Keymaps
require("lsp_config") -- LSP server setup
require("config.ale") -- ALE linter/fixer settings (g:ale_*)

-- ray-x/go.nvim: organize imports on save for Go files
local go_import_grp = vim.api.nvim_create_augroup("GoImport", {})
vim.api.nvim_create_autocmd("BufWritePre", {
  pattern = "*.go",
  callback = function()
    require("go.format").goimport()
  end,
  group = go_import_grp,
})

vim.cmd([[set showtabline=2]])

vim.api.nvim_create_autocmd("User", {
  pattern = "DevcontainerBuildProgress",
  callback = function()
    vim.cmd("redrawstatus")
  end,
})
