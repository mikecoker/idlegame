export interface ScalingFormula {
  base: number;
  exponent?: number;
  perStage?: number;
}

export interface EnemyScalingConfig {
  hp: ScalingFormula;
  attack: ScalingFormula;
  defense: ScalingFormula;
  speed: ScalingFormula;
}

export interface BossEnrageConfig {
  hpPercent: number;
  attackMultiplier: number;
}

export interface BossScalingConfig {
  hp: ScalingFormula;
  attack: ScalingFormula;
  defense: ScalingFormula;
  speed: number;
  timerSeconds: number;
  enrage: BossEnrageConfig;
}

export interface RewardScalingConfig {
  gold: ScalingFormula;
  xp: ScalingFormula;
}

export interface BossRewardConfig {
  gold: ScalingFormula;
  shards: ScalingFormula;
  gemChance: ScalingFormula;
}

export interface ProgressionRewardsConfig {
  enemy: RewardScalingConfig;
  boss: BossRewardConfig;
}

export interface LootTableThreshold {
  stage: number;
  table: string;
}

export interface LootTableRoutingConfig {
  default: string;
  thresholds: LootTableThreshold[];
}

export interface EnemiesPerWaveConfig {
  base: number;
  perFiveStages: number;
}

export interface ProgressionConfig {
  wavesPerStage: number;
  enemiesPerWave: EnemiesPerWaveConfig;
  enemyScaling: EnemyScalingConfig;
  boss: BossScalingConfig;
  rewards: ProgressionRewardsConfig;
  lootTables: LootTableRoutingConfig;
}
