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

-- ray-x/go.nvim
map('n', '<space>ca', "<cmd>lua require('go.codeaction').run_code_action()<CR>", { noremap = true, silent = true })
map('v', '<space>ca', "<cmd>lua require('go.codeaction').run_range_code_action()<CR>", { noremap = true, silent = true })

-- Telescope
local builtin = require('telescope.builtin')
map('n', '<leader>ff', 'biuiltin.find_files', {})
map('n', '<leader>fg', "builtin.live_grep", {})
map('n', '<leader>fb', "builtin.buffers", {})
map('n', '<leader>fh', "builtin.help_tags", {})

-- map('n', '<C-J>', '<cmd>copilot.Accept()<CR>' {})
--g:copilot_no_tab_map = v:true
--
map('i', '<C-Space>', "copilot#Accept('<CR>')", { noremap = true, silent = true, expr = true })
vim.g.copilot_no_tab_map = true

