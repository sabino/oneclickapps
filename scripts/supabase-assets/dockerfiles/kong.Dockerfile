FROM kong:$$cap_kong_version
USER root
__INSTALL_OPENSSL__
__WRITE_LEGACY_KEYS_LIB__
__WRITE_KONG_TEMPLATE__
__WRITE_KONG_ENTRYPOINT__
USER kong
ENTRYPOINT ["/bin/sh", "/tmp/kong-entrypoint.sh"]
