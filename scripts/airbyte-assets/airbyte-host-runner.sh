#!/bin/sh
set -eu

AIRBYTE_MANAGER_HOME="${AIRBYTE_MANAGER_HOME:-/var/lib/airbyte-manager}"
AIRBYTE_RUNTIME_DIR="${AIRBYTE_RUNTIME_DIR:-$AIRBYTE_MANAGER_HOME/runtime}"
AIRBYTE_LOG_DIR="${AIRBYTE_LOG_DIR:-$AIRBYTE_MANAGER_HOME/logs}"
STATUS_FILE="${AIRBYTE_RUNTIME_DIR}/status.json"
TARGET_HOST="${AIRBYTE_TARGET_HOST:-127.0.0.1}"
AIRBYTE_VALUES_FILE="${AIRBYTE_VALUES_FILE:-/opt/airbyte-manager/airbyte-values.yaml}"

mkdir -p "$AIRBYTE_MANAGER_HOME" "$AIRBYTE_RUNTIME_DIR" "$AIRBYTE_LOG_DIR" "$AIRBYTE_MANAGER_HOME/.airbyte"
rm -rf /root/.airbyte
ln -s "$AIRBYTE_MANAGER_HOME/.airbyte" /root/.airbyte

export HOME="$AIRBYTE_MANAGER_HOME"
export DO_NOT_TRACK=1
AIRBYTE_CLUSTER_NAME="${AIRBYTE_CLUSTER_NAME:-airbyte-abctl}"
AIRBYTE_KUBECONFIG_PATH="${AIRBYTE_KUBECONFIG_PATH:-$AIRBYTE_MANAGER_HOME/.airbyte/abctl/abctl.kubeconfig}"

write_status() {
  state="$1"
  message="$2"
  cat >"${STATUS_FILE}.tmp" <<EOF
{"state":"${state}","message":"${message}","mode":"${AIRBYTE_MANAGER_MODE:-install}","updatedAt":"$(date -u +"%Y-%m-%dT%H:%M:%SZ")","target":"http://${TARGET_HOST}:${AIRBYTE_HOST_PORT}"}
EOF
  mv "${STATUS_FILE}.tmp" "$STATUS_FILE"
}

local_install_exists() {
  [ -s "$AIRBYTE_KUBECONFIG_PATH" ]
}

cluster_exists() {
  kind get clusters 2>/dev/null | grep -Fx "$AIRBYTE_CLUSTER_NAME" >/dev/null 2>&1
}

detect_existing_cluster_port() {
  docker inspect "$AIRBYTE_CLUSTER_NAME-control-plane" \
    --format '{{with index .HostConfig.PortBindings "80/tcp"}}{{(index . 0).HostPort}}{{end}}' \
    2>/dev/null || true
}

ensure_single_install_supported() {
  if ! cluster_exists; then
    return 0
  fi

  existing_port="$(detect_existing_cluster_port)"

  if ! local_install_exists; then
    write_status \
      "error" \
      "Another Airbyte local cluster already exists on this host${existing_port:+ on port ${existing_port}}. The current manager uses abctl local, which only supports a single Airbyte deployment per host for now. Reuse the existing Airbyte app or uninstall it before creating a new one."
    return 1
  fi

  if [ -n "$existing_port" ] && [ "$existing_port" != "$AIRBYTE_HOST_PORT" ]; then
    write_status \
      "error" \
      "This Airbyte installation is already bound to host ingress port ${existing_port}. Changing the host port requires uninstalling the existing Airbyte cluster first, then deploying again with the new port."
    return 1
  fi
}

wait_for_ingress() {
  attempt=0
  while [ "$attempt" -lt 60 ]; do
    if curl -fsS -I \
      -H "Host: $AIRBYTE_DOMAIN" \
      "http://127.0.0.1:${AIRBYTE_HOST_PORT}/" >/dev/null 2>&1; then
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 2
  done
  return 1
}

build_install_args() {
  set -- local install \
    --chart-version "$AIRBYTE_CHART_VERSION" \
    --host "${AIRBYTE_DOMAIN}${AIRBYTE_ADDITIONAL_HOSTS:+,${AIRBYTE_ADDITIONAL_HOSTS}}" \
    --no-browser \
    --port "$AIRBYTE_HOST_PORT" \
    --values "$AIRBYTE_VALUES_FILE"

  if [ "${AIRBYTE_LOW_RESOURCE_MODE:-true}" = "true" ]; then
    set -- "$@" --low-resource-mode
  fi

  if [ "${AIRBYTE_DISABLE_AUTH:-false}" = "true" ]; then
    set -- "$@" --disable-auth
  fi

  if [ "${AIRBYTE_INSECURE_COOKIES:-true}" = "true" ]; then
    set -- "$@" --insecure-cookies
  fi

  printf '%s\n' "$@"
}

run_install() {
  set -- $(build_install_args)
  abctl "$@"
}

run_uninstall() {
  set -- local uninstall

  if [ "${AIRBYTE_REMOVE_PERSISTED_DATA:-false}" = "true" ]; then
    set -- "$@" --persisted
  fi

  abctl "$@"
}

main() {
  case "${AIRBYTE_MANAGER_MODE:-install}" in
    uninstall)
      write_status "uninstalling" "Removing the Airbyte kind cluster and Helm release."
      if run_uninstall; then
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

  write_status "installing" "Bootstrapping Airbyte with abctl on the host Docker daemon. This can take several minutes on the first run."

  ensure_single_install_supported || exit 1

  run_install || {
    write_status "error" "Airbyte install failed. Check the manager logs."
    exit 1
  }

  if abctl local status >/dev/null 2>&1 && wait_for_ingress; then
    write_status "ready" "Airbyte is installed and the manager proxy is routing traffic to the host ingress."
    exit 0
  fi

  write_status "warning" "Airbyte installed, but the local ingress is not answering on the configured host port yet. Inspect the manager logs if the UI does not load."
}

main "$@"
