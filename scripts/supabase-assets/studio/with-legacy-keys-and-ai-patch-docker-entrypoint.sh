#!/bin/sh
set -eu

. /usr/local/bin/legacy-keys.sh
ensure_supabase_legacy_keys

/usr/local/bin/patch-studio-ai.sh

exec docker-entrypoint.sh "$@"
