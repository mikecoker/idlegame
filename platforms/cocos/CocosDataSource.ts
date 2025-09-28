import { JsonAsset } from "cc";
import { CharacterData } from "../../core/characters/Character";
import {
  GameDataSource,
  HeroDefinition,
} from "../../core/data/DataSource";
import { LootTableConfig } from "../../core/economy/LootTable";
import { CraftingRecipe, ItemDefinition } from "../../core/items/ItemDefinition";
import { EnemyUnit, StageDefinition } from "../../core/progression/Stage";
import { ProgressionConfig } from "../../core/progression/ProgressionConfig";
import type { ProgressionData } from "../../core/progression/Stage";

export interface CocosHeroSource {
  asset: JsonAsset | null;
  id?: string;
  label?: string;
}

export interface CocosEnemySource {
  asset: JsonAsset | null;
}

export interface CocosLootSource {
  asset: JsonAsset | null;
}

export interface CocosDataSourceConfig {
  heroes: CocosHeroSource[];
  enemies: CocosEnemySource[];
  progression: JsonAsset | null;
  progressionConfig?: JsonAsset | null;
  lootTables: CocosLootSource[];
}

export class CocosDataSource implements GameDataSource {
  constructor(private readonly config: CocosDataSourceConfig) {}

  async loadHeroes(): Promise<HeroDefinition[]> {
    const heroes: HeroDefinition[] = [];
    this.config.heroes.forEach((entry, index) => {
      const data = this.cloneCharacter(entry.asset);
      if (!data) {
        return;
      }
      const id = entry.id ?? entry.asset?.name ?? `hero-${index + 1}`;
      const label = entry.label ?? id;
      heroes.push({ id, label, data });
    });

    return heroes;
  }

  async loadEnemyPools(): Promise<Record<string, EnemyUnit[]>> {
    const pools: Record<string, EnemyUnit[]> = { small: [], medium: [], boss: [] };

    this.config.enemies.forEach((entry) => {
      const asset = entry.asset;
      if (!asset?.json) {
        return;
      }

      const json = asset.json as any;
      const tier = typeof json.tier === "string" ? json.tier : "small";
      const id = typeof json.id === "string" ? json.id : asset.name ?? "enemy";
      const label = typeof json.name === "string" ? json.name : id;
      const data = this.clone(json as CharacterData);

      pools[tier] = pools[tier] || [];
      pools[tier].push({ id, label, tier, data });
    });

    return pools;
  }

  async loadStages(): Promise<StageDefinition[]> {
    const asset = this.config.progression;
    if (!asset?.json) {
      return [];
    }
    const json = asset.json as ProgressionData;
    return json?.stages ? json.stages.map((stage) => ({ ...stage })) : [];
  }

  async loadLootTables(): Promise<LootTableConfig[]> {
    const tables: LootTableConfig[] = [];
    this.config.lootTables.forEach((entry, index) => {
      const asset = entry.asset;
      if (!asset?.json) {
        return;
      }
      const table = { ...(asset.json as LootTableConfig) };
      table.id = table.id ?? asset.name ?? `loot-${index + 1}`;
      tables.push(table);
    });
    return tables;
  }

  async loadItemDefinitions(): Promise<ItemDefinition[]> {
    return [];
  }

  async loadCraftingRecipes(): Promise<CraftingRecipe[]> {
    return [];
  }

  async loadProgressionConfig(): Promise<ProgressionConfig | null> {
    const asset = this.config.progressionConfig;
    if (!asset?.json) {
      return null;
    }
    return this.clone(asset.json as ProgressionConfig);
  }

  protected cloneCharacter(asset: JsonAsset | null): CharacterData | null {
    if (!asset?.json) {
      return null;
    }
    return this.clone(asset.json as CharacterData);
  }

  protected clone<T>(data: T): T {
    return JSON.parse(JSON.stringify(data)) as T;
  }
}
