#!/bin/sh
set -eu

export AIRBYTE_MANAGER_HOME="${AIRBYTE_MANAGER_HOME:-/var/lib/airbyte-manager}"
export AIRBYTE_RUNTIME_DIR="${AIRBYTE_RUNTIME_DIR:-$AIRBYTE_MANAGER_HOME/runtime}"
export AIRBYTE_LOG_DIR="${AIRBYTE_LOG_DIR:-$AIRBYTE_MANAGER_HOME/logs}"
export AIRBYTE_HOST_GATEWAY="${AIRBYTE_HOST_GATEWAY:-$(ip route | awk '/default/ { print $3; exit }')}"
export AIRBYTE_PROXY_UPSTREAM="http://${AIRBYTE_HOST_GATEWAY}:${AIRBYTE_HOST_PORT}"
export AIRBYTE_PROXY_UPSTREAM_HOSTPORT="${AIRBYTE_HOST_GATEWAY}:${AIRBYTE_HOST_PORT}"

mkdir -p "$AIRBYTE_MANAGER_HOME" "$AIRBYTE_RUNTIME_DIR" "$AIRBYTE_LOG_DIR" /var/cache/nginx /var/run
mkdir -p "$AIRBYTE_MANAGER_HOME/.airbyte"
rm -rf /root/.airbyte
ln -s "$AIRBYTE_MANAGER_HOME/.airbyte" /root/.airbyte

cat >"${AIRBYTE_RUNTIME_DIR}/status.json" <<EOF
{"state":"booting","message":"Starting the Airbyte manager container.","mode":"${AIRBYTE_MANAGER_MODE:-install}","updatedAt":"$(date -u +"%Y-%m-%dT%H:%M:%SZ")","target":"${AIRBYTE_PROXY_UPSTREAM}"}
EOF

envsubst '${AIRBYTE_PROXY_UPSTREAM} ${AIRBYTE_PROXY_UPSTREAM_HOSTPORT}' \
  </opt/airbyte-manager/nginx.conf.template \
  >/etc/nginx/nginx.conf

/usr/local/bin/install-airbyte.sh >>"${AIRBYTE_LOG_DIR}/install.log" 2>&1 &

exec nginx -g 'daemon off;'
