import { getItemsAllowed } from "./constants";
import { EquipmentItem } from "./item";
import { DerivedStats, DerivedStatsBlock, StatBlock } from "./stat";

export class CharacterData {
  public baseStats: StatBlock;
  public derivedStats: DerivedStatsBlock;
}

export class Character {
  protected _level: number;
  protected _experience: number;

  protected _charData: CharacterData;

  protected _itemBonuses: StatBlock;
  protected _buffBonuses: StatBlock;

  protected _equipment: EquipmentItem[] = [];
  protected _derivedStats: DerivedStats;

  protected _curHealth: number = 0;
  public get health(): number {
    return this._curHealth;
  }

  protected _maxHealth: number = 1;
  public get maxHealth(): number {
    return this._maxHealth;
  }

  protected _curMana: number = 0;
  public get mana(): number {
    return this._curMana;
  }

  protected _maxMana: number = 1;
  public get maxMana(): number {
    return this._maxMana;
  }

  public get armor(): number {
    return this._itemBonuses.armor + this._buffBonuses.armor;
  }

  public get strength(): number {
    return (
      this._charData.baseStats.strength +
      this._itemBonuses.strength +
      this._buffBonuses.strength
    );
  }

  public get agility(): number {
    return (
      this._charData.baseStats.agility +
      this._itemBonuses.agility +
      this._buffBonuses.agility
    );
  }

  public get dexterity(): number {
    return (
      this._charData.baseStats.dexterity +
      this._itemBonuses.dexterity +
      this._buffBonuses.dexterity
    );
  }

  public get stamina(): number {
    return (
      this._charData.baseStats.stamina +
      this._itemBonuses.stamina +
      this._buffBonuses.stamina
    );
  }

  public get wisdom(): number {
    return (
      this._charData.baseStats.wisdom +
      this._itemBonuses.wisdom +
      this._buffBonuses.wisdom
    );
  }

  public get intelligence(): number {
    return (
      this._charData.baseStats.intelligence +
      this._itemBonuses.intelligence +
      this._buffBonuses.intelligence
    );
  }

  public get charisma(): number {
    return (
      this._charData.baseStats.charisma +
      this._itemBonuses.charisma +
      this._buffBonuses.charisma
    );
  }

  public get attackPower(): number {
    return this._derivedStats.attackPower;
  }
  public get defense(): number {
    return this._derivedStats.defense;
  }
  public get accuracy(): number {
    return this._derivedStats.accuracy;
  }
  public get evasion(): number {
    return this._derivedStats.evasion;
  }
  public get critPercent(): number {
    return this._derivedStats.critPercent;
  }

  constructor(charData: CharacterData) {
    this._level = 1;
    this._experience = 0;
    this._charData = charData;
    this._derivedStats = new DerivedStats();
  }

  // this is the stupid version
  public equipItem(equipment: EquipmentItem): EquipmentItem {
    const count = getItemsAllowed(equipment.slot);
    if (count == 1) {
      const exist = this._equipment.find((e) => e.slot == equipment.slot);
      if (exist) {
        this._equipment = this._equipment.filter((e) => e != exist);
      }
      this._equipment.push(equipment);
      this.updateStats();
      return exist;
    }

    // more than 1 to equip
    const found = [];
    this._equipment.forEach((v) => {
      if (v.slot == equipment.slot) {
        found.push(v);
      }
    });

    // if we have an open slot, just equip and bail
    if (found.length < count) {
      this._equipment.push(equipment);
      this.updateStats();
      return null;
    }

    // else unequip the first thing found
    this._equipment = this._equipment.filter((e) => e != found[0]);
    this._equipment.push(equipment);
    this.updateStats();
    return found[0];
  }

  protected updateItemStats() {
    this._itemBonuses.reset();
    this._equipment.forEach((e) => {
      this._itemBonuses.add(e.stats);
    });
  }

  updateStats() {
    this.updateItemStats();

    this._derivedStats.accuracy = this._charData.derivedStats.getAccuracy(
      this.strength
    );
    this._derivedStats.attackPower = this._charData.derivedStats.getAttack(
      this.strength
    );
    this._derivedStats.evasion = this._charData.derivedStats.getEvasion(
      this.agility
    );
    this._derivedStats.defense = this._charData.derivedStats.getDefense(
      this.armor
    );
    this._derivedStats.critPercent = this._charData.derivedStats.getCritPercent(
      this.dexterity
    );
  }

  applyDamage(amount: number) {}
}
