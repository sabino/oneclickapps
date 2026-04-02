#!/bin/sh
set -eu

. /usr/local/bin/legacy-keys.sh
ensure_supabase_legacy_keys

exec docker-entrypoint.sh "$@"
