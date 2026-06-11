-- [[ plugins/lsp.lua ]]
-- The actual server setup (gopls, on_attach, keymaps) lives in lua/lsp_config.lua,
-- which init.lua requires after lazy.setup() has put nvim-lspconfig on the rtp.
return {
  { "neovim/nvim-lspconfig" },
}
