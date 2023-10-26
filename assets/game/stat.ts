export class StatBlock {
  public strength: number; // small atk, avg hit, skillups
  public agility: number; // avoidance, skillups
  public dexterity: number; // crits, skillups
  public stamina: number; // hps
  public intelligence: number; // mana pool int casters, fizzle chance
  public wisdom: number; // mana pool wis casters, fizzle
  public charisma: number; // merchant prices, charms, enc/bard skills
  public armor: number;

  public reset() {
    this.strength =
      this.agility =
      this.dexterity =
      this.stamina =
      this.intelligence =
      this.wisdom =
      this.charisma =
      this.armor =
        0;
  }

  public add(e: StatBlock) {
    this.agility += e.agility;
    this.armor += e.armor;
    this.charisma += e.charisma;
    this.dexterity += e.dexterity;
    this.intelligence += e.intelligence;
    this.stamina += e.stamina;
    this.strength += e.strength;
    this.wisdom += e.wisdom;
  }

  public remove(e: StatBlock) {
    this.agility -= e.agility;
    this.armor -= e.armor;
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
  public defense = 10;
  public accuracy = 10;
  public evasion = 10;
  public critPercent = 0.1;
}

const cMaxCrit = 75;

export class DerivedStatsBlock {
  public baseHitpoints: number = 10;
  public baseMana: number = 10;
  public attackPerStr: number = 5;
  public accPerStr: number = 2;
  public evaPerAgi: number = 2;
  public dexPerCrit: number = 5;
  public acPerDef: number = 10;
  public hpPerStamina: number = 4;
  public manaPerIntOrWis: number = 4;

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

  public getDefense(ac: number): number {
    return Math.floor(ac / this.acPerDef);
  }

  public getCritPercent(dex: number): number {
    return Math.min(cMaxCrit, Math.floor(dex / this.dexPerCrit)) / 100.0;
  }
}

export class WeaponStatBlock {
  public damage: number;
  public delay: number;
}

export class ArmorStatBlock {
  public armor: number;
}
