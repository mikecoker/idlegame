import { EquipmentSlot, ItemType } from "./constants";
import { ArmorStatBlock, StatBlock, WeaponStatBlock } from "./stat";

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
