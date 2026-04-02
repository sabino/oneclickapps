# Supabase for CapRover

This repository publishes the **full self-hosted Supabase stack** as a CapRover one-click app.

The final `supabase.yml` is the standalone artifact CapRover consumes, but it is generated because Supabase is a large multi-service stack that needs custom config files, image build steps, and a few CapRover-specific adjustments to stay maintainable.

## What this app deploys

- Full Supabase stack
- Public entrypoint through Kong
- Studio, Auth, REST, Realtime, Storage, Edge Functions, Analytics, Supavisor, Postgres, and supporting services

## Why there is a generator

- Supabase is too complex to maintain as a single hand-written template in this repository
- The generator keeps the final YAML standalone while still letting the source stay readable
- Versions stay pinned through template variables instead of relying on floating tags
- The published output is still a single CapRover template

## CapRover-specific notes

1. After deployment, enable HTTPS on the public `supabase` service in CapRover
2. Large multi-service stacks can exhaust Docker Swarm overlay VIPs on small default network ranges
3. If deployment fails with overlay IP allocation issues, free unused services or expand the shared overlay capacity before retrying

## Optional OpenAI enhancement

This published app includes an optional Studio-side patch for custom OpenAI-compatible base URLs. That is useful for Azure OpenAI and other compatible providers.

The official Supabase Studio setup supports an OpenAI API key, but not a custom OpenAI-compatible base URL by default.
