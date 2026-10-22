# Game AI interface (Gomoku via Rapfi, Othello via our own engine) — shared contract

Base: main @ bcf4542 (multi-game merged). Go keeps KataGo exactly as is.
Owner decisions: Gomoku AI = Rapfi (GPL-3 engine, CC0 weights) — accepted. Othello AI = our own free engine, must run in our browser client (no server, no external runtime services, strict CSP: same-origin only; `'wasm-unsafe-eval'` only for workers that need it).

## Files (each agent owns only its own)
- Gomoku agent: `src/ai/gomoku/gomokuAi.js` (pure entry), `src/ai/gomoku/gomokuAiWorker.js` (module worker), `src/ai/gomoku/rapfiBridge.js` (Piskvork protocol driver), `public/engines/rapfi/*` (built wasm/glue/weights + COPYING + SOURCE.md), `scripts/build-rapfi.sh`, THIRD_PARTY_NOTICES.md entry, `public/_headers` rule for the gomoku worker, tests `test/gomokuAi*.test.js`.
- Othello agent: `src/ai/othello/othelloAi.js` (pure entry), `src/ai/othello/othelloAiWorker.js`, helpers under `src/ai/othello/`, tests `test/othelloAi*.test.js`.
- Integration agent: `src/ai/gameAiClient.js`, `src/ai/gameAiRegistry.js`, `src/ai/fallback/*` (simple fallback AI implementing the same protocol, used until real workers merge and as a last resort), `src/ai/modelCatalog.js`, `src/game/rules/{gomoku,othello,shared}.js` (capabilities/actions/modes for AI), `src/multiplayer/*`, `worker/*`, `src/main.js`, `index.html`, `src/i18n*`, styles, tests.

## Worker protocol (identical for every non-Go game AI)
Workers are ES module workers created with `new Worker(new URL("./<game>AiWorker.js", import.meta.url), { type: "module" })`.
Incoming messages:
- `{ type: "init", requestId }` → `{ type: "ready", requestId, info: { engine, version, license, levels: ["easy","normal","hard"] } }` (may load wasm/weights; idempotent).
- `{ type: "choose-move", requestId, position, settings }` → `{ type: "move", requestId, move: { row, col }, info: { engine, ms, depth?, nodes?, score?, source? } }` or `{ type: "error", requestId, code, message }`. Optional `{ type: "progress", requestId, info }` while thinking.
- `{ type: "cancel", requestId }` → the pending choose-move resolves with `{ type: "error", requestId, code: "CANCELLED" }` promptly.
`position` = `{ gameType: "gomoku"|"othello", ruleSet?: "freestyle"|"renju", width, height, topology: "cylinder"|"torus"|"mobius", board: (null|"black"|"white")[][] (row-major, height rows × width cols), currentPlayer: "black"|"white", lastMove?: {row,col,color}|null, moveCount }`.
`settings` = `{ level: "easy"|"normal"|"hard", timeLimitMs }` (defaults: easy 300, normal 1500, hard 4000; the worker must respect timeLimitMs ± 20%).
The returned move MUST be legal under our rules on the real topology (Gomoku: empty and not Renju-forbidden for Black; Othello: flips ≥1). Workers validate with our engines: `new GomokuEngine({ width, height, topology, ruleSet, initialBoard: board, currentPlayer })` / `new OthelloEngine({ width, height, topology, initialBoard: board, currentPlayer })` and `checkPlay(row, col)`. Othello: the AI is only asked when the side to move has a legal move (passes are automatic).
Pure entries for tests and reuse: `chooseGomokuMove(position, settings, { signal }) → Promise<{ move, info }>` and `chooseOthelloMove(position, settings, { signal }) → Promise<{ move, info }>`.

## AI catalog ids (for online AI seats, lobby names)
- Go: existing "b10", "b18" (KataGo) unchanged.
- Gomoku: "rapfi" (display "Rapfi").
- Othello: "topo-othello" (display zh "拓扑黑白棋 AI", en "Topology Othello AI").
