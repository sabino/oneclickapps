FROM supabase/supavisor:$$cap_supavisor_version
__WRITE_POOLER_CONFIG__
CMD ["/bin/sh", "-c", "/app/bin/migrate && /app/bin/supavisor eval \"$(cat /etc/pooler/pooler.exs)\" && /app/bin/server"]
