# oneclickapps.sabino.pro

Custom CapRover one-click app repository for the full self-hosted Supabase stack.

## Use this repo in CapRover
Add this repository URL in **One-Click Apps/Databases**:

- `https://oneclickapps.sabino.pro`

This repo is intended to be added alongside the official CapRover one-click app repository when you want the more fully maintained Supabase template.

## What is included
- one canonical full-stack `supabase.yml` template
- a generator at `scripts/generate_supabase.js`
- vendored assets under `scripts/supabase-assets/`
- a generated standalone template at `public/v4/apps/supabase.yml`
- an operator guide for overlay-network capacity at `docs/supabase-overlay-network-capacity.md`

## How it works
The published YAML is standalone for CapRover users, but it is generated from readable source assets and a small generator so the complex Supabase stack remains maintainable.

If you change the generator or assets:

```bash
npm install
npm run generate_supabase
npm run formatter
npm run validate_apps
npm run build
```

## GitHub Pages
This repo publishes the built one-click catalog through GitHub Pages at:

- `https://oneclickapps.sabino.pro`
