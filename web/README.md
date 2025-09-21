# Web Harness

A lightweight DOM playground for the IdleEQ combat simulation. The goal is to inspect and tweak combat math without opening Cocos Creator.

## Prerequisites

- Node.js 18+
- TypeScript compiler available in `node_modules/.bin`. Install it with:

  ```bash
  npm install --save-dev typescript
  ```

- (Optional) `http-server` for local hosting. The provided `serve:web` script pulls it via `npx`.

## Commands

```bash
npm run build:web   # transpile to web/dist
npm run serve:web   # build then serve web/ on http://localhost:4321
```

## Connecting to the Simulator

`web/src/main.ts` instantiates `EncounterLoop` with the existing `CombatSim`, `Character`, and JSON presets from `assets/data/`. UI controls let you:

- choose source/target presets,
- adjust tick interval,
- start/pause/reset the encounter,
- inspect live combat logs and stat snapshots.

All simulation logic continues to live under `assets/game/`, so changes there propagate to both the web harness and the Cocos project.
