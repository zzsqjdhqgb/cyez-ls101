#!/bin/sh
set -eu

cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

docker compose run --rm cyez-ls101-dev-docker \
  bash -lc 'yarn && exec codex --sandbox danger-full-access'
