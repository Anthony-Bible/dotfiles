

-- ALE Config
-- ---
vim.g.ale_completion_enabled = 0
vim.g.ale_completion_autoimport = 1
vim.g.ale_hover_cursor = 0
vim.g.ale_echo_msg_error_str = ''
vim.g.ale_echo_msg_warning_str = ''
vim.g.ale_echo_msg_format = '[%linter%] %s [%severity%]'
vim.g.ale_linters_explicit = 1
vim.g.ale_fixers = { ['*'] = { 'remove_trailing_lines', 'trim_whitespace' }  }
