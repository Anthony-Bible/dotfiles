# ZSH Theme - Preview: http://gyazo.com/8becc8a7ed5ab54a0262a470555c3eed.png
# local return_code="%{$(echotc UP 1)%}%(?..%{$fg[red]%}%? ↵%{$reset_color%})%{$(echotc DO 1)%}"
local return_code="%(?..%{$fg[red]%} exit: %?%{$reset_color%})"
# setopt transientrprompt

# local user_host='%{$terminfo[bold]$fg[green]%}%n@%m%{$reset_color%}'
# local user_host='%{$terminfo[bold]$fg[green]%}%m%{$reset_color%}'
local current_dir='%{$terminfo[bold]$fg[blue]%} %~%{$reset_color%}'
local rvm_ruby=''
# if which rvm-prompt &> /dev/null; then
#   rvm_ruby='%{$fg[red]%}‹$(rvm-prompt i v g)›%{$reset_color%}'
# else
#   if which rbenv &> /dev/null; then
local rvm_ruby='%{$fg[red]%}‹$(rbenv version | sed -e "s/ (set.*$//")›%{$reset_color%}'
#   fi
# fi
local git_branch='$(git_prompt_info)%{$reset_color%}'
# local chef_server='‹%{$fg[blue]%}chef:%{$reset_color%} $(echo $CHEF_SERVER)›'
# local sdc_env='‹%{$fg[blue]%}sdc:%{$reset_color%} $(echo $SDC)›'
# local openstack_env='‹%{$fg[blue]%}os:%{$reset_color%} $(echo $OPENSTACK)›'
# local aws_env='‹%{$fg[blue]%}aws:%{$reset_color%} $(echo $AWS)›'
# local berks='‹%{$fg[blue]%}berks:%{$reset_color%} $(berks_prompt)›'
local kube='‹%{$fg[blue]%}kube:%{$reset_color%} %{$fg[green]%}$(echo $KUBE)%{$reset_color%}/%{$fg[green]%}$(echo $KUBE_NS)%{$reset_color%}›'
local gcloud='‹%{$fg[blue]%}gcp:%{$reset_color%} $(echo $CLOUDSDK_ACTIVE_CONFIG_NAME)›'
local gke='‹%{$fg[blue]%}gke:%{$reset_color%} $(echo $CLOUDSDK_CONTAINER_CLUSTER)›'
PROMPT="╭─◦${current_dir} ${rvm_ruby} ${git_branch} ${gcloud} ${gke} ${kube}
╰─%B◦%b "
RPS1="${return_code}"

ZSH_THEME_GIT_PROMPT_PREFIX="%{$fg[yellow]%}‹"
ZSH_THEME_GIT_PROMPT_SUFFIX="›%{$reset_color%}"
