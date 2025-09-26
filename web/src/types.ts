import type { CharacterData, CharacterProgressSnapshot } from "../../assets/game/character";
import type { EncounterSummary, EncounterRewards } from "../../assets/game/encounter";
import type { EquipmentSlot } from "../../assets/game/constants";
import type { ItemRarity } from "../../assets/game/item";

export interface Preset {
  id: string;
  label: string;
  data: CharacterData;
}

export interface EnemyUnit {
  id: string;
  label: string;
  tier: string;
  data: CharacterData;
}

export interface StageComposition {
  [tier: string]: number;
}

export interface StageDefinition {
  name: string;
  waves: number;
  composition: StageComposition[];
  lootTable?: string;
  finalBoss?: StageComposition;
}

export interface LootTableRecord {
  id: string;
  label: string;
}

export type CraftingRecipeType = "equipment" | "consumable" | "material";

export interface CraftingRecipe {
  id: string;
  result: string;
  type: CraftingRecipeType;
  tier: string;
  cost: Record<string, number>;
  resultAmount?: number;
}

export type EquippedSlotKey = "MainHand" | "OffHand" | "Head" | "Chest";

export interface OwnedEquipment {
  instanceId: string;
  itemId: string;
  rarity: ItemRarity;
  upgradeLevel: number;
  maxUpgradeLevel: number;
  socketSlots: number;
  augments: string[];
}

export interface EncounterHistoryEntry {
  index: number;
  stage: string;
  wave: number;
  opponent: string;
  result: "Victory" | "Defeat";
  heroHP: string;
  enemyHP: string;
  rewards: EncounterRewards;
}

export interface SimulatorRewardsState {
  last: EncounterRewards;
  total: EncounterRewards;
}

export interface SimulatorViewState {
  loading: boolean;
  heroOptions: Preset[];
  stages: StageDefinition[];
  recipes: CraftingRecipe[];
  lootTableIds: string[];
  selectedHeroId: string | null;
  selectedStageIndex: number;
  selectedLootId: string | null;
  tickInterval: number;
  autoResume: boolean;
  isRunning: boolean;
  statusSummary: EncounterSummary | null;
  currentStageName: string;
  currentWaveNumber: number;
  currentEnemyLabel: string;
  history: EncounterHistoryEntry[];
  logs: string[];
  materials: Record<string, number>;
  consumables: Record<string, number>;
  equipped: Record<EquippedSlotKey, OwnedEquipment | null>;
  equipmentInventory: OwnedEquipment[];
  rewards: SimulatorRewardsState;
  heroProgress?: CharacterProgressSnapshot;
}

export interface SimulatorSnapshot extends SimulatorViewState {}

export type LogLevel = "info" | "warn" | "error";
