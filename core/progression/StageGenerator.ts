import { CharacterData } from "../characters/Character";
import type { EnemyUnit } from "./Stage";
import {
  BossRewardConfig,
  BossScalingConfig,
  EnemiesPerWaveConfig,
  ProgressionConfig,
  ProgressionRewardsConfig,
  ScalingFormula,
} from "./ProgressionConfig";

export interface GeneratedWave {
  enemies: EnemyUnit[];
  isBoss: boolean;
}

export interface StageRewardsSummary {
  enemyGold: number;
  enemyXp: number;
  bossGold: number;
  bossShards: number;
  bossGemChance: number;
  firstClearBonusPercent: number;
}

export interface BossEncounterConfig {
  timerSeconds: number;
  enrageHpPercent: number;
  enrageAttackMultiplier: number;
}

export interface StagePreview {
  stageNumber: number;
  name: string;
  waveCount: number;
  lootTableId: string | null;
  rewards: StageRewardsSummary;
  bossConfig: BossEncounterConfig;
}

export interface StageBlueprint {
  stageNumber: number;
  name: string;
  waves: GeneratedWave[];
  lootTableId: string | null;
  rewards: StageRewardsSummary;
  bossConfig: BossEncounterConfig;
}

interface EnemyPools {
  [tier: string]: EnemyUnit[];
}

export class StageGenerator {
  constructor(private readonly config: ProgressionConfig) {}

  generateStage(stageNumber: number, enemyPools: EnemyPools, context?: { heroLevel?: number }): StageBlueprint {
    const name = `Stage ${stageNumber}`;
    const lootTableId = this.resolveLootTable(stageNumber);
    const waves: GeneratedWave[] = [];

    const totalWaves = Math.max(1, Math.round(this.config.wavesPerStage));
    const heroLevel = context?.heroLevel ?? 1;
    const normalWaves = Math.max(0, totalWaves - 1);

    for (let waveIndex = 0; waveIndex < normalWaves; waveIndex += 1) {
      waves.push({
        enemies: this.generateWaveEnemies(stageNumber, waveIndex, enemyPools, false, heroLevel),
        isBoss: false,
      });
    }

    waves.push({
      enemies: this.generateWaveEnemies(stageNumber, normalWaves, enemyPools, true, heroLevel),
      isBoss: true,
    });

    const rewards = this.buildRewardSummary(stageNumber);
    const bossConfig = this.buildBossConfig(stageNumber);

    return {
      stageNumber,
      name,
      waves,
      lootTableId,
      rewards,
      bossConfig,
    };
  }

  protected generateWaveEnemies(
    stageNumber: number,
    waveIndex: number,
    enemyPools: EnemyPools,
    isBoss: boolean,
    heroLevel: number
  ): EnemyUnit[] {
    if (isBoss) {
      const boss = this.pickEnemy("boss", enemyPools, stageNumber + waveIndex) ??
        this.pickEnemy("medium", enemyPools, stageNumber + waveIndex) ??
        this.pickEnemy("small", enemyPools, stageNumber + waveIndex);
      if (!boss) {
        return [];
      }
      return [this.scaleEnemy(boss, stageNumber, true)];
    }

    const count = this.getEnemiesPerWave(stageNumber, heroLevel);
    const enemies: EnemyUnit[] = [];

    const mediumAllowance = Math.min(count, Math.max(0, Math.floor(stageNumber / 10)));
    const smallCount = Math.max(0, count - mediumAllowance);

    for (let i = 0; i < mediumAllowance; i += 1) {
      const base =
        this.pickEnemy("medium", enemyPools, stageNumber * 31 + waveIndex * 7 + i) ??
        this.pickEnemy("small", enemyPools, stageNumber * 17 + waveIndex * 3 + i);
      if (!base) {
        continue;
      }
      enemies.push(this.scaleEnemy(base, stageNumber, false));
    }

    for (let i = 0; i < smallCount; i += 1) {
      const base =
        this.pickEnemy("small", enemyPools, stageNumber * 13 + waveIndex * 5 + i) ??
        this.pickEnemy("medium", enemyPools, stageNumber * 11 + waveIndex * 2 + i);
      if (!base) {
        continue;
      }
      enemies.push(this.scaleEnemy(base, stageNumber, false));
    }

    if (!enemies.length) {
      const fallback =
        this.pickEnemy("small", enemyPools, stageNumber + waveIndex) ??
        this.pickEnemy("medium", enemyPools, stageNumber + waveIndex);
      if (fallback) {
        enemies.push(this.scaleEnemy(fallback, stageNumber, false));
      }
    }

    return enemies;
  }

  protected getEnemiesPerWave(stageNumber: number, heroLevel: number): number {
    const config = this.config.enemiesPerWave;
    const base = Math.max(1, Math.floor(config.base));
    const additional = Math.max(
      0,
      Math.floor((stageNumber - 1) / 5) * Math.max(0, Math.floor(config.perFiveStages))
    );
    const stageCount = base + additional;

    if (heroLevel < 10) {
      return 1;
    }
    if (heroLevel < 15) {
      return Math.min(stageCount, 2);
    }
    return Math.max(stageCount, 3);
  }

  protected pickEnemy(tier: string, pools: EnemyPools, seed: number): EnemyUnit | null {
    const pool = pools[tier];
    if (!pool || !pool.length) {
      return null;
    }
    const index = Math.abs(seed) % pool.length;
    const source = pool[index];
    return {
      id: source.id,
      label: source.label,
      tier: source.tier,
      data: this.cloneData(source.data),
    };
  }

  protected scaleEnemy(unit: EnemyUnit, stageNumber: number, isBoss: boolean): EnemyUnit {
    const clone: EnemyUnit = {
      id: unit.id,
      label: unit.label,
      tier: unit.tier,
      data: this.cloneData(unit.data),
    };

    const data = clone.data as CharacterData;

    if (!data.baseStats || !data.derivedStats) {
      return clone;
    }

    if (isBoss) {
      this.applyBossScaling(data, stageNumber);
    } else {
      this.applyEnemyScaling(data, stageNumber);
    }

    return clone;
  }

  protected applyEnemyScaling(data: CharacterData, stageNumber: number) {
    const scaling = this.config.enemyScaling;
    const targetHp = this.evaluateFormula(scaling.hp, stageNumber);
    const targetAttack = this.evaluateFormula(scaling.attack, stageNumber);
    const targetDefense = this.evaluateFormula(scaling.defense, stageNumber);
    const attacksPerSecond = Math.max(
      0.1,
      this.evaluateFormula(scaling.speed, stageNumber)
    );

    const attackPerStr = data.derivedStats.attackPerStr || 1;

    data.derivedStats.baseHitpoints = Math.max(1, Math.round(targetHp));
    data.baseStats.strength = Math.max(1, Math.round(targetAttack / attackPerStr));
    data.baseStats.defense = Math.max(1, Math.round(targetDefense));

    const delay = Math.max(0.2, 1 / attacksPerSecond);
    data.derivedStats.baseAttackDelay = delay;
    data.derivedStats.minAttackDelay = Math.min(data.derivedStats.minAttackDelay ?? delay, delay);
  }

  protected applyBossScaling(data: CharacterData, stageNumber: number) {
    const boss = this.config.boss;
    const targetHp = this.evaluateFormula(boss.hp, stageNumber);
    const targetAttack = this.evaluateFormula(boss.attack, stageNumber);
    const targetDefense = this.evaluateFormula(boss.defense, stageNumber);
    const attacksPerSecond = Math.max(0.1, boss.speed);

    const attackPerStr = data.derivedStats.attackPerStr || 1;

    data.derivedStats.baseHitpoints = Math.max(1, Math.round(targetHp));
    data.baseStats.strength = Math.max(1, Math.round(targetAttack / attackPerStr));
    data.baseStats.defense = Math.max(1, Math.round(targetDefense));

    const delay = Math.max(0.2, 1 / attacksPerSecond);
    data.derivedStats.baseAttackDelay = delay;
    data.derivedStats.minAttackDelay = Math.min(data.derivedStats.minAttackDelay ?? delay, delay);
  }

  protected buildBossConfig(stageNumber: number): BossEncounterConfig {
    const boss = this.config.boss;
    return {
      timerSeconds: boss.timerSeconds,
      enrageHpPercent: boss.enrage.hpPercent,
      enrageAttackMultiplier: boss.enrage.attackMultiplier,
    };
  }

  protected buildRewardSummary(stageNumber: number): StageRewardsSummary {
    const rewards = this.config.rewards;
    const firstClear = this.config.firstClearBonusPercent ?? 0.05;
    return {
      enemyGold: this.evaluateFormula(rewards.enemy.gold, stageNumber),
      enemyXp: this.evaluateFormula(rewards.enemy.xp, stageNumber),
      bossGold: this.evaluateFormula(rewards.boss.gold, stageNumber),
      bossShards: this.evaluateFormula(rewards.boss.shards, stageNumber),
      bossGemChance: Math.min(1, this.evaluateFormula(rewards.boss.gemChance, stageNumber)),
      firstClearBonusPercent: firstClear,
    };
  }

  protected resolveLootTable(stageNumber: number): string | null {
    const routing = this.config.lootTables;
    if (!routing) {
      return null;
    }
    let table = routing.default;
    for (const entry of routing.thresholds ?? []) {
      if (stageNumber >= entry.stage) {
        table = entry.table;
      }
    }
    return table ?? null;
  }

  protected evaluateFormula(formula: ScalingFormula, stageNumber: number): number {
    if (!formula) {
      return 0;
    }
    let result = formula.base ?? 0;
    if (formula.exponent !== undefined) {
      result = formula.base * Math.pow(stageNumber, formula.exponent);
    }
    if (formula.perStage !== undefined) {
      result += formula.perStage * stageNumber;
    }
    return result;
  }

  protected cloneData<T>(data: T): T {
    return JSON.parse(JSON.stringify(data)) as T;
  }
}
