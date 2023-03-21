--[[ vars.lua ]]

local g = vim.g
g.t_co = 256
g.background = "dark"
-- Update the packpath
local packer_path = vim.fn.stdpath('config') .. '/site'
vim.o.packpath = vim.o.packpath .. ',' .. packer_path
local build_status_last = require("devcontainer.status").find_build({ running = true })
if build_status_last then
	status = status
		.. "["
		.. (build_status_last.current_step or "")
		.. "/"
		.. (build_status_last.step_count or "")
		.. "]"
		.. (build_status_last.progress and "(" .. build_status_last.progress .. "%%)" or "")
end
return status

