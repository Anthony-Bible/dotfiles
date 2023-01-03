-- [[ plug.lua ]]

local fn = vim.fn
local install_path = fn.stdpath('data')..'/site/pack/packer/start/packer.nvim'
if fn.empty(fn.glob(install_path)) > 0 then
  packer_bootstrap = fn.system({'git', 'clone', '--depth', '1', 'https://github.com/wbthomason/packer.nvim', install_path})
  vim.cmd [[packadd packer.nvim]]
end

return require('packer').startup(function(use)
  use {                                              -- filesystem navigation
    'kyazdani42/nvim-tree.lua',
    requires = 'kyazdani42/nvim-web-devicons'        -- filesystem icons
  }
   use { 'mhinz/vim-startify' }                       -- start screen
  use { 'DanilaMihailov/beacon.nvim' }               -- cursor jump
  use {
    'nvim-lualine/lualine.nvim',                     -- statusline
    requires = {'kyazdani42/nvim-web-devicons',
                }
  }
  use { 'Mofiqul/dracula.nvim' }
  use 'shaunsingh/nord.nvim'
  use 'github/copilot.vim'

use { 'mattn/emmet-vim' }
use {'dense-analysis/ale'}
  -- [[ Dev ]]
  use {
    'nvim-telescope/telescope.nvim',                 -- fuzzy finder
    requires = { {'nvim-lua/plenary.nvim','BurntSushi/ripgrep'} }
  }
  use { 'majutsushi/tagbar' }                        -- code structure
  use { 'Yggdroot/indentLine' }                      -- see indentation
  use { 'tpope/vim-fugitive' }                       -- git integration
  use { 'junegunn/gv.vim' }                          -- commit history
  use { 'windwp/nvim-autopairs' }                    -- auto close brackets, etc.
  use{ 'tpope/vim-surround' }
  -- WhichKey
  use {
  "folke/which-key.nvim",
  config = function()
    require("which-key").setup {
      -- your configuration comes here
      -- or leave it empty to use the default settings
      -- refer to the configuration section below
    }
  end
}
use {
  'https://codeberg.org/esensar/nvim-dev-container',
  requires = { 'nvim-treesitter/nvim-treesitter' },
  config = function()
    require("devcontainer").setup{
	terminal_handler = function(command)
		local laststatus = vim.o.laststatus
		vim.cmd("tabnew")
		local bufnr = vim.api.nvim_get_current_buf()
		vim.o.laststatus = 0
		local au_id = vim.api.nvim_create_augroup("devcontainer.docker.terminal", {})
		vim.api.nvim_create_autocmd("BufEnter", {
			buffer = bufnr,
			group = au_id,
			callback = function()
				vim.o.laststatus = 0
				vim.cmd("set lines+=1")
			end,
		})
		vim.api.nvim_create_autocmd("BufLeave", {
			buffer = bufnr,
			group = au_id,
			callback = function()
				vim.o.laststatus = laststatus
				vim.cmd("set lines-=1")
			end,
		})
		vim.api.nvim_create_autocmd("BufDelete", {
			buffer = bufnr,
			group = au_id,
			callback = function()
				vim.o.laststatus = laststatus
				vim.cmd("set lines-=1")
				vim.api.nvim_del_augroup_by_id(au_id)
			end,
		})
		vim.fn.termopen(command)

	    end,

        autocommands = {
        init = true,
        update = true
      },
      attach_mounts = {
          always = true,
          neovim_config= {
           enabled = true,
           options = {}
          }
      },
      neovim_data = {
        enabled=true,
        options = {}
      }
    }
    end
}
require'nvim-treesitter.configs'.setup {
  ensure_installed = { "jsonc" },
  -- Install parsers synchronously (only applied to `ensure_installed`)
  sync_install = true,
}

  use { 'jayli/vim-easycomplete' }
use { 'SirVer/ultisnips' }
     use 'neovim/nvim-lspconfig' -- Configurations for Nvim LSP

       if packer_bootstrap then
    require('packer').sync()
  end
end)
