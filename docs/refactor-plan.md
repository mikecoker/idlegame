# IdleEQ New Design Refactor Plan

## Goals & Guiding Principles
- Separate simulation core from presentation so Cocos Creator and the web harness consume the same engine.
- Implement systems described in `NewDesign.md` using data-driven configuration instead of hard-coded values.
- Preserve ability to iterate quickly by keeping JSON in `assets/data` as the single source of truth and generating runtime-ready structures from it.
- Maintain backward compatibility during transition by supplying shims for existing UI until the new runtime is stable.

## Current State Observations
- Core combat (`assets/game/combatsim.ts`, `character.ts`, `encounter.ts`) lives under the Cocos asset tree and leaks Cocos concepts (e.g., `Component` lifecycle in `Simulator.ts`).
- React harness (`web/src/simulatorHarness.ts`) fetches JSON directly from `assets/data`, but duplicates encounter orchestration, loot logic, progression, and persistence.
- Stage progression JSON (`assets/data/encounters/progression.json`) encodes a short fixed campaign rather than the scalable, formula-driven structure in `NewDesign.md`.
- Equipment, consumables, prestige, and other systems exist only as stubs or simple tables; none respect the richer scaling, unlocks, or resource flows promised in the new design.
- Save data format is tightly coupled to the legacy harness state shape and will not extend cleanly once multi-creature parties, evolutions, or offline progress arrive.

## Target Architecture
```
/ core
  /combat             // deterministic combat + encounter loop
  /creatures          // stats, leveling, evolutions, abilities
  /progression        // stages, wave generation, offline calc, prestige
  /economy            // rewards, drop tables, currencies, crafting
  /equipment          // gear, gems, enchantments, artifacts
  /skills             // skill tree definitions and resolution
  /services           // runtime orchestration, save/load, event bus
  index.ts            // exports stable API for any host UI
/ platforms
  /cocos              // thin wrappers (Components, resource loaders)
  /react              // harness built on shared core API
/ data
  (source JSON copied or symlinked from assets/data during build)
```
- `core` modules are pure TypeScript with no dependency on `cc` or browser APIs. They expose synchronous APIs for simulation ticks and asynchronous data-loading hooks.
- Define a `DataSource` interface with async getters (`getCreature(id)`, `getStageConfig()`, etc.) and provide:
  - `CocosDataSource` that uses `resources.load`/`JsonAsset`.
  - `WebDataSource` that fetches JSON via `fetch` or Vite `import`.
- Host applications own the game loop (Cocos via `Component.update`, React via `requestAnimationFrame`) and drive the core `SimulationRuntime` through a minimal façade.

## Data Strategy
- Keep authoritative JSON under `assets/data`. Introduce subfolders per system to mirror the new design:
  - `assets/data/stages/stage-rules.json` (global formulas, unlock thresholds, wave templates).
  - `assets/data/creatures/*.json` (base stats, growth curves, evolution material costs, ability unlocks).
  - `assets/data/enemies/*.json` extended to include stage-scaling tags and boss flags.
  - `assets/data/equipment/*.json` for base gear stats, rarity multipliers, enchantments, gem sockets, upgrade tables.
  - `assets/data/loot/*.json` for drop tables referencing item IDs and scaling expressions.
  - `assets/data/consumables.json`, `skill-tree.json`, `prestige.json`, `ascension.json`, `artifacts.json` for late-game systems.
- Add a lightweight build step (script in `tools/` or within Vite/Cocos asset pipeline) that validates JSON against TypeScript schemas using `zod`, generating typed maps consumed by `core`.
- Represent formulas from `NewDesign.md` as data:
  - Store coefficients/exponents (`"enemyHp": { "base": 50, "exponent": 1.2 }`).
  - Capture unlock gates (`"equipmentUnlockStage": 10`).
  - Encode prestige multipliers (`"prestige": { "damage": 0.05, ... }`).

## Implementation Roadmap

### Phase 1 – Core Extraction & API Scaffold
- Create `core/` directory and move `character.ts`, `stat.ts`, `item.ts`, `combatsim.ts`, and `encounter.ts` into it, removing any Cocos imports.
- Introduce `SimulationRuntime` that wraps `CombatSim` + `EncounterLoop` and exposes lifecycle (`loadData`, `startEncounter`, `tick`, `getState`).
- Implement `DataSource` abstraction with temporary adapters that proxy current JSON layouts, keeping legacy functionality intact.
- Update `assets/game/Simulator.ts` and `web/src/simulatorHarness.ts` to consume the new runtime façade while still using legacy data.

### Phase 2 – Stage & Progression Overhaul
- Replace stage JSON with `stage-rules.json` capturing base wave count, boss frequency, and scaling parameters from `NewDesign.md` (HP/DMG/DEF/SPD, rewards, boss enrage).
- Build `StageGenerator` service that, given highest cleared stage, produces wave compositions (`3 + floor(stage/5)` enemies, 10 waves + boss) and yields `StageInstance` objects consumed by `SimulationRuntime`.
- Implement boss timers, enrage behaviour, and reward bundles per design (gold/xp/shards/gems, permanent boost on first boss clear).
- Add offline progress calculator that runs `StageGenerator` at 50% speed up to 24h cap and emits batched rewards.

### Phase 3 – Creature Roster & Party System
- Extend `Character` to support leveling curve (`XP = 100 * level^1.5`), evolution tiers at 10/20/30/50, and base stat scaling data-driven via JSON.
- Implement roster management for up to 5 deployed creatures, including slot unlock logic and party DPS aggregation.
- Introduce ability system hooks (area damage, healing aura) with event-driven effects triggered from combat outcomes.
- Persist creature progress snapshots (level, evolution tier, gear, abilities) in save data.

### Phase 4 – Loot, Equipment, Gems, and Enchantments
- Expand equipment module to support six slots, rarity multipliers, socket slots, upgrade tracks, and enchantments as described.
- Create loot table JSON referencing item IDs with stage-scaling drop chances (2% base + 0.5% per 10 stages) and rarity weights.
- Implement `LootService` that rolls rewards after each encounter, updates inventories, and feeds crafting/salvage flows.
- Add gem system (socketing, fusion) and enchantment management with shard costs/power scaling.

### Phase 5 – Economy, Consumables, and Metaprogression
- Implement consumable effects (potions, elixirs, boss slayer, time warp) with cooldown tracking and resource costs.
- Build prestige system per formula (`PP = floor(sqrt(highest_stage - 99)) * ...`) and apply multiplicative bonuses across combat calculations.
- Add ascension layer (shard earnings, perk spending, caps) unlocked at Prestige 10.
- Integrate artifacts with passive modifiers and drop rates.

### Phase 6 – Skill Tree & Late-Game Systems
- Structure skill tree JSON with branches, tiers, point caps, and respec cost formula; implement runtime tree that mutates derived stats and economy bonuses.
- Implement late-game challenge modes and infinite scaling multipliers that toggle additional modifications after stage 1000.
- Provide hooks for optional monetization features (premium currency, battle pass, VIP), gated behind configuration flags so they can be disabled in dev builds.

### Phase 7 – Persistence, Telemetry, and Tooling
- Define versioned save schema (JSON) that stores party state, stage progression, inventory, currencies, prestige/ascension status, cooldown timers, and telemetry counters.
- Write migration utilities to load legacy harness saves into the new schema.
- Enhance telemetry events to log combat stats, loot rolls, and resource sinks for balancing; expose aggregated data to frontends.
- Add validation scripts and CI checks (schema linting, data sanity ranges) to prevent bad tables from shipping.

## UI Integration Strategy
- Update Cocos `Simulator` component to own only editor bindings and visual hooks, delegating all game logic to `SimulationRuntime`. Serialize editor-assigned JSON assets into the runtime via `CocosDataSource`.
- Replace `SimulatorHarness` in React with a new hook-based wrapper around the core API (`useSimulationRuntime`), keeping existing components but swapping data sources.
- Provide shared TypeScript types in `core` for UI consumption (status payloads, inventory snapshots) so both platforms render identical state without duplicating formatters.
- Gradually retire the legacy harness shims by implementing feature parity in the new wrapper, then removing obsolete code once testing completes.

## Incremental Migration Plan
1. Land Phase 1 core extraction and adapt both frontends without changing gameplay.
2. Gate new systems behind feature flags in the runtime (`features.stageV2`, `features.prestige`) to allow staged rollout.
3. Replace stage progression with `StageGenerator` while keeping loot/equipment legacy to limit regression scope.
4. Introduce party system and ensure UI shows multi-creature state before enabling evolution/abilities.
5. Migrate loot/equipment and prestige systems, updating save schema with migration steps.
6. Enable consumables, skill tree, and late-game systems sequentially, verifying data checkpoints via manual harness playtests.
7. Clean up legacy data and code once all milestones are stable.

## Risks & Open Questions
- Data duplication between `assets/data` and any build-time mirrors must stay synchronized; need tooling decision (symlink vs. copy on build).
- Ability system design (area damage, healing aura) requires concrete effect triggers—need agreement on combat event model before implementation.
- Prestige and ascension multipliers may require rebalance to avoid runaway scaling; expect iterative tuning.
- Offline progress simulation at 24h cap could be heavy; may need batching or analytical approximations rather than per-wave simulation.
- Monetization hooks are optional; clarify whether to stub them out or keep feature-complete in data.

## Immediate Next Steps
- Confirm directory layout and naming (`core/` + `platforms/`) with the team.
- Draft TypeScript interfaces for `DataSource`, `SimulationRuntime`, and primary domain entities to guide extraction work.
- Inventory existing JSON files to map which values migrate into the new schema versus being superseded.
- Decide on validation tooling (e.g., `zod`, `ajv`, or custom) and add it to the repository before expanding data tables.
