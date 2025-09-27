export { CombatSim } from "./combat/CombatSim";
export type { AttackOutcome, AttackResult } from "./combat/CombatSim";
export {
  EncounterLoop,
  type EncounterEvent,
  type EncounterSummary,
  type EncounterRewards,
  type RewardAugmentItem,
  type RewardEquipmentItem,
} from "./combat/Encounter";
export { Character, CharacterData } from "./characters/Character";
export type { CharacterProgressSnapshot } from "./characters/Character";
export * from "./items/constants";
export * from "./items/Item";
export * from "./stats/StatBlock";
export * from "./progression/Stage";
export * from "./economy/LootTable";
export * from "./data/DataSource";
export { SimulationRuntime } from "./runtime/SimulationRuntime";
export type {
  SimulationRuntimeHooks,
  SimulationRuntimeOptions,
  SimulationState,
} from "./runtime/SimulationRuntime";
