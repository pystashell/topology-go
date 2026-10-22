# Topology Go: notes for coding sessions

Read `docs/HANDOFF.md` first. It covers current status, the owner's decisions, how releases work, the architecture, and open items. Design notes are in `docs/design/`.

- **Communication:** the owner writes in Chinese, so reply in Chinese. They prefer speed: once dev checks pass, ship it and let them give feedback.
- **Checks to run before pushing** (the same as CI):
  - `npm test`
  - `npm run build`
  - `npx wrangler deploy --dry-run --strict`
  - `npm audit --audit-level=moderate`
- **Go behaviour must not change.** `test/goGoldenMaster.test.js` guards it, and neighbour order is persisted behaviour.
- **Keep the main.js function names** that UI wiring tests look up: `hydratePublicGame`, `applyOnlineRoom`, `enterReplay`, `enterNextGameSetup`, `startConfiguredNextGame`, `startImmediateRematch`, and the rest.
- **User-facing strings:** write them in Chinese with English in `src/i18n/*`. The coverage tests enforce this.
- **CSP:** no inline scripts or styles. A new worker that needs WebAssembly needs its own rule in `public/_headers`.
- **Releases:** never publish from `main`. Prepare a `release/x.y.z` branch with `npm run release:version -- x.y.z` and see `docs/RELEASES.md`. Right now the owner runs the publish step on their own machine, because the GitHub `production` environment has no Cloudflare secrets.
- **Rapfi** (`public/engines/rapfi/`, GPL-3): keep its COPYING, source archive and SOURCE.md next to the binary.
