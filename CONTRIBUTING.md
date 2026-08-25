# Contributing

Thanks for considering an improvement to `$ANSEM FRONTLINE`.

## Development workflow

1. Create a focused branch from `main`.
2. Install the locked dependencies with `npm ci`.
3. Keep data semantics separate from visual metaphor: verified champions require a real transaction signature; aggregate ranks must remain explicitly labelled as market-force visualization.
4. Run `npm run lint`, `npm test`, `npm run build` and `npm run test:e2e` before opening a pull request.
5. For movement, camera or WebGL changes, also run the documented five-minute soak test and attach a screenshot when the appearance changes.

Use small, descriptive commits following Conventional Commits where practical, for example `fix(scene): stabilize crowd engagement` or `docs: clarify market-force semantics`. Avoid drive-by formatting changes in unrelated files.

## Code standards

- Keep market calculations and tactical decisions in pure modules when possible, with Vitest coverage.
- Keep DOM updates in `ui.js`, external data normalization in `api.js` or `market.js`, and Three.js lifecycle work in `scene.js`.
- Bound positions, speeds and time-based transitions explicitly.
- Never expose service credentials through `VITE_*`, source files, logs or test fixtures.
- Prefer deterministic seeded variation over unbounded randomness so visual regressions can be reproduced.

Security reports must follow [SECURITY.md](SECURITY.md), not public issues.
