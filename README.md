# oneclickapps.sabino.pro

Custom CapRover one-click app repository with a growing catalog of maintained templates.

## Use this repo in CapRover
Add this repository URL in **One-Click Apps/Databases**:

- `https://oneclickapps.sabino.pro`

This repo is intended to be added alongside the official CapRover one-click app repository when you want templates that are maintained separately from the main catalog.

## What is included
- one canonical full-stack `supabase.yml` template
- `claudable.yml` and `capable.yml` developer-tool templates
- a generator at `scripts/generate_supabase.js`
- vendored assets under `scripts/supabase-assets/`
- a generated standalone template at `public/v4/apps/supabase.yml`
- markdown documentation sources under `docs/`
- generated public docs pages at `/docs/`

## How it works
The published YAML is standalone for CapRover users, but it is generated from readable source assets and a small generator so the complex Supabase stack remains maintainable.

Repository-level documentation is authored as markdown in `docs/` and published as static HTML pages during the build so each guide has a stable public URL.

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
