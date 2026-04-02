FROM supabase/edge-runtime:$$cap_functions_version
__WRITE_LEGACY_KEYS_LIB__
__WRITE_FUNCTION_HELLO__
__WRITE_FUNCTION_MAIN__
__WRITE_FUNCTION_SEED_ENTRYPOINT__
ENTRYPOINT ["/bin/sh", "/usr/local/bin/seed-functions.sh"]
CMD ["start", "--main-service", "/home/deno/functions/main"]
