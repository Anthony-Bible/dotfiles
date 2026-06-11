-- [[ plugins/go.lua ]]
-- init.lua registers a BufWritePre autocmd that calls require('go.format').goimport(),
-- so go.nvim is kept eager (lazy = false by default) to match the previous behavior.
return {
  {
    "ray-x/go.nvim",
    dependencies = {
      "ray-x/guihua.lua", -- floating window support
    },
    config = function()
      require("go").setup({
        lsp_gofumpt = true,
      })
    end,
  },
}
