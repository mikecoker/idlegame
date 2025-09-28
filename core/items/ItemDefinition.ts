import { CharacterData } from "../characters/Character";
import { ArmorStatBlock, StatBlock, StatBlockData, WeaponStatBlock } from "../stats/StatBlock";
import { EquipmentSlot, ItemType } from "./constants";
import { EquipmentItem, ItemRarity } from "./Item";

export type EquipmentSlotKey = Extract<keyof typeof EquipmentSlot, string>;

export type CraftingRecipeType = "equipment" | "consumable" | "material";

export interface ItemDefinition {
  id: string;
  name: string;
  tier: string;
  type: "weapon" | "armor" | "consumable" | "augment";
  slot?: string;
  power?: number;
  stats?: Partial<CharacterData["baseStats"]>;
  weapon?: {
    minDamage: number;
    maxDamage: number;
    delay: number;
  };
  armor?: {
    armor: number;
  };
  effect?: {
    kind: "heal";
    percent: number;
  };
  socketSlots?: number;
  maxUpgradeLevel?: number;
  augment?: {
    stats?: Partial<CharacterData["baseStats"]>;
  };
  upgrades?: Array<{
    materials: Record<string, number>;
  }>;
}

export interface OwnedEquipment {
  instanceId: string;
  itemId: string;
  rarity: ItemRarity;
  upgradeLevel: number;
  maxUpgradeLevel: number;
  socketSlots: number;
  augments: string[];
}

export interface CraftingRecipe {
  id: string;
  result: string;
  type: CraftingRecipeType;
  tier: string;
  cost: Record<string, number>;
  resultAmount?: number;
}

export interface SalvageResult {
  materialId: string;
  amount: number;
}

export const RARITY_MULTIPLIERS: Record<ItemRarity, number> = {
  common: 1,
  uncommon: 1.1,
  rare: 1.25,
  epic: 1.4,
  legendary: 1.6,
};

export const SALVAGE_VALUE_BY_RARITY: Record<ItemRarity, number> = {
  common: 1,
  uncommon: 2,
  rare: 4,
  epic: 7,
  legendary: 12,
};

export const UPGRADE_SCALE_PER_LEVEL = 0.05;

const STAT_DATA_KEYS: (keyof StatBlockData)[] = [
  "strength",
  "agility",
  "dexterity",
  "stamina",
  "intelligence",
  "wisdom",
  "charisma",
  "defense",
];

export function cloneDefinition(def: ItemDefinition): ItemDefinition {
  return {
    ...def,
    stats: def.stats ? { ...def.stats } : undefined,
    weapon: def.weapon ? { ...def.weapon } : undefined,
    armor: def.armor ? { ...def.armor } : undefined,
    effect: def.effect ? { ...def.effect } : undefined,
    augment: def.augment
      ? {
          stats: def.augment.stats ? { ...def.augment.stats } : undefined,
        }
      : undefined,
    upgrades: def.upgrades
      ? def.upgrades.map((upgrade) => ({
          materials: { ...upgrade.materials },
        }))
      : undefined,
  };
}

export function cloneOwnedEquipment(owned: OwnedEquipment): OwnedEquipment {
  return {
    ...owned,
    augments: [...owned.augments],
  };
}

export function getRarityMultiplier(rarity: ItemRarity): number {
  return RARITY_MULTIPLIERS[rarity] ?? 1;
}

export function getUpgradeMultiplier(upgradeLevel: number): number {
  return 1 + Math.max(0, upgradeLevel) * UPGRADE_SCALE_PER_LEVEL;
}

export function resolveEquipmentSlot(slotName?: string): EquipmentSlot | null {
  if (!slotName) {
    return null;
  }
  const value = (EquipmentSlot as Record<string, unknown>)[slotName];
  return typeof value === "number" ? (value as EquipmentSlot) : null;
}

function scaleStatBlockValues(block: StatBlock, multiplier: number) {
  STAT_DATA_KEYS.forEach((key) => {
    const current = block[key];
    if (typeof current === "number") {
      block[key] = Math.round(current * multiplier) as unknown as number;
    }
  });
}

function applyAugmentBonuses(
  stats: StatBlock,
  augmentIds: string[],
  lookup: (id: string) => ItemDefinition | undefined
) {
  augmentIds.forEach((augmentId) => {
    const augment = lookup(augmentId);
    if (!augment?.augment?.stats) {
      return;
    }
    stats.applyDelta(augment.augment.stats as Partial<StatBlockData>);
  });
}

export function createEquipmentFromDefinition(
  definition: ItemDefinition,
  owned: OwnedEquipment | null,
  lookup: (id: string) => ItemDefinition | undefined
): EquipmentItem | null {
  const slot = resolveEquipmentSlot(definition.slot);
  if (slot === null) {
    return null;
  }

  const rarity: ItemRarity = owned?.rarity ?? "common";
  const upgradeLevel = Math.max(0, owned?.upgradeLevel ?? 0);
  const maxUpgradeLevel = Math.max(
    upgradeLevel,
    owned?.maxUpgradeLevel ?? definition.maxUpgradeLevel ?? 0
  );
  const socketSlots = Math.max(0, owned?.socketSlots ?? definition.socketSlots ?? 0);
  const augments = owned?.augments ? [...owned.augments] : [];

  const rarityMultiplier = getRarityMultiplier(rarity);
  const upgradeMultiplier = getUpgradeMultiplier(upgradeLevel);
  const totalMultiplier = rarityMultiplier * upgradeMultiplier;

  if (definition.type === "weapon" && definition.weapon) {
    const stats = new WeaponStatBlock();
    stats.reset();
    if (definition.stats) {
      stats.applyDelta(definition.stats as Partial<StatBlockData>);
    }
    scaleStatBlockValues(stats, totalMultiplier);
    stats.minDamage = Math.max(1, Math.round(definition.weapon.minDamage * totalMultiplier));
    stats.maxDamage = Math.max(stats.minDamage, Math.round(definition.weapon.maxDamage * totalMultiplier));
    stats.delay = definition.weapon.delay;
    applyAugmentBonuses(stats, augments, lookup);

    return {
      id: definition.id,
      name: definition.name,
      description: "",
      stackSize: 0,
      type: ItemType.Weapon,
      stats,
      slot,
      rarity,
      upgradeLevel,
      maxUpgradeLevel,
      socketSlots,
      augments,
    };
  }

  if (definition.type === "armor") {
    const stats = new ArmorStatBlock();
    stats.reset();
    if (definition.stats) {
      stats.applyDelta(definition.stats as Partial<StatBlockData>);
    }
    scaleStatBlockValues(stats, totalMultiplier);
    stats.armor = Math.max(0, Math.round((definition.armor?.armor ?? 0) * totalMultiplier));
    applyAugmentBonuses(stats, augments, lookup);

    return {
      id: definition.id,
      name: definition.name,
      description: "",
      stackSize: 0,
      type: ItemType.Armor,
      stats,
      slot,
      rarity,
      upgradeLevel,
      maxUpgradeLevel,
      socketSlots,
      augments,
    };
  }

  return null;
}

export function createOwnedEquipmentInstance(
  definition: ItemDefinition,
  rarity: ItemRarity = "common"
): OwnedEquipment {
  const instanceId = `${definition.id}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
  const maxUpgradeLevel = Math.max(
    0,
    definition.upgrades ? definition.upgrades.length : definition.maxUpgradeLevel ?? 0
  );
  const socketSlots = Math.max(0, definition.socketSlots ?? 0);

  return {
    instanceId,
    itemId: definition.id,
    rarity,
    upgradeLevel: 0,
    maxUpgradeLevel,
    socketSlots,
    augments: [],
  };
}

export function getUpgradeCost(
  definition: ItemDefinition | undefined,
  owned: OwnedEquipment
): Record<string, number> | null {
  if (!definition || (definition.type !== "weapon" && definition.type !== "armor")) {
    return null;
  }
  if (owned.upgradeLevel >= owned.maxUpgradeLevel) {
    return null;
  }
  if (definition.upgrades && definition.upgrades.length) {
    const tierIndex = Math.min(owned.upgradeLevel, definition.upgrades.length - 1);
    const tier = definition.upgrades[tierIndex];
    if (!tier?.materials) {
      return null;
    }
    const normalized = Object.entries(tier.materials).reduce<Record<string, number>>(
      (acc, [id, amount]) => {
        const value = Math.max(1, Math.floor(Number(amount) || 0));
        if (value > 0) {
          acc[id] = value;
        }
        return acc;
      },
      {}
    );
    return Object.keys(normalized).length ? normalized : null;
  }

  const materialId = definition.type === "weapon" ? "weapon-essence" : "armor-essence";
  const base = definition.type === "weapon" ? 2 : 2;
  const scale = definition.type === "weapon" ? 2 : 3;
  const amount = base + owned.upgradeLevel * scale;
  return { [materialId]: amount };
}

export function getSalvageResult(
  definition: ItemDefinition | undefined,
  owned: OwnedEquipment
): SalvageResult | null {
  if (!definition || (definition.type !== "weapon" && definition.type !== "armor")) {
    return null;
  }
  const materialId = definition.type === "weapon" ? "weapon-essence" : "armor-essence";
  const base = SALVAGE_VALUE_BY_RARITY[owned.rarity] ?? 1;
  const bonus = owned.upgradeLevel;
  const amount = Math.max(1, base + bonus);
  return { materialId, amount };
}

export class ItemLibrary {
  private definitions = new Map<string, ItemDefinition>();

  setDefinitions(defs: ItemDefinition[]) {
    this.definitions.clear();
    defs.forEach((def) => {
      this.definitions.set(def.id, cloneDefinition(def));
    });
  }

  listDefinitions(): ItemDefinition[] {
    return Array.from(this.definitions.values()).map((def) => cloneDefinition(def));
  }

  getDefinition(id: string): ItemDefinition | undefined {
    const def = this.definitions.get(id);
    return def ? cloneDefinition(def) : undefined;
  }

  getDefinitionInternal(id: string): ItemDefinition | undefined {
    return this.definitions.get(id);
  }

  createOwnedInstance(itemId: string, rarity: ItemRarity = "common"): OwnedEquipment | null {
    const definition = this.definitions.get(itemId);
    if (!definition) {
      return null;
    }
    return createOwnedEquipmentInstance(definition, rarity);
  }

  createEquipmentForOwned(owned: OwnedEquipment): EquipmentItem | null {
    const definition = this.definitions.get(owned.itemId);
    if (!definition) {
      return null;
    }
    return createEquipmentFromDefinition(definition, owned, (id) => this.definitions.get(id));
  }
}
