import { EquipmentSlot, getItemsAllowed } from "../items/constants";
import { EquipmentItem } from "../items/Item";
import {
  DerivedStats,
  DerivedStatsBlock,
  DerivedStatsBlockData,
  StatBlock,
  StatBlockData,
  WeaponStatBlock,
} from "../stats/StatBlock";

const STAT_KEYS: (keyof StatBlockData)[] = [
  "strength",
  "agility",
  "dexterity",
  "stamina",
  "intelligence",
  "wisdom",
  "charisma",
  "defense",
];

export interface ProgressionXpData {
  base: number;
  perLevel: number;
  exponent?: number;
}

export interface ProgressionData {
  initialLevel?: number;
  xp?: ProgressionXpData;
  statGrowth?: Partial<StatBlockData>;
}

interface ProgressionProfile {
  initialLevel: number;
  baseXp: number;
  perLevel: number;
  exponent: number;
  statGrowth: Partial<StatBlockData>;
}

export interface CharacterProgressSnapshot {
  level: number;
  experience: number;
  baseStats: StatBlockData;
  currentHealth: number;
  currentMana: number;
  maxHealth: number;
  maxMana: number;
}

export class CharacterData {
  public baseStats: StatBlockData;
  public derivedStats: DerivedStatsBlockData;
  public progression?: ProgressionData;
}

export class Character {
  protected _level: number;
  protected _experience: number;
  protected _experienceToNext: number;
  protected _progression: ProgressionProfile;

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

  public get level(): number {
    return this._level;
  }

  public get experience(): number {
    return this._experience;
  }

  public get experienceToNext(): number {
    return this._experienceToNext;
  }

  public get experienceProgress(): number {
    if (this._experienceToNext <= 0) {
      return 1;
    }
    return Math.min(1, this._experience / this._experienceToNext);
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

  protected getWeapon(slot: EquipmentSlot): EquipmentItem | undefined {
    return this._equipment.find((e) => e.slot === slot);
  }

  constructor(charData: CharacterData) {
    this._baseStats = new StatBlock();
    this._baseStats.initialize(charData.baseStats);
    this._derivedStatsBlock = new DerivedStatsBlock();
    this._derivedStatsBlock.initialize(charData.derivedStats);

    this._progression = this.createProgression(charData.progression);
    this._level = this._progression.initialLevel;
    this._experience = 0;

    if (this._level > 1) {
      for (let level = 2; level <= this._level; level++) {
        this.applyStatGrowth();
      }
    }

    this._derivedStats = new DerivedStats();
    this._experienceToNext = this.calculateXpForLevel(this._level);
    this.updateStats();
  }

  public getDamage(mh: boolean, min: boolean): number {
    if (mh) {
      const weapon = this.getWeapon(EquipmentSlot.MainHand);
      if (weapon) {
        return min
          ? (weapon.stats as WeaponStatBlock).minDamage
          : (weapon.stats as WeaponStatBlock).maxDamage;
      }
    } else {
      const weapon = this.getWeapon(EquipmentSlot.OffHand);
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

  protected createProgression(data?: ProgressionData): ProgressionProfile {
    const initialLevel = Math.max(1, Math.floor(data?.initialLevel ?? 1));
    const xpData = data?.xp;
    const baseXp = Math.max(1, Math.floor(xpData?.base ?? 100));
    const perLevel = Math.max(0, Math.floor(xpData?.perLevel ?? 50));
    const exponentRaw = xpData?.exponent ?? 1.1;
    const exponent = Number.isFinite(exponentRaw) ? Math.max(0.5, exponentRaw) : 1.1;

    const statGrowthSource = data?.statGrowth ?? {};
    const statGrowth: Partial<StatBlockData> = {};
    STAT_KEYS.forEach((key) => {
      const raw = (statGrowthSource as Record<string, unknown>)[key];
      if (raw !== undefined) {
        const value = Number(raw);
        if (Number.isFinite(value)) {
          statGrowth[key] = value;
        }
      }
    });

    return {
      initialLevel,
      baseXp,
      perLevel,
      exponent,
      statGrowth,
    };
  }

  protected calculateXpForLevel(level: number): number {
    const { baseXp, perLevel, exponent } = this._progression;
    if (level <= 1) {
      return Math.max(1, baseXp);
    }
    const factor = Math.pow(level - 1, exponent);
    const xp = baseXp + perLevel * factor;
    return Math.max(1, Math.floor(xp));
  }

  protected applyStatGrowth() {
    if (!this._progression.statGrowth) {
      return;
    }
    this._baseStats.applyDelta(this._progression.statGrowth);
  }

  public addExperience(amount: number): number {
    if (amount <= 0) {
      return 0;
    }

    this._experience += amount;
    let levelsGained = 0;

    while (
      this._experienceToNext > 0 &&
      this._experience >= this._experienceToNext
    ) {
      this._experience -= this._experienceToNext;
      this._level += 1;
      levelsGained += 1;
      this.applyStatGrowth();
      this._experienceToNext = this.calculateXpForLevel(this._level);
    }

    if (levelsGained > 0) {
      this.updateStats();
      this.resetVitals();
    }

    return levelsGained;
  }

  public serializeProgress(): CharacterProgressSnapshot {
    return {
      level: this._level,
      experience: this._experience,
      baseStats: this._baseStats.toData(),
      currentHealth: this._curHealth,
      currentMana: this._curMana,
      maxHealth: this._maxHealth,
      maxMana: this._maxMana,
    };
  }

  public restoreProgress(snapshot: CharacterProgressSnapshot | undefined) {
    if (!snapshot) {
      return;
    }

    const level = Math.max(1, Math.floor(snapshot.level));
    this._baseStats.initialize(snapshot.baseStats);
    this._level = level;
    this._experience = Math.max(0, Math.floor(snapshot.experience ?? 0));
    this._experienceToNext = this.calculateXpForLevel(this._level);
    if (this._experience >= this._experienceToNext) {
      this._experience = Math.max(0, this._experienceToNext - 1);
    }

    const sanitizedMaxHealth = Math.max(1, snapshot.maxHealth ?? this._maxHealth);
    const sanitizedMaxMana = Math.max(0, snapshot.maxMana ?? this._maxMana);
    this._maxHealth = sanitizedMaxHealth;
    this._curHealth = Math.min(
      sanitizedMaxHealth,
      Math.max(0, snapshot.currentHealth ?? sanitizedMaxHealth)
    );
    this._maxMana = sanitizedMaxMana;
    this._curMana = Math.min(
      sanitizedMaxMana,
      Math.max(0, snapshot.currentMana ?? sanitizedMaxMana)
    );

    this.updateStats();
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

  heal(amount: number) {
    const heal = Math.abs(amount);
    this._curHealth = Math.min(this._maxHealth, this._curHealth + heal);
  }

  healPercent(percent: number) {
    const clamped = Math.max(0, percent);
    this.heal(this._maxHealth * clamped);
  }

  public getAttackDelaySeconds(hand: "main" | "off" = "main"): number {
    const slot = hand === "main" ? EquipmentSlot.MainHand : EquipmentSlot.OffHand;
    const weapon = this.getWeapon(slot);
    if (weapon) {
      const stats = weapon.stats as WeaponStatBlock;
      if (stats && typeof stats.delay === "number" && stats.delay > 0) {
        return stats.delay;
      }
    }
    if (hand === "off") {
      return this.attackDelay * 1.2;
    }
    return this.attackDelay;
  }

  public hasOffHandWeapon(): boolean {
    return Boolean(this.getWeapon(EquipmentSlot.OffHand));
  }
}
