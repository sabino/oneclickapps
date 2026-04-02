FROM supabase/storage-api:$$cap_storage_version
__INSTALL_OPENSSL__
__WRITE_LEGACY_KEYS_LIB__
__WRITE_DOCKER_ENTRYPOINT_WRAPPER__
ENTRYPOINT ["/bin/sh", "/usr/local/bin/with-legacy-keys-docker-entrypoint.sh"]
CMD ["node", "dist/start/server.js"]
