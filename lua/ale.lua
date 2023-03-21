

-- ALE Config
-- ---
vim.g.ale_completion_enabled = 0
vim.g.ale_completion_autoimport = 1
vim.g.ale_echo_msg_error_str = ''
vim.g.ale_echo_msg_warning_str = ''
vim.g.ale_echo_msg_format = '[%linter%] %s [%severity%]'
vim.g.ale_linters_explicit = 1
vim.g.ale_linters = {['javascript'] = {'eslint'}, ['go'] = {'revive'}, yaml = {'yaml-language-server'} }
vim.g.ale_fixers = { ['javascript'] = {'eslint'}  }
vim.g.ale_fix_on_save = 1
vim.g.ale_yaml_ls_use_global = 1
-- vim.g.ale_yaml_ls_config = { 
--      'yaml' : {
--     \      'schemas':{
--     \          'kubernetes' : '/*.yaml'
--     \     }
--     \ }
-- \ } 
--  'kubernetes' : '*.yaml',
-- ['http://json.schemastore.org/github-workflow'] : '.github/workflows/*',
-- ['http://json.schemastore.org/github-action'] : '.github/action.{yml,yaml}',
-- ['http://json.schemastore.org/ansible-stable-2.9'] : 'roles/tasks/*.{yml,yaml}',
-- ['http://json.schemastore.org/prettierrc'] : '.prettierrc.{yml,yaml}',
-- ['http://json.schemastore.org/kustomization'] : 'kustomization.{yml,yaml}',
-- ['http://json.schemastore.org/ansible-playbook'] : '*play*.{yml,yaml}',
-- ['http://json.schemastore.org/chart'] : 'Chart.{yml,yaml}',
-- ['https://json.schemastore.org/dependabot-v2'] : '.github/dependabot.{yml,yaml}',
-- ['https://json.schemastore.org/gitlab-ci'] : '*gitlab-ci*.{yml,yaml}',
-- ['https://raw.githubusercontent.com/OAI/OpenAPI-Specification/main/schemas/v3.1/schema.json'] : '*api*.{yml,yaml}',
-- ['https://raw.githubusercontent.com/compose-spec/compose-spec/master/schema/compose-spec.json'] : '*docker-compose*.{yml,yaml}',
-- ['https://raw.githubusercontent.com/argoproj/argo-workflows/master/api/jsonschema/schema.json'] : '*flow*.{yml,yaml}',
-- }}}
