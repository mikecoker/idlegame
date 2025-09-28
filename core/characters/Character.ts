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
import {
  AbilityDefinition,
  cloneAbilityDefinition,
} from "./Abilities";

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

type StatKey = keyof StatBlockData;

interface GrowthRule {
  flat: number;
  percent: number;
}

const ZERO_GROWTH: GrowthRule = { flat: 0, percent: 0 };

export interface StatGrowthRuleConfig {
  flat?: number;
  percent?: number;
}

export interface ProgressionXpCurveData {
  coefficient: number;
  exponent: number;
  offset?: number;
}

interface ProgressionXpCurveProfile {
  coefficient: number;
  exponent: number;
  offset: number;
}

export interface VitalGrowthConfig {
  hitpoints?: StatGrowthRuleConfig;
  mana?: StatGrowthRuleConfig;
}

interface VitalGrowthProfile {
  hitpoints: GrowthRule;
  mana: GrowthRule;
}

export interface EvolutionTierData {
  tier?: number;
  requiredLevel: number;
  statMultiplier: number;
  essenceCost: number;
  unlocks?: string[];
}

interface EvolutionTierProfile {
  tier: number;
  requiredLevel: number;
  statMultiplier: number;
  essenceCost: number;
  unlocks: string[];
}

export type EvolutionTierDefinition = EvolutionTierProfile;

function cloneDerivedStatsBlock(
  block: DerivedStatsBlockData
): DerivedStatsBlockData {
  const clone = new DerivedStatsBlockData();
  clone.baseHitpoints = block.baseHitpoints;
  clone.baseMana = block.baseMana;
  clone.attackPerStr = block.attackPerStr;
  clone.accPerStr = block.accPerStr;
  clone.evaPerAgi = block.evaPerAgi;
  clone.dexPerCrit = block.dexPerCrit;
  clone.acPerDef = block.acPerDef;
  clone.hpPerStamina = block.hpPerStamina;
  clone.manaPerIntOrWis = block.manaPerIntOrWis;
  clone.baseDodge = block.baseDodge;
  clone.dodgePerAgi = block.dodgePerAgi;
  clone.baseParry = block.baseParry;
  clone.parryPerDex = block.parryPerDex;
  clone.baseAttackDelay = block.baseAttackDelay;
  clone.minAttackDelay = block.minAttackDelay;
  clone.attackDelayReductionPerAgi = block.attackDelayReductionPerAgi;
  return clone;
}

function normalizeGrowthRule(input: unknown): GrowthRule {
  if (typeof input === "number" && Number.isFinite(input)) {
    return { flat: input, percent: 0 };
  }
  if (input && typeof input === "object") {
    const source = input as Record<string, unknown>;
    const flatRaw = source.flat ?? source.value ?? source.amount ?? 0;
    const percentRaw =
      source.percent ??
      source.percentage ??
      source.percentPerLevel ??
      source.multiplier ??
      0;
    const flat = typeof flatRaw === "number" && Number.isFinite(flatRaw) ? flatRaw : 0;
    const percent =
      typeof percentRaw === "number" && Number.isFinite(percentRaw) ? percentRaw : 0;
    return { flat, percent };
  }
  return { flat: 0, percent: 0 };
}

function createZeroGrowthRecord(): Record<StatKey, GrowthRule> {
  const record = {} as Record<StatKey, GrowthRule>;
  (STAT_KEYS as StatKey[]).forEach((key) => {
    record[key] = { ...ZERO_GROWTH };
  });
  return record;
}

function normalizeVitalGrowth(config?: VitalGrowthConfig): VitalGrowthProfile {
  return {
    hitpoints: normalizeGrowthRule(config?.hitpoints),
    mana: normalizeGrowthRule(config?.mana),
  };
}

function normalizeEvolutionTiers(
  source?: EvolutionTierData[]
): EvolutionTierProfile[] {
  if (!Array.isArray(source) || !source.length) {
    return [];
  }

  const sorted = source.map((entry, index) => {
    const tierRaw = entry.tier;
    const tier =
      typeof tierRaw === "number" && Number.isFinite(tierRaw)
        ? Math.max(1, Math.floor(tierRaw))
        : index + 1;
    const requiredLevel = Math.max(1, Math.floor(entry.requiredLevel ?? 1));
    const statMultiplier = Math.max(1, Number(entry.statMultiplier ?? 1));
    const essenceCost = Math.max(0, Math.floor(entry.essenceCost ?? 0));
    const unlocks = Array.isArray(entry.unlocks)
      ? Array.from(
          new Set(
            entry.unlocks.filter((id): id is string => typeof id === "string" && id.length > 0)
          )
        )
      : [];
    return { tier, requiredLevel, statMultiplier, essenceCost, unlocks };
  });

  sorted.sort((a, b) => {
    if (a.requiredLevel === b.requiredLevel) {
      return a.tier - b.tier;
    }
    return a.requiredLevel - b.requiredLevel;
  });

  const result: EvolutionTierProfile[] = [];
  const seenTiers = new Set<number>();
  let nextTier = 1;
  for (const entry of sorted) {
    let tier = entry.tier;
    while (seenTiers.has(tier)) {
      tier += 1;
    }
    seenTiers.add(tier);
    nextTier = tier + 1;
    result.push({ ...entry, tier });
  }
  return result;
}

function normalizeXpCurve(
  data?: ProgressionXpCurveData
): ProgressionXpCurveProfile | undefined {
  if (!data) {
    return undefined;
  }
  const coefficient = Number(data.coefficient);
  const exponent = Number(data.exponent);
  if (!Number.isFinite(coefficient) || coefficient <= 0) {
    return undefined;
  }
  if (!Number.isFinite(exponent) || exponent <= 0) {
    return undefined;
  }
  const offsetRaw = Number(data.offset ?? 0);
  const offset = Number.isFinite(offsetRaw) ? offsetRaw : 0;
  return {
    coefficient,
    exponent,
    offset,
  };
}

export interface ProgressionXpData {
  base: number;
  perLevel: number;
  exponent?: number;
}

type StatGrowthInput = Partial<Record<StatKey, StatGrowthRuleConfig | number>>;

export interface ProgressionData {
  initialLevel?: number;
  xp?: ProgressionXpData;
  xpCurve?: ProgressionXpCurveData;
  statGrowth?: StatGrowthInput;
  vitalGrowth?: VitalGrowthConfig;
  evolutions?: EvolutionTierData[];
  initialEvolutionTier?: number;
}

interface ProgressionProfile {
  initialLevel: number;
  baseXp: number;
  perLevel: number;
  exponent: number;
  xpCurve?: ProgressionXpCurveProfile;
  statGrowth: Record<StatKey, GrowthRule>;
  vitalGrowth: VitalGrowthProfile;
  evolutions: EvolutionTierProfile[];
  initialEvolutionTier: number;
  maxEvolutionTier: number;
}

export interface CharacterProgressSnapshot {
  level: number;
  experience: number;
  baseStats: StatBlockData;
  currentHealth: number;
  currentMana: number;
  maxHealth: number;
  maxMana: number;
  evolutionTier?: number;
}

export class CharacterData {
  public baseStats: StatBlockData;
  public derivedStats: DerivedStatsBlockData;
  public progression?: ProgressionData;
  public abilities?: AbilityDefinition[];
}

export class Character {
  protected _level: number;
  protected _experience: number;
  protected _experienceToNext: number;
  protected _progression: ProgressionProfile;

  protected _baseStats: StatBlock;
  protected _baseStatsBase: StatBlockData;
  protected _derivedStatsBlock: DerivedStatsBlock;
  protected _derivedStatsBase: DerivedStatsBlockData;
  protected _abilityDefinitions: AbilityDefinition[] = [];
  protected _currentEvolutionTier = 0;
  protected _appliedEvolutionMultiplier = 1;

  protected _itemBonuses: StatBlock = new StatBlock();
  protected _buffBonuses: StatBlock = new StatBlock();

  protected _equipment: EquipmentItem[] = [];
  protected _derivedStats: DerivedStats;
  protected _progressionMultiplierApplied = 1;

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

  public applyGlobalStatBonus(multiplier: number) {
    if (!Number.isFinite(multiplier) || multiplier <= 0) {
      return;
    }
    const delta = multiplier - 1;
    if (Math.abs(delta) < 1e-4) {
      return;
    }
    const bonus: Partial<StatBlockData> = {
      strength: this._baseStats.strength * delta,
      agility: this._baseStats.agility * delta,
      dexterity: this._baseStats.dexterity * delta,
      stamina: this._baseStats.stamina * delta,
      intelligence: this._baseStats.intelligence * delta,
      wisdom: this._baseStats.wisdom * delta,
      charisma: this._baseStats.charisma * delta,
      defense: this._baseStats.defense * delta,
    };
    this._buffBonuses.applyDelta(bonus);

    this._derivedStatsBlock.baseHitpoints *= multiplier;
    this._derivedStatsBlock.baseMana *= multiplier;
    this._derivedStatsBlock.attackPerStr *= multiplier;
    this._derivedStatsBlock.accPerStr *= multiplier;
    this._derivedStatsBlock.evaPerAgi *= multiplier;
    this._derivedStatsBlock.dexPerCrit *= multiplier;
    this._derivedStatsBlock.acPerDef *= multiplier;
    this._derivedStatsBlock.hpPerStamina *= multiplier;
    this._derivedStatsBlock.manaPerIntOrWis *= multiplier;

    this.updateStats();
    this._progressionMultiplierApplied *= multiplier;
  }

  public applyAttackMultiplier(multiplier: number) {
    if (!Number.isFinite(multiplier) || multiplier <= 0) {
      return;
    }
    const delta = multiplier - 1;
    if (Math.abs(delta) < 1e-4) {
      return;
    }
    const baseStrength = this._baseStats.strength + this._itemBonuses.strength;
    this._buffBonuses.applyDelta({ strength: baseStrength * delta });
    this._derivedStatsBlock.attackPerStr *= multiplier;
    this._derivedStatsBlock.accPerStr *= Math.max(1, multiplier);
    this.updateStats();
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
    this._baseStatsBase = this._baseStats.toData();
    this._derivedStatsBlock = new DerivedStatsBlock();
    this._derivedStatsBlock.initialize(charData.derivedStats);
    this._derivedStatsBase = cloneDerivedStatsBlock(this._derivedStatsBlock);

    this._progression = this.createProgression(charData.progression);
    this._level = this._progression.initialLevel;
    this._experience = 0;

    if (Array.isArray(charData.abilities)) {
      this._abilityDefinitions = charData.abilities.map((ability) =>
        cloneAbilityDefinition(ability)
      );
    }

    if (this._level > 1) {
      for (let level = 2; level <= this._level; level++) {
        this.applyStatGrowth();
      }
    }

    this._derivedStats = new DerivedStats();
    this._experienceToNext = this.calculateXpForLevel(this._level);
    this.updateEvolutionTier(this._progression.initialEvolutionTier, true);
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

  public clearEquipment() {
    if (!this._equipment.length) {
      return;
    }
    this._equipment = [];
    this.updateStats();
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

    const statGrowthRecord = createZeroGrowthRecord();
    if (data?.statGrowth) {
      (STAT_KEYS as StatKey[]).forEach((key) => {
        const raw = (data.statGrowth as Record<string, unknown>)[key];
        if (raw !== undefined) {
          statGrowthRecord[key] = normalizeGrowthRule(raw);
        }
      });
    }

    const xpCurve = normalizeXpCurve(data?.xpCurve);
    const vitalGrowth = normalizeVitalGrowth(data?.vitalGrowth);
    const evolutions = normalizeEvolutionTiers(data?.evolutions);
    const maxEvolutionTier = evolutions.reduce(
      (acc, tier) => Math.max(acc, tier.tier),
      0
    );
    const requestedInitialTier = Math.max(0, Math.floor(data?.initialEvolutionTier ?? 0));
    const initialEvolutionTier = Math.min(requestedInitialTier, maxEvolutionTier);

    return {
      initialLevel,
      baseXp,
      perLevel,
      exponent,
      xpCurve,
      statGrowth: statGrowthRecord,
      vitalGrowth,
      evolutions,
      initialEvolutionTier,
      maxEvolutionTier,
    };
  }

  protected calculateXpForLevel(level: number): number {
    const xpCurve = this._progression.xpCurve;
    if (xpCurve) {
      const safeLevel = Math.max(1, level);
      const xp =
        xpCurve.coefficient * Math.pow(safeLevel, xpCurve.exponent) + xpCurve.offset;
      return Math.max(1, Math.floor(xp));
    }
    const { baseXp, perLevel, exponent } = this._progression;
    if (level <= 1) {
      return Math.max(1, baseXp);
    }
    const factor = Math.pow(level - 1, exponent);
    const xp = baseXp + perLevel * factor;
    return Math.max(1, Math.floor(xp));
  }

  protected applyStatGrowth() {
    const deltas: Partial<StatBlockData> = {};
    (STAT_KEYS as StatKey[]).forEach((key) => {
      const rule = this._progression.statGrowth[key] ?? ZERO_GROWTH;
      let delta = 0;
      if (rule.flat) {
        delta += rule.flat;
      }
      if (rule.percent) {
        const baseline = this._baseStatsBase[key];
        delta += baseline * rule.percent;
      }
      if (delta !== 0) {
        deltas[key] = delta;
      }
    });

    if (Object.keys(deltas).length) {
      this._baseStats.applyDelta(deltas);
    }
    this.applyVitalGrowth();
  }

  protected applyVitalGrowth() {
    const growth = this._progression.vitalGrowth;
    if (!growth) {
      return;
    }

    const hpRule = growth.hitpoints;
    if (hpRule) {
      let delta = 0;
      if (hpRule.flat) {
        delta += hpRule.flat;
      }
      if (hpRule.percent) {
        delta += this._derivedStatsBase.baseHitpoints * hpRule.percent;
      }
      if (delta !== 0) {
        this._derivedStatsBlock.baseHitpoints = Math.max(
          1,
          this._derivedStatsBlock.baseHitpoints + delta
        );
      }
    }

    const manaRule = growth.mana;
    if (manaRule) {
      let delta = 0;
      if (manaRule.flat) {
        delta += manaRule.flat;
      }
      if (manaRule.percent) {
        delta += this._derivedStatsBase.baseMana * manaRule.percent;
      }
      if (delta !== 0) {
        this._derivedStatsBlock.baseMana = Math.max(
          0,
          this._derivedStatsBlock.baseMana + delta
        );
      }
    }
  }

  public get evolutionTier(): number {
    return this._currentEvolutionTier;
  }

  public get maxEvolutionTier(): number {
    return this._progression.maxEvolutionTier;
  }

  public setEvolutionTier(tier: number): void {
    this.updateEvolutionTier(tier, true);
  }

  public listEvolutionTiers(): EvolutionTierDefinition[] {
    return this._progression.evolutions.map((tier) => ({ ...tier }));
  }

  protected updateEvolutionTier(targetTier: number, applyScaling: boolean) {
    const clamped = Math.max(0, Math.min(targetTier, this._progression.maxEvolutionTier));
    const targetMultiplier = this.calculateEvolutionMultiplier(clamped);

    if (!applyScaling) {
      this._currentEvolutionTier = clamped;
      this._appliedEvolutionMultiplier = targetMultiplier;
      return;
    }

    if (Math.abs(targetMultiplier - this._appliedEvolutionMultiplier) < 1e-4) {
      this._currentEvolutionTier = clamped;
      return;
    }

    const diff = targetMultiplier / this._appliedEvolutionMultiplier;
    this._currentEvolutionTier = clamped;
    this._appliedEvolutionMultiplier = targetMultiplier;

    if (Math.abs(diff - 1) < 1e-4) {
      return;
    }

    const deltas: Partial<StatBlockData> = {};
    (STAT_KEYS as StatKey[]).forEach((key) => {
      const current = this._baseStats[key];
      const delta = current * (diff - 1);
      if (delta !== 0) {
        deltas[key] = delta;
      }
    });
    if (Object.keys(deltas).length) {
      this._baseStats.applyDelta(deltas);
    }
    this.applyEvolutionMultiplierToDerived(diff);
    this.updateStats();
  }

  protected calculateEvolutionMultiplier(tier: number): number {
    if (!this._progression.evolutions.length || tier <= 0) {
      return 1;
    }
    return this._progression.evolutions.reduce((multiplier, entry) => {
      if (entry.tier <= tier) {
        return multiplier * Math.max(1, entry.statMultiplier);
      }
      return multiplier;
    }, 1);
  }

  protected applyEvolutionMultiplierToDerived(multiplier: number) {
    if (Math.abs(multiplier - 1) < 1e-4) {
      return;
    }
    this._derivedStatsBlock.baseHitpoints *= multiplier;
    this._derivedStatsBlock.baseMana *= multiplier;
    this._derivedStatsBlock.attackPerStr *= multiplier;
    this._derivedStatsBlock.accPerStr *= multiplier;
    this._derivedStatsBlock.evaPerAgi *= multiplier;
    this._derivedStatsBlock.dexPerCrit *= multiplier;
    this._derivedStatsBlock.acPerDef *= multiplier;
    this._derivedStatsBlock.hpPerStamina *= multiplier;
    this._derivedStatsBlock.manaPerIntOrWis *= multiplier;
  }

  public listAbilityDefinitions(): AbilityDefinition[] {
    return this._abilityDefinitions.map((ability) =>
      cloneAbilityDefinition(ability)
    );
  }

  public getUnlockedAbilities(): AbilityDefinition[] {
    const tier = this._currentEvolutionTier;
    return this._abilityDefinitions
      .filter((ability) => (ability.requiresTier ?? 0) <= tier)
      .map((ability) => cloneAbilityDefinition(ability));
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
      evolutionTier: this._currentEvolutionTier,
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

    const evolutionTier = Math.max(
      0,
      Math.floor(snapshot.evolutionTier ?? this._currentEvolutionTier)
    );
    this.updateEvolutionTier(evolutionTier, false);

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
