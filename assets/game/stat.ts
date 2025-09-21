export class StatBlockData {
  public strength: number; // small atk, avg hit, skillups
  public agility: number; // avoidance, skillups
  public dexterity: number; // crits, skillups
  public stamina: number; // hps
  public intelligence: number; // mana pool int casters, fizzle chance
  public wisdom: number; // mana pool wis casters, fizzle
  public charisma: number; // merchant prices, charms, enc/bard skills
  public defense: number;
}

export class StatBlock extends StatBlockData {
  constructor() {
    super();
    this.reset();
  }

  initialize(block: StatBlockData) {
    this.strength = block.strength;
    this.agility = block.agility;
    this.dexterity = block.dexterity;
    this.stamina = block.stamina;
    this.intelligence = block.intelligence;
    this.wisdom = block.wisdom;
    this.charisma = block.charisma;
    this.defense = block.defense;
  }

  public reset() {
    this.strength =
      this.agility =
      this.dexterity =
      this.stamina =
      this.intelligence =
      this.wisdom =
      this.charisma =
      this.defense =
        0;
  }

  public add(e: StatBlock) {
    this.agility += e.agility;
    this.defense += e.defense;
    this.charisma += e.charisma;
    this.dexterity += e.dexterity;
    this.intelligence += e.intelligence;
    this.stamina += e.stamina;
    this.strength += e.strength;
    this.wisdom += e.wisdom;
  }

  public remove(e: StatBlock) {
    this.agility -= e.agility;
    this.defense -= e.defense;
    this.charisma -= e.charisma;
    this.dexterity -= e.dexterity;
    this.intelligence -= e.intelligence;
    this.stamina -= e.stamina;
    this.strength -= e.strength;
    this.wisdom -= e.wisdom;
  }
}

export class DerivedStats {
  public attackPower = 10;
  public armor = 10;
  public accuracy = 10;
  public evasion = 10;
  public critPercent = 0.1;
  public dodgePercent = 0;
  public parryPercent = 0;
  public attackDelay = 2;
}

const cMaxCrit = 75;
const cMaxDodge = 45;
const cMaxParry = 35;

export class DerivedStatsBlockData {
  public baseHitpoints: number = 10;
  public baseMana: number = 10;
  public attackPerStr: number = 5;
  public accPerStr: number = 2;
  public evaPerAgi: number = 2;
  public dexPerCrit: number = 5;
  public acPerDef: number = 10;
  public hpPerStamina: number = 4;
  public manaPerIntOrWis: number = 4;
  public baseDodge: number = 5;
  public dodgePerAgi: number = 0.2;
  public baseParry: number = 2;
  public parryPerDex: number = 0.1;
  public baseAttackDelay: number = 2;
  public minAttackDelay: number = 0.6;
  public attackDelayReductionPerAgi: number = 0;
}

export class DerivedStatsBlock extends DerivedStatsBlockData {
  initialize(block: DerivedStatsBlockData) {
    this.baseHitpoints = block.baseHitpoints;
    this.baseMana = block.baseMana;
    this.attackPerStr = block.attackPerStr;
    this.accPerStr = block.accPerStr;
    this.evaPerAgi = block.evaPerAgi;
    this.dexPerCrit = block.dexPerCrit;
    this.acPerDef = block.acPerDef;
    this.hpPerStamina = block.hpPerStamina;
    this.manaPerIntOrWis = block.manaPerIntOrWis;
    this.baseDodge = block.baseDodge ?? this.baseDodge;
    this.dodgePerAgi = block.dodgePerAgi ?? this.dodgePerAgi;
    this.baseParry = block.baseParry ?? this.baseParry;
    this.parryPerDex = block.parryPerDex ?? this.parryPerDex;
    this.baseAttackDelay = block.baseAttackDelay ?? this.baseAttackDelay;
    this.minAttackDelay = block.minAttackDelay ?? this.minAttackDelay;
    this.attackDelayReductionPerAgi =
      block.attackDelayReductionPerAgi ?? this.attackDelayReductionPerAgi;
  }

  public getHitpoints(sta: number): number {
    return this.baseHitpoints + Math.floor(sta * this.hpPerStamina);
  }

  public getManaPoints(intOrWis: number): number {
    return this.baseMana + Math.floor(intOrWis * this.manaPerIntOrWis);
  }

  public getAttack(str: number): number {
    return Math.floor(str * this.attackPerStr);
  }

  public getAccuracy(str: number): number {
    return Math.floor(str * this.accPerStr);
  }

  public getEvasion(agi: number): number {
    return Math.floor(agi * this.evaPerAgi);
  }

  public getArmor(def: number): number {
    return Math.floor(def * this.acPerDef);
  }

  public getCritPercent(dex: number): number {
    return Math.min(cMaxCrit, Math.floor(dex * this.dexPerCrit)) / 100.0;
  }

  public getDodgePercent(agi: number): number {
    return (
      Math.min(cMaxDodge, this.baseDodge + agi * this.dodgePerAgi) / 100.0
    );
  }

  public getParryPercent(dex: number): number {
    return (
      Math.min(cMaxParry, this.baseParry + dex * this.parryPerDex) / 100.0
    );
  }

  public getAttackDelay(agi: number): number {
    const reduced =
      this.baseAttackDelay - agi * this.attackDelayReductionPerAgi;
    return Math.max(this.minAttackDelay, reduced);
  }
}

export class WeaponStatBlock extends StatBlock {
  public minDamage: number;
  public maxDamage: number;
  public delay: number;
}

export class ArmorStatBlock extends StatBlock {
  public armor: number;
}
