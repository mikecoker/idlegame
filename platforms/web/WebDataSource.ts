import { CharacterData } from "../../core/characters/Character";
import {
  GameDataSource,
  HeroDefinition,
} from "../../core/data/DataSource";
import { LootTableConfig } from "../../core/economy/LootTable";
import { EnemyUnit, StageDefinition } from "../../core/progression/Stage";

export interface WebHeroManifestEntry {
  id: string;
  label: string;
  path: string;
}

export interface WebEnemyManifestEntry {
  id: string;
  label?: string;
  tier: string;
  path: string;
}

export interface WebLootManifestEntry {
  id: string;
  label?: string;
  path: string;
}

export interface WebHeroManifest {
  presets: WebHeroManifestEntry[];
}

export interface WebEnemyManifest {
  tiers: Record<string, WebEnemyManifestEntry[]>;
}

export interface WebLootManifest {
  tables: WebLootManifestEntry[];
}

export interface WebDataSourceOptions {
  baseUrl?: string;
  heroManifestUrl: string;
  enemyManifestUrl: string;
  stageConfigUrl: string;
  lootManifestUrl: string;
  fetcher?: typeof fetch;
}

const defaultFetcher = (input: RequestInfo | URL, init?: RequestInit) =>
  fetch(input, init);

export class WebDataSource implements GameDataSource {
  protected readonly fetcher: typeof fetch;
  protected readonly baseUrl: string;

  constructor(private readonly options: WebDataSourceOptions) {
    this.fetcher = options.fetcher ?? defaultFetcher;
    this.baseUrl = options.baseUrl ?? "";
  }

  async loadHeroes(): Promise<HeroDefinition[]> {
    const manifest = await this.loadJson<WebHeroManifest>(this.options.heroManifestUrl);
    if (!manifest?.presets?.length) {
      return [];
    }

    const heroes: HeroDefinition[] = [];
    for (const entry of manifest.presets) {
      try {
        const data = await this.loadJson<CharacterData>(entry.path);
        if (!data) {
          continue;
        }
        const id = entry.id ?? entry.path;
        const label = entry.label ?? id;
        heroes.push({ id, label, data });
      } catch (err) {
        console.warn(`[WebDataSource] Failed to load hero '${entry.id}'`, err);
      }
    }
    return heroes;
  }

  async loadEnemyPools(): Promise<Record<string, EnemyUnit[]>> {
    const manifest = await this.loadJson<WebEnemyManifest>(this.options.enemyManifestUrl);
    const pools: Record<string, EnemyUnit[]> = { small: [], medium: [], boss: [] };
    if (!manifest?.tiers) {
      return pools;
    }

    for (const [tier, entries] of Object.entries(manifest.tiers)) {
      pools[tier] = pools[tier] ?? [];
      for (const entry of entries ?? []) {
        try {
          const data = await this.loadJson<CharacterData>(entry.path);
          if (!data) {
            continue;
          }
          pools[tier].push({
            id: entry.id,
            label: entry.label ?? entry.id,
            tier,
            data,
          });
        } catch (err) {
          console.warn(`[WebDataSource] Failed to load enemy '${entry.id}'`, err);
        }
      }
    }

    return pools;
  }

  async loadStages(): Promise<StageDefinition[]> {
    const data = await this.loadJson<{ stages?: StageDefinition[] }>(
      this.options.stageConfigUrl
    );
    return data?.stages?.length ? data.stages.map((stage) => ({ ...stage })) : [];
  }

  async loadLootTables(): Promise<LootTableConfig[]> {
    const manifest = await this.loadJson<WebLootManifest>(this.options.lootManifestUrl);
    if (!manifest?.tables?.length) {
      return [];
    }

    const tables: LootTableConfig[] = [];
    for (const entry of manifest.tables) {
      try {
        const table = await this.loadJson<LootTableConfig>(entry.path);
        if (!table) {
          continue;
        }
        if (!table.id) {
          table.id = entry.id;
        }
        if (!table.name && entry.label) {
          table.name = entry.label;
        }
        tables.push(table);
      } catch (err) {
        console.warn(`[WebDataSource] Failed to load loot table '${entry.id}'`, err);
      }
    }
    return tables;
  }

  protected resolveUrl(path: string): string {
    if (!this.baseUrl) {
      return path;
    }
    if (/^https?:/i.test(path)) {
      return path;
    }
    const trimmed = path.startsWith("/") ? path.slice(1) : path;
    return `${this.baseUrl}${trimmed}`;
  }

  protected async loadJson<T>(path: string): Promise<T | null> {
    const url = this.resolveUrl(path);
    const response = await this.fetcher(url, { cache: "no-cache" });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    return (await response.json()) as T;
  }
}
