# Progression Overhaul Implementation Plan

## Goal
Replace the static `progression.json` staging with a data-driven progression system that matches **NewDesign.md**: 10-wave stages + boss, formula-driven enemy stats, boss timers/enrage, and scalable rewards, while keeping the runtime/UI stable.

## Current Snapshot
- `SimulationRuntime` feeds on `StageDefinition[]` from `progression.json`, which enumerates a handful of fixed stages with hand-authored wave compositions.
- Enemies are drawn from tiered manifests (`small`, `medium`, `boss`) with static stats (no stage scaling).
- Rewards and combat pacing (boss timers, enrages) are managed outside of stage definitions; runtime assumes no global scaling.
- Offline play / boss enrage / prestige hooks from NewDesign aren’t present yet.

## Target Capabilities (Phase 1 focus)
1. **Procedural Stage Generator**
   - Produce stage metadata for any stage index using formulas for wave count (always 10 + boss), enemy counts, and loot table selection.
   - Support deterministic seeding so Cocos + web share results.
2. **Enemy Scaling Service**
   - Apply stage-based HP/ATK/DEF/SPD formulas to base enemy blueprints.
   - Provide boss-specific scaling, enrage modifiers, and time-limit config.
3. **Reward Scaling**
   - Calculate per-enemy gold/xp from stage formulas; provide boss reward bundle (gold, shards, gem chance, permanent first-clear bonus hook).
   - Feed results into existing reward grant pipeline.
4. **Boss Encounter Logic**
   - Track boss timer (60 s) and enrage trigger at 50% HP (+50% ATK, potentially expose multiplier hook for UI).
   - Emit encounter events so UI/logs can display timer/enrage state.
5. **Data & Validation**
   - New JSON config (`assets/data/progression/config.json` or similar) holding coefficients/exponents, drop scaling, first-clear rewards, etc.
   - Extend `tools/validate-data.mjs` with schema for progression config and ensure manifests reference it.

Phase 2 (later): offline calc, prestige unlocks, multi-creature deployment, prestige/ascension loops.

## Proposed Architecture Changes
- Introduce `core/progression/StageGenerator.ts` that consumes `ProgressionConfig` and `EnemyLibrary` to output `StageInstance` (waves + boss metadata).
- Create `ProgressionConfig` JSON (coefficients, loot tables, boss reward formulas) with matching TypeScript types.
- Extend `SimulationRuntime` to request `StageGenerator` output when `setStageIndex` or `advanceStage` is called instead of referencing static array.
- Update `GameDataSource` to load the new config (temporary: still parse existing `progression.json` for fallback).
- Add `BossEncounterState` to runtime state: timer remaining, enraged boolean, first-clear flag.
- Ensure `PlayerProgress` (save payload) tracks highest stage cleared, first-clear bonuses, and permanent stat boosts from bosses.

## Data Model Changes
- New file: `assets/data/progression/config.json` example:
```
{
  "wavesPerStage": 10,
  "enemiesPerWave": {
    "base": 3,
    "perFiveStages": 1
  },
  "enemyScaling": {
    "hp": { "base": 50, "exponent": 1.2 },
    "attack": { "base": 10, "exponent": 1.1 },
    "defense": { "base": 5, "exponent": 1.05 },
    "speed": { "base": 0.5, "perStage": 0.01 }
  },
  "boss": {
    "hp": { "base": 500, "exponent": 1.5 },
    "attack": { "base": 20, "exponent": 1.3 },
    "defense": { "base": 10, "exponent": 1.1 },
    "speed": 0.6667,
    "timerSeconds": 60,
    "enrage": { "hpPercent": 0.5, "attackMultiplier": 1.5 }
  },
  "rewards": {
    "enemy": {
      "gold": { "base": 10, "perStage": 1 },
      "xp": { "base": 5, "perStage": 1 }
    },
    "boss": {
      "gold": { "base": 1000 },
      "shards": { "base": 10 },
      "gemChance": { "base": 0.05 }
    }
  },
  "lootTables": {
    "default": "starter",
    "thresholds": [
      { "stage": 20, "table": "dungeon" }
    ]
  }
}
```
- Schema for validation to ensure positive numbers, exponent ranges, etc.

## Runtime Flow Adjustments
1. `SimulationRuntime.initialize` loads `ProgressionConfig` and instantiates `StageGenerator`.
2. When stage changes or new run starts:
   - Generate stage definition.
   - Build waves: for each wave, pick enemy tiers per generator rules, clone base enemy data, apply scaling stats.
   - Build boss encounter: scaled boss stats, timer config.
3. Encounter loop uses provided timer/enrage thresholds; when timer expires, treat as defeat.
4. Reward application uses stage-supplied reward bundles; track first-clear via runtime (persist in `CharacterProgressSnapshot` or new profile storage).

## Save / State Considerations
- Need to store highest stage cleared, last stage attempted, and first-clear flags for boss permanent buffs.
- Pause/resume must serialize boss timer + enrage status.
- Inventory / hero data already handled; ensure stat boosts from bosses apply via runtime modifiers (perhaps `ProgressionBonuses` service).

## UI Impacts (React + Cocos)
- Display stage index, wave number (1-10), boss timer countdown, enrage warning.
- Show scaling rewards in UI (per enemy, boss reward preview).
- Possibly add stage difficulty info panel (optional stretch).

## Milestones & Task Breakdown

### Milestone A – Config & Infrastructure
- [ ] Define `ProgressionConfig` types + JSON file; update data source + validator.
- [ ] Implement `StageGenerator` + helper math functions.
- [ ] Extend `SimulationRuntime` to use generator for listStages & encounter prep.
- [ ] Provide minimal integration tests via TypeScript unit or harness logging.

### Milestone B – Boss Mechanics
- [ ] Add boss timer/enrage tracking inside encounter loop.
- [ ] Emit runtime hooks for timer updates/enrage state.
- [ ] Update harness UI to display timer + enrage.

### Milestone C – Reward & Progress Tracking
- [ ] Implement reward scaling + first-clear permanent bonuses.
- [ ] Persist stage clears, permanent buffs in progress snapshot.
- [ ] Update UI to show boss reward preview & permanent bonus.

Later milestones: offline progress, prestige, multi-creature parties, gating unlocks.

## Open Questions
- Where to store permanent stat boosts (hero vs account)?
- Do waves mix enemy tiers randomly or deterministic rotation? (Assume deterministic formula for now.)
- Should loot tables change beyond simple thresholds (e.g., formulas)? Future extension.

## Dependencies
- None blocking, but updating validators and runtime will require re-running tsc + manual QA in React harness.

## Risks
- Large refactor touches runtime core; need careful regression QA (combat loop, rewards, persistence).
- First-clear bonuses require new persistence fields; coordinate with save format and migration strategy.

