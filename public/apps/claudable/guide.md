# Claudable for CapRover

This entry packages [Claudable](https://github.com/opactorai/Claudable) as a single CapRover web app.

The image is built from a pinned upstream git ref and includes:

- the Claudable Next.js production server
- SQLite schema initialization on container start
- Claude Code CLI
- Codex CLI
- Qwen Code CLI
- Git, OpenSSH, Python, and build tools for generated projects

## Persistent state

The template stores mutable state under the CapRover volume mounted at `/data`:

- `/data/cc.db` for the SQLite database
- `/data/projects` for generated apps
- `/data/uploads` for uploaded assets
- `/data/home` for CLI auth state such as `.claude`, `.codex`, and other home-directory config
- `/data/npm-cache` for dependency installs inside generated project previews

The web process runs as the non-root `claudable` user. That matters because agent CLIs may reject bypass or full-auto modes when run as root.

## Auth and tokens

The install form accepts optional API keys for Anthropic, OpenAI, Qwen, Zhipu, and GitHub.

You can also add GitHub, Supabase, and Vercel tokens later in the Claudable UI. If you prefer browser/login based CLI auth, exec into the running app container and authenticate with `HOME=/data/home` so the login state survives redeploys.

## Preview limitation

Claudable upstream starts generated project previews inside the same runtime and currently records those preview URLs as `http://localhost:<port>`.

That works for local desktop use, but a browser visiting the CapRover domain cannot resolve the container's localhost. The main Claudable app deploys cleanly on CapRover; public iframe previews need one more layer:

- an upstream Claudable change that returns CapRover-safe preview URLs and proxies the preview port range, or
- an operator-managed tunnel/proxy for the internal preview ports.

The one-click template keeps the internal preview port range configurable so a future proxy can be added without changing the app's data layout.

## Updating versions

The upstream Claudable git ref and bundled CLI versions are install-form variables. Keep them pinned for reproducible builds, then test a new deployment before replacing a working instance.
