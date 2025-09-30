export interface LootRange {
  min: number;
  max: number;
}

export interface LootMaterialDrop {
  id: string;
  chance: number;
  min?: number;
  max?: number;
}

export interface LootTableConfig {
  id: string;
  name?: string;
  xpPerWin?: number;
  gold?: LootRange;
  materialDrops?: LootMaterialDrop[];
  equipmentDrops?: LootEquipmentDrop[];
  augmentDrops?: LootAugmentDrop[];
}

export interface LootEquipmentDrop {
  itemId: string;
  chance: number;
  min?: number;
  max?: number;
  rarityWeights?: Record<string, number>;
}

export interface LootAugmentDrop {
  augmentId: string;
  chance: number;
  min?: number;
  max?: number;
}

export interface LootConsumableDrop {
  itemId: string;
  chance: number;
  min?: number;
  max?: number;
}

export interface LootTableConfig {
  id: string;
  name?: string;
  xpPerWin?: number;
  gold?: LootRange;
  materialDrops?: LootMaterialDrop[];
  equipmentDrops?: LootEquipmentDrop[];
  augmentDrops?: LootAugmentDrop[];
  consumableDrops?: LootConsumableDrop[];
}

export interface LootTableRecord {
  id: string;
  label: string;
  config: LootTableConfig;
}

export const DEFAULT_LOOT_TABLE_ID = "default";
