FROM supabase/postgres:$$cap_db_version
__WRITE_DB_SUPABASE_SQL__
__WRITE_DB_JWT_SQL__
__WRITE_DB_LOGS_SQL__
__WRITE_DB_POOLER_SQL__
__WRITE_DB_REALTIME_SQL__
__WRITE_DB_ROLES_SQL__
__WRITE_DB_WEBHOOKS_SQL__
CMD ["postgres", "-c", "config_file=/etc/postgresql/postgresql.conf", "-c", "log_min_messages=fatal"]
