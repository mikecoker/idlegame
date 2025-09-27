import type { CharacterData } from "../characters/Character";

export interface EnemyUnit {
  id: string;
  label: string;
  tier: string;
  data: CharacterData;
}

export type StageComposition = Record<string, number>;

export interface StageWaveDefinition {
  composition: StageComposition;
  isBoss?: boolean;
}

export interface StageDefinition {
  id: string;
  name?: string;
  waves?: number;
  composition?: StageComposition[];
  lootTable?: string;
  finalBoss?: StageComposition;
}

export interface ProgressionData {
  stages: StageDefinition[];
}

export const DEFAULT_STAGE: StageDefinition = {
  id: "endless",
  name: "Endless",
  waves: 999,
  composition: [{ small: 1 }, { small: 2 }],
  finalBoss: { boss: 1 },
};

export const DEFAULT_BOSS_COMPOSITION: StageComposition = { boss: 1 };
