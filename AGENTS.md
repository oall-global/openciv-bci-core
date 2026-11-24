# Instructions for AI coding agents

This file is for AI assistants (Claude Code, Codex, Cursor, and others) working on this repository. Read it before making changes.

## Read first

1. [docs/product-principles.md](docs/product-principles.md) — what this project is (the core of OpenCiv BCI-001: device connection, acquisition, saving and signal processing, the local developer interface, and the WeChat mini program's pairing and recording; no wear guide, abilities, lamps, games or reports), copy rules, fixed UI names, hardware facts, signal processing, and directions already rejected.
2. [CONTRIBUTING.md](CONTRIBUTING.md) — which changes may go straight to a PR and which need discussion first.
3. [README.md](README.md) — setup, run, build, tests, repository layout.

## Hard rules

- **No user-visible change without agreement.** Do not add, rename or reword screens, banners, labels or explanatory text unless the task explicitly asks for it.
- **No explanatory text on screen.** Explanations belong in the 「?」 popups and the concept manual (`content/glossary/`).
- **Keep the fixed UI names** listed in the principles (信号工作台, 主图, 佩戴检查, 脑电数据库, …).
- **No data leaves the computer or phone**: no upload, sync, telemetry or cloud dependency.
- **No medical or wellness claims.** No electrical stimulation features.
- **No brand or vendor names in the concept manual.**
- **Both platforms keep working.** Isolate platform code with `process.platform` / `sys.platform`; Windows behaviour must not change for macOS work and vice versa.
- **Report results honestly** in the UI: failures, skipped steps and simulated data are never shown as success.

## Working

- One topic per change. Separate bug fixes from UX changes.
- Match the surrounding code: comment density, naming, idioms. Comments explain why, briefly.
- Signal processing must stay equal to OpenBCI GUI (`tests/display-filter.cjs`, `engine/rail.py`).
- While working: `npm run test:changed` (or `node scripts/run-tests.cjs <names>`). Before submitting: `npm test`. Register new UI tests in `AREAS` in `scripts/run-tests.cjs`.
- Type check and build: `npm run build`. Format: `npm run format:check`. The mini program's bundled libraries (`wechat/lib/*.js`, `wechat/moment/lib/card.js`): `npm run build:wechat` after changing `src/wechat/` or what it imports.
- No hardware is needed: `npm start -- --demo` starts the development build connected to a simulated device (development and tests only; it is not offered in the app). Say clearly in the PR what was verified only with simulated data.
- UI copy is Chinese; keep it formal and plain (see the principles). Code, comments and commit messages may be English.

## Pull requests

State the problem, the change, how it was verified (screenshots before/after for UI changes, real-device evidence if any), and what remains unverified.
