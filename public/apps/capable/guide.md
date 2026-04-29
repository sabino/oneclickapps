# CapAble for CapRover

This entry packages CapAble as a single self-hosted web app.

CapAble is a web-first fork of Claudable focused on deploying generated apps directly to a CapRover fleet.

## Persistent state

The template stores mutable state under `/data`:

- `/data/capable.db` for SQLite
- `/data/projects` for generated apps
- `/data/uploads` for uploaded assets
- `/data/home` for CLI auth state such as `.claude` and `.codex`
- `/data/npm-cache` for package-manager cache

The web process runs as a non-root `capable` user.

## First setup

After installation:

1. Enable HTTPS for the CapAble app in CapRover.
2. Open CapAble.
3. Go to Settings > Services.
4. Save and test your CapRover fleet connection.
5. Add AI provider API keys or authenticate the bundled CLI inside the container with `HOME=/data/home`.

## Deployment model

CapAble preview and production publish flows create or update real CapRover apps. Users choose the production app name, and the hostname is derived from the connected fleet root domain.

GitHub remains optional for source control. Direct CapRover deployment is the default path.

## Important

The default repository URL in this template is a placeholder until the CapAble fork is pushed to GitHub. Set the `CapAble git repository` variable to the published fork URL before deploying.
