# Web Harness

The harness now renders through React (via Vite) so the combat dashboard can grow into a richer, componentised UI while still consuming the shared simulation logic in `assets/game/`.

## Prerequisites

- Node.js 18+
- Install dependencies (React, Vite, etc.):

  ```bash
  npm install
  ```

  > The command needs internet access. If you are offline, install the packages manually before running the scripts below.

## Commands

```bash
npm run serve:web   # start Vite dev server on http://localhost:4321
npm run build:web   # produce production bundle in web/dist
```

## Notes

- The React layout renders the structural elements that the existing `SimulatorHarness` expects, so the legacy controller keeps working while we iteratively move logic into composable components.
- All JSON data (`assets/data/**`) is still shared with the Cocos project and loaded at runtime, so tweaking heroes/enemies/loot continues to update both experiences.
