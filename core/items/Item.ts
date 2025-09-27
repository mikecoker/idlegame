import { EquipmentSlot, ItemType } from "./constants";
import { ArmorStatBlock, StatBlock, WeaponStatBlock } from "../stats/StatBlock";

export type ItemRarity = "common" | "uncommon" | "rare" | "epic" | "legendary";

export class Item {
  public id: string;
  public type: ItemType;
  public name: string;
  public description: string;
  public stackSize: number = 0; // 0 non-stacking, 1+ stack limit
}

export class EquipmentItem extends Item {
  public stats: StatBlock;
  public slot: EquipmentSlot;
  public rarity: ItemRarity = "common";
  public upgradeLevel = 0;
  public maxUpgradeLevel = 0;
  public socketSlots = 0;
  public augments: string[] = [];
}

export interface EquipmentUpgradeTier {
  level: number;
  materials: Record<string, number>;
}
export class WeaponItem extends EquipmentItem {
  public weaponStats: WeaponStatBlock;
}

export class ArmorItem extends EquipmentItem {
  public armorStats: ArmorStatBlock;
}

export class ItemInstance {
  public item: Item;
  public count: number;
}
