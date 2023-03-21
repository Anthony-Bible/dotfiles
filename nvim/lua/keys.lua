--[[ keys.lua ]]
local map = vim.api.nvim_set_keymap

-- remap the key used to leave insert mode
map('i', 'jk', '<Esc>', {})

-- Toggle nvim-tree
map('n', 't', [[:NvimTreeToggle]], {})
map('n', 'tf', [[:NvimTreeFocus]], {})
--map('n', 'l', [[:IndentLinesToggle]], {})

map('n', 'tt', [[:TagbarToggle]], {})
map('n', 'ff', [[:Telescope find_files]], {})
map('i', ',t', '<Esc>:tabnew<CR>',{})

-- Better indent
map("v", "<", "<gv", {})
map("v", ">", ">gv", {})

-- ALE

map('n', '<Leader>lf', '<Cmd>ALEFix<CR>', {})
map('n', '<Leader>lh', '<Cmd>ALEHover<CR>', {})
map('n', '<Leader>li', '<Cmd>ALEInfo<CR>', {})
map('n', '<Leader>lr', '<Cmd>ALERename<CR>', {})

-- Refactoring
map("v", "<leader>re", [[ <Esc><Cmd>lua require('refactoring').refactor('Extract Function')<CR>]], {noremap = true, silent = true, expr = false})
map("v", "<leader>rf", [[ <Esc><Cmd>lua require('refactoring').refactor('Extract Function To File')<CR>]], {noremap = true, silent = true, expr = false})
map("v", "<leader>rv", [[ <Esc><Cmd>lua require('refactoring').refactor('Extract Variable')<CR>]], {noremap = true, silent = true, expr = false})
map("v", "<leader>ri", [[ <Esc><Cmd>lua require('refactoring').refactor('Inline Variable')<CR>]], {noremap = true, silent = true, expr = false})

-- Extract block doesn't need visual mode
map("n", "<leader>rb", [[ <Cmd>lua require('refactoring').refactor('Extract Block')<CR>]], {noremap = true, silent = true, expr = false})
map("n", "<leader>rbf", [[ <Cmd>lua require('refactoring').refactor('Extract Block To File')<CR>]], {noremap = true, silent = true, expr = false})

-- Inline variable can also pick up the identifier currently under the cursor without visual mode
map("n", "<leader>ri", [[ <Cmd>lua require('refactoring').refactor('Inline Variable')<CR>]], {noremap = true, silent = true, expr = false})
