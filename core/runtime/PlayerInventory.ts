import {
  EncounterRewards,
  RewardAugmentItem,
  RewardEquipmentItem,
} from "../combat/Encounter";
import { ItemRarity } from "../items/Item";
import {
  CraftingRecipe,
  CraftingRecipeType,
  ItemDefinition,
  ItemLibrary,
  OwnedEquipment,
  SalvageResult,
  cloneOwnedEquipment,
  createEquipmentFromDefinition,
  getRarityMultiplier,
  getSalvageResult,
  getUpgradeCost,
} from "../items/ItemDefinition";

export interface InventorySnapshot {
  equipped: Record<string, OwnedEquipment | null>;
  inventory: OwnedEquipment[];
  materials: Record<string, number>;
  consumables: Record<string, number>;
}

export interface InventoryMutationResult {
  success: boolean;
  messages?: string[];
  heroNeedsRefresh?: boolean;
  inventoryChanged?: boolean;
  materialsChanged?: boolean;
  consumablesChanged?: boolean;
  resetEncounter?: boolean;
}

export interface ConsumableEffect {
  kind: "heal";
  percent: number;
}

export interface ConsumableUseResult {
  success: boolean;
  messages?: string[];
  effect?: ConsumableEffect;
  consumablesChanged?: boolean;
}

const DEFAULT_SLOTS = ["MainHand", "OffHand", "Head", "Chest"];

function cloneMaterials(map: Record<string, number>): Record<string, number> {
  const clone: Record<string, number> = {};
  Object.entries(map).forEach(([id, qty]) => {
    clone[id] = qty;
  });
  return clone;
}

function normalizeCost(cost: Record<string, number>): Record<string, number> {
  const normalized: Record<string, number> = {};
  Object.entries(cost ?? {}).forEach(([id, amount]) => {
    const value = Math.max(1, Math.floor(Number(amount) || 0));
    if (value > 0) {
      normalized[id] = value;
    }
  });
  return normalized;
}

function ensureMessages(result: InventoryMutationResult | ConsumableUseResult) {
  if (!result.messages) {
    result.messages = [];
  }
}

export class PlayerInventory {
  protected equipped: Record<string, OwnedEquipment | null> = {};
  protected inventory: OwnedEquipment[] = [];
  protected materials: Record<string, number> = {};
  protected consumables: Record<string, number> = {};

  constructor(private readonly items: ItemLibrary) {
    this.reset();
  }

  reset() {
    this.equipped = {};
    DEFAULT_SLOTS.forEach((slot) => {
      this.equipped[slot] = null;
    });
    this.inventory = [];
    this.materials = {};
    this.consumables = {};
  }

  setSnapshot(snapshot?: InventorySnapshot | null) {
    if (!snapshot) {
      this.reset();
      return;
    }

    this.equipped = {};
    DEFAULT_SLOTS.forEach((slot) => {
      this.equipped[slot] = null;
    });
    Object.entries(snapshot.equipped ?? {}).forEach(([slot, owned]) => {
      this.equipped[slot] = owned ? cloneOwnedEquipment(owned) : null;
    });

    this.inventory = (snapshot.inventory ?? []).map((item) => cloneOwnedEquipment(item));
    this.materials = cloneMaterials(snapshot.materials ?? {});
    this.consumables = cloneMaterials(snapshot.consumables ?? {});
  }

  getSnapshot(): InventorySnapshot {
    const equipped: Record<string, OwnedEquipment | null> = {};
    const keys = new Set([...DEFAULT_SLOTS, ...Object.keys(this.equipped)]);
    keys.forEach((slot) => {
      const owned = this.equipped[slot] ?? null;
      equipped[slot] = owned ? cloneOwnedEquipment(owned) : null;
    });
    return {
      equipped,
      inventory: this.inventory.map((item) => cloneOwnedEquipment(item)),
      materials: cloneMaterials(this.materials),
      consumables: cloneMaterials(this.consumables),
    };
  }

  getEquippedEntries(): Array<[string, OwnedEquipment]> {
    return Object.entries(this.equipped)
      .filter(([, value]) => !!value)
      .map(([slot, value]) => [slot, value!] as [string, OwnedEquipment]);
  }

  getOwnedEquipment(instanceId: string): OwnedEquipment | null {
    const inventoryItem = this.inventory.find((item) => item.instanceId === instanceId);
    if (inventoryItem) {
      return inventoryItem;
    }
    for (const [slot, owned] of Object.entries(this.equipped)) {
      if (owned && owned.instanceId === instanceId) {
        return owned;
      }
    }
    return null;
  }

  findEquippedSlot(instanceId: string): string | null {
    for (const [slot, owned] of Object.entries(this.equipped)) {
      if (owned && owned.instanceId === instanceId) {
        return slot;
      }
    }
    return null;
  }

  getMaterials(): Record<string, number> {
    return cloneMaterials(this.materials);
  }

  setMaterials(materials: Record<string, number>) {
    this.materials = cloneMaterials(materials ?? {});
  }

  getConsumables(): Record<string, number> {
    return cloneMaterials(this.consumables);
  }

  setConsumables(consumables: Record<string, number>) {
    this.consumables = cloneMaterials(consumables ?? {});
  }

  setInventory(items: OwnedEquipment[]) {
    this.inventory = items.map((item) => cloneOwnedEquipment(item));
  }

  setEquipped(equipped: Record<string, OwnedEquipment | null>) {
    this.equipped = {};
    DEFAULT_SLOTS.forEach((slot) => {
      this.equipped[slot] = null;
    });
    Object.entries(equipped).forEach(([slot, owned]) => {
      this.equipped[slot] = owned ? cloneOwnedEquipment(owned) : null;
    });
  }

  equipFromInventory(instanceId: string): InventoryMutationResult {
    const result: InventoryMutationResult = { success: false };
    ensureMessages(result);

    const index = this.inventory.findIndex((item) => item.instanceId === instanceId);
    if (index === -1) {
      result.messages!.push("Item not found in inventory.");
      return result;
    }

    const owned = this.inventory[index];
    const definition = this.items.getDefinitionInternal(owned.itemId);
    if (!definition?.slot) {
      result.messages!.push(`Cannot equip ${owned.itemId}.`);
      return result;
    }

    const slotName = definition.slot;
    const previous = this.equipped[slotName] ?? null;

    this.inventory.splice(index, 1);
    this.equipped[slotName] = owned;
    if (previous) {
      this.inventory.push(previous);
    }

    result.success = true;
    result.heroNeedsRefresh = true;
    result.inventoryChanged = true;
    result.resetEncounter = true;
    const rarity = owned.rarity ?? "common";
    result.messages!.push(
      `${definition.name ?? owned.itemId} (${rarity}) equipped to ${slotName}.`
    );
    return result;
  }

  unequipSlot(slot: string): InventoryMutationResult {
    const result: InventoryMutationResult = { success: false };
    ensureMessages(result);

    const owned = this.equipped[slot] ?? null;
    if (!owned) {
      result.messages!.push(`No item equipped in ${slot}.`);
      return result;
    }

    this.equipped[slot] = null;
    this.inventory.push(cloneOwnedEquipment(owned));

    result.success = true;
    result.heroNeedsRefresh = true;
    result.inventoryChanged = true;
    result.resetEncounter = true;
    result.messages!.push(`${owned.itemId} unequipped from ${slot}.`);
    return result;
  }

  equipFirstMatching(itemId: string): InventoryMutationResult {
    const owned = this.inventory.find((item) => item.itemId === itemId);
    if (!owned) {
      return {
        success: false,
        messages: [`${itemId} not found in inventory.`],
      };
    }
    return this.equipFromInventory(owned.instanceId);
  }

  upgradeEquipment(instanceId: string): InventoryMutationResult {
    const result: InventoryMutationResult = { success: false };
    ensureMessages(result);

    const owned = this.getOwnedEquipment(instanceId);
    if (!owned) {
      result.messages!.push("Item not found.");
      return result;
    }

    const definition = this.items.getDefinitionInternal(owned.itemId);
    const cost = getUpgradeCost(definition, owned);
    if (!definition || !cost) {
      result.messages!.push(`${owned.itemId} cannot be upgraded further.`);
      return result;
    }

    if (!this.hasMaterials(cost)) {
      const parts = Object.entries(cost)
        .map(([id, amount]) => `${id} x${amount}`)
        .join(", ");
      result.messages!.push(`Need ${parts}.`);
      return result;
    }

    this.consumeMaterials(cost);
    owned.upgradeLevel = Math.min(owned.maxUpgradeLevel, owned.upgradeLevel + 1);

    const slot = this.findEquippedSlot(instanceId);
    result.success = true;
    result.heroNeedsRefresh = !!slot;
    result.materialsChanged = true;
    result.resetEncounter = !!slot;

    const parts = Object.entries(cost)
      .map(([id, amount]) => `${id} x${amount}`)
      .join(", ");
    result.messages!.push(
      `${definition.name ?? owned.itemId} upgraded to +${owned.upgradeLevel} (spent ${parts}).`
    );

    return result;
  }

  salvageEquipment(instanceId: string): InventoryMutationResult {
    const result: InventoryMutationResult = { success: false };
    ensureMessages(result);

    const index = this.inventory.findIndex((item) => item.instanceId === instanceId);
    if (index === -1) {
      result.messages!.push("Item must be unequipped before salvaging.");
      return result;
    }

    const owned = this.inventory[index];
    const definition = this.items.getDefinitionInternal(owned.itemId);
    const salvage = getSalvageResult(definition, owned);
    if (!salvage) {
      result.messages!.push(`${owned.itemId} cannot be salvaged.`);
      return result;
    }

    this.inventory.splice(index, 1);
    this.addMaterials({ [salvage.materialId]: salvage.amount });

    result.success = true;
    result.inventoryChanged = true;
    result.materialsChanged = true;
    result.messages!.push(
      `${definition?.name ?? owned.itemId} salvaged for ${salvage.materialId} x${salvage.amount}.`
    );

    return result;
  }

  socketEquipment(instanceId: string, augmentId: string): InventoryMutationResult {
    const result: InventoryMutationResult = { success: false };
    ensureMessages(result);

    const owned = this.getOwnedEquipment(instanceId);
    if (!owned) {
      result.messages!.push("Item not found.");
      return result;
    }

    if (owned.socketSlots <= 0) {
      result.messages!.push("This item has no sockets.");
      return result;
    }

    if (owned.augments.length >= owned.socketSlots) {
      result.messages!.push("All sockets are filled.");
      return result;
    }

    if ((this.consumables[augmentId] ?? 0) <= 0) {
      result.messages!.push(`${augmentId} not available.`);
      return result;
    }

    const augmentDefinition = this.items.getDefinitionInternal(augmentId);
    if (!augmentDefinition || augmentDefinition.type !== "augment") {
      result.messages!.push(`${augmentId} is not a valid augment.`);
      return result;
    }

    this.consumables[augmentId] = Math.max(0, (this.consumables[augmentId] ?? 0) - 1);
    owned.augments.push(augmentId);

    const slot = this.findEquippedSlot(instanceId);
    result.success = true;
    result.heroNeedsRefresh = !!slot;
    result.resetEncounter = !!slot;
    result.consumablesChanged = true;
    result.messages!.push(
      `${augmentDefinition.name ?? augmentId} socketed into ${owned.itemId}.`
    );

    return result;
  }

  useConsumable(consumableId: string): ConsumableUseResult {
    const result: ConsumableUseResult = { success: false };
    ensureMessages(result);

    if ((this.consumables[consumableId] ?? 0) <= 0) {
      result.messages!.push(`${consumableId} not available.`);
      return result;
    }

    const definition = this.items.getDefinitionInternal(consumableId);
    if (!definition?.effect || definition.effect.kind !== "heal") {
      result.messages!.push(`${consumableId} cannot be used.`);
      return result;
    }

    this.consumables[consumableId] = Math.max(0, (this.consumables[consumableId] ?? 0) - 1);
    result.success = true;
    result.consumablesChanged = true;
    result.effect = {
      kind: "heal",
      percent: Math.max(0, definition.effect.percent ?? 0.5),
    };
    result.messages!.push(
      `${definition.name ?? consumableId} used (+${Math.round((result.effect.percent ?? 0.5) * 100)}% HP).`
    );

    return result;
  }

  grantRewards(rewards: EncounterRewards): InventoryMutationResult {
    const result: InventoryMutationResult = { success: true };
    ensureMessages(result);

    if (rewards.materials) {
      this.addMaterials(rewards.materials);
      if (Object.keys(rewards.materials).length) {
        result.materialsChanged = true;
      }
    }

    if (rewards.equipment?.length) {
      rewards.equipment.forEach((entry) => {
        this.createOwnedEquipment(entry);
      });
      result.inventoryChanged = true;
      const list = this.formatEquipmentList(rewards.equipment);
      result.messages!.push(`Equipment acquired: ${list}.`);
    }

    if (rewards.augments?.length) {
      rewards.augments.forEach((entry) => {
        this.consumables[entry.augmentId] =
          (this.consumables[entry.augmentId] ?? 0) + Math.max(1, entry.quantity);
      });
      result.consumablesChanged = true;
      const list = rewards.augments
        .map((entry) => `${entry.augmentId} x${entry.quantity}`)
        .join(", ");
      result.messages!.push(`Augments acquired: ${list}.`);
    }

    return result;
  }

  craftRecipe(recipe: CraftingRecipe): InventoryMutationResult {
    switch (recipe.type as CraftingRecipeType) {
      case "equipment":
        return this.craftEquipmentRecipe(recipe);
      case "consumable":
        return this.craftConsumableRecipe(recipe);
      case "material":
        return this.craftMaterialRecipe(recipe);
      default:
        return {
          success: false,
          messages: [`Unknown recipe type '${recipe.type}'.`],
        };
    }
  }

  getUpgradeCostForInstance(instanceId: string): Record<string, number> | null {
    const owned = this.getOwnedEquipment(instanceId);
    if (!owned) {
      return null;
    }
    const definition = this.items.getDefinitionInternal(owned.itemId);
    return getUpgradeCost(definition, owned);
  }

  getSalvageResultForInstance(instanceId: string): SalvageResult | null {
    const owned = this.getOwnedEquipment(instanceId);
    if (!owned) {
      return null;
    }
    const definition = this.items.getDefinitionInternal(owned.itemId);
    return getSalvageResult(definition, owned);
  }

  getAvailableAugments(): string[] {
    return Object.entries(this.consumables)
      .filter(([, qty]) => qty > 0)
      .map(([id]) => id)
      .filter((id) => this.items.getDefinitionInternal(id)?.type === "augment");
  }

  protected craftEquipmentRecipe(recipe: CraftingRecipe): InventoryMutationResult {
    const result: InventoryMutationResult = { success: false };
    ensureMessages(result);

    const definition = this.items.getDefinitionInternal(recipe.result);
    if (!definition) {
      result.messages!.push(`Missing item definition for '${recipe.result}'.`);
      return result;
    }

    const cost = normalizeCost(recipe.cost ?? {});
    if (!this.hasMaterials(cost)) {
      const parts = Object.entries(cost)
        .map(([id, amount]) => `${id} x${amount}`)
        .join(", ");
      result.messages!.push(`Not enough materials (${parts}).`);
      return result;
    }

    const amount = Math.max(1, Math.floor(recipe.resultAmount ?? 1));
    this.consumeMaterials(cost);
    result.materialsChanged = Object.keys(cost).length > 0;

    const crafted: OwnedEquipment[] = [];
    for (let index = 0; index < amount; index += 1) {
      const owned = this.items.createOwnedInstance(definition.id, "common");
      if (owned) {
        this.inventory.push(owned);
        crafted.push(owned);
      }
    }

    result.success = crafted.length > 0;
    result.inventoryChanged = crafted.length > 0;
    if (crafted.length) {
      result.messages!.push(
        `Forged ${definition.name ?? definition.id} x${crafted.length}.`
      );
    }
    return result;
  }

  protected craftConsumableRecipe(recipe: CraftingRecipe): InventoryMutationResult {
    const result: InventoryMutationResult = { success: false };
    ensureMessages(result);

    const definition = this.items.getDefinitionInternal(recipe.result);
    if (!definition) {
      result.messages!.push(`Missing definition for '${recipe.result}'.`);
      return result;
    }

    const cost = normalizeCost(recipe.cost ?? {});
    if (!this.hasMaterials(cost)) {
      const parts = Object.entries(cost)
        .map(([id, amount]) => `${id} x${amount}`)
        .join(", ");
      result.messages!.push(`Not enough materials (${parts}).`);
      return result;
    }

    const amount = Math.max(1, Math.floor(recipe.resultAmount ?? 1));
    this.consumeMaterials(cost);
    this.consumables[recipe.result] = (this.consumables[recipe.result] ?? 0) + amount;

    result.success = true;
    result.materialsChanged = Object.keys(cost).length > 0;
    result.consumablesChanged = true;
    result.messages!.push(
      `Prepared ${definition.name ?? recipe.result} x${amount}.`
    );
    return result;
  }

  protected craftMaterialRecipe(recipe: CraftingRecipe): InventoryMutationResult {
    const result: InventoryMutationResult = { success: false };
    ensureMessages(result);

    const cost = normalizeCost(recipe.cost ?? {});
    if (!this.hasMaterials(cost)) {
      const parts = Object.entries(cost)
        .map(([id, amount]) => `${id} x${amount}`)
        .join(", ");
      result.messages!.push(`Not enough materials (${parts}).`);
      return result;
    }

    const amount = Math.max(1, Math.floor(recipe.resultAmount ?? 1));
    this.consumeMaterials(cost);
    this.materials[recipe.result] = (this.materials[recipe.result] ?? 0) + amount;

    result.success = true;
    result.materialsChanged = true;
    result.messages!.push(`Refined ${recipe.result} x${amount}.`);
    return result;
  }

  protected createOwnedEquipment(entry: RewardEquipmentItem) {
    const amount = Math.max(1, entry.quantity);
    for (let index = 0; index < amount; index += 1) {
      const owned = this.items.createOwnedInstance(entry.itemId, entry.rarity as ItemRarity);
      if (owned) {
        this.inventory.push(owned);
      }
    }
  }

  protected hasMaterials(cost: Record<string, number>): boolean {
    return Object.entries(cost).every(
      ([id, amount]) => (this.materials[id] ?? 0) >= Math.max(0, amount)
    );
  }

  protected consumeMaterials(cost: Record<string, number>) {
    Object.entries(cost).forEach(([id, amount]) => {
      this.materials[id] = Math.max(0, (this.materials[id] ?? 0) - Math.max(0, amount));
    });
  }

  protected addMaterials(materials: Record<string, number>) {
    Object.entries(materials).forEach(([id, amount]) => {
      if (!Number.isFinite(amount)) {
        return;
      }
      const normalized = Math.max(0, Math.floor(amount));
      if (normalized <= 0) {
        return;
      }
      this.materials[id] = (this.materials[id] ?? 0) + normalized;
    });
  }

  protected formatEquipmentList(list: RewardEquipmentItem[]): string {
    return list
      .map((entry) => `${entry.itemId} (${entry.rarity}) x${entry.quantity}`)
      .join(", ");
  }
}
