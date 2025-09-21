# IdleEQ Roadmap

## Vision
IdleEQ should deliver a hands-off combat experience where teams progress through encounters, acquire loot, and grow stronger even while the player is away. The roadmap below sequences the work needed to evolve the current combat sandbox into a sustainable idle RPG.

## Phase 1 – Simulation Core
- Extend the combat loop to run continuously with configurable tick frequency, pause/resume, and encounter presets.
- Separate battle logic from Cocos components so the simulator can run headless for offline progress.
- Expand stats and formulas: attack delays, dual-wielding, dodge, parry, crit bonuses, and armor mitigation capped by enemy level.

## Phase 2 – Progression & Economy
- Track XP, gold, and materials per encounter; grant level-ups that increase derived stats and unlock talent choices.
- Introduce loot tables tied to `EquipmentSlot`, with item rarity, upgrades, and crafting/infusion sinks.
- Persist state (characters, inventory, progression timers) to local storage; compute offline gains by replaying ticks while the game was closed.

## Phase 3 – Content & UX
- Author enemy archetypes and boss encounters via JSON, including scripted abilities, DOTs, and resistances.
- Provide UI panels for run summaries, loot preview, and automation controls (ability priorities, heal thresholds).
- Surface analytics (DPS charts, hit rates, time-to-kill) to support tuning and player decision-making.

## Phase 4 – Live Systems
- Add prestige/reset loops that grant meta-currencies, enabling long-term retention and scaling difficulty.
- Implement daily objectives or quests that drive engagement and reward strategic roster building.
- Harden tooling: add balancing spreadsheets or data exporters, plus unit-style tests for combat math with deterministic RNG.

Each phase should land in reviewable slices; prioritize playable improvements first, then deepen systems iteratively.
