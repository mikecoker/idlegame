import { CombatSim } from "../../assets/game/combatsim";
import { Character, CharacterData, CharacterProgressSnapshot } from "../../assets/game/character";
import {
  EncounterEvent,
  EncounterLoop,
  EncounterRewardConfig,
  EncounterSummary,
  EncounterRewards,
  RewardAugmentItem,
  RewardEquipmentItem,
} from "../../assets/game/encounter";
import { EquipmentSlot, ItemType } from "../../assets/game/constants";
import { EquipmentItem, ItemRarity } from "../../assets/game/item";
import {
  StatBlock,
  WeaponStatBlock,
  ArmorStatBlock,
  StatBlockData,
} from "../../assets/game/stat";

interface Preset {
  id: string;
  label: string;
  data: CharacterData;
}

interface EnemyUnit {
  id: string;
  label: string;
  tier: string;
  data: CharacterData;
}

interface LootTableRecord {
  id: string;
  label: string;
  config: EncounterRewardConfig;
}

interface StageComposition {
  [tier: string]: number;
}

interface StageDefinition {
  name: string;
  waves: number;
  composition: StageComposition[];
  lootTable?: string;
  finalBoss?: StageComposition;
}

interface EnemyManifestEntry {
  id: string;
  label?: string;
  path: string;
}

interface EnemyManifestData {
  tiers: Record<string, EnemyManifestEntry[]>;
}

interface ProgressionManifest {
  stages: StageDefinition[];
}

interface CombatTelemetry {
  attempts: number;
  hits: number;
  crits: number;
  misses: number;
  dodges: number;
  parries: number;
  totalDamage: number;
}

interface ItemDefinition {
  id: string;
  name: string;
  tier: string;
  type: "weapon" | "armor" | "consumable" | "augment";
  slot?: string;
  power?: number;
  stats?: Partial<Record<keyof CharacterData["baseStats"], number>>;
  weapon?: {
    minDamage: number;
    maxDamage: number;
    delay: number;
  };
  armor?: {
    armor: number;
  };
  effect?: {
    kind: "heal";
    percent: number;
  };
  socketSlots?: number;
  maxUpgradeLevel?: number;
  augment?: {
    stats?: Partial<Record<keyof CharacterData["baseStats"], number>>;
  };
  upgrades?: Array<{
    materials: Record<string, number>;
  }>;
}

interface OwnedEquipment {
  instanceId: string;
  itemId: string;
  rarity: ItemRarity;
  upgradeLevel: number;
  maxUpgradeLevel: number;
  socketSlots: number;
  augments: string[];
}

type EquippedSlotKey = "MainHand" | "OffHand" | "Head" | "Chest";

interface CraftingRecipe {
  id: string;
  result: string;
  type: "equipment" | "consumable";
  tier: string;
  cost: Record<string, number>;
}

interface PersistedState {
  version: number;
  heroId: string;
  stageIndex: number;
  stageWaveCompleted: number;
  totalWavesCompleted: number;
  tickInterval: number;
  lootTableId?: string;
  rewards: EncounterRewards;
  lastRewards?: EncounterRewards;
  heroProgress?: CharacterProgressSnapshot;
  history?: EncounterHistoryEntry[];
  historyCounter?: number;
  materialsStock?: Record<string, number>;
  equippedItems?: Record<string, string | null>;
  consumables?: Record<string, number>;
  equipmentInventory?: Record<string, number>;
  equippedItemsV2?: Record<string, OwnedEquipment | null>;
  equipmentInventoryV2?: OwnedEquipment[];
  timestamp: number;
}

interface EncounterHistoryEntry {
  index: number;
  stage: string;
  wave: number;
  opponent: string;
  result: "Victory" | "Defeat";
  heroHP: string;
  enemyHP: string;
  rewards: EncounterRewards;
}

const HERO_SOURCES = [
  { id: "hero", label: "Hero", path: "dist/assets/data/hero.json" },
  { id: "rogue", label: "Rogue", path: "dist/assets/data/rogue.json" },
  { id: "warrior", label: "Warrior", path: "dist/assets/data/warrior.json" },
];

const STORAGE_KEY = "idle-eq-harness-state-v2";
const RARITY_MULTIPLIERS: Record<ItemRarity, number> = {
  common: 1,
  uncommon: 1.1,
  rare: 1.25,
  epic: 1.4,
  legendary: 1.6,
};

const SALVAGE_VALUE_BY_RARITY: Record<ItemRarity, number> = {
  common: 1,
  uncommon: 2,
  rare: 4,
  epic: 7,
  legendary: 12,
};

const UPGRADE_SCALE_PER_LEVEL = 0.05;
const STAT_DATA_KEYS: Array<keyof StatBlock> = [
  "strength",
  "agility",
  "dexterity",
  "stamina",
  "intelligence",
  "wisdom",
  "charisma",
  "defense",
];

function createTelemetryBucket(): CombatTelemetry {
  return {
    attempts: 0,
    hits: 0,
    crits: 0,
    misses: 0,
    dodges: 0,
    parries: 0,
    totalDamage: 0,
  };
}

function createEmptyRewards(): EncounterRewards {
  return {
    xp: 0,
    gold: 0,
    materials: {},
    equipment: [],
    augments: [],
  };
}

function normalizeRewards(raw?: EncounterRewards | null): EncounterRewards {
  if (!raw) {
    return createEmptyRewards();
  }
  return {
    xp: raw.xp ?? 0,
    gold: raw.gold ?? 0,
    materials: { ...(raw.materials ?? {}) },
    equipment: raw.equipment ? raw.equipment.map((entry) => ({ ...entry })) : [],
    augments: raw.augments ? raw.augments.map((entry) => ({ ...entry })) : [],
  };
}

function getRarityMultiplier(rarity: ItemRarity): number {
  return RARITY_MULTIPLIERS[rarity] ?? 1;
}

function scaleStatBlockValues(block: StatBlock, multiplier: number) {
  STAT_DATA_KEYS.forEach((key) => {
    const current = block[key];
    if (typeof current === "number") {
      block[key] = Math.round(current * multiplier) as any;
    }
  });
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

class SimulatorHarness {
  protected sim = new CombatSim();
  protected hero: Character | null = null;
  protected enemy: Character | null = null;
  protected encounter: EncounterLoop | null = null;

  protected heroOptions: Preset[] = [];
  protected enemyPools: Record<string, EnemyUnit[]> = {
    small: [],
    medium: [],
    boss: [],
  };
  protected stages: StageDefinition[] = [];
  protected itemDefs: Map<string, ItemDefinition> = new Map();
  protected recipes: CraftingRecipe[] = [];
  protected recipeMap: Map<string, CraftingRecipe> = new Map();

  protected stageIndex = 0;
  protected stageWaveCompleted = 0;
  protected totalWavesCompleted = 0;
  protected currentWaveNumber = 0;
  protected currentStageName = "";
  protected currentEnemyLabel = "";
  protected currentWaveQueue: EnemyUnit[] = [];

  protected lootTables: LootTableRecord[] = [];
  protected rewardConfig: EncounterRewardConfig = {
    xpPerWin: 0,
    equipmentDrops: [],
    augmentDrops: [],
    materialDrops: [],
  };
  protected selectedLootId: string | null = null;
  protected materialsStock: Record<string, number> = {};
  protected equippedItems: Record<EquippedSlotKey, OwnedEquipment | null> = {
    MainHand: null,
    OffHand: null,
    Head: null,
    Chest: null,
  };
  protected consumables: Record<string, number> = {};
  protected equipmentInventory: OwnedEquipment[] = [];

  protected telemetry = {
    hero: createTelemetryBucket(),
    enemy: createTelemetryBucket(),
  };

  protected running = false;
  protected rafHandle: number | null = null;
  protected lastTimestamp = 0;
  protected currentWaveIsBoss = false;

  protected lastRewards: EncounterRewards = createEmptyRewards();
  protected totalRewards: EncounterRewards = createEmptyRewards();
  protected rewardClaimed = false;
  protected resumeAfterVictory = false;

  protected tickIntervalSeconds = 0.1;
  protected pendingSourceProgress?: CharacterProgressSnapshot;
  protected autoStart = true;

  protected history: EncounterHistoryEntry[] = [];
  protected historyCounter = 0;

  async init() {
    this.setStatusMessage("Loading data...");

    const [heroOptions, lootTables] = await Promise.all([
      this.loadHeroPresets(),
      this.loadLootTables(),
    ]);
    this.heroOptions = heroOptions;
    this.lootTables = lootTables;

    await Promise.all([
      this.loadEnemyPools(),
      this.loadStages(),
      this.loadItemDefinitions(),
      this.loadRecipes(),
    ]);

    this.populateHeroSelect();
    this.populateStageSelect();
    this.populateLootSelect();
    this.bindControls();

    const hasState = this.restoreState();
    this.resetEncounter(!hasState);
    this.refreshStatus(true);
    this.renderRewards();
    this.renderTelemetry();
    this.renderStatsTable();
    this.renderEquipment();
    this.renderHistory();
    this.populateRecipeSelects();
    this.updateCraftingAvailability();
  }

  protected async loadHeroPresets(): Promise<Preset[]> {
    const results: Preset[] = [];
    for (const source of HERO_SOURCES) {
      try {
        const response = await fetch(`./${source.path}`, { cache: "no-cache" });
        if (!response.ok) {
          throw new Error(`${response.status} ${response.statusText}`);
        }
        const data = (await response.json()) as CharacterData;
        results.push({ id: source.id, label: source.label, data });
      } catch (err) {
        console.warn(`[Harness] Failed to load hero preset '${source.id}'`, err);
      }
    }
    return results.length ? results : [];
  }

  protected async loadEnemyPools(): Promise<void> {
    const pools: Record<string, EnemyUnit[]> = {
      small: [],
      medium: [],
      boss: [],
    };

    try {
      const response = await fetch(`./dist/assets/data/enemies/manifest.json`, {
        cache: "no-cache",
      });
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      const manifest = (await response.json()) as EnemyManifestData;
      const entries = manifest.tiers ?? {};

      for (const [tier, list] of Object.entries(entries)) {
        const cleanedTier = tier.toLowerCase();
        pools[cleanedTier] = pools[cleanedTier] ?? [];
        for (const entry of list) {
          try {
          const resolvedPath = entry.path.startsWith("dist/")
            ? entry.path
            : `dist/${entry.path}`;
          const enemyResp = await fetch(`./${resolvedPath}`, {
              cache: "no-cache",
            });
            if (!enemyResp.ok) {
              throw new Error(`${enemyResp.status} ${enemyResp.statusText}`);
            }
            const data = (await enemyResp.json()) as CharacterData;
            pools[cleanedTier].push({
              id: entry.id,
              label: entry.label ?? entry.id,
              tier: cleanedTier,
              data,
            });
          } catch (err) {
            console.warn(`[Harness] Failed to load enemy '${entry.id}'`, err);
          }
        }
      }
    } catch (err) {
      console.warn("[Harness] Failed to load enemy manifest", err);
    }

    this.enemyPools = pools;
  }

  protected async loadStages(): Promise<void> {
    try {
      const response = await fetch(`./dist/assets/data/encounters/progression.json`, {
        cache: "no-cache",
      });
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      const manifest = (await response.json()) as ProgressionManifest;
      const stages = manifest.stages ?? [];
      const defaultFinalBoss: StageComposition = { boss: 1 };
      const defaultComposition = [{ small: 1 }];
      this.stages = stages.map((stage, index) => ({
        name: stage.name ?? `Stage ${index + 1}`,
        waves: Math.max(1, Math.floor(stage.waves ?? 1)),
        composition: stage.composition?.length ? stage.composition : defaultComposition,
        lootTable: stage.lootTable,
        finalBoss: stage.finalBoss ?? defaultFinalBoss,
      }));
    } catch (err) {
      console.warn("[Harness] Failed to load progression", err);
      this.stages = [
        {
          name: "Endless",
          waves: 999,
          composition: [{ small: 1 }, { small: 2 }],
          finalBoss: { boss: 1 },
        },
      ];
    }
  }

  protected async loadItemDefinitions(): Promise<void> {
    const map = new Map<string, ItemDefinition>();
    try {
      const response = await fetch(`./dist/assets/data/items/manifest.json`, {
        cache: "no-cache",
      });
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      const manifest = (await response.json()) as {
        items: Array<{ id: string; path: string }>;
      };

      for (const entry of manifest.items ?? []) {
        try {
          const resolvedPath = entry.path.startsWith("dist/")
            ? entry.path
            : `dist/${entry.path}`;
          const itemResponse = await fetch(`./${resolvedPath}`, {
            cache: "no-cache",
          });
          if (!itemResponse.ok) {
            throw new Error(`${itemResponse.status} ${itemResponse.statusText}`);
          }
          const data = (await itemResponse.json()) as ItemDefinition;
          map.set(data.id, data);
        } catch (err) {
          console.warn(`[Harness] Failed to load item '${entry.id}'`, err);
        }
      }
    } catch (err) {
      console.warn("[Harness] Failed to load item manifest", err);
    }

    this.itemDefs = map;
  }

  protected async loadRecipes(): Promise<void> {
    try {
      const response = await fetch(`./dist/assets/data/crafting/recipes.json`, {
        cache: "no-cache",
      });
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      const json = await response.json();
      this.recipes = json.recipes ?? [];
      this.recipeMap = new Map();
      this.recipes.forEach((recipe) => {
        this.recipeMap.set(recipe.id, recipe);
      });
    } catch (err) {
      console.warn("[Harness] Failed to load crafting recipes", err);
      this.recipes = [];
      this.recipeMap = new Map();
    }
  }

  protected async loadLootTables(): Promise<LootTableRecord[]> {
    try {
      const response = await fetch(`./dist/assets/data/loot/manifest.json`, {
        cache: "no-cache",
      });
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      const manifest = (await response.json()) as {
        tables: Array<{
          id: string;
          label?: string;
          path: string;
        }>;
      };

      const records: LootTableRecord[] = [];
      for (const entry of manifest.tables ?? []) {
        try {
          const resolvedPath = entry.path.startsWith("dist/")
            ? entry.path
            : `dist/${entry.path}`;
          const tableResponse = await fetch(`./${resolvedPath}`, {
            cache: "no-cache",
          });
          if (!tableResponse.ok) {
            throw new Error(`${tableResponse.status} ${tableResponse.statusText}`);
          }
          const table = (await tableResponse.json()) as any;
          const config: EncounterRewardConfig = {
            xpPerWin: Math.max(0, Math.floor(table.xpPerWin ?? 0)),
            goldMin: Math.max(0, Math.floor(table.gold?.min ?? 0)),
            goldMax: Math.max(
              Math.max(0, Math.floor(table.gold?.min ?? 0)),
              Math.floor(table.gold?.max ?? table.gold?.min ?? 0)
            ),
            materialDrops: (table.materialDrops ?? []).map((drop: any) => ({
              id: drop.id,
              chance: clamp01(drop.chance ?? 0),
              min: Math.max(0, Math.floor(drop.min ?? 0)),
              max: Math.max(0, Math.floor(drop.max ?? drop.min ?? 0)),
            })),
            equipmentDrops: (table.equipmentDrops ?? []).map((drop: any) => ({
              itemId: drop.itemId,
              chance: clamp01(drop.chance ?? 0),
              min: drop.min !== undefined ? Math.max(0, Math.floor(drop.min)) : undefined,
              max: drop.max !== undefined ? Math.max(0, Math.floor(drop.max)) : undefined,
              rarityWeights: drop.rarityWeights ? { ...drop.rarityWeights } : undefined,
            })),
            augmentDrops: (table.augmentDrops ?? []).map((drop: any) => ({
              augmentId: drop.augmentId,
              chance: clamp01(drop.chance ?? 0),
              min: drop.min !== undefined ? Math.max(0, Math.floor(drop.min)) : undefined,
              max: drop.max !== undefined ? Math.max(0, Math.floor(drop.max)) : undefined,
            })),
          };
          records.push({
            id: entry.id,
            label: entry.label ?? entry.id,
            config,
          });
        } catch (err) {
          console.warn(`[Harness] Failed to load loot table '${entry.id}'`, err);
        }
      }
      return records.length ? records : [];
    } catch (err) {
      console.warn("[Harness] Failed to load loot manifest", err);
      return [];
    }
  }

  protected bindControls() {
    const startBtn = document.getElementById("start-button") as HTMLButtonElement | null;
    const pauseBtn = document.getElementById("pause-button") as HTMLButtonElement | null;
    const resetBtn = document.getElementById("reset-button") as HTMLButtonElement | null;
    const tickInput = document.getElementById("tick-input") as HTMLInputElement | null;
    const heroSelect = document.getElementById("hero-select") as HTMLSelectElement | null;
    const stageSelect = document.getElementById("stage-select") as HTMLSelectElement | null;
    const lootSelect = document.getElementById("loot-select") as HTMLSelectElement | null;

    startBtn?.addEventListener("click", () => {
      if (!this.encounter) {
        if (this.currentWaveQueue.length) {
          this.startNextEncounter(false);
        } else {
          this.resetEncounter(false);
        }
      }
      this.startAuto();
    });

    pauseBtn?.addEventListener("click", () => {
      this.stopAuto();
    });

    resetBtn?.addEventListener("click", () => {
      this.resetEncounter(true);
    });

    tickInput?.addEventListener("change", () => {
      const value = Math.max(0.01, parseFloat(tickInput.value) || this.tickIntervalSeconds);
      this.tickIntervalSeconds = value;
      this.encounter?.setTickInterval(value);
      this.persistState();
      this.refreshStatus();
    });

    heroSelect?.addEventListener("change", () => {
      this.resetEncounter(true);
    });

    stageSelect?.addEventListener("change", () => {
      const index = parseInt(stageSelect.value, 10);
      if (Number.isFinite(index)) {
        this.stageIndex = Math.max(0, Math.min(index, this.stages.length - 1));
        this.stageWaveCompleted = 0;
        this.totalWavesCompleted = 0;
        this.resetEncounter(false);
      }
    });

    lootSelect?.addEventListener("change", () => {
      const id = lootSelect.value || null;
      this.selectLootTable(id, { persist: true });
      this.resetEncounter(false);
    });

    const equipSelect = document.getElementById("equipment-recipe-select") as HTMLSelectElement | null;
    const consumableSelect = document.getElementById("consumable-recipe-select") as HTMLSelectElement | null;
    const craftEquipBtn = document.getElementById("craft-equipment-button") as HTMLButtonElement | null;
    const equipEquipBtn = document.getElementById("equip-selected-button") as HTMLButtonElement | null;
    const craftConsumableBtn = document.getElementById("craft-consumable-button") as HTMLButtonElement | null;
    const useConsumableBtn = document.getElementById("use-consumable-button") as HTMLButtonElement | null;

    equipSelect?.addEventListener("change", () => this.updateCraftingAvailability());
    consumableSelect?.addEventListener("change", () => this.updateCraftingAvailability());

    craftEquipBtn?.addEventListener("click", () => {
      const id = equipSelect?.value;
      if (id) {
        this.craftEquipment(id);
        this.updateCraftingAvailability();
      }
    });

    equipEquipBtn?.addEventListener("click", () => {
      const recipe = equipSelect ? this.recipeMap.get(equipSelect.value) : undefined;
      if (recipe) {
        this.equipFirstMatchingItem(recipe.result);
        this.updateCraftingAvailability();
      }
    });

    craftConsumableBtn?.addEventListener("click", () => {
      const id = consumableSelect?.value;
      if (id) {
        this.craftConsumable(id);
        this.updateCraftingAvailability();
      }
    });

    useConsumableBtn?.addEventListener("click", () => {
      const recipe = consumableSelect ? this.recipeMap.get(consumableSelect.value) : undefined;
      const consumableId = recipe?.result;
      if (consumableId) {
        this.useConsumable(consumableId);
        this.updateCraftingAvailability();
      }
    });
  }

  protected populateHeroSelect() {
    const select = document.getElementById("hero-select") as HTMLSelectElement | null;
    if (!select) {
      return;
    }
    select.innerHTML = "";
    this.heroOptions.forEach((option, index) => {
      const node = document.createElement("option");
      node.value = option.id;
      node.textContent = option.label;
      if (index === 0) {
        node.selected = true;
      }
      select.appendChild(node);
    });
  }

  protected populateStageSelect() {
    const select = document.getElementById("stage-select") as HTMLSelectElement | null;
    if (!select) {
      return;
    }
    select.innerHTML = "";
    this.stages.forEach((stage, index) => {
      const node = document.createElement("option");
      node.value = index.toString();
      node.textContent = stage.name ?? `Stage ${index + 1}`;
      if (index === 0) {
        node.selected = true;
      }
      select.appendChild(node);
    });
  }

  protected populateLootSelect() {
    const select = document.getElementById("loot-select") as HTMLSelectElement | null;
    if (!select) {
      return;
    }
    select.innerHTML = "";
    this.lootTables.forEach((table, index) => {
      const node = document.createElement("option");
      node.value = table.id;
      node.textContent = table.label;
      if (index === 0) {
        node.selected = true;
      }
      select.appendChild(node);
    });
  }

  protected populateRecipeSelects() {
    const equipSelect = document.getElementById("equipment-recipe-select") as HTMLSelectElement | null;
    const consumableSelect = document.getElementById("consumable-recipe-select") as HTMLSelectElement | null;

    if (equipSelect) {
      const previous = equipSelect.value;
      equipSelect.innerHTML = "";
      this.recipes
        .filter((recipe) => recipe.type === "equipment")
        .forEach((recipe) => {
          const def = this.itemDefs.get(recipe.result);
          const option = document.createElement("option");
          option.value = recipe.id;
          option.textContent = `${def?.name ?? recipe.result} (${recipe.tier})`;
          if (previous === recipe.id) {
            option.selected = true;
          }
          equipSelect.appendChild(option);
        });
      if (!equipSelect.value && equipSelect.options.length) {
        equipSelect.selectedIndex = 0;
      }
    }

    if (consumableSelect) {
      const previous = consumableSelect.value;
      consumableSelect.innerHTML = "";
      this.recipes
        .filter((recipe) => recipe.type === "consumable")
        .forEach((recipe) => {
          const def = this.itemDefs.get(recipe.result);
          const option = document.createElement("option");
          option.value = recipe.id;
          option.textContent = `${def?.name ?? recipe.result} (${recipe.tier})`;
          if (previous === recipe.id) {
            option.selected = true;
          }
          consumableSelect.appendChild(option);
        });
      if (!consumableSelect.value && consumableSelect.options.length) {
        consumableSelect.selectedIndex = 0;
      }
    }

    this.updateCraftingAvailability();
  }

  protected resetEncounter(freshHero: boolean) {
    if (!this.heroOptions.length) {
      console.warn("[Harness] No hero options available");
      return;
    }

    if (!this.ensureHero(freshHero)) {
      return;
    }

    if (freshHero) {
      this.history = [];
      this.historyCounter = 0;
      this.renderHistory();
      this.materialsStock = {};
      this.equippedItems = {
        MainHand: null,
        OffHand: null,
        Head: null,
        Chest: null,
      };
      this.consumables = {};
      this.equipmentInventory = [];
      this.totalRewards = createEmptyRewards();
      this.lastRewards = createEmptyRewards();
    }

    if (this.pendingSourceProgress && this.hero) {
      this.hero.restoreProgress(this.pendingSourceProgress);
      this.pendingSourceProgress = undefined;
      this.applyEquippedItems();
      this.renderStatsTable();
    }

    const stageSelect = document.getElementById("stage-select") as HTMLSelectElement | null;
    if (stageSelect) {
      const index = parseInt(stageSelect.value, 10);
      if (Number.isFinite(index)) {
        this.stageIndex = Math.max(0, Math.min(index, this.stages.length - 1));
      }
    }

    this.stageWaveCompleted = Math.max(0, Math.min(this.stageWaveCompleted, this.currentStage().waves - 1));
    this.currentWaveQueue = [];
    this.currentWaveNumber = 0;
    this.currentStageName = this.currentStage().name;
    this.currentEnemyLabel = "";
    this.currentWaveIsBoss = false;

    this.hero?.resetVitals();
    this.enemy = null;
    this.encounter = null;
    this.running = false;
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }

    this.telemetry.hero = createTelemetryBucket();
    this.telemetry.enemy = createTelemetryBucket();
    this.renderTelemetry();

    this.rewardClaimed = false;
    this.resumeAfterVictory = false;
    this.lastRewards = this.lastRewards ?? createEmptyRewards();

    this.prepareNextWave();
    this.renderEquipment();
    this.populateRecipeSelects();
    this.startNextEncounter(freshHero);
    this.persistState();
  }

  protected ensureHero(fresh: boolean): boolean {
    const select = document.getElementById("hero-select") as HTMLSelectElement | null;
    const heroId = select?.value ?? this.heroOptions[0].id;
    if (!fresh && this.hero && this.heroOptions.some((option) => option.id === heroId)) {
      return true;
    }

    const preset = this.heroOptions.find((option) => option.id === heroId) ?? this.heroOptions[0];
    this.hero = new Character(this.cloneData(preset.data));
    this.applyEquippedItems();
    this.renderStatsTable();
    return true;
  }

  protected currentStage(): StageDefinition {
    if (!this.stages.length) {
      this.stages = [
        {
          name: "Endless",
          waves: 999,
          composition: [{ small: 1 }, { small: 2 }],
          finalBoss: { boss: 1 },
        },
      ];
    }
    if (this.stageIndex >= this.stages.length) {
      this.stageIndex = this.stages.length - 1;
    }
    if (this.stageIndex < 0) {
      this.stageIndex = 0;
    }
    return this.stages[this.stageIndex];
  }

  protected prepareNextWave(): boolean {
    let stage = this.currentStage();

    if (this.stageWaveCompleted >= stage.waves) {
      if (this.stageIndex < this.stages.length - 1) {
        this.stageIndex += 1;
      }
      this.stageWaveCompleted = 0;
      stage = this.currentStage();
    }

    const compositionList = stage.composition && stage.composition.length ? stage.composition : [{ small: 1 }];
    const waveIndex = this.stageWaveCompleted;
    const isFinalWave = waveIndex === (stage.waves ?? compositionList.length) - 1;
    const pattern = isFinalWave
      ? stage.finalBoss ?? { boss: 1 }
      : compositionList[waveIndex % compositionList.length];

    const stageSelect = document.getElementById("stage-select") as HTMLSelectElement | null;
    if (stageSelect && stageSelect.value !== String(this.stageIndex)) {
      stageSelect.value = String(this.stageIndex);
    }

    const queue: EnemyUnit[] = [];
    Object.entries(pattern).forEach(([tier, amount]) => {
      const total = Math.max(0, Math.floor(amount));
      for (let i = 0; i < total; i += 1) {
        const unit = this.pickEnemyFromTier(tier);
        if (unit) {
          queue.push(unit);
        }
      }
    });

    if (!queue.length) {
      const fallbackOrder = isFinalWave ? ["boss", "medium", "small"] : ["small", "medium", "boss"];
      let fallback: EnemyUnit | null = null;
      for (const tier of fallbackOrder) {
        fallback = this.pickEnemyFromTier(tier);
        if (fallback) {
          break;
        }
      }
      if (fallback) {
        queue.push(fallback);
      } else {
        console.warn("[Harness] No enemies available for wave");
        return false;
      }
    }

    this.currentWaveQueue = queue;
    this.currentWaveNumber = this.totalWavesCompleted + 1;
    this.currentStageName = stage.name;
    this.applyStageLoot(stage.lootTable);
    this.currentWaveIsBoss = isFinalWave;
    return true;
  }

  protected pickEnemyFromTier(tier: string): EnemyUnit | null {
    const pool = this.enemyPools[tier] ?? [];
    if (pool.length) {
      const index = Math.floor(Math.random() * pool.length);
      const source = pool[index];
      return {
        id: source.id,
        label: source.label,
        tier: source.tier,
        data: this.cloneData(source.data),
      };
    }

    const fallbacks = ["small", "medium", "boss"].filter((t) => t !== tier);
    for (const fallbackTier of fallbacks) {
      const fallbackPool = this.enemyPools[fallbackTier] ?? [];
      if (fallbackPool.length) {
        const index = Math.floor(Math.random() * fallbackPool.length);
        const source = fallbackPool[index];
        return {
          id: source.id,
          label: source.label,
          tier: source.tier,
          data: this.cloneData(source.data),
        };
      }
    }

    return null;
  }

  protected startNextEncounter(autoStart = false) {
    if (!this.hero || !this.hero.isAlive) {
      return;
    }

    if (!this.currentWaveQueue.length && !this.prepareNextWave()) {
      return;
    }

    const unit = this.currentWaveQueue.shift();
    if (!unit) {
      return;
    }

    this.enemy = new Character(this.cloneData(unit.data));
    this.enemy.resetVitals();
    this.currentEnemyLabel = unit.label;

    this.tryUseConsumables();

    this.encounter = new EncounterLoop(this.sim, this.hero, this.enemy, {
      tickInterval: this.tickIntervalSeconds,
      rewardConfig: this.rewardConfig,
    });

    this.telemetry.hero = createTelemetryBucket();
    this.telemetry.enemy = createTelemetryBucket();
    this.renderTelemetry();

    this.rewardClaimed = false;
    this.resumeAfterVictory = autoStart;

    console.log(
      `[Encounter] ${this.currentStageName} — Wave ${this.currentWaveNumber} vs ${unit.label}`
    );

    if (autoStart) {
      this.startAuto();
    } else {
      this.running = false;
      this.updateCraftingAvailability();
    }
  }

  protected handleHeroVictory() {
    if (!this.hero) {
      return;
    }

    const summary = this.encounter?.getSummary() ?? null;
    this.recordHistoryEntry("Victory", summary);
    this.renderHistory();

    if (this.currentWaveQueue.length) {
      const autoResume = this.running;
      this.encounter = null;
      this.startNextEncounter(autoResume);
      if (!autoResume) {
        this.updateCraftingAvailability();
      }
      this.persistState();
      return;
    }

    const wasBossWave = this.currentWaveIsBoss;
    const clearedStageName = this.currentStageName;
    const clearedStageIndex = this.stageIndex;

    this.completeWave();
    const hasNext = this.prepareNextWave();

    if (!hasNext) {
      console.log("[Encounter] Stages exhausted.");
      this.stopAuto();
      this.encounter = null;
      this.running = false;
      this.renderEquipment();
      this.updateCraftingAvailability();
      this.pushLog(`[Stage] ${clearedStageName} cleared. All stages complete.`);
      this.persistState();
      return;
    }

    if (wasBossWave) {
      this.stopAuto();
      this.encounter = null;
      this.running = false;
      this.renderEquipment();
      this.updateCraftingAvailability();
      this.pushLog(
        `[Stage] ${clearedStageName} cleared. Prepare for ${this.currentStageName}.`
      );
      this.persistState();
      return;
    }

    const auto = this.running;
    this.encounter = null;
    this.startNextEncounter(auto);
    if (!auto) {
      this.renderEquipment();
      this.updateCraftingAvailability();
      this.pushLog(
        `[Stage] ${this.currentStageName} — wave ${this.currentWaveNumber} ready. Craft or press Start.`
      );
    }
    this.persistState();
  }

  protected handleHeroDefeat() {
    console.log("[Encounter] Hero defeated. Simulation halted.");
    const summary = this.encounter?.getSummary() ?? null;
    this.recordHistoryEntry("Defeat", summary);
    this.renderHistory();
    const bossWave = this.currentWaveIsBoss;

    this.stopAuto();
    this.encounter = null;
    this.running = false;

    if (this.hero) {
      this.hero.resetVitals();
      this.renderStatsTable();
    }

    if (bossWave) {
      this.stageWaveCompleted = 0;
      this.currentWaveQueue = [];
      this.currentWaveNumber = 0;
      this.currentEnemyLabel = "";
      this.currentWaveIsBoss = false;
      if (this.prepareNextWave()) {
        this.pushLog(
          `[Boss] ${this.currentStageName} boss repelled the hero. Clear earlier waves to regroup before the next attempt.`
        );
      } else {
        console.warn("[Harness] Failed to reset stage after boss defeat.");
      }
    } else {
      this.pushLog("[Encounter] Defeat. Adjust gear or craft before retrying.");
    }

    this.renderEquipment();
    this.updateCraftingAvailability();
    this.persistState();
  }

  protected completeWave() {
    this.stageWaveCompleted += 1;
    this.totalWavesCompleted += 1;
    this.currentWaveQueue = [];
    this.currentWaveIsBoss = false;
  }

  protected applyStageLoot(lootId?: string) {
    if (!lootId) {
      return;
    }
    this.selectLootTable(lootId, { persist: false });
  }

  protected applyEquippedItems() {
    if (!this.hero) {
      return;
    }

    Object.entries(this.equippedItems).forEach(([slot, owned]) => {
      if (!owned) {
        return;
      }
      const def = this.itemDefs.get(owned.itemId);
      if (!def) {
        return;
      }
      const equipment = this.createEquipment(def, owned);
      if (!equipment) {
        return;
      }
      this.hero!.equipItem(equipment);
    });
  }

  protected createEquipment(def: ItemDefinition, owned?: OwnedEquipment | null): EquipmentItem | null {
    if (!def.slot) {
      return null;
    }
    const slotKey = def.slot as keyof typeof EquipmentSlot;
    const slot = EquipmentSlot[slotKey];
    if (slot === undefined) {
      return null;
    }

    const rarity: ItemRarity = owned?.rarity ?? "common";
    const upgradeLevel = Math.max(0, owned?.upgradeLevel ?? 0);
    const maxUpgradeLevel = Math.max(upgradeLevel, owned?.maxUpgradeLevel ?? def.maxUpgradeLevel ?? 0);
    const socketSlots = Math.max(0, owned?.socketSlots ?? def.socketSlots ?? 0);
    const augments = owned?.augments ? [...owned.augments] : [];
    const rarityMultiplier = getRarityMultiplier(rarity);
    const upgradeMultiplier = 1 + upgradeLevel * UPGRADE_SCALE_PER_LEVEL;
    const totalMultiplier = rarityMultiplier * upgradeMultiplier;

    if (def.type === "weapon" && def.weapon) {
      const stats = new WeaponStatBlock();
      stats.reset();
      if (def.stats) {
        stats.applyDelta(def.stats);
      }
      scaleStatBlockValues(stats, totalMultiplier);
      stats.minDamage = Math.max(1, Math.round(def.weapon.minDamage * totalMultiplier));
      stats.maxDamage = Math.max(stats.minDamage, Math.round(def.weapon.maxDamage * totalMultiplier));
      stats.delay = def.weapon.delay;
      this.applyAugmentBonuses(stats, augments);

      const equipment: EquipmentItem = {
        id: def.id,
        name: def.name,
        description: "",
        stackSize: 0,
        type: ItemType.Weapon,
        stats,
        slot,
        rarity,
        upgradeLevel,
        maxUpgradeLevel,
        socketSlots,
        augments,
      };
      return equipment;
    }

    if (def.type === "armor") {
      const stats = new ArmorStatBlock();
      stats.reset();
      if (def.stats) {
        stats.applyDelta(def.stats);
      }
      scaleStatBlockValues(stats, totalMultiplier);
      stats.armor = Math.max(0, Math.round((def.armor?.armor ?? 0) * totalMultiplier));
      this.applyAugmentBonuses(stats, augments);

      const equipment: EquipmentItem = {
        id: def.id,
        name: def.name,
        description: "",
        stackSize: 0,
        type: ItemType.Armor,
        stats,
        slot,
        rarity,
        upgradeLevel,
        maxUpgradeLevel,
        socketSlots,
        augments,
      };
      return equipment;
    }

    return null;
  }

  protected applyAugmentBonuses(stats: StatBlock, augmentIds: string[]) {
    augmentIds.forEach((augmentId) => {
      const augmentDef = this.itemDefs.get(augmentId);
      const bonuses = augmentDef?.augment?.stats;
      if (bonuses) {
        stats.applyDelta(bonuses as Partial<StatBlockData>);
      }
    });
  }

  protected hasMaterials(cost: Record<string, number> = {}): boolean {
    return Object.entries(cost).every(
      ([id, qty]) => (this.materialsStock[id] ?? 0) >= qty
    );
  }

  protected consumeMaterials(cost: Record<string, number> = {}) {
    Object.entries(cost).forEach(([id, qty]) => {
      this.materialsStock[id] = Math.max(0, (this.materialsStock[id] ?? 0) - qty);
    });
    this.updateCraftingAvailability();
  }

  protected addMaterials(materials: Record<string, number> = {}) {
    Object.entries(materials).forEach(([id, qty]) => {
      this.materialsStock[id] = (this.materialsStock[id] ?? 0) + qty;
    });
    this.updateCraftingAvailability();
  }

  protected addEquipmentToInventory(owned: OwnedEquipment) {
    this.equipmentInventory.push(owned);
    this.updateCraftingAvailability();
  }

  protected removeEquipmentFromInventory(instanceId: string): OwnedEquipment | null {
    const index = this.equipmentInventory.findIndex((item) => item.instanceId === instanceId);
    if (index === -1) {
      return null;
    }
    const [removed] = this.equipmentInventory.splice(index, 1);
    this.updateCraftingAvailability();
    return removed;
  }

  protected createOwnedEquipmentInstance(itemId: string, rarity: ItemRarity = "common"): OwnedEquipment | null {
    const def = this.itemDefs.get(itemId);
    if (!def) {
      console.warn(`[Harness] Unknown equipment '${itemId}'.`);
      return null;
    }
    const instanceId = `${itemId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    return {
      instanceId,
      itemId: def.id,
      rarity,
      upgradeLevel: 0,
      maxUpgradeLevel: Math.max(
        0,
        def.upgrades ? def.upgrades.length : def.maxUpgradeLevel ?? 3
      ),
      socketSlots: Math.max(0, def.socketSlots ?? 0),
      augments: [],
    };
  }

  protected craftEquipment(recipeId: string): boolean {
    const recipe = this.recipeMap.get(recipeId);
    if (!recipe || recipe.type !== "equipment") {
      this.pushLog(`[Craft] Unknown equipment recipe '${recipeId}'.`);
      return false;
    }
    const def = this.itemDefs.get(recipe.result);
    if (!def || !def.slot) {
      this.pushLog(`[Craft] Missing definition for '${recipe.result}'.`);
      return false;
    }
    if (!this.hasMaterials(recipe.cost)) {
      this.pushLog(`[Craft] Not enough materials for ${def.name}.`);
      return false;
    }
    const owned = this.createOwnedEquipmentInstance(def.id, "common");
    if (!owned) {
      this.pushLog(`[Craft] Cannot forge ${def.name}.`);
      return false;
    }
    this.consumeMaterials(recipe.cost);
    this.addEquipmentToInventory(owned);
    this.pushLog(`[Craft] Forged ${def.name} (${owned.rarity}).`);
    const slotKey = def.slot as EquippedSlotKey;
    if (!this.equippedItems[slotKey]) {
      this.equipOwnedFromInventory(owned.instanceId);
    } else {
      this.renderEquipment();
      this.persistState();
    }
    return true;
  }

  protected craftConsumable(recipeId: string): boolean {
    const recipe = this.recipeMap.get(recipeId);
    if (!recipe || recipe.type !== "consumable") {
      this.pushLog(`[Craft] Unknown consumable recipe '${recipeId}'.`);
      return false;
    }
    if (!this.hasMaterials(recipe.cost)) {
      this.pushLog(`[Craft] Not enough materials for ${recipe.result}.`);
      return false;
    }
    const def = this.itemDefs.get(recipe.result);
    this.consumeMaterials(recipe.cost);
    this.consumables[recipe.result] = (this.consumables[recipe.result] ?? 0) + 1;
    this.pushLog(`[Craft] Prepared ${def?.name ?? recipe.result}.`);
    this.renderEquipment();
    this.persistState();
    return true;
  }

  protected equipOwnedFromInventory(instanceId: string): boolean {
    if (!this.hero) {
      this.pushLog(`[Equip] No hero available.`);
      this.updateCraftingAvailability();
      return false;
    }

    const index = this.equipmentInventory.findIndex((item) => item.instanceId === instanceId);
    if (index === -1) {
      this.pushLog(`[Equip] Item not found in inventory.`);
      this.updateCraftingAvailability();
      return false;
    }

    const owned = this.equipmentInventory[index];
    const def = this.itemDefs.get(owned.itemId);
    if (!def || !def.slot) {
      this.pushLog(`[Equip] Unknown equipment '${owned.itemId}'.`);
      this.updateCraftingAvailability();
      return false;
    }

    const equipment = this.createEquipment(def, owned);
    if (!equipment) {
      this.pushLog(`[Equip] Cannot equip ${def.name}.`);
      this.updateCraftingAvailability();
      return false;
    }

    const slotKey = def.slot as EquippedSlotKey;
    const previousOwned = this.equippedItems[slotKey] ?? null;
    this.hero.equipItem(equipment);

    this.equipmentInventory.splice(index, 1);
    if (previousOwned) {
      this.equipmentInventory.push(previousOwned);
    }
    this.equippedItems[slotKey] = owned;
    this.pushLog(`[Equip] ${def.name} (${owned.rarity}) equipped.`);
    this.renderStatsTable();
    this.renderEquipment();
    this.persistState();
    this.updateCraftingAvailability();
    return true;
  }

  protected equipFirstMatchingItem(itemId: string): boolean {
    const owned = this.equipmentInventory.find((item) => item.itemId === itemId);
    if (!owned) {
      this.pushLog(`[Equip] ${itemId} not found in inventory.`);
      this.updateCraftingAvailability();
      return false;
    }
    return this.equipOwnedFromInventory(owned.instanceId);
  }

  protected mergeEquipmentRewards(target: RewardEquipmentItem[], source: RewardEquipmentItem[] = []) {
    source.forEach((entry) => {
      const existing = target.find((item) => item.itemId === entry.itemId && item.rarity === entry.rarity);
      if (existing) {
        existing.quantity += entry.quantity;
      } else {
        target.push({ itemId: entry.itemId, rarity: entry.rarity, quantity: entry.quantity });
      }
    });
  }

  protected mergeAugmentRewards(target: RewardAugmentItem[], source: RewardAugmentItem[] = []) {
    source.forEach((entry) => {
      const existing = target.find((item) => item.augmentId === entry.augmentId);
      if (existing) {
        existing.quantity += entry.quantity;
      } else {
        target.push({ augmentId: entry.augmentId, quantity: entry.quantity });
      }
    });
  }

  protected grantEquipmentRewards(list: RewardEquipmentItem[] = []) {
    list.forEach((entry) => {
      for (let index = 0; index < entry.quantity; index += 1) {
        const owned = this.createOwnedEquipmentInstance(entry.itemId, entry.rarity);
        if (owned) {
          this.addEquipmentToInventory(owned);
        }
      }
    });
  }

  protected grantAugmentRewards(list: RewardAugmentItem[] = []) {
    list.forEach((entry) => {
      this.consumables[entry.augmentId] = (this.consumables[entry.augmentId] ?? 0) + entry.quantity;
    });
  }

  protected getOwnedEquipment(instanceId: string): OwnedEquipment | null {
    const inventoryItem = this.equipmentInventory.find((item) => item.instanceId === instanceId);
    if (inventoryItem) {
      return inventoryItem;
    }
    const slot = this.findEquippedSlot(instanceId);
    if (slot) {
      return this.equippedItems[slot] ?? null;
    }
    return null;
  }

  protected findEquippedSlot(instanceId: string): EquippedSlotKey | null {
    for (const [slot, owned] of Object.entries(this.equippedItems) as Array<[
      EquippedSlotKey,
      OwnedEquipment | null
    ]>) {
      if (owned && owned.instanceId === instanceId) {
        return slot;
      }
    }
    return null;
  }

  protected getUpgradeMaterials(def: ItemDefinition | undefined, owned: OwnedEquipment): Record<string, number> | null {
    if (!def || (def.type !== "weapon" && def.type !== "armor")) {
      return null;
    }
    if (owned.upgradeLevel >= owned.maxUpgradeLevel) {
      return null;
    }
    if (def.upgrades && def.upgrades.length) {
      const tierIndex = Math.min(owned.upgradeLevel, def.upgrades.length - 1);
      const tier = def.upgrades[tierIndex];
      if (!tier || !tier.materials) {
        return null;
      }
      const normalized = Object.entries(tier.materials).reduce<Record<string, number>>((acc, [id, amount]) => {
        const value = Math.max(1, Math.floor(Number(amount) || 0));
        if (value > 0) {
          acc[id] = value;
        }
        return acc;
      }, {});
      if (!Object.keys(normalized).length) {
        return null;
      }
      return normalized;
    }
    const materialId = def.type === "weapon" ? "weapon-essence" : "armor-essence";
    const base = def.type === "weapon" ? 2 : 2;
    const scale = def.type === "weapon" ? 2 : 3;
    const amount = base + owned.upgradeLevel * scale;
    return { [materialId]: amount };
  }

  protected canUpgradeEquipment(owned: OwnedEquipment): boolean {
    const def = this.itemDefs.get(owned.itemId);
    const materials = this.getUpgradeMaterials(def, owned);
    if (!materials) {
      return false;
    }
    return Object.entries(materials).every(
      ([id, amount]) => (this.materialsStock[id] ?? 0) >= amount
    );
  }

  protected describeUpgrade(def: ItemDefinition | undefined, owned: OwnedEquipment): {
    label: string;
    title: string;
    disabled: boolean;
  } {
    const materials = this.getUpgradeMaterials(def, owned);
    if (!materials) {
      return {
        label: "Upgrade (Max)",
        title: "Maximum upgrade level reached",
        disabled: true,
      };
    }
    const parts: string[] = [];
    let hasAll = true;
    Object.entries(materials).forEach(([id, amount]) => {
      const ownedQty = this.materialsStock[id] ?? 0;
      const has = ownedQty >= amount;
      if (!has) {
        hasAll = false;
      }
      parts.push(`${id} x${amount} (have ${ownedQty})`);
    });
    const labelParts = Object.entries(materials).map(([id, amount]) => `${id} x${amount}`);
    return {
      label: `Upgrade (${labelParts.join(", ")})`,
      title: hasAll
        ? `Spend ${parts.join(", ")}`
        : `Needs ${parts.join(", ")}`,
      disabled: !hasAll,
    };
  }

  protected describeSocket(owned: OwnedEquipment): {
    label: string;
    title: string;
    disabled: boolean;
  } {
    if (owned.socketSlots <= 0) {
      return {
        label: "Socket",
        title: "This item has no sockets",
        disabled: true,
      };
    }
    if (owned.augments.length >= owned.socketSlots) {
      return {
        label: `Socket ${owned.augments.length}/${owned.socketSlots}`,
        title: "All sockets are filled",
        disabled: true,
      };
    }
    const available = this.getAvailableAugmentIds();
    if (!available.length) {
      return {
        label: `Socket ${owned.augments.length}/${owned.socketSlots}`,
        title: "You do not have any augments in inventory",
        disabled: true,
      };
    }
    return {
      label: `Socket ${owned.augments.length}/${owned.socketSlots}`,
      title: `Choose an augment (${available.join(", ")})`,
      disabled: false,
    };
  }

  protected upgradeEquipment(instanceId: string): boolean {
    const owned = this.getOwnedEquipment(instanceId);
    if (!owned) {
      this.pushLog(`[Upgrade] Item not found.`);
      return false;
    }
    const def = this.itemDefs.get(owned.itemId);
    const materials = this.getUpgradeMaterials(def, owned);
    if (!def || !materials) {
      this.pushLog(`[Upgrade] ${owned.itemId} cannot be upgraded further.`);
      return false;
    }
    const missing = Object.entries(materials).filter(
      ([id, amount]) => (this.materialsStock[id] ?? 0) < amount
    );
    if (missing.length) {
      const parts = missing
        .map(([id, amount]) => `${id} x${amount} (have ${this.materialsStock[id] ?? 0})`)
        .join(", ");
      this.pushLog(`[Upgrade] Need ${parts}.`);
      this.updateCraftingAvailability();
      this.renderEquipment();
      return false;
    }

    Object.entries(materials).forEach(([id, amount]) => {
      this.materialsStock[id] = (this.materialsStock[id] ?? 0) - amount;
    });
    owned.upgradeLevel = Math.min(owned.maxUpgradeLevel, owned.upgradeLevel + 1);

    const slot = this.findEquippedSlot(instanceId);
    if (slot && this.hero) {
      const equipment = this.createEquipment(def, owned);
      if (equipment) {
        this.hero.equipItem(equipment);
        this.renderStatsTable();
      }
    }

    const parts = Object.entries(materials)
      .map(([id, amount]) => `${id} x${amount}`)
      .join(", ");
    this.pushLog(
      `[Upgrade] ${def?.name ?? owned.itemId} -> +${owned.upgradeLevel} (spent ${parts}).`
    );
    this.renderEquipment();
    this.updateCraftingAvailability();
    this.persistState();
    return true;
  }

  protected getSalvageResult(def: ItemDefinition | undefined, owned: OwnedEquipment): {
    materialId: string;
    amount: number;
  } | null {
    if (!def || (def.type !== "weapon" && def.type !== "armor")) {
      return null;
    }
    const materialId = def.type === "weapon" ? "weapon-essence" : "armor-essence";
    const base = SALVAGE_VALUE_BY_RARITY[owned.rarity] ?? 1;
    const bonus = owned.upgradeLevel;
    const amount = Math.max(1, base + bonus);
    return { materialId, amount };
  }

  protected describeSalvage(def: ItemDefinition | undefined, owned: OwnedEquipment): {
    label: string;
    title: string;
    disabled: boolean;
  } {
    const result = this.getSalvageResult(def, owned);
    if (!result) {
      return {
        label: "Salvage",
        title: "Cannot salvage this item",
        disabled: true,
      };
    }
    return {
      label: `Salvage (+${result.amount} ${result.materialId})`,
      title: `Convert to ${result.materialId} x${result.amount}`,
      disabled: false,
    };
  }

  protected canSalvage(instanceId: string): boolean {
    return this.equipmentInventory.some((item) => item.instanceId === instanceId);
  }

  protected salvageEquipment(instanceId: string): boolean {
    const index = this.equipmentInventory.findIndex((item) => item.instanceId === instanceId);
    if (index === -1) {
      this.pushLog(`[Salvage] Item must be unequipped before salvaging.`);
      return false;
    }

    const owned = this.equipmentInventory[index];
    const def = this.itemDefs.get(owned.itemId);
    const result = this.getSalvageResult(def, owned);
    if (!result) {
      this.pushLog(`[Salvage] ${owned.itemId} cannot be salvaged.`);
      return false;
    }

    this.equipmentInventory.splice(index, 1);
    this.materialsStock[result.materialId] =
      (this.materialsStock[result.materialId] ?? 0) + result.amount;

    this.pushLog(
      `[Salvage] ${def?.name ?? owned.itemId} dismantled for ${result.materialId} x${result.amount}.`
    );
    this.renderEquipment();
    this.updateCraftingAvailability();
    this.persistState();
    return true;
  }

  protected getAvailableAugmentIds(): string[] {
    return Object.entries(this.consumables)
      .filter(([, qty]) => qty > 0)
      .map(([id]) => id)
      .filter((id) => this.itemDefs.get(id)?.type === "augment");
  }

  protected canSocketEquipment(owned: OwnedEquipment): boolean {
    if (owned.socketSlots <= 0) {
      return false;
    }
    if (owned.augments.length >= owned.socketSlots) {
      return false;
    }
    return this.getAvailableAugmentIds().length > 0;
  }

  protected socketAugment(instanceId: string): boolean {
    const owned = this.getOwnedEquipment(instanceId);
    if (!owned) {
      this.pushLog(`[Augment] Item not found.`);
      return false;
    }
    if (owned.socketSlots <= 0) {
      this.pushLog(`[Augment] ${owned.itemId} has no sockets.`);
      return false;
    }
    if (owned.augments.length >= owned.socketSlots) {
      this.pushLog(`[Augment] All sockets are filled.`);
      return false;
    }
    const available = this.getAvailableAugmentIds();
    if (!available.length) {
      this.pushLog(`[Augment] No augments available.`);
      return false;
    }

    let chosen = available[0];
    if (available.length > 1) {
      const promptValue = window.prompt(
        `Choose augment (${available.join(", ")})`,
        chosen
      );
      if (!promptValue) {
        return false;
      }
      const trimmed = promptValue.trim();
      if (!available.includes(trimmed)) {
        this.pushLog(`[Augment] ${promptValue} is unavailable.`);
        return false;
      }
      chosen = trimmed;
    }

    this.consumables[chosen] = Math.max(0, (this.consumables[chosen] ?? 0) - 1);
    owned.augments.push(chosen);

    const def = this.itemDefs.get(owned.itemId);
    const slot = this.findEquippedSlot(instanceId);
    if (slot && this.hero && def) {
      const equipment = this.createEquipment(def, owned);
      if (equipment) {
        this.hero.equipItem(equipment);
        this.renderStatsTable();
      }
    }

    const augmentName = this.itemDefs.get(chosen)?.name ?? chosen;
    this.pushLog(`[Augment] ${def?.name ?? owned.itemId} gains ${augmentName}.`);
    this.renderEquipment();
    this.updateCraftingAvailability();
    this.persistState();
    return true;
  }

  protected useConsumable(consumableId: string): boolean {
    if (!this.hero) {
      return false;
    }
    if ((this.consumables[consumableId] ?? 0) <= 0) {
      this.pushLog(`[Consumable] ${consumableId} not available.`);
      return false;
    }
    const def = this.itemDefs.get(consumableId);
    if (!def || !def.effect || def.effect.kind !== "heal") {
      this.pushLog(`[Consumable] ${consumableId} cannot be used.`);
      return false;
    }
    this.consumables[consumableId] = Math.max(0, (this.consumables[consumableId] ?? 0) - 1);
    this.hero.healPercent(def.effect.percent ?? 0.5);
    this.pushLog(
      `[Consumable] Hero uses ${def.name ?? consumableId} (+${Math.round((def.effect.percent ?? 0.5) * 100)}% HP)`
    );
    this.renderStatsTable();
    this.renderEquipment();
    this.persistState();
    this.updateCraftingAvailability();
    return true;
  }

  protected recordHistoryEntry(
    result: "Victory" | "Defeat",
    summary: EncounterSummary | null
  ) {
    if (!summary) {
      return;
    }

    const heroHp = this.hero
      ? `${Math.round(this.hero.health)} / ${Math.round(this.hero.maxHealth)}`
      : "-";
    const enemyHp = this.enemy
      ? `${Math.round(this.enemy.health)} / ${Math.round(this.enemy.maxHealth)}`
      : "-";

    const rewards = normalizeRewards(summary.rewards);

    const entry: EncounterHistoryEntry = {
      index: ++this.historyCounter,
      stage: this.currentStageName || "-",
      wave: this.currentWaveNumber,
      opponent: this.currentEnemyLabel || "-",
      result,
      heroHP: heroHp,
      enemyHP: enemyHp,
      rewards,
    };

    this.history.push(entry);
    if (this.history.length > 100) {
      this.history.splice(0, this.history.length - 100);
    }
  }

  protected tryUseConsumables() {
    if (!this.hero) {
      return;
    }

    const hpRatio = this.hero.health / this.hero.maxHealth;
    if (hpRatio >= 0.6) {
      return;
    }

    const potionId = this.consumables["greater-healing-potion"]
      ? "greater-healing-potion"
      : this.consumables["healing-potion"]
      ? "healing-potion"
      : null;

    if (!potionId) {
      return;
    }

    this.useConsumable(potionId);
  }

  protected selectLootTable(id: string | null, options: { persist?: boolean } = {}) {
    if (!id) {
      if (!options.persist) {
        return;
      }
      this.selectedLootId = null;
      this.rewardConfig = {
        xpPerWin: 0,
        equipmentDrops: [],
        augmentDrops: [],
        materialDrops: [],
      };
      this.persistState();
      return;
    }

    const record = this.lootTables.find((table) => table.id === id);
    if (!record) {
      console.warn(`[Harness] Loot table '${id}' not found.`);
      return;
    }

    this.selectedLootId = record.id;
    this.rewardConfig = {
      xpPerWin: record.config.xpPerWin ?? 0,
      goldMin: record.config.goldMin ?? 0,
      goldMax: record.config.goldMax ?? record.config.goldMin ?? 0,
      materialDrops: record.config.materialDrops
        ? record.config.materialDrops.map((drop) => ({ ...drop }))
        : [],
      equipmentDrops: record.config.equipmentDrops
        ? record.config.equipmentDrops.map((drop) => ({ ...drop }))
        : [],
      augmentDrops: record.config.augmentDrops
        ? record.config.augmentDrops.map((drop) => ({ ...drop }))
        : [],
    };

    const lootSelect = document.getElementById("loot-select") as HTMLSelectElement | null;
    if (lootSelect && lootSelect.value !== record.id) {
      lootSelect.value = record.id;
    }

    if (options.persist !== false) {
      this.persistState();
    }
  }

  protected startAuto() {
    if (!this.encounter) {
      return;
    }
    this.encounter.setTickInterval(this.tickIntervalSeconds);
    this.encounter.start();
    this.running = true;
    this.lastTimestamp = performance.now();
    if (this.rafHandle === null) {
      this.rafHandle = requestAnimationFrame(this.onFrame);
    }
  }

  protected stopAuto() {
    this.encounter?.stop();
    this.running = false;
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
  }

  protected onFrame = (time: number) => {
    if (!this.encounter || !this.running) {
      this.rafHandle = null;
      return;
    }

    const delta = (time - this.lastTimestamp) / 1000;
    this.lastTimestamp = time;

    const events = this.encounter.tick(delta);
    if (events.length) {
      events.forEach((event: EncounterEvent) => {
        const role = event.attacker === this.hero ? "hero" : "enemy";
        const bucket = this.telemetry[role];
        bucket.attempts += 1;
        switch (event.result) {
          case "hit":
            bucket.hits += 1;
            bucket.totalDamage += Math.max(0, event.damage);
            if (event.critical) {
              bucket.crits += 1;
            }
            break;
          case "miss":
            bucket.misses += 1;
            break;
          case "dodge":
            bucket.dodges += 1;
            break;
          case "parry":
            bucket.parries += 1;
            break;
        }

        const attackerLabel = event.attacker === this.hero ? "Hero" : "Enemy";
        const defenderLabel = event.defender === this.hero ? "Hero" : "Enemy";
        const stamp = event.timestamp.toFixed(2);
        const hand = event.hand === "main" ? "main" : "off";
        switch (event.result) {
          case "miss":
            this.pushLog(`[${stamp}s][${hand}] ${attackerLabel} swings at ${defenderLabel} and misses.`);
            break;
          case "dodge":
            this.pushLog(`[${stamp}s][${hand}] ${defenderLabel} dodges ${attackerLabel}.`);
            break;
          case "parry":
            this.pushLog(`[${stamp}s][${hand}] ${defenderLabel} parries ${attackerLabel}.`);
            break;
          case "hit":
          default: {
            const dmg = Math.round(event.damage);
            const crit = event.critical ? " CRIT!" : "";
            this.pushLog(`[${stamp}s][${hand}] ${attackerLabel} hits ${defenderLabel} for ${dmg}.${crit}`);
            break;
          }
        }
      });
      this.renderTelemetry();
    }

    const summary = this.encounter.getSummary();
    this.refreshStatus();

    if (summary.victor === "source") {
      this.handleHeroVictory();
    } else if (summary.victor === "target") {
      this.handleHeroDefeat();
      return;
    }

    this.claimRewardsIfReady(summary);

    if (!this.running) {
      this.rafHandle = null;
      return;
    }

    this.rafHandle = requestAnimationFrame(this.onFrame);
  };

  protected claimRewardsIfReady(summary: EncounterSummary) {
    if (this.rewardClaimed || summary.victor !== "source") {
      return;
    }

    const rewards = normalizeRewards(summary.rewards);
    this.lastRewards = normalizeRewards(summary.rewards);

    this.totalRewards.xp += rewards.xp;
    this.totalRewards.gold += rewards.gold;
    Object.entries(rewards.materials ?? {}).forEach(([id, qty]) => {
      this.totalRewards.materials[id] =
        (this.totalRewards.materials[id] ?? 0) + qty;
    });
    this.mergeEquipmentRewards(this.totalRewards.equipment, rewards.equipment);
    this.mergeAugmentRewards(this.totalRewards.augments, rewards.augments);

    this.addMaterials(rewards.materials ?? {});
    this.grantEquipmentRewards(rewards.equipment);
    this.grantAugmentRewards(rewards.augments);

    if (rewards.equipment && rewards.equipment.length) {
      this.pushLog(`[Loot] Equipment: ${this.formatEquipmentList(rewards.equipment)}`);
    }
    if (rewards.augments && rewards.augments.length) {
      this.pushLog(`[Loot] Augments: ${this.formatAugmentList(rewards.augments)}`);
    }

    if (this.hero && rewards.xp > 0) {
      const levels = this.hero.addExperience(rewards.xp);
      if (levels > 0) {
        this.renderStatsTable();
        this.renderEquipment();
      }
    }

    this.rewardClaimed = true;
    this.renderRewards();
    this.renderEquipment();
    this.persistState();
  }

  protected refreshStatus(force = false) {
    const statusNode = document.getElementById("status-text");
    const stageCell = document.getElementById("stage-cell");
    const waveCell = document.getElementById("wave-cell");
    const opponentCell = document.getElementById("opponent-cell");
    const elapsedCell = document.getElementById("elapsed-cell");
    const swingsCell = document.getElementById("swings-cell");
    const heroDmgCell = document.getElementById("hero-dmg-cell");
    const enemyDmgCell = document.getElementById("enemy-dmg-cell");
    const winnerCell = document.getElementById("winner-cell");

    const summary = this.encounter?.getSummary() ?? null;

    const runningState = this.encounter?.isRunning ?? false;
    if (statusNode) {
      let state = runningState ? "Running" : "Paused";
      if (!this.encounter) {
        state = "Idle";
      }
      const content = `${state} • tick ${this.tickIntervalSeconds.toFixed(2)}s`;
      if (force || statusNode.textContent !== content) {
        statusNode.textContent = content;
      }
    }

    if (stageCell) {
      stageCell.textContent = this.currentStageName || "-";
    }

    if (waveCell) {
      waveCell.textContent = `${this.currentWaveNumber}`;
    }

    if (opponentCell) {
      opponentCell.textContent = this.currentEnemyLabel || "-";
    }

    if (summary) {
      elapsedCell && (elapsedCell.textContent = `${summary.elapsedSeconds.toFixed(1)}s`);
      swingsCell && (swingsCell.textContent = `${summary.swings}`);
      heroDmgCell && (heroDmgCell.textContent = `${summary.totalDamageFromSource}`);
      enemyDmgCell && (enemyDmgCell.textContent = `${summary.totalDamageFromTarget}`);
      winnerCell && (winnerCell.textContent = summary.victor ?? "-");
    } else {
      elapsedCell && (elapsedCell.textContent = "0.0s");
      swingsCell && (swingsCell.textContent = "0");
      heroDmgCell && (heroDmgCell.textContent = "0");
      enemyDmgCell && (enemyDmgCell.textContent = "0");
      winnerCell && (winnerCell.textContent = "-");
    }
  }

  protected renderRewards() {
    const table = document.getElementById("reward-table");
    if (!table) {
      return;
    }

    const materialLast = this.formatMaterials(this.lastRewards.materials);
    const materialTotal = this.formatMaterials(this.totalRewards.materials);
    const equipmentLast = this.formatEquipmentList(this.lastRewards.equipment);
    const equipmentTotal = this.formatEquipmentList(this.totalRewards.equipment);
    const augmentLast = this.formatAugmentList(this.lastRewards.augments);
    const augmentTotal = this.formatAugmentList(this.totalRewards.augments);

    const rows = [
      { label: "XP", last: `${this.lastRewards.xp}`, total: `${this.totalRewards.xp}` },
      { label: "Gold", last: `${this.lastRewards.gold}`, total: `${this.totalRewards.gold}` },
      {
        label: "Materials",
        last: materialLast || "-",
        total: materialTotal || "-",
      },
      {
        label: "Equipment",
        last: equipmentLast || "-",
        total: equipmentTotal || "-",
      },
      {
        label: "Augments",
        last: augmentLast || "-",
        total: augmentTotal || "-",
      },
    ];

    table.innerHTML = "";
    rows.forEach((row) => {
      const tr = document.createElement("tr");
      const th = document.createElement("th");
      th.textContent = row.label;
      const lastTd = document.createElement("td");
      lastTd.textContent = row.last;
      const totalTd = document.createElement("td");
      totalTd.textContent = row.total;
      tr.appendChild(th);
      tr.appendChild(lastTd);
      tr.appendChild(totalTd);
      table.appendChild(tr);
    });
  }

  protected renderTelemetry() {
    const table = document.getElementById("telemetry-table");
    if (!table) {
      return;
    }

    const hero = this.telemetry.hero;
    const enemy = this.telemetry.enemy;

    const rows = [
      { label: "Attempts", hero: hero.attempts, enemy: enemy.attempts },
      { label: "Hits", hero: this.formatCount(hero.hits, hero.attempts), enemy: this.formatCount(enemy.hits, enemy.attempts) },
      { label: "Crits", hero: this.formatCount(hero.crits, hero.hits), enemy: this.formatCount(enemy.crits, enemy.hits) },
      { label: "Misses", hero: this.formatCount(hero.misses, hero.attempts), enemy: this.formatCount(enemy.misses, enemy.attempts) },
      { label: "Dodges", hero: this.formatCount(hero.dodges, hero.attempts), enemy: this.formatCount(enemy.dodges, enemy.attempts) },
      { label: "Parries", hero: this.formatCount(hero.parries, hero.attempts), enemy: this.formatCount(enemy.parries, enemy.attempts) },
      { label: "Avg Hit", hero: this.formatAverage(hero.totalDamage, hero.hits), enemy: this.formatAverage(enemy.totalDamage, enemy.hits) },
      { label: "Total Damage", hero: Math.round(hero.totalDamage), enemy: Math.round(enemy.totalDamage) },
    ];

    table.innerHTML = "";
    rows.forEach((row) => {
      const tr = document.createElement("tr");
      const th = document.createElement("th");
      th.textContent = row.label;
      const heroTd = document.createElement("td");
      heroTd.textContent = typeof row.hero === "number" ? `${row.hero}` : row.hero;
      const enemyTd = document.createElement("td");
      enemyTd.textContent = typeof row.enemy === "number" ? `${row.enemy}` : row.enemy;
      tr.appendChild(th);
      tr.appendChild(heroTd);
      tr.appendChild(enemyTd);
      table.appendChild(tr);
    });
  }

  protected renderHistory() {
    const table = document.getElementById("history-table");
    if (!table) {
      return;
    }

    table.innerHTML = "";
    const entries = this.history.slice(-30).reverse();
    if (!entries.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.textContent = "No encounters yet";
      td.colSpan = 8;
      tr.appendChild(td);
      table.appendChild(tr);
      return;
    }

    entries.forEach((entry) => {
      const tr = document.createElement("tr");
      const cells = [
        `#${entry.index}`,
        entry.stage,
        `${entry.wave}`,
        entry.opponent,
        entry.result,
        entry.heroHP,
        entry.enemyHP,
        this.formatHistoryRewards(entry.rewards),
      ];
      cells.forEach((value) => {
        const td = document.createElement("td");
        td.textContent = value;
        tr.appendChild(td);
      });
      table.appendChild(tr);
    });
  }

  protected renderStatsTable() {
    const table = document.getElementById("stats-table");
    if (!table) {
      return;
    }
    table.innerHTML = "";

    if (!this.hero) {
      const row = document.createElement("tr");
      const th = document.createElement("th");
      th.textContent = "Status";
      const td = document.createElement("td");
      td.textContent = "No hero";
      row.appendChild(th);
      row.appendChild(td);
      table.appendChild(row);
      return;
    }

    const stats = this.collectStatNames(this.hero);
    stats.forEach((name) => {
      const row = document.createElement("tr");
      const th = document.createElement("th");
      th.textContent = name;
      const td = document.createElement("td");
      td.textContent = this.formatStatValue(name, (this.hero as any)[name]);
      row.appendChild(th);
      row.appendChild(td);
      table.appendChild(row);
    });
  }

  protected renderEquipment() {
    const equipTable = document.getElementById("equipment-table");
    const inventoryTable = document.getElementById("inventory-table");
    const materialsTable = document.getElementById("materials-table");
    const consumablesTable = document.getElementById("consumables-table");

    if (equipTable) {
      equipTable.innerHTML = "";
      const slots: EquippedSlotKey[] = [
        "MainHand",
        "OffHand",
        "Head",
        "Chest",
      ];
      slots.forEach((slot) => {
        const owned = this.equippedItems[slot];
        const def = owned ? this.itemDefs.get(owned.itemId) : undefined;
        const tr = document.createElement("tr");
        const slotTd = document.createElement("td");
        slotTd.textContent = slot;
        const itemTd = document.createElement("td");
        if (owned && def) {
          const upgradeLabel = owned.maxUpgradeLevel
            ? ` +${owned.upgradeLevel}/${owned.maxUpgradeLevel}`
            : ` +${owned.upgradeLevel}`;
          const augmentNames = owned.augments
            .map((id) => this.itemDefs.get(id)?.name ?? id)
            .join(", ");
          const augmentLabel = owned.socketSlots
            ? ` • Aug ${owned.augments.length}/${owned.socketSlots}${augmentNames ? ` (${augmentNames})` : ""}`
            : "";
          itemTd.textContent = `${def.name} (${owned.rarity})${upgradeLabel}${augmentLabel}`;
        } else {
          itemTd.textContent = "-";
        }
        const actionTd = document.createElement("td");
        if (owned && def) {
          const upgradeMeta = this.describeUpgrade(def, owned);
          const upgradeBtn = document.createElement("button");
          upgradeBtn.textContent = upgradeMeta.label;
          upgradeBtn.disabled = upgradeMeta.disabled;
          upgradeBtn.title = upgradeMeta.title;
          upgradeBtn.style.marginRight = "4px";
          upgradeBtn.addEventListener("click", () => this.upgradeEquipment(owned.instanceId));

          const socketMeta = this.describeSocket(owned);
          const socketBtn = document.createElement("button");
          socketBtn.textContent = socketMeta.label;
          socketBtn.disabled = socketMeta.disabled;
          socketBtn.title = socketMeta.title;
          socketBtn.style.marginRight = "4px";
          socketBtn.addEventListener("click", () => this.socketAugment(owned.instanceId));

          const salvageMeta = this.describeSalvage(def, owned);
          const salvageBtn = document.createElement("button");
          salvageBtn.textContent = salvageMeta.label;
          const equippedSalvageDisabled = salvageMeta.disabled || !this.canSalvage(owned.instanceId);
          salvageBtn.disabled = equippedSalvageDisabled;
          salvageBtn.title = equippedSalvageDisabled
            ? `${salvageMeta.title}${!this.canSalvage(owned.instanceId) ? " (unequip to salvage)" : ""}`
            : salvageMeta.title;
          salvageBtn.style.marginRight = "4px";
          salvageBtn.addEventListener("click", () => this.salvageEquipment(owned.instanceId));

          actionTd.appendChild(upgradeBtn);
          actionTd.appendChild(socketBtn);
          actionTd.appendChild(salvageBtn);
        } else {
          actionTd.textContent = "-";
        }
        tr.appendChild(slotTd);
        tr.appendChild(itemTd);
        tr.appendChild(actionTd);
        equipTable.appendChild(tr);
      });
    }

    if (inventoryTable) {
      inventoryTable.innerHTML = "";
      if (!this.equipmentInventory.length) {
        const tr = document.createElement("tr");
        const td = document.createElement("td");
        td.colSpan = 3;
        td.textContent = "-";
        tr.appendChild(td);
        inventoryTable.appendChild(tr);
      } else {
        this.equipmentInventory
          .slice()
          .sort((a, b) => {
            const defA = this.itemDefs.get(a.itemId)?.name ?? a.itemId;
            const defB = this.itemDefs.get(b.itemId)?.name ?? b.itemId;
            if (defA !== defB) {
              return defA.localeCompare(defB);
            }
            const rarityOrder: ItemRarity[] = ["legendary", "epic", "rare", "uncommon", "common"];
            const orderA = rarityOrder.indexOf(a.rarity);
            const orderB = rarityOrder.indexOf(b.rarity);
            const weightA = orderA === -1 ? rarityOrder.length : orderA;
            const weightB = orderB === -1 ? rarityOrder.length : orderB;
            return weightA - weightB;
          })
          .forEach((owned) => {
            const def = this.itemDefs.get(owned.itemId);
            const tr = document.createElement("tr");
            const nameTd = document.createElement("td");
            nameTd.textContent = def?.name ?? owned.itemId;
            const infoTd = document.createElement("td");
            const upgradeLabel = owned.maxUpgradeLevel
              ? `+${owned.upgradeLevel}/${owned.maxUpgradeLevel}`
              : `+${owned.upgradeLevel}`;
            const augmentNames = owned.augments
              .map((id) => this.itemDefs.get(id)?.name ?? id)
              .join(", ");
            const socketsLabel = owned.socketSlots
              ? `${owned.augments.length}/${owned.socketSlots} sockets${augmentNames ? ` (${augmentNames})` : ""}`
              : "No sockets";
            infoTd.textContent = `${owned.rarity} • Upg ${upgradeLabel} • ${socketsLabel}`;
            const actionTd = document.createElement("td");
            const button = document.createElement("button");
            button.textContent = "Equip";
            button.disabled = !this.hero || !def || (def.type !== "weapon" && def.type !== "armor");
            button.addEventListener("click", () => {
              this.equipOwnedFromInventory(owned.instanceId);
            });
            const upgradeMeta = this.describeUpgrade(def, owned);
            const upgradeBtn = document.createElement("button");
            upgradeBtn.textContent = upgradeMeta.label;
            upgradeBtn.disabled = upgradeMeta.disabled;
            upgradeBtn.title = upgradeMeta.title;
            upgradeBtn.style.marginRight = "4px";
            upgradeBtn.addEventListener("click", () => this.upgradeEquipment(owned.instanceId));

            const socketMeta = this.describeSocket(owned);
            const socketBtn = document.createElement("button");
            socketBtn.textContent = socketMeta.label;
            socketBtn.disabled = socketMeta.disabled;
            socketBtn.title = socketMeta.title;
            socketBtn.style.marginRight = "4px";
            socketBtn.addEventListener("click", () => this.socketAugment(owned.instanceId));

            const salvageMeta = this.describeSalvage(def, owned);
            const salvageBtn = document.createElement("button");
            salvageBtn.textContent = salvageMeta.label;
            salvageBtn.disabled = salvageMeta.disabled;
            salvageBtn.title = salvageMeta.title;
            salvageBtn.style.marginRight = "4px";
            salvageBtn.addEventListener("click", () => this.salvageEquipment(owned.instanceId));

            actionTd.appendChild(upgradeBtn);
            actionTd.appendChild(socketBtn);
            actionTd.appendChild(salvageBtn);
            actionTd.appendChild(button);
            tr.appendChild(nameTd);
            tr.appendChild(infoTd);
            tr.appendChild(actionTd);
            inventoryTable.appendChild(tr);
          });
      }
    }

    if (materialsTable) {
      materialsTable.innerHTML = "";
      const entries = Object.entries(this.materialsStock).sort((a, b) => a[0].localeCompare(b[0]));
      if (!entries.length) {
        const tr = document.createElement("tr");
        const td = document.createElement("td");
        td.colSpan = 2;
        td.textContent = "-";
        tr.appendChild(td);
        materialsTable.appendChild(tr);
      } else {
        entries.forEach(([id, qty]) => {
          const tr = document.createElement("tr");
          const idTd = document.createElement("td");
          idTd.textContent = id;
          const qtyTd = document.createElement("td");
          qtyTd.textContent = `${qty}`;
          tr.appendChild(idTd);
          tr.appendChild(qtyTd);
          materialsTable.appendChild(tr);
        });
      }
    }

    if (consumablesTable) {
      consumablesTable.innerHTML = "";
      const entries = Object.entries(this.consumables).filter(([, qty]) => qty > 0);
      if (!entries.length) {
        const tr = document.createElement("tr");
        const td = document.createElement("td");
        td.colSpan = 2;
        td.textContent = "-";
        tr.appendChild(td);
        consumablesTable.appendChild(tr);
      } else {
        entries
          .sort((a, b) => a[0].localeCompare(b[0]))
          .forEach(([id, qty]) => {
            const def = this.itemDefs.get(id);
            const tr = document.createElement("tr");
            const idTd = document.createElement("td");
            idTd.textContent = def?.name ?? id;
            const qtyTd = document.createElement("td");
            qtyTd.textContent = `${qty}`;
            tr.appendChild(idTd);
            tr.appendChild(qtyTd);
            consumablesTable.appendChild(tr);
          });
      }
    }

    this.updateCraftingAvailability();
  }

  protected collectStatNames(character: Character): string[] {
    const proto = Reflect.getPrototypeOf(character);
    return Object.entries(Object.getOwnPropertyDescriptors(proto))
      .filter(([name, descriptor]) => typeof descriptor.get === "function" && name !== "__proto__")
      .map(([name]) => name)
      .sort();
  }

  protected formatStatValue(statName: string, value: unknown): string {
    if (value === undefined || value === null) {
      return "-";
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        return "-";
      }
      if (statName.toLowerCase().includes("percent")) {
        return `${(value * 100).toFixed(1)}%`;
      }
      if (Math.abs(value) >= 10 && Number.isInteger(value)) {
        return value.toString();
      }
      if (Math.abs(value) < 1) {
        return value.toFixed(3);
      }
      return value.toFixed(2);
    }
    return String(value);
  }

  protected formatCount(value: number, denominator: number): string {
    if (denominator <= 0) {
      return `${value} (-)`;
    }
    const percent = ((value / denominator) * 100).toFixed(1);
    return `${value} (${percent}%)`;
  }

  protected formatAverage(total: number, samples: number): string {
    if (samples <= 0) {
      return "-";
    }
    return (total / samples).toFixed(2);
  }

  protected formatMaterials(materials: Record<string, number>): string {
    return Object.entries(materials)
      .map(([id, qty]) => `${id} x${qty}`)
      .join(", ");
  }

  protected formatEquipmentList(list: RewardEquipmentItem[] = []): string {
    return list
      .map((entry) => `${entry.itemId} (${entry.rarity}) x${entry.quantity}`)
      .join(", ");
  }

  protected formatAugmentList(list: RewardAugmentItem[] = []): string {
    return list.map((entry) => `${entry.augmentId} x${entry.quantity}`).join(", ");
  }

  protected formatHistoryRewards(rewards: EncounterRewards): string {
    const parts: string[] = [];
    if (rewards.xp) {
      parts.push(`XP ${rewards.xp}`);
    }
    if (rewards.gold) {
      parts.push(`Gold ${rewards.gold}`);
    }
    const mats = this.formatMaterials(rewards.materials ?? {});
    if (mats) {
      parts.push(mats);
    }
    const equipment = this.formatEquipmentList(rewards.equipment ?? []);
    if (equipment) {
      parts.push(`Eq: ${equipment}`);
    }
    const augments = this.formatAugmentList(rewards.augments ?? []);
    if (augments) {
      parts.push(`Aug: ${augments}`);
    }
    return parts.length ? parts.join("; ") : "-";
  }

  protected pushLog(entry: string) {
    const logNode = document.getElementById("log-output");
    if (!logNode) {
      return;
    }
    logNode.textContent = `${logNode.textContent ? `${logNode.textContent}\n` : ""}${entry}`;
    logNode.scrollTop = logNode.scrollHeight;
  }

  protected setStatusMessage(message: string) {
    const statusNode = document.getElementById("status-text");
    if (statusNode) {
      statusNode.textContent = message;
    }
  }

  protected updateCraftingAvailability() {
    const equipSelect = document.getElementById("equipment-recipe-select") as HTMLSelectElement | null;
    const equipCraftBtn = document.getElementById("craft-equipment-button") as HTMLButtonElement | null;
    const equipEquipBtn = document.getElementById("equip-selected-button") as HTMLButtonElement | null;
    const consumableSelect = document.getElementById("consumable-recipe-select") as HTMLSelectElement | null;
    const consumableCraftBtn = document.getElementById("craft-consumable-button") as HTMLButtonElement | null;
    const consumableUseBtn = document.getElementById("use-consumable-button") as HTMLButtonElement | null;

    const equipRecipe = equipSelect ? this.recipeMap.get(equipSelect.value) : undefined;
    if (equipCraftBtn) {
      equipCraftBtn.disabled = !equipRecipe || !this.hasMaterials(equipRecipe.cost);
    }
    if (equipEquipBtn) {
      const resultId = equipRecipe?.result ?? null;
      equipEquipBtn.disabled =
        !resultId || !this.equipmentInventory.some((item) => item.itemId === resultId);
    }
    this.renderRecipeDetails(equipRecipe, "equipment-recipe-details");

    const consumableRecipe = consumableSelect ? this.recipeMap.get(consumableSelect.value) : undefined;
    const consumableResult = consumableRecipe ? consumableRecipe.result : null;
    if (consumableCraftBtn) {
      consumableCraftBtn.disabled = !consumableRecipe || !this.hasMaterials(consumableRecipe.cost);
    }
    if (consumableUseBtn) {
      consumableUseBtn.disabled = !consumableResult || (this.consumables[consumableResult] ?? 0) <= 0;
    }
    this.renderRecipeDetails(consumableRecipe, "consumable-recipe-details");
  }

  protected renderRecipeDetails(recipe: CraftingRecipe | undefined, elementId: string) {
    const node = document.getElementById(elementId);
    if (!node) {
      return;
    }

    if (!recipe) {
      node.textContent = "Select a recipe to view costs.";
      return;
    }

    const entries = Object.entries(recipe.cost ?? {});
    if (!entries.length) {
      node.textContent = "No materials required.";
      return;
    }

    const lines = entries.map(([id, required]) => {
      const need = Math.max(0, Math.floor(Number(required) || 0));
      const owned = this.materialsStock[id] ?? 0;
      const status = owned >= need ? "[ok]" : "[need]";
      return `${status} ${id}: ${owned}/${need}`;
    });
    node.textContent = lines.join("\n");
  }

  protected persistState() {
    if (!this.hero) {
      return;
    }

    try {
      const heroSelect = document.getElementById("hero-select") as HTMLSelectElement | null;
      const stageSelect = document.getElementById("stage-select") as HTMLSelectElement | null;

      const equippedSnapshot: Record<string, OwnedEquipment | null> = {
        MainHand: null,
        OffHand: null,
        Head: null,
        Chest: null,
      };
      (Object.keys(equippedSnapshot) as EquippedSlotKey[]).forEach((slot) => {
        const owned = this.equippedItems[slot];
        equippedSnapshot[slot] = owned
          ? { ...owned, augments: [...owned.augments] }
          : null;
      });

      const inventorySnapshot = this.equipmentInventory.map((item) => ({
        ...item,
        augments: [...item.augments],
      }));

      const legacyEquipped: Record<string, string | null> = {};
      (Object.keys(equippedSnapshot) as EquippedSlotKey[]).forEach((slot) => {
        legacyEquipped[slot] = equippedSnapshot[slot]?.itemId ?? null;
      });

      const legacyInventory: Record<string, number> = {};
      this.equipmentInventory.forEach((item) => {
        legacyInventory[item.itemId] = (legacyInventory[item.itemId] ?? 0) + 1;
      });

      const state: PersistedState = {
        version: 1,
        heroId: heroSelect?.value ?? this.heroOptions[0].id,
        stageIndex: this.stageIndex,
        stageWaveCompleted: this.stageWaveCompleted,
        totalWavesCompleted: this.totalWavesCompleted,
        tickInterval: this.tickIntervalSeconds,
        lootTableId: this.selectedLootId ?? undefined,
        rewards: this.totalRewards,
        lastRewards: this.lastRewards,
        heroProgress: this.hero.serializeProgress(),
        history: this.history.slice(-40),
        historyCounter: this.historyCounter,
        materialsStock: this.materialsStock,
        equippedItems: legacyEquipped,
        consumables: this.consumables,
        equipmentInventory: legacyInventory,
        equippedItemsV2: equippedSnapshot,
        equipmentInventoryV2: inventorySnapshot,
        timestamp: Date.now(),
      };

      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      console.warn("[Harness] Failed to persist state", err);
    }
  }

  protected restoreState(): boolean {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return false;
      }
      const state = JSON.parse(raw) as PersistedState;
      if (!state || state.version !== 1) {
        return false;
      }

      const heroSelect = document.getElementById("hero-select") as HTMLSelectElement | null;
      const stageSelect = document.getElementById("stage-select") as HTMLSelectElement | null;
      const lootSelect = document.getElementById("loot-select") as HTMLSelectElement | null;

      if (heroSelect && this.heroOptions.some((option) => option.id === state.heroId)) {
        heroSelect.value = state.heroId;
      }
      if (stageSelect && state.stageIndex < this.stages.length) {
        stageSelect.value = String(state.stageIndex);
      }
     if (lootSelect && state.lootTableId) {
       lootSelect.value = state.lootTableId;
     }
      const tickInput = document.getElementById("tick-input") as HTMLInputElement | null;
      if (tickInput) {
        tickInput.value = (state.tickInterval ?? 0.1).toFixed(2);
      }

      this.selectedLootId = state.lootTableId ?? null;
      if (state.lootTableId) {
        this.selectLootTable(state.lootTableId, { persist: false });
      }

      this.stageIndex = Math.max(0, Math.min(state.stageIndex ?? 0, this.stages.length - 1));
      this.stageWaveCompleted = Math.max(0, state.stageWaveCompleted ?? 0);
      this.totalWavesCompleted = Math.max(0, state.totalWavesCompleted ?? 0);
      this.tickIntervalSeconds = Math.max(0.01, state.tickInterval ?? 0.1);
      this.totalRewards = normalizeRewards(state.rewards);
      this.lastRewards = normalizeRewards(state.lastRewards);

      this.pendingSourceProgress = state.heroProgress;
      this.history = state.history ? state.history.slice(-40) : [];
      this.historyCounter = state.historyCounter ?? this.history.length;
      this.renderHistory();
      this.materialsStock = { ...(state.materialsStock ?? {}) };

      const equippedDefaults: Record<EquippedSlotKey, OwnedEquipment | null> = {
        MainHand: null,
        OffHand: null,
        Head: null,
        Chest: null,
      };

      if (state.equippedItemsV2) {
        Object.entries(state.equippedItemsV2).forEach(([slot, value]) => {
          if (slot in equippedDefaults) {
            equippedDefaults[slot as EquippedSlotKey] = value
              ? { ...value, augments: [...value.augments] }
              : null;
          }
        });
      } else if (state.equippedItems) {
        Object.entries(state.equippedItems).forEach(([slot, itemId]) => {
          if (!itemId || !(slot in equippedDefaults)) {
            return;
          }
          const owned = this.createOwnedEquipmentInstance(itemId, "common");
          if (owned) {
            equippedDefaults[slot as EquippedSlotKey] = owned;
          }
        });
      }
      this.equippedItems = equippedDefaults;

      this.consumables = { ...(state.consumables ?? {}) };

      if (state.equipmentInventoryV2) {
        this.equipmentInventory = state.equipmentInventoryV2.map((item) => ({
          ...item,
          augments: [...item.augments],
        }));
      } else if (state.equipmentInventory) {
        this.equipmentInventory = [];
        Object.entries(state.equipmentInventory).forEach(([itemId, qty]) => {
          for (let index = 0; index < qty; index += 1) {
            const owned = this.createOwnedEquipmentInstance(itemId, "common");
            if (owned) {
              this.equipmentInventory.push(owned);
            }
          }
        });
      } else {
        this.equipmentInventory = [];
      }
      return true;
    } catch (err) {
      console.warn("[Harness] Failed to restore state", err);
      return false;
    }
  }

  protected cloneData<T>(data: T): T {
    return JSON.parse(JSON.stringify(data));
  }
}

const harness = new SimulatorHarness();
window.addEventListener("DOMContentLoaded", () => {
  harness.init().catch((err) => {
    console.error("Failed to initialise simulator harness", err);
    const statusNode = document.getElementById("status-text");
    if (statusNode) {
      statusNode.textContent = "Initialisation failed";
    }
  });
});
