# @apodemakeles/dsh-token-dashboard

English | [中文](README.zh.md)

A DeepSeek Harness (DSH) web GUI plugin: a token-consumption heatmap panel. It shows your **total token usage per day / per week** across all projects on this machine, GitHub-contributions style, fed by the usage events recorded in DSH session logs.

> Status: **released v0.1.0** — GitHub distribution is live; npm publishing is pending the maintainer's 2FA setup.

## What it does

- **Host half** — reads DSH session logs through the `sessionPersistence` seam, dedupes usage events per (turn, step), aggregates them into per-day total-token buckets (local timezone, overridable), and serves them over `/api/token-dashboard/*` routes.
- **Client half** — registers a **Token** entry in the sidebar and opens a dedicated panel rendering the heatmap (weekly grid + daily view).

## Installation

From GitHub:

```bash
dsh plugin --profile web add github:apodemakeles/dsh-token-dashboard
```

Then **restart dsh web**. Open any project session and click the **Token** entry in the sidebar.

From npm (coming soon — once the package is published):

```bash
dsh plugin --profile web add @apodemakeles/dsh-token-dashboard
```

## Development

```bash
git clone https://github.com/apodemakeles/dsh-token-dashboard.git
cd dsh-token-dashboard
pnpm install && pnpm build
dsh plugin --profile web add link:$(pwd)
```

See [.scratch/dsh-token-dashboard/map.md](.scratch/dsh-token-dashboard/map.md) for the project map (planning tracker), and [docs/dev-loop.md](docs/dev-loop.md) for the full dev loop (watch / HMR / restart rules).

## Known limitations

- Total tokens = inputTokens + outputTokens; cacheReadTokens are recorded but not counted into the headline number (they dwarf real usage and would drown the signal).
- Machine-local only: shows usage for sessions stored in this machine's `~/.dsh/sessions`.

## License

MIT