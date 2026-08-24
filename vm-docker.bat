chcp 65001
set VAGRANT_CWD=./dev-env
vagrant up
vagrant ssh -- -t "cd /workspace-mount && exec bash ./dev-env/start-docker.sh"