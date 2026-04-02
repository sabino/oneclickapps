FROM debian:bookworm-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      bash \
      ca-certificates \
      curl \
      docker.io \
      gettext-base \
      iproute2 \
      iptables \
      nginx-light \
      procps && \
    rm -rf /var/lib/apt/lists/*

ARG ABCTL_VERSION=$$cap_abctl_version

RUN arch=$(dpkg --print-architecture) && \
    case "$arch" in \
      amd64) airbyte_arch=linux-amd64 ;; \
      arm64) airbyte_arch=linux-arm64 ;; \
      *) echo "unsupported arch: $arch" >&2; exit 1 ;; \
    esac && \
    curl -fsSL -o /tmp/abctl.tgz "https://github.com/airbytehq/abctl/releases/download/${ABCTL_VERSION}/abctl-${ABCTL_VERSION}-${airbyte_arch}.tar.gz" && \
    tar -xzf /tmp/abctl.tgz -C /tmp && \
    install -m 0755 /tmp/abctl-${ABCTL_VERSION}-${airbyte_arch}/abctl /usr/local/bin/abctl && \
    rm -rf /tmp/abctl.tgz /tmp/abctl-${ABCTL_VERSION}-${airbyte_arch}

__WRITE_INSTALL_SCRIPT__
__WRITE_HOST_RUNNER__
__WRITE_ENTRYPOINT__
__WRITE_NGINX_TEMPLATE__
__WRITE_BOOTSTRAPPING_PAGE__
__WRITE_VALUES_FILE__

RUN mkdir -p /var/lib/airbyte-manager/runtime /var/lib/airbyte-manager/logs /var/cache/nginx /var/run

ENTRYPOINT ["/bin/sh", "/usr/local/bin/airbyte-entrypoint.sh"]
