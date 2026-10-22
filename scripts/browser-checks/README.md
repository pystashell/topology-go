# Browser checks

These are Playwright scripts that drive the built app in Chromium and report console errors and CSP violations. They are not part of `npm test`, and Playwright is deliberately not a project dependency.

## Setup (once)

```bash
cd scripts/browser-checks
npm init -y >/dev/null && npm install playwright@1 && npx playwright install chromium
```

Set `CHROMIUM_PATH` instead if you already have a Chromium build.

## Run

Start the full app (static assets and the Worker) from the repo root:

```bash
npm run dev            # build + wrangler dev on http://localhost:8787
```

Then, from `scripts/browser-checks`:

| Script | What it checks |
| --- | --- |
| `node csp.mjs` | Under the real `_headers` CSP: view switches, a local KataGo self-play game (b10), the lobby, and room creation over WebSocket. Fails on any CSP violation. |
| `node local.mjs` | Gomoku (freestyle and Renju) and Othello against the AI on cylinder, torus and Möbius, played to a result. Also AI self-play with pause/undo/resume, direct undo against the AI, and an English pass checking for leftover Chinese. |
| `node online.mjs` | Online rooms with an AI seat run by the host browser, plus a guest and a spectator. Checks that undo stays in sync and that every view ends on the same result. |
| `node go.mjs` | Go regression: the AI dialog still offers KataGo b10/b18, and KataGo plays a real reply. |

## Environment variables

- `BASE`: the app URL (default `http://localhost:8787`).
- `SHOTS`: screenshot directory (default: a temp dir).
- `CHROMIUM_PATH`: optional browser executable.

Real engines think for 0.3–4 s per move, so `local.mjs` and `online.mjs` take several minutes. The scripts match parts of the Chinese UI text. If you change that wording, update `play.mjs`.
