# Topology Go: notes for coding sessions

Read `docs/HANDOFF.md` first. It covers current status, the owner's decisions, how releases work, the architecture, and open items. Design notes are in `docs/design/`.

- **Communication:** the owner writes in Chinese, so reply in Chinese. They prefer speed: once dev checks pass, ship it and let them give feedback.
- **Checks to run before pushing** (the same as CI):
  - `npm test` (CI runs it as `npm run test:coverage`, which fails below 95% lines / 90% branches / 95% functions of the rules code)
  - `npm run test:soak` (every board size of every game: random games against independent references, about two minutes)
  - `npm run build`
  - `npx wrangler deploy --dry-run --strict`
  - `npm audit --audit-level=moderate`
- **Go behaviour must not change.** `test/goGoldenMaster.test.js` guards it, and neighbour order is persisted behaviour.
- **Keep the page function names** that UI wiring tests look up: `hydratePublicGame`, `applyOnlineRoom`, `enterReplay`, `enterNextGameSetup`, `startConfiguredNextGame`, `startImmediateRematch`, and the rest. The tests search `src/main.js` and `src/app/*.js` together (`test/helpers/appSource.js`).
- **Page modules (`src/app/`):** parts of the page split out of `main.js` (lobby, chat, SGF files, room tools). They keep their own state and read page state from `main.js` through live bindings (the export list at the end of `main.js`). A module never assigns `main.js` state: move a variable together with every function that writes it, and give `main.js` a small function to call instead.
- **User-facing strings:** write them in Chinese with English in `src/i18n/*`. The coverage tests enforce this.
- **Accounts and game records:** Better Auth on D1 (`worker/auth.js`, `worker/accounts.js`, `worker/records.js`, `migrations/`); see the design in `docs/design/accounts-and-game-records.md`. Sending email must stay free (the owner pays for none; `worker/email.js` caps it). Never rotate the `PASSWORD_PEPPER` secret (every password depends on it) or `BETTER_AUTH_SECRET` (guests would lose their games). Schema changes are new SQL files in `migrations/` (additive only); `npm run dev` applies them locally and the release script applies them remotely before deploying. Tests use `test/helpers/d1.js`.
- **CSP:** no inline scripts or styles. A new worker that needs WebAssembly needs its own rule in `public/_headers`.
- **Releases:** never publish from `main`. Prepare a `release/x.y.z` branch with `npm run release:version -- x.y.z` and see `docs/RELEASES.md`. The GitHub `production` environment has no Cloudflare secrets, so publishing runs on the owner's machine (`npm run release:publish -- x.y.z`), where Wrangler is logged in; ask before publishing.
- **Browser checks:** `scripts/browser-checks/` (Playwright, installed separately) drive the built app on `wrangler dev`; see its README. Run the relevant ones for UI or room changes.
- **Rapfi** (`public/engines/rapfi/`, GPL-3): keep its COPYING, source archive and SOURCE.md next to the binary.
