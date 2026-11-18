local wezterm = require 'wezterm'
local events_functions = require 'extras.events'
return {
        font = wezterm.font 'Fira Code',
        font_size = 10.5,
color_scheme = 'Dracula',
window_background_opacity =0.95, 
scrollback_lines = 100000,
keys = events_functions.keys,
-- Hold CMD to bypass tmux's mouse capture (set -g mouse on) so WezTerm handles the click.
bypass_mouse_reporting_modifiers = 'CMD',
mouse_bindings = {
    -- CMD+click opens the link under the cursor (works inside tmux too)
    {
    event = { Up = { streak = 1, button = 'Left' } },
    mods = 'CMD',
    action = wezterm.action.OpenLinkAtMouseCursor,
    },
    -- Swallow the CMD+click press so it doesn't start a selection
    {
    event = { Down = { streak = 1, button = 'Left' } },
    mods = 'CMD',
    action = wezterm.action.Nop,
    },
    {
    event = { Down = { streak = 3, button = 'Left' } },
    action = wezterm.action.SelectTextAtMouseCursor 'SemanticZone',
    mods = 'NONE',
    },
}
}



