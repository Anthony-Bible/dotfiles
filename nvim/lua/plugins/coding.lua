-- [[ plugins/coding.lua ]]
-- copilot keymaps (<C-Space>, copilot_no_tab_map) live in lua/keys.lua.
-- ALE keymaps (<Leader>l*) live in lua/keys.lua. Its g:ale_* settings are in
-- lua/ale.lua, which is currently NOT required by init.lua (same as before this
-- migration) so ALE runs with default settings.
return {
  { "github/copilot.vim" },   -- AI completion
  { "dense-analysis/ale" },   -- async lint engine / fixer
}
