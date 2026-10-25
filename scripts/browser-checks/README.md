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
| `node sgf.mjs` | SGF for every game: AI self-play a Gomoku (Renju, torus) and an Othello (Möbius) game, export each record, import it on a fresh page and replay it to the end. Also a Go import, an unsupported GM[3] record and an English pass. |
| `node scoring.mjs` | A Go count nobody confirms: both players pass, both pages (one in English) show the two-minute countdown, and the room then confirms the current marks on its own. About 2.5 minutes. |
| `node rooms.mjs` | Room management against `wrangler dev`: an unlisted room kept out of the lobby (then listed and unlisted again), the host removing a spectator, the guest playing White against the host's AI with undo, and the host claiming the game after the guest has been offline for two minutes. Ends with an English pass. About 3 minutes. |
| `node touch.mjs` | Real touch input on a Pixel 7 profile (Chromium, sent through CDP so the browser's own touch-action and scrolling decide): up/down swipes move the 3D cylinder, the flat torus and the 3D torus without scrolling the page; on the arc they scroll the page; the Swipe scrolls page button hands them to the page. |
| `node webkit.mjs` | An iPhone 13 profile in WebKit (closest to iOS Safari without a device; `npx playwright install webkit` once): load, tap to play Go, Gomoku and Othello AI replies, WebGL and wasm SIMD, and the phone touch policy (up/down drags move the flat torus and every 3D view; the Swipe scrolls page button hands them to the page). WebKit reports the internal styles of `<select>` elements and of its own screenshots against the CSP; the script ignores exactly those. |
| `node othello.mjs` | Othello's automatic skip in the page: a local 6x6 cylinder game clicked through a real game until Black cannot outflank anything; the page says Black is skipped, keeps White to move and accepts White's next move. |
| `node hints.mjs` | Games against AI: for Othello, Gomoku and Go (KataGo b10) the human asks for a hint on their turn, plays the hinted point, and the AI answers no sooner than a second later; the hint button is off during the AI's turn and undo clears the hint. |
| `node flipwave.mjs` | The Othello flip wave frame by frame on the flat canvas: discs at distances 1, 2 and 3 stay the old colour until their ring's turn, narrow to their edge and end the new colour, in order of distance; undo shows the earlier position at once; the same move runs without errors in the 3D and arc views. |
| `node go.mjs` | Go regression: the AI dialog still offers KataGo b10/b18, and KataGo plays a real reply. |

## Environment variables

- `BASE`: the app URL (default `http://localhost:8787`).
- `SHOTS`: screenshot directory (default: a temp dir).
- `CHROMIUM_PATH`: optional browser executable.

Real engines think for 0.3–4 s per move, so `local.mjs` and `online.mjs` take several minutes. The scripts match parts of the Chinese UI text. If you change that wording, update `play.mjs`.
