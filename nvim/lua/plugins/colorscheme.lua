-- [[ plugins/colorscheme.lua ]]
-- Colorschemes. `opts.lua` sets `colorscheme nord`, so nord must load first.
return {
  {
    "shaunsingh/nord.nvim",
    lazy = false,    -- load during startup
    priority = 1000, -- load before all other start plugins so the colorscheme is ready
  },
  { "Mofiqul/dracula.nvim" }, -- provides the `dracula-nvim` lualine theme
}
