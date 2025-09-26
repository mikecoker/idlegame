# IdleEQ Roadmap

## Vision
IdleEQ should deliver a hands-off combat experience where teams progress through encounters, acquire loot, and grow stronger even while the player is away. The roadmap below sequences the work needed to evolve the current combat sandbox into a sustainable idle RPG.

## Phase 1 – Simulation Core
- [x] Extend the combat loop with configurable tick frequency, pause/resume, and encounter presets that run continuously in the web harness.
- [x] Detach battle logic from Cocos UI; the simulator now exposes TypeScript listeners so the React shell and headless runs share the same core.
- [ ] Expand stats and formulas: attack delays, dual-wielding, dodge, parry, crit bonuses, and armor mitigation capped by enemy level.

### Harness & Web Migration (Phase 1.5)
- [x] Deliver live React views for rewards, inventory, materials, crafting, telemetry, and hero stats.
- [x] Replace legacy DOM mutations with harness notifications (status, controls, logs, history, stats).
- [ ] Add richer visual analytics (DPS charts, hit timelines) and reactive encounter summaries.

## Phase 2 – Progression & Economy
- [x] Track XP, gold, materials, and persist encounter history to local storage.
- [ ] Gate level-ups and talent unlocks behind XP milestones with derived stat growth.
- [ ] Introduce loot tables per `EquipmentSlot`, item rarity rolls, and crafting/infusion sinks beyond the current prototype recipes.
- [ ] Reconstruct offline progress by replaying ticks while the game is closed (current save system captures data but no catch-up).

## Phase 3 – Content & UX
- [ ] Author enemy archetypes and boss encounters via JSON, including scripted abilities, DOTs, and resistances.
- [ ] Build automation controls for combat priorities and heal thresholds; surface presets in the web UI.
- [ ] Surface analytics dashboards (comparative DPS, hit rates, time-to-kill) to drive balancing and player decision-making.

## Phase 4 – Live Systems
- [ ] Add prestige/reset loops that grant meta-currencies, enabling long-term retention and scaling difficulty.
- [ ] Implement daily objectives or quests that reward roster planning and sustained engagement.
- [ ] Harden tooling: balancing spreadsheets or data exporters, plus deterministic tests covering combat math and loot.

Each phase should land in reviewable slices; prioritize playable improvements first, then deepen systems iteratively.
