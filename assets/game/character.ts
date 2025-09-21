import { EquipmentSlot, getItemsAllowed } from "./constants";
import { EquipmentItem } from "./item";
import {
  DerivedStats,
  DerivedStatsBlock,
  DerivedStatsBlockData,
  StatBlock,
  StatBlockData,
  WeaponStatBlock,
} from "./stat";

export class CharacterData {
  public baseStats: StatBlockData;
  public derivedStats: DerivedStatsBlockData;
}

export class Character {
  protected _level: number;
  protected _experience: number;

  protected _baseStats: StatBlock;
  protected _derivedStatsBlock: DerivedStatsBlock;

  protected _itemBonuses: StatBlock = new StatBlock();
  protected _buffBonuses: StatBlock = new StatBlock();

  protected _equipment: EquipmentItem[] = [];
  protected _derivedStats: DerivedStats;

  protected _curHealth: number = 1;
  public get health(): number {
    return this._curHealth;
  }

  protected _maxHealth: number = 1;
  public get maxHealth(): number {
    return this._maxHealth;
  }

  protected _curMana: number = 1;
  public get mana(): number {
    return this._curMana;
  }

  protected _maxMana: number = 1;
  public get maxMana(): number {
    return this._maxMana;
  }

  public get isAlive(): boolean {
    return this._curHealth > 0;
  }

  public resetVitals() {
    this._curHealth = this._maxHealth;
    this._curMana = this._maxMana;
  }

  public get defense(): number {
    return (
      this._baseStats.defense +
      this._itemBonuses.defense +
      this._buffBonuses.defense
    );
  }

  public get strength(): number {
    return (
      this._baseStats.strength +
      this._itemBonuses.strength +
      this._buffBonuses.strength
    );
  }

  public get agility(): number {
    return (
      this._baseStats.agility +
      this._itemBonuses.agility +
      this._buffBonuses.agility
    );
  }

  public get dexterity(): number {
    return (
      this._baseStats.dexterity +
      this._itemBonuses.dexterity +
      this._buffBonuses.dexterity
    );
  }

  public get stamina(): number {
    return (
      this._baseStats.stamina +
      this._itemBonuses.stamina +
      this._buffBonuses.stamina
    );
  }

  public get wisdom(): number {
    return (
      this._baseStats.wisdom +
      this._itemBonuses.wisdom +
      this._buffBonuses.wisdom
    );
  }

  public get intelligence(): number {
    return (
      this._baseStats.intelligence +
      this._itemBonuses.intelligence +
      this._buffBonuses.intelligence
    );
  }

  public get charisma(): number {
    return (
      this._baseStats.charisma +
      this._itemBonuses.charisma +
      this._buffBonuses.charisma
    );
  }

  public get attackPower(): number {
    return this._derivedStats.attackPower;
  }
  public get armor(): number {
    return this._derivedStats.armor;
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
  public get dodgePercent(): number {
    return this._derivedStats.dodgePercent;
  }
  public get parryPercent(): number {
    return this._derivedStats.parryPercent;
  }
  public get attackDelay(): number {
    return this._derivedStats.attackDelay;
  }

  constructor(charData: CharacterData) {
    this._level = 1;
    this._experience = 0;
    this._baseStats = new StatBlock();
    this._baseStats.initialize(charData.baseStats);
    this._derivedStatsBlock = new DerivedStatsBlock();
    this._derivedStatsBlock.initialize(charData.derivedStats);

    this._derivedStats = new DerivedStats();
    this.updateStats();
  }

  public getDamage(mh: boolean, min: boolean): number {
    if (mh) {
      const weapon = this._equipment.find(
        (e) => e.slot == EquipmentSlot.MainHand
      );
      if (weapon) {
        return min
          ? (weapon.stats as WeaponStatBlock).minDamage
          : (weapon.stats as WeaponStatBlock).maxDamage;
      }
    } else {
      const weapon = this._equipment.find(
        (e) => e.slot == EquipmentSlot.OffHand
      );
      if (weapon) {
        return min
          ? (weapon.stats as WeaponStatBlock).minDamage
          : (weapon.stats as WeaponStatBlock).maxDamage;
      }
    }
    return min ? 1 : 2;
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

    this._derivedStats.accuracy = this._derivedStatsBlock.getAccuracy(
      this.strength
    );
    this._derivedStats.attackPower = this._derivedStatsBlock.getAttack(
      this.strength
    );
    this._derivedStats.evasion = this._derivedStatsBlock.getEvasion(
      this.agility
    );
    this._derivedStats.armor = this._derivedStatsBlock.getArmor(this.defense);
    this._derivedStats.critPercent = this._derivedStatsBlock.getCritPercent(
      this.dexterity
    );
    this._derivedStats.dodgePercent = this._derivedStatsBlock.getDodgePercent(
      this.agility
    );
    this._derivedStats.parryPercent = this._derivedStatsBlock.getParryPercent(
      this.dexterity
    );
    this._derivedStats.attackDelay = this._derivedStatsBlock.getAttackDelay(
      this.agility
    );

    let pct = this.health / this.maxHealth;
    const max = this._derivedStatsBlock.getHitpoints(this.stamina);
    this._maxHealth = max;
    this._curHealth = max * pct;

    pct = this.mana / this.maxMana;
    this._maxMana = this._derivedStatsBlock.getManaPoints(
      Math.max(this.intelligence, this.wisdom)
    );
    this._curMana = this._maxMana * pct;

    // event
  }

  applyDamage(amount: number) {
    const dmg = Math.abs(amount);
    this._curHealth = Math.max(0, this._curHealth - dmg);
    // event
  }

  public getAttackDelaySeconds(): number {
    const weapon = this._equipment.find(
      (e) => e.slot == EquipmentSlot.MainHand
    );
    if (weapon) {
      const stats = weapon.stats as WeaponStatBlock;
      if (stats && typeof stats.delay === "number" && stats.delay > 0) {
        return stats.delay;
      }
    }
    return this.attackDelay;
  }
}
