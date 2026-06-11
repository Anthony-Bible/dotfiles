-- [[ lsp_config.lua ]]
-- LSP setup using the Neovim 0.11+ vim.lsp.config / vim.lsp.enable API.
-- (nvim-lspconfig now just ships server defaults under lsp/; we merge ours on top.)

-- Capabilities: advertise snippet support for completion.
local capabilities = vim.lsp.protocol.make_client_capabilities()
capabilities.textDocument.completion.completionItem.snippetSupport = true

-- Highlight groups used by document-highlight (set once, after the colorscheme).
vim.cmd([[
  hi LspReferenceRead  cterm=bold ctermbg=DarkMagenta guibg=LightYellow
  hi LspReferenceText  cterm=bold ctermbg=DarkMagenta guibg=LightYellow
  hi LspReferenceWrite cterm=bold ctermbg=DarkMagenta guibg=LightYellow
]])

-- Buffer-local setup that runs whenever an LSP client attaches to a buffer.
-- Replaces the old per-server on_attach so it applies to every server.
vim.api.nvim_create_autocmd("LspAttach", {
  group = vim.api.nvim_create_augroup("UserLspConfig", {}),
  callback = function(args)
    local bufnr = args.buf
    local client = vim.lsp.get_client_by_id(args.data.client_id)

    vim.bo[bufnr].omnifunc = "v:lua.vim.lsp.omnifunc"

    -- Mappings (buffer-local).
    local function map(mode, lhs, rhs, desc)
      vim.keymap.set(mode, lhs, rhs, { noremap = true, silent = true, buffer = bufnr, desc = desc })
    end

    map("n", "gD", vim.lsp.buf.declaration, "LSP declaration")
    map("n", "gd", vim.lsp.buf.definition, "LSP definition")
    map("n", "ga", vim.lsp.buf.code_action, "LSP code action")
    map("n", "K", vim.lsp.buf.hover, "LSP hover")
    map("n", "gi", vim.lsp.buf.implementation, "LSP implementation")
    map("n", "<C-k>", vim.lsp.buf.signature_help, "LSP signature help")
    map("n", "<space>wa", vim.lsp.buf.add_workspace_folder, "Add workspace folder")
    map("n", "<space>wr", vim.lsp.buf.remove_workspace_folder, "Remove workspace folder")
    map("n", "<space>wl", function()
      print(vim.inspect(vim.lsp.buf.list_workspace_folders()))
    end, "List workspace folders")
    map("n", "<space>D", vim.lsp.buf.type_definition, "LSP type definition")
    map("n", "<space>rn", vim.lsp.buf.rename, "LSP rename")
    map("n", "gr", vim.lsp.buf.references, "LSP references")
    map("n", "<space>e", vim.diagnostic.open_float, "Line diagnostics")
    map("n", "[d", function() vim.diagnostic.jump({ count = -1, float = true }) end, "Prev diagnostic")
    map("n", "]d", function() vim.diagnostic.jump({ count = 1, float = true }) end, "Next diagnostic")
    map("n", "<space>q", vim.diagnostic.setloclist, "Diagnostics to loclist")

    -- Conditional on server capabilities.
    if client and client:supports_method("textDocument/formatting") then
      map("n", "ff", function() vim.lsp.buf.format({ async = true }) end, "LSP format")
    end

    if client and client:supports_method("textDocument/documentHighlight") then
      local hl_group = vim.api.nvim_create_augroup("lsp_document_highlight", { clear = false })
      vim.api.nvim_clear_autocmds({ buffer = bufnr, group = hl_group })
      vim.api.nvim_create_autocmd("CursorHold", {
        buffer = bufnr,
        group = hl_group,
        callback = vim.lsp.buf.document_highlight,
      })
      vim.api.nvim_create_autocmd("CursorMoved", {
        buffer = bufnr,
        group = hl_group,
        callback = vim.lsp.buf.clear_references,
      })
    end
  end,
})

-- gopls (Go)
vim.lsp.config("gopls", {
  cmd = { "gopls" },
  capabilities = capabilities,
  settings = {
    gopls = {
      experimentalPostfixCompletions = true,
      analyses = {
        unusedparams = true,
        shadow = true,
        -- NOTE: the `fieldalignment` analyzer was removed in gopls v0.17.0.
        -- Hover over a struct field to see size/offset info instead.
      },
      staticcheck = true,
    },
  },
})

vim.lsp.enable("gopls")

--vim.lsp.set_log_level(1)
