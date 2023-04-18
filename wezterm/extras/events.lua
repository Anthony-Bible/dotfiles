local wezterm = require 'wezterm'
local io = require 'io'
local os = require 'os'
local act = wezterm.action

wezterm.on('trigger-vim-with-visible-text', function(window, pane)
  -- Retrieve the current viewport's text.
  --
  -- Note: You could also pass an optional number of lines (eg: 2000) to
  -- retrieve that number of lines starting from the bottom of the viewport.
  local viewport_text = pane:get_lines_as_text(2000)

  -- Create a temporary file to pass to vim
--  local name = os.tmpname()
--  local f = io.open(name, 'w+')
--  f:write(viewport_text)
--  f:flush()
--  f:close()

  -- Get $HOME/.config/wezterm/logs
  local custom_log_dir = wezterm.config_dir .. "/logs"
  -- open a file in $HOME/.config/wezterm/logs with a date and timestamp
  local log_name = custom_log_dir .. "/wezterm-" .. os.date("%Y-%m-%d-%H-%M-%S") .. ".log"
  custom_log_file = io.open(log_name, "w+")
  custom_log_file:write(viewport_text)
  custom_log_file:flush()
  custom_log_file:close()

  -- Open a new window running vim and tell it to open the file
  window:perform_action(
    act.SpawnCommandInNewWindow {
      args = { 'nvim', log_name},
    },
    pane
  )

  -- Wait "enough" time for vim to read the file before we remove it.
  -- The window creation and process spawn are asynchronous wrt. running
  -- this script and are not awaitable, so we just pick a number.
  --
  -- Note: We don't strictly need to remove this file, but it is nice
  -- to avoid cluttering up the temporary directory.
  wezterm.sleep_ms(1000)
end)

return {
  keys = {
    {
      key = 'E',
      mods = 'CTRL',
      action = act.EmitEvent 'trigger-vim-with-visible-text',
    },
      -- Make Option-Left equivalent to Alt-b which many line editors interpret as backward-word
    {
      key = 'LeftArrow', 
      mods = 'OPT', 
      action = act.SendString '\x1bb', 
    },
  -- Make Option-Right equivalent to Alt-f; forward-word
    {
      key = 'RightArrow', 
      mods = 'OPT', 
      action = act.SendString '\x1bf', 
    },
    {
        key = 'UpArrow',
        mods = 'SHIFT',
        action = act.ScrollToPrompt(-1)
    },
    {
        key = 'DownArrow',
        mods = 'SHIFT',
        action = act.ScrollToPrompt(1) 
    },
}
}

