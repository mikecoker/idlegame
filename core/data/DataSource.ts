import type { CharacterData } from "../characters/Character";
import type { CraftingRecipe, ItemDefinition } from "../items/ItemDefinition";
import type { LootTableConfig } from "../economy/LootTable";
import type { EnemyUnit, StageDefinition } from "../progression/Stage";
import type { ProgressionConfig } from "../progression/ProgressionConfig";

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
  items?: ItemDefinition[];
  recipes?: CraftingRecipe[];
  progressionConfig?: ProgressionConfig;
}

export interface GameDataSource {
  loadHeroes(): Promise<HeroDefinition[]>;
  loadEnemyPools(): Promise<Record<string, EnemyUnit[]>>;
  loadStages(): Promise<StageDefinition[]>;
  loadLootTables(): Promise<LootTableConfig[]>;
  loadItemDefinitions(): Promise<ItemDefinition[]>;
  loadCraftingRecipes(): Promise<CraftingRecipe[]>;
  loadProgressionConfig(): Promise<ProgressionConfig | null>;
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

  async loadItemDefinitions(): Promise<ItemDefinition[]> {
    return this.snapshot.items ?? [];
  }

  async loadCraftingRecipes(): Promise<CraftingRecipe[]> {
    return this.snapshot.recipes ?? [];
  }

  async loadProgressionConfig(): Promise<ProgressionConfig | null> {
    return this.snapshot.progressionConfig ?? null;
  }
}
