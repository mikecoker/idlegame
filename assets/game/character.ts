export class StatBlock {
  public strength: number; // small atk, avg hit, skillups
  public agility: number; // avoidance, skillups
  public dexterity: number; // crits, skillups
  public stamina: number; // hps
  public intelligence: number; // mana pool int casters, fizzle chance
  public wisdom: number; // mana pool wis casters, fizzle
  public charisma: number; // merchant prices, charms, enc/bard skills
}

export class Character {
  protected _level: number;
  protected _experience: number;

  protected _baseStats: StatBlock;
  protected _derivedStats: DerivedStats;
  protected _itemBonuses: StatBlock;
  protected _buffBonuses: StatBlock;

  public health: number;
  public mana: number;

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

  constructor(basestats: StatBlock, derived: DerivedStats) {
    this._level = 1;
    this._experience = 0;
    this._baseStats = basestats;
    this._derivedStats = derived;
  }

  applyDamage(amount: number) {}
}

export class DerivedStats {
  public baseHitpoints: number = 10;
  public baseMana: number = 10;
  public atkPerStrength: number = 2;
  public hitPerStrength: number = 2;
  public avoidPerAgility: number = 2;
  public critPerDexterity: number = 2;
  public hpPerStamina: number = 4;
  public manaPerIntelligence: number = 4;
  public manaPerWisdom: number = 4;
}

export class WeaponStatBlock {
  public damage: number;
  public delay: number;
}

export class ArmorStatBlock {
  public armor: number;
}

export class Item {
  public stats: StatBlock;
  public stackSize: number = 0; // 0 non-stacking, 1+ stack limit
}

export class WeaponItem extends Item {
  public weaponStats: WeaponStatBlock;
}

export class ArmorItem extends Item {
  public armorStats: ArmorStatBlock;
}

export class ItemInstance {
  public item: Item;
  public type: number;
  public count: number;
}
