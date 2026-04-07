#!/bin/sh
set -eu

AIRBYTE_MANAGER_HOME="${AIRBYTE_MANAGER_HOME:-/var/lib/airbyte-manager}"
AIRBYTE_RUNTIME_DIR="${AIRBYTE_RUNTIME_DIR:-$AIRBYTE_MANAGER_HOME/runtime}"
AIRBYTE_LOG_DIR="${AIRBYTE_LOG_DIR:-$AIRBYTE_MANAGER_HOME/logs}"
STATUS_FILE="${AIRBYTE_RUNTIME_DIR}/status.json"
UPSTREAM_PORT_FILE="${AIRBYTE_RUNTIME_DIR}/upstream-port"
LOCK_DIR="${AIRBYTE_RUNTIME_DIR}/install.lock"
HOST_GATEWAY="${AIRBYTE_HOST_GATEWAY:-$(ip route | awk '/default/ { print $3; exit }')}"
RUNNER_NAME="${AIRBYTE_RUNNER_NAME:-airbyte-manager-runner}"
NGINX_TEMPLATE_FILE="${AIRBYTE_NGINX_TEMPLATE_FILE:-/opt/airbyte-manager/nginx.conf.template}"
NGINX_CONFIG_FILE="${AIRBYTE_NGINX_CONFIG_FILE:-/etc/nginx/nginx.conf}"

mkdir -p "$AIRBYTE_RUNTIME_DIR" "$AIRBYTE_LOG_DIR" "$AIRBYTE_MANAGER_HOME"

current_target_port() {
  if [ -s "$UPSTREAM_PORT_FILE" ]; then
    port="$(tr -cd '0-9' < "$UPSTREAM_PORT_FILE")"
    if [ -n "$port" ]; then
      printf '%s\n' "$port"
      return 0
    fi
  fi

  printf '%s\n' "$AIRBYTE_HOST_PORT"
}

write_status() {
  state="$1"
  message="$2"
  target_port="$(current_target_port)"
  cat >"${STATUS_FILE}.tmp" <<EOF
{"state":"${state}","message":"${message}","mode":"${AIRBYTE_MANAGER_MODE:-install}","updatedAt":"$(date -u +"%Y-%m-%dT%H:%M:%SZ")","target":"http://${HOST_GATEWAY}:${target_port}"}
EOF
  mv "${STATUS_FILE}.tmp" "$STATUS_FILE"
}

cleanup_stale_lock() {
  if [ ! -d "$LOCK_DIR" ]; then
    return 0
  fi

  if docker ps --format '{{.Names}}' | grep -Fx "$RUNNER_NAME" >/dev/null 2>&1; then
    return 0
  fi

  rm -rf "$LOCK_DIR"
}

detect_manager_mount() {
  mount_spec="$(docker inspect "$HOSTNAME" --format '{{range .Mounts}}{{if eq .Destination "/var/lib/airbyte-manager"}}{{if .Name}}{{.Name}}{{else}}{{.Source}}{{end}}|{{.Type}}{{end}}{{end}}' 2>/dev/null || true)"
  [ -n "$mount_spec" ] || return 1

  mount_value="${mount_spec%|*}"
  mount_type="${mount_spec##*|}"

  case "$mount_type" in
    volume)
      printf '%s|volume\n' "$mount_value"
      ;;
    bind)
      printf '%s|bind\n' "$mount_value"
      ;;
    *)
      return 1
      ;;
  esac
}

detect_runner_image() {
  docker inspect "$HOSTNAME" --format '{{.Config.Image}}'
}

reload_proxy_target() {
  target_port="$(current_target_port)"

  if [ -z "$target_port" ] || [ "$target_port" = "$AIRBYTE_HOST_PORT" ]; then
    return 0
  fi

  if [ ! -f "$NGINX_TEMPLATE_FILE" ]; then
    return 0
  fi

  AIRBYTE_PROXY_UPSTREAM="http://${HOST_GATEWAY}:${target_port}" \
  AIRBYTE_PROXY_UPSTREAM_HOSTPORT="${HOST_GATEWAY}:${target_port}" \
    envsubst '${AIRBYTE_PROXY_UPSTREAM} ${AIRBYTE_PROXY_UPSTREAM_HOSTPORT}' \
      <"$NGINX_TEMPLATE_FILE" \
      >"$NGINX_CONFIG_FILE"

  nginx -s reload >/dev/null 2>&1 || true
}

run_host_runner() {
  mount_info="$(detect_manager_mount)" || {
    write_status "error" "Unable to detect the Airbyte manager volume mount from the live container."
    return 1
  }
  mount_value="${mount_info%|*}"
  runner_image="$(detect_runner_image)" || {
    write_status "error" "Unable to detect the Airbyte manager image from the live container."
    return 1
  }

  docker rm -f "$RUNNER_NAME" >/dev/null 2>&1 || true

  set -- docker run --rm --name "$RUNNER_NAME" --network host \
    -v /var/run/docker.sock:/var/run/docker.sock

  set -- "$@" -v "${mount_value}:/var/lib/airbyte-manager"
  set -- "$@" \
    -e "AIRBYTE_MANAGER_HOME=$AIRBYTE_MANAGER_HOME" \
    -e "AIRBYTE_RUNTIME_DIR=$AIRBYTE_RUNTIME_DIR" \
    -e "AIRBYTE_LOG_DIR=$AIRBYTE_LOG_DIR" \
    -e "AIRBYTE_DOMAIN=$AIRBYTE_DOMAIN" \
    -e "AIRBYTE_ADDITIONAL_HOSTS=${AIRBYTE_ADDITIONAL_HOSTS:-}" \
    -e "AIRBYTE_HOST_PORT=$AIRBYTE_HOST_PORT" \
    -e "AIRBYTE_CHART_VERSION=$AIRBYTE_CHART_VERSION" \
    -e "AIRBYTE_MANAGER_MODE=${AIRBYTE_MANAGER_MODE:-install}" \
    -e "AIRBYTE_LOW_RESOURCE_MODE=${AIRBYTE_LOW_RESOURCE_MODE:-true}" \
    -e "AIRBYTE_DISABLE_AUTH=${AIRBYTE_DISABLE_AUTH:-false}" \
    -e "AIRBYTE_INSECURE_COOKIES=${AIRBYTE_INSECURE_COOKIES:-true}" \
    -e "AIRBYTE_REMOVE_PERSISTED_DATA=${AIRBYTE_REMOVE_PERSISTED_DATA:-false}" \
    -e "AIRBYTE_TARGET_HOST=$HOST_GATEWAY" \
    --entrypoint /bin/sh \
    "$runner_image" \
    /usr/local/bin/airbyte-host-runner.sh

  "$@"
}

main() {
  cleanup_stale_lock

  if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    write_status "waiting" "Another Airbyte manager process is already running."
    exit 0
  fi
  trap 'rmdir "$LOCK_DIR" >/dev/null 2>&1 || true' EXIT

  case "${AIRBYTE_MANAGER_MODE:-install}" in
    uninstall)
      write_status "uninstalling" "Removing the Airbyte kind cluster and Helm release."
      if run_host_runner; then
        write_status "uninstalled" "Airbyte has been removed from the host. It is now safe to delete this CapRover app."
        exit 0
      fi
      write_status "error" "Airbyte uninstall failed. Check the manager logs."
      exit 1
      ;;
    install)
      ;;
    *)
      write_status "error" "Unknown AIRBYTE_MANAGER_MODE value."
      exit 1
      ;;
  esac

  write_status "installing" "Launching the host-networked Airbyte runner. This can take several minutes on the first run."

  run_host_runner || {
    write_status "error" "Airbyte host runner failed. Check the manager logs."
    exit 1
  }

  reload_proxy_target
}

main "$@"
