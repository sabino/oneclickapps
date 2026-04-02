#!/bin/sh
set -eu

. /usr/local/bin/legacy-keys.sh
ensure_supabase_legacy_keys

mkdir -p /home/deno/functions/hello /home/deno/functions/main

if [ ! -f /home/deno/functions/hello/index.ts ]; then
  cp /opt/default-functions/hello/index.ts /home/deno/functions/hello/index.ts
fi

if [ ! -f /home/deno/functions/main/index.ts ]; then
  cp /opt/default-functions/main/index.ts /home/deno/functions/main/index.ts
fi

exec edge-runtime "$@"
