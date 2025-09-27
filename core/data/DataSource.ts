import type { CharacterData } from "../characters/Character";
import type { LootTableConfig } from "../economy/LootTable";
import type { EnemyUnit, StageDefinition } from "../progression/Stage";

export interface HeroDefinition {
  id: string;
  label: string;
  data: CharacterData;
}

export interface GameDataSnapshot {
  heroes: HeroDefinition[];
  enemyPools: Record<string, EnemyUnit[]>;
  stages: StageDefinition[];
  lootTables: LootTableConfig[];
}

export interface GameDataSource {
  loadHeroes(): Promise<HeroDefinition[]>;
  loadEnemyPools(): Promise<Record<string, EnemyUnit[]>>;
  loadStages(): Promise<StageDefinition[]>;
  loadLootTables(): Promise<LootTableConfig[]>;
}

export class StaticDataSource implements GameDataSource {
  constructor(private readonly snapshot: GameDataSnapshot) {}

  async loadHeroes(): Promise<HeroDefinition[]> {
    return this.snapshot.heroes;
  }

  async loadEnemyPools(): Promise<Record<string, EnemyUnit[]>> {
    return this.snapshot.enemyPools;
  }

  async loadStages(): Promise<StageDefinition[]> {
    return this.snapshot.stages;
  }

  async loadLootTables(): Promise<LootTableConfig[]> {
    return this.snapshot.lootTables;
  }
}
