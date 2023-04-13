local wezterm = require 'wezterm'
local events_functions = require 'extras.events'
return {
        font = wezterm.font 'Fira Code',
        font_size = 10.5,
color_scheme = 'Dracula',
window_background_opacity =0.95, 
keys = events_functions.keys,
}



