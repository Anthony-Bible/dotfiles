-- [[ plugins/markdown.lua ]]
-- NOTE: vim-instant-markdown needs the `instant-markdown-d` daemon installed
-- globally: `npm install -g instant-markdown-d` (a system dependency).
return {
  {
    "instant-markdown/vim-instant-markdown",
    ft = { "markdown" },
  },
}
