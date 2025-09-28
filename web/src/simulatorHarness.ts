import {
  SimulationRuntime,
  SimulationState,
  ProgressionSnapshot,
} from "@core/runtime/SimulationRuntime";
import {
  EncounterEvent,
  EncounterRewards,
  EncounterSummary,
  RewardAugmentItem,
  RewardEquipmentItem,
} from "@core/combat/Encounter";
import { LootTableConfig } from "@core/economy/LootTable";
import {
  Character,
  CharacterData,
  CharacterProgressSnapshot,
} from "@core/characters/Character";
import { EquipmentSlot, ItemType } from "@core/items/constants";
import { EquipmentItem, ItemRarity } from "@core/items/Item";
import {
  CraftingRecipe,
  CraftingRecipeType,
  ItemDefinition,
  OwnedEquipment,
} from "@core/items/ItemDefinition";
import {
  StatBlock,
  WeaponStatBlock,
  ArmorStatBlock,
  StatBlockData,
} from "@core/stats/StatBlock";
import type { InventorySnapshot } from "@core/runtime/PlayerInventory";
import { formatAugmentRewards, formatEquipmentRewards } from "@core/utils/formatting";
import type { StagePreview } from "@core/progression/StageGenerator";
import type { StageDefinition as CoreStageDefinition } from "@core/progression/Stage";

export type EquippedSlotKey = "MainHand" | "OffHand" | "Head" | "Chest";
export type { OwnedEquipment, CraftingRecipe, ItemDefinition };
import { WebDataSource } from "../../platforms/web/WebDataSource";

interface Preset {
  id: string;
  label: string;
  data: CharacterData;
}

interface LootTableRecord {
  id: string;
  label: string;
  table: LootTableConfig;
}

interface StageComposition {
  [tier: string]: number;
}

interface HarnessStageDefinition {
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
  stages: HarnessStageDefinition[];
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

interface PersistedState {
  version: number;
  heroId: string;
  stageIndex: number;
  totalWavesCompleted: number;
  tickInterval: number;
  lootTableId?: string;
  rewards: EncounterRewards;
  lastRewards?: EncounterRewards;
  heroProgress?: CharacterProgressSnapshot;
  history?: EncounterHistoryEntry[];
  historyCounter?: number;
  inventorySnapshot?: InventorySnapshot;
  resumeAfterVictory?: boolean;
  highestStageCleared?: number;
  clearedStages?: number[];
  statBonusMultiplier?: number;
  progressionSnapshot?: ProgressionSnapshot;
  timestamp: number;
}

export interface EncounterHistoryEntry {
  index: number;
  stage: string;
  wave: number;
  opponent: string;
  result: "Victory" | "Defeat";
  heroHP: string;
  enemyHP: string;
  rewards: EncounterRewards;
}

export interface StatusPayload {
  label: string;
  stage: string;
  wave: number;
  opponent: string;
  elapsedSeconds: number;
  swings: number;
  heroDamage: number;
  enemyDamage: number;
  winner: string | null;
  heroHealth: number;
  heroMaxHealth: number;
  enemyHealth: number;
  enemyMaxHealth: number;
  bossTimerRemaining: number;
  bossTimerTotal: number;
  bossEnraged: boolean;
}

export interface HarnessListeners {
  onStatus?(payload: StatusPayload): void;
  onRewards?(payload: { last: EncounterRewards; total: EncounterRewards }): void;
  onLog?(entry: string): void;
  onHistory?(history: EncounterHistoryEntry[]): void;
  onInventory?(payload: {
    equipped: Record<EquippedSlotKey, OwnedEquipment | null>;
    inventory: OwnedEquipment[];
  }): void;
  onMaterials?(payload: { materials: Record<string, number>; consumables: Record<string, number> }): void;
  onCrafting?(payload: CraftingStatePayload): void;
  onControls?(payload: ControlStatePayload): void;
  onTelemetry?(rows: TelemetryRow[]): void;
  onStats?(rows: StatRow[]): void;
}

const resolveDataUrl = (relativePath: string) => {
  const trimmed = relativePath.startsWith("/") ? relativePath.slice(1) : relativePath;
  return `${import.meta.env.BASE_URL}${trimmed}`;
};

const STORAGE_KEY = "idle-eq-harness-state-v2";
const RARITY_MULTIPLIERS: Record<ItemRarity, number> = {
  common: 1,
  uncommon: 1.1,
  rare: 1.25,
  epic: 1.4,
  legendary: 1.6,
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

export interface ActionDescriptor {
  label: string;
  title: string;
  disabled: boolean;
}

export interface EquipmentActionState {
  instanceId: string;
  slot: EquippedSlotKey | null;
  isEquipped: boolean;
  upgrade: ActionDescriptor;
  salvage: ActionDescriptor;
  socket: ActionDescriptor;
}

export interface CraftingOptionInfo {
  id: string;
  label: string;
  resultId: string;
  resultName: string;
  tier: string;
  resultAmount: number;
  cost: Record<string, number>;
}

export interface CraftingGroupState {
  type: CraftingRecipeType;
  selectedId: string | null;
  selectedOption: CraftingOptionInfo | null;
  options: CraftingOptionInfo[];
  primaryAction: ActionDescriptor;
  secondaryAction?: ActionDescriptor;
  details: string[];
}

export interface CraftingStatePayload {
  equipment: CraftingGroupState;
  consumables: CraftingGroupState;
  materials: CraftingGroupState;
}

export interface ControlOption {
  id: string;
  label: string;
}

export interface StageOption {
  index: number;
  label: string;
}

export interface ControlStatePayload {
  heroOptions: ControlOption[];
  stageOptions: StageOption[];
  lootOptions: ControlOption[];
  selectedHeroId: string | null;
  selectedStageIndex: number;
  selectedLootId: string | null;
  tickInterval: number;
  isRunning: boolean;
  autoResume: boolean;
}

export interface TelemetryRow {
  label: string;
  hero: string;
  enemy: string;
}

export interface StatRow {
  label: string;
  value: string;
  raw: number;
}

export interface StatPreviewRow {
  label: string;
  current: string;
  preview: string;
  delta: number;
  deltaFormatted: string;
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

export class SimulatorHarness {
  protected listeners: HarnessListeners;
  protected runtime: SimulationRuntime | null = null;
  protected runtimeState: SimulationState | null = null;
  protected dataSource: WebDataSource | null = null;
  protected hero: Character | null = null;
  protected enemy: Character | null = null;
  protected lastSummary: EncounterSummary | null = null;

  protected heroOptions: Preset[] = [];
  protected stages: HarnessStageDefinition[] = [];
  protected itemDefs: Map<string, ItemDefinition> = new Map();
  protected recipes: CraftingRecipe[] = [];
  protected recipeMap: Map<string, CraftingRecipe> = new Map();

  protected stageIndex = 0;
  protected totalWavesCompleted = 0;
  protected currentWaveNumber = 0;
  protected currentStageName = "";
  protected currentEnemyLabel = "";

  protected lootTables: LootTableRecord[] = [];
  protected selectedLootId: string | null = null;
  protected selectedHeroId: string | null = null;
  protected materialsStock: Record<string, number> = {};
  protected inventorySnapshot: InventorySnapshot | null = null;
  protected equippedItems: Record<EquippedSlotKey, OwnedEquipment | null> = {
    MainHand: null,
    OffHand: null,
    Head: null,
    Chest: null,
  };
  protected consumables: Record<string, number> = {};
  protected equipmentInventory: OwnedEquipment[] = [];
  protected selectedEquipmentRecipeId: string | null = null;
  protected selectedConsumableRecipeId: string | null = null;
  protected selectedMaterialRecipeId: string | null = null;

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

  protected bossTimerRemaining = 0;
  protected bossTimerTotal = 0;
  protected bossEnraged = false;
  protected stagePreview: StagePreview | null = null;
  protected permanentBonusPercent = 0;

  protected tickIntervalSeconds = 0.1;
  protected pendingSourceProgress?: CharacterProgressSnapshot;
  protected autoStart = false;

  protected history: EncounterHistoryEntry[] = [];
  protected notifyInventory() {
    if (this.listeners.onInventory) {
      const snapshot: Record<EquippedSlotKey, OwnedEquipment | null> = {
        MainHand: this.equippedItems.MainHand ? { ...this.equippedItems.MainHand, augments: [...this.equippedItems.MainHand.augments] } : null,
        OffHand: this.equippedItems.OffHand ? { ...this.equippedItems.OffHand, augments: [...this.equippedItems.OffHand.augments] } : null,
        Head: this.equippedItems.Head ? { ...this.equippedItems.Head, augments: [...this.equippedItems.Head.augments] } : null,
        Chest: this.equippedItems.Chest ? { ...this.equippedItems.Chest, augments: [...this.equippedItems.Chest.augments] } : null,
      };
      const inventorySnapshot = this.equipmentInventory.map((item) => ({
        ...item,
        augments: [...item.augments],
      }));
      this.listeners.onInventory({
        equipped: snapshot,
        inventory: inventorySnapshot,
      });
    }
  }

  protected notifyMaterials() {
    if (this.listeners.onMaterials) {
      this.listeners.onMaterials({
        materials: { ...this.materialsStock },
        consumables: { ...this.consumables },
      });
    }
  }

  protected notifyCraftingState() {
    if (!this.listeners.onCrafting) {
      return;
    }

    const equipment = this.buildCraftingGroupState("equipment");
    const consumables = this.buildCraftingGroupState("consumable");
    const materials = this.buildCraftingGroupState("material");

    this.listeners.onCrafting({ equipment, consumables, materials });
  }

  protected notifyControlState() {
    if (!this.listeners.onControls) {
      return;
    }

    this.ensureStageListCoverage(this.stageIndex);

    const heroOptions: ControlOption[] = this.heroOptions.map((option) => ({
      id: option.id,
      label: option.label,
    }));
    const stageOptions: StageOption[] = this.stages.map((stage, index) => ({
      index,
      label: stage.name ?? `Stage ${index + 1}`,
    }));
    const lootOptions: ControlOption[] = this.lootTables.map((table) => ({
      id: table.id,
      label: table.label ?? table.id,
    }));

    const payload: ControlStatePayload = {
      heroOptions,
      stageOptions,
      lootOptions,
      selectedHeroId: this.selectedHeroId ?? (heroOptions[0]?.id ?? null),
      selectedStageIndex: this.stageIndex,
      selectedLootId: this.selectedLootId ?? (lootOptions[0]?.id ?? null),
      tickInterval: this.tickIntervalSeconds,
      isRunning: this.running,
      autoResume: this.resumeAfterVictory,
    };

    this.listeners.onControls(payload);
  }

  getStagePreview(): StagePreview | null {
    return this.stagePreview ? this.cloneStagePreview(this.stagePreview) : null;
  }

  getPermanentBonusPercent(): number {
    return this.permanentBonusPercent;
  }

  protected buildCraftingGroupState(type: CraftingRecipeType): CraftingGroupState {
    const options = this.recipes
      .filter((recipe) => recipe.type === type)
      .map<CraftingOptionInfo>((recipe) => {
        const def = this.itemDefs.get(recipe.result);
        const resultAmount = Math.max(1, Math.floor(recipe.resultAmount ?? 1));
        return {
          id: recipe.id,
          label: `${def?.name ?? recipe.result} (${recipe.tier})`,
          resultId: recipe.result,
          resultName: def?.name ?? recipe.result,
          tier: recipe.tier,
          resultAmount,
          cost: { ...(recipe.cost ?? {}) },
        };
      });

    let selectedId: string | null;
    if (type === "equipment") {
      selectedId = this.selectedEquipmentRecipeId;
    } else if (type === "consumable") {
      selectedId = this.selectedConsumableRecipeId;
    } else {
      selectedId = this.selectedMaterialRecipeId;
    }

    if (selectedId && !options.some((option) => option.id === selectedId)) {
      selectedId = null;
    }
    if (!selectedId && options.length) {
      selectedId = options[0].id;
      this.setSelectedRecipe(type, selectedId, { notify: false });
    }

    const selectedOption = selectedId ? options.find((option) => option.id === selectedId) ?? null : null;
    const selectedRecipe = selectedId ? this.recipeMap.get(selectedId) : undefined;

    const details = this.describeRecipeDetails(selectedRecipe);

    const primaryBase: ActionDescriptor = {
      label: this.getPrimaryLabel(type),
      title: "Select a recipe",
      disabled: !selectedRecipe,
    };

    let secondaryAction: ActionDescriptor | undefined;
    let primaryAction = primaryBase;

    if (selectedRecipe) {
      const hasMaterials = this.hasMaterials(selectedRecipe.cost);
      const costSummary = this.formatCostSummary(selectedRecipe.cost);
      primaryAction = {
        ...primaryBase,
        title: hasMaterials ? `Spend ${costSummary}` : `Need ${costSummary}`,
        disabled: !hasMaterials,
      };

      if (type === "equipment") {
        const resultId = selectedRecipe.result;
        const canEquip = this.equipmentInventory.some((item) => item.itemId === resultId);
        secondaryAction = {
          label: "Equip Crafted",
          title: canEquip ? "Equip the crafted item" : "Craft or obtain this item to equip",
          disabled: !canEquip,
        };
      } else if (type === "consumable") {
        const resultId = selectedRecipe.result;
        const stock = this.consumables[resultId] ?? 0;
        secondaryAction = {
          label: "Use",
          title: stock > 0 ? `Use ${selectedOption?.resultName ?? resultId}` : "No items available to use",
          disabled: stock <= 0,
        };
      }
    }

    return {
      type,
      selectedId: selectedId ?? null,
      selectedOption: selectedOption ?? null,
      options,
      primaryAction,
      secondaryAction,
      details,
    };
  }

  protected setSelectedRecipe(
    type: CraftingRecipeType,
    recipeId: string | null,
    options: { notify?: boolean } = {}
  ) {
    const notify = options.notify ?? true;
    let changed = false;
    if (type === "equipment") {
      if (this.selectedEquipmentRecipeId !== recipeId) {
        this.selectedEquipmentRecipeId = recipeId;
        changed = true;
      }
    } else if (type === "consumable") {
      if (this.selectedConsumableRecipeId !== recipeId) {
        this.selectedConsumableRecipeId = recipeId;
        changed = true;
      }
    } else {
      if (this.selectedMaterialRecipeId !== recipeId) {
        this.selectedMaterialRecipeId = recipeId;
        changed = true;
      }
    }
    if (notify && (changed || !recipeId)) {
      this.notifyCraftingState();
    } else if (notify && !changed) {
      this.updateCraftingAvailability();
    }
  }

  protected getPrimaryLabel(type: CraftingRecipeType): string {
    switch (type) {
      case "equipment":
        return "Craft";
      case "consumable":
        return "Craft";
      case "material":
      default:
        return "Refine";
    }
  }

  protected describeRecipeDetails(recipe: CraftingRecipe | undefined): string[] {
    if (!recipe) {
      return ["Select a recipe to view costs."];
    }
    const amount = Math.max(1, Math.floor(recipe.resultAmount ?? 1));
    const header = `Output: ${recipe.result} x${amount}`;
    const entries = Object.entries(recipe.cost ?? {});
    if (!entries.length) {
      return [header, "No materials required."];
    }
    const lines = entries.map(([id, required]) => {
      const need = Math.max(0, Math.floor(Number(required) || 0));
      const owned = this.materialsStock[id] ?? 0;
      const status = owned >= need ? "[ok]" : "[need]";
      return `${status} ${id}: ${owned}/${need}`;
    });
    return [header, ...lines];
  }

  protected formatCostSummary(cost: Record<string, number> = {}): string {
    const entries = Object.entries(cost);
    if (!entries.length) {
      return "no materials";
    }
    return entries.map(([id, qty]) => `${id} x${qty}`).join(", ");
  }

  protected refreshInventorySnapshot() {
    if (!this.runtime) {
      return;
    }
    try {
      const snapshot = this.runtime.getInventorySnapshot();
      this.inventorySnapshot = {
        equipped: { ...(snapshot.equipped ?? {}) },
        inventory: snapshot.inventory?.map((item) => this.cloneOwnedEquipment(item)) ?? [],
        materials: { ...(snapshot.materials ?? {}) },
        consumables: { ...(snapshot.consumables ?? {}) },
      };
      this.applyInventorySnapshot(this.inventorySnapshot);
      this.syncInventoryView();
    } catch (err) {
      console.warn("[Harness] Failed to refresh inventory snapshot", err);
    }
  }

  protected applyInventorySnapshot(snapshot: InventorySnapshot) {
    const defaults: Record<EquippedSlotKey, OwnedEquipment | null> = {
      MainHand: null,
      OffHand: null,
      Head: null,
      Chest: null,
    };

    Object.entries(snapshot.equipped ?? {}).forEach(([slot, owned]) => {
      if (slot in defaults) {
        defaults[slot as EquippedSlotKey] = owned ? this.cloneOwnedEquipment(owned) : null;
      }
    });

    this.equippedItems = defaults;
    this.equipmentInventory = (snapshot.inventory ?? []).map((item) =>
      this.cloneOwnedEquipment(item)
    );
    this.materialsStock = { ...(snapshot.materials ?? {}) };
    this.consumables = { ...(snapshot.consumables ?? {}) };
  }

  protected syncInventoryView() {
    this.notifyInventory();
    this.notifyMaterials();
    this.updateCraftingAvailability();
  }

  protected historyCounter = 0;

  constructor(listeners: HarnessListeners = {}) {
    this.listeners = listeners;
  }

  protected async initializeRuntime() {
    const baseUrl = import.meta.env.BASE_URL ?? "/";
    this.dataSource = new WebDataSource({
      baseUrl,
      heroManifestUrl: "assets/data/heroes/manifest.json",
      enemyManifestUrl: "assets/data/enemies/manifest.json",
      progressionConfigUrl: "assets/data/progression/config.json",
      lootManifestUrl: "assets/data/loot/manifest.json",
      itemManifestUrl: "assets/data/items/manifest.json",
      craftingRecipesUrl: "assets/data/crafting/recipes.json",
    });

    this.runtime = new SimulationRuntime(this.dataSource, {
      tickIntervalSeconds: this.tickIntervalSeconds,
      autoStart: false,
      hooks: {
        onStateChanged: (state) => this.handleRuntimeState(state),
        onEncounterEvents: (events) => this.handleRuntimeEvents(events),
        onEncounterComplete: (summary) => this.handleRuntimeComplete(summary),
        onLog: (entry) => this.pushLog(entry),
      },
    });

    await this.runtime.initialize(true);

    const initialState = this.runtime.getState();
    this.applyRuntimeState(initialState);

    const heroDefs = this.runtime.listHeroes();
    this.heroOptions = heroDefs.map((hero) => ({
      id: hero.id,
      label: hero.label ?? hero.id,
      data: hero.data,
    }));

    const stages = this.runtime.listStages();
    this.updateStageCatalog(stages);
    this.updateStagePreview();

    const lootTables = this.runtime.listLootTables();
    this.lootTables = lootTables.map((table) => {
      const id = table.id ?? table.name ?? "loot";
      const label = table.name ?? id;
      return {
        id,
        label,
        table: { ...table, id },
      };
    });

    if (!this.selectedHeroId && heroDefs.length) {
      this.selectedHeroId = heroDefs[0].id;
    }

    if (!this.selectedLootId && this.lootTables.length) {
      this.selectedLootId = this.runtimeState?.lootTableId ?? this.lootTables[0].id;
    }
  }

  protected seedDefinitionsFromRuntime() {
    if (!this.runtime) {
      this.itemDefs = new Map();
      this.recipes = [];
      this.recipeMap = new Map();
      return;
    }

    const defs = this.runtime.listItemDefinitions();
    this.itemDefs = new Map();
    defs.forEach((def) => {
      this.itemDefs.set(def.id, def);
    });

    this.recipes = this.runtime.listCraftingRecipes();
    this.recipeMap = new Map();
    this.recipes.forEach((recipe) => {
      this.recipeMap.set(recipe.id, recipe);
    });
  }

  protected applyRuntimeState(state: SimulationState) {
    const previousState = this.runtimeState;
    const previousHero = this.hero;
    const previousWave = previousState?.waveNumber ?? 0;
    const previousStage = previousState?.stageIndex ?? -1;

    this.runtimeState = state;
    this.hero = state.hero ?? null;
    this.enemy = state.enemy ?? null;

    this.stageIndex = state.stageIndex;
    this.ensureStageListCoverage(this.stageIndex);
    const stageNameFallback = this.stages[state.stageIndex]?.name;
    this.currentStageName = state.stageName ?? stageNameFallback ?? this.currentStageName;
    this.currentWaveNumber = state.waveNumber;
    this.totalWavesCompleted = state.totalWavesCompleted;
    this.currentEnemyLabel = state.enemyLabel ?? this.currentEnemyLabel;
    this.currentWaveIsBoss = state.isBossWave;
    this.running = state.running;
    this.bossTimerRemaining = state.bossTimerRemaining ?? 0;
    this.bossTimerTotal = state.bossTimerTotal ?? 0;
    this.bossEnraged = !!state.bossEnraged;

    if (state.lootTableId && state.lootTableId !== this.selectedLootId) {
      this.selectedLootId = state.lootTableId;
    }

    const waveChanged =
      state.waveNumber !== previousWave || state.stageIndex !== previousStage;
    if (waveChanged) {
      this.telemetry.hero = createTelemetryBucket();
      this.telemetry.enemy = createTelemetryBucket();
      this.renderTelemetry();
      this.rewardClaimed = false;
      this.lastSummary = null;
    }

    const heroChanged = this.hero && this.hero !== previousHero;
    if (heroChanged) {
      if (this.pendingSourceProgress && this.hero) {
        this.hero.restoreProgress(this.pendingSourceProgress);
        this.pendingSourceProgress = undefined;
      }
      this.hero?.resetVitals();
      this.renderStatsTable();
    }

    if (!this.hero) {
      this.renderStatsTable();
    }

    this.updateStagePreview();
    this.refreshStatus();
    this.notifyControlState();
  }

  protected handleRuntimeState(state: SimulationState) {
    this.applyRuntimeState(state);
    this.tryUseConsumables();
  }

  protected handleRuntimeEvents(events: EncounterEvent[]) {
    if (!events.length) {
      return;
    }

    events.forEach((event) => {
      const attackerIsHero = this.hero ? event.attacker === this.hero : false;
      const defenderIsHero = this.hero ? event.defender === this.hero : false;
      const bucket = attackerIsHero ? this.telemetry.hero : this.telemetry.enemy;

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

      const attackerLabel = attackerIsHero ? "Hero" : "Enemy";
      const defenderLabel = defenderIsHero ? "Hero" : "Enemy";
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
    this.tryUseConsumables();
    this.renderStatsTable();
  }

  protected handleRuntimeComplete(summary: EncounterSummary) {
    this.lastSummary = summary;

    if (summary.victor === "source") {
      this.recordHistoryEntry("Victory", summary);
      this.applyRewards(summary);
      if (this.resumeAfterVictory) {
        this.startAuto();
      } else {
        this.stopAuto();
      }
    } else if (summary.victor === "target") {
      this.recordHistoryEntry("Defeat", summary);
      this.pushLog("[Encounter] Hero defeated. Adjust loadout or crafting before retrying.");
      this.stopAuto();
    }

    this.renderHistory();
    this.refreshStatus(true);
    this.renderStatsTable();
  }

  protected ensureAnimationLoop() {
    if (this.rafHandle !== null) {
      return;
    }
    this.lastTimestamp = performance.now();
    this.rafHandle = requestAnimationFrame(this.onFrame);
  }

  protected stopAnimationLoop() {
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
  }

  async init() {
    this.setStatusMessage("Loading data...");

    await this.initializeRuntime();

    this.seedDefinitionsFromRuntime();
    this.refreshInventorySnapshot();

    this.populateHeroSelect();
    this.populateStageSelect();
    this.populateLootSelect();

    const hasState = this.restoreState();
    this.resetEncounter(!hasState);
    this.refreshStatus(true);
    this.renderRewards();
    this.renderTelemetry();
    this.renderStatsTable();
    this.syncInventoryView();
    this.renderHistory();
    this.populateRecipeSelects();
    this.updateCraftingAvailability();
  }

  protected populateHeroSelect() {
    if (!this.selectedHeroId && this.heroOptions.length) {
      this.selectedHeroId = this.heroOptions[0].id;
    }

    this.notifyControlState();
  }

  protected populateStageSelect() {
    this.notifyControlState();
  }

  protected updateStageCatalog(stages: CoreStageDefinition[]) {
    this.stages = stages.map((stage, index) => ({
      id: stage.id ?? `stage-${index + 1}`,
      name: stage.name ?? `Stage ${index + 1}`,
      waves: Math.max(1, Math.floor(stage.waves ?? 1)),
      composition: stage.composition?.map((entry) => ({ ...entry })) ?? [],
      lootTable: stage.lootTable ?? null,
      finalBoss: stage.finalBoss ? { ...stage.finalBoss } : undefined,
    }));
  }

  protected ensureStageListCoverage(targetIndex: number) {
    if (!this.runtime) {
      return;
    }
    const remaining = this.stages.length - targetIndex;
    if (remaining > 5) {
      return;
    }
    const stages = this.runtime.listStages();
    this.updateStageCatalog(stages);
    this.updateStagePreview();
  }

  protected updateStagePreview() {
    if (!this.runtime) {
      this.stagePreview = null;
      this.permanentBonusPercent = 0;
      return;
    }
    const preview = this.runtime.getStagePreview(this.stageIndex + 1);
    this.stagePreview = preview ? this.cloneStagePreview(preview) : null;
    const snapshot = this.runtime.getProgressionSnapshot();
    const multiplier = snapshot?.statBonusMultiplier ?? 1;
    this.permanentBonusPercent = Math.max(0, (multiplier - 1) * 100);
  }

  protected cloneStagePreview(preview: StagePreview): StagePreview {
    return {
      stageNumber: preview.stageNumber,
      name: preview.name,
      waveCount: preview.waveCount,
      lootTableId: preview.lootTableId,
      rewards: { ...preview.rewards },
      bossConfig: { ...preview.bossConfig },
    };
  }

  protected populateLootSelect() {
    if (!this.selectedLootId && this.lootTables.length) {
      this.selectedLootId = this.lootTables[0].id;
    }
    this.notifyControlState();
  }

  protected populateRecipeSelects() {
    if (!this.selectedEquipmentRecipeId) {
      const first = this.recipes.find((recipe) => recipe.type === "equipment");
      this.selectedEquipmentRecipeId = first ? first.id : null;
    }

    if (!this.selectedConsumableRecipeId) {
      const first = this.recipes.find((recipe) => recipe.type === "consumable");
      this.selectedConsumableRecipeId = first ? first.id : null;
    }

    if (!this.selectedMaterialRecipeId) {
      const first = this.recipes.find((recipe) => recipe.type === "material");
      this.selectedMaterialRecipeId = first ? first.id : null;
    }

    this.updateCraftingAvailability();
  }

  protected resetEncounter(freshHero: boolean) {
    if (!this.runtime) {
      return;
    }

    this.stopAuto();

    if (freshHero) {
      this.history = [];
      this.historyCounter = 0;
      this.renderHistory();
      this.totalRewards = createEmptyRewards();
      this.selectedEquipmentRecipeId = null;
      this.selectedConsumableRecipeId = null;
      this.selectedMaterialRecipeId = null;
      this.runtime.setInventorySnapshot(null);
      this.refreshInventorySnapshot();
    }

    this.lastRewards = createEmptyRewards();
    this.rewardClaimed = false;
    this.lastSummary = null;

    this.telemetry.hero = createTelemetryBucket();
    this.telemetry.enemy = createTelemetryBucket();
    this.renderTelemetry();
    this.renderRewards();

    this.runtime.resetEncounter(this.autoStart, freshHero);

    if (!freshHero) {
      this.refreshInventorySnapshot();
    }

    this.updateCraftingAvailability();
    this.notifyControlState();
    this.persistState();
  }

  protected cloneOwnedEquipment(owned: OwnedEquipment): OwnedEquipment {
    return {
      ...owned,
      augments: [...owned.augments],
    };
  }

  protected cloneLoadout(
    overrides: Partial<Record<EquippedSlotKey, OwnedEquipment | null>> = {}
  ): Record<EquippedSlotKey, OwnedEquipment | null> {
    const base: Record<EquippedSlotKey, OwnedEquipment | null> = {
      MainHand: this.equippedItems.MainHand ? this.cloneOwnedEquipment(this.equippedItems.MainHand) : null,
      OffHand: this.equippedItems.OffHand ? this.cloneOwnedEquipment(this.equippedItems.OffHand) : null,
      Head: this.equippedItems.Head ? this.cloneOwnedEquipment(this.equippedItems.Head) : null,
      Chest: this.equippedItems.Chest ? this.cloneOwnedEquipment(this.equippedItems.Chest) : null,
    };

    (Object.keys(overrides) as EquippedSlotKey[]).forEach((slot) => {
      const override = overrides[slot];
      base[slot] = override ? this.cloneOwnedEquipment(override) : null;
    });

    return base;
  }

  protected createHeroClone(
    loadout: Record<EquippedSlotKey, OwnedEquipment | null>
  ): Character | null {
    const heroId = this.selectedHeroId ?? this.heroOptions[0]?.id;
    const preset = heroId
      ? this.heroOptions.find((option) => option.id === heroId) ?? this.heroOptions[0]
      : this.heroOptions[0];

    if (!preset) {
      return null;
    }

    const clone = new Character(this.cloneData(preset.data));
    const progress = this.hero?.serializeProgress();
    if (progress) {
      clone.restoreProgress(progress);
    }

    (Object.keys(loadout) as EquippedSlotKey[]).forEach((slot) => {
      const owned = loadout[slot];
      if (!owned) {
        return;
      }
      const def = this.itemDefs.get(owned.itemId);
      if (!def) {
        return;
      }
      const equipment = this.createEquipment(def, owned);
      if (equipment) {
        clone.equipItem(equipment);
      }
    });

    clone.resetVitals();
    return clone;
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

  protected craftEquipment(recipeId: string): boolean {
    if (!this.runtime) {
      return false;
    }
    const result = this.runtime.craftRecipe(recipeId);
    if (
      result.success ||
      result.inventoryChanged ||
      result.materialsChanged ||
      result.consumablesChanged
    ) {
      this.refreshInventorySnapshot();
    } else {
      this.updateCraftingAvailability();
    }
    this.persistState();
    return result.success;
  }

  protected craftConsumable(recipeId: string): boolean {
    if (!this.runtime) {
      return false;
    }
    const result = this.runtime.craftRecipe(recipeId);
    if (
      result.success ||
      result.inventoryChanged ||
      result.materialsChanged ||
      result.consumablesChanged
    ) {
      this.refreshInventorySnapshot();
    } else {
      this.updateCraftingAvailability();
    }
    this.persistState();
    return result.success;
  }

  protected craftMaterial(recipeId: string): boolean {
    if (!this.runtime) {
      return false;
    }
    const result = this.runtime.craftRecipe(recipeId);
    if (
      result.success ||
      result.inventoryChanged ||
      result.materialsChanged ||
      result.consumablesChanged
    ) {
      this.refreshInventorySnapshot();
    } else {
      this.updateCraftingAvailability();
    }
    this.persistState();
    return result.success;
  }

  protected equipOwnedFromInventory(instanceId: string): boolean {
    this.pauseSimulation();
    if (!this.runtime) {
      return false;
    }

    const result = this.runtime.equipFromInventory(instanceId);
    if (
      result.success ||
      result.inventoryChanged ||
      result.materialsChanged ||
      result.consumablesChanged
    ) {
      this.refreshInventorySnapshot();
    } else {
      this.updateCraftingAvailability();
    }
    this.persistState();
    return result.success;
  }

  protected equipFirstMatchingItem(itemId: string): boolean {
    if (!this.runtime) {
      return false;
    }
    const result = this.runtime.equipFirstMatching(itemId);
    if (
      result.success ||
      result.inventoryChanged ||
      result.materialsChanged ||
      result.consumablesChanged
    ) {
      this.refreshInventorySnapshot();
    } else {
      this.updateCraftingAvailability();
    }
    this.persistState();
    return result.success;
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
    if (!this.runtime) {
      return null;
    }
    return this.runtime.getUpgradeCostForInstance(owned.instanceId);
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
    if (!this.runtime) {
      return false;
    }
    const result = this.runtime.upgradeOwnedEquipment(instanceId);
    if (
      result.success ||
      result.inventoryChanged ||
      result.materialsChanged ||
      result.consumablesChanged
    ) {
      this.refreshInventorySnapshot();
    } else {
      this.updateCraftingAvailability();
    }
    this.persistState();
    return result.success;
  }

  protected getSalvageResult(def: ItemDefinition | undefined, owned: OwnedEquipment): {
    materialId: string;
    amount: number;
  } | null {
    if (!this.runtime) {
      return null;
    }
    return this.runtime.getSalvageResultForInstance(owned.instanceId);
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
    if (!this.runtime) {
      return false;
    }
    const result = this.runtime.salvageOwnedEquipment(instanceId);
    if (
      result.success ||
      result.inventoryChanged ||
      result.materialsChanged ||
      result.consumablesChanged
    ) {
      this.refreshInventorySnapshot();
    } else {
      this.updateCraftingAvailability();
    }
    this.persistState();
    return result.success;
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

    this.pauseSimulation();
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
    if (!this.runtime) {
      return false;
    }
    const result = this.runtime.socketOwnedEquipment(instanceId, chosen);
    if (
      result.success ||
      result.inventoryChanged ||
      result.materialsChanged ||
      result.consumablesChanged
    ) {
      this.refreshInventorySnapshot();
    } else {
      this.updateCraftingAvailability();
    }
    this.persistState();
    return result.success;
  }

  protected useConsumable(consumableId: string): boolean {
    if (!this.runtime) {
      return false;
    }
    const result = this.runtime.useConsumableItem(consumableId);
    if (result.success || result.consumablesChanged) {
      this.refreshInventorySnapshot();
      this.persistState();
      return result.success;
    }
    this.updateCraftingAvailability();
    return result.success;
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

  protected selectLootTable(
    id: string | null,
    options: { persist?: boolean; notifyRuntime?: boolean } = {}
  ) {
    if (!id) {
      if (!options.persist) {
        return;
      }
      this.selectedLootId = null;
      if (options.notifyRuntime) {
        this.runtime?.setLootTableId(null);
      }
      this.persistState();
      return;
    }

    const record = this.lootTables.find((table) => table.id === id);
    if (!record) {
      console.warn(`[Harness] Loot table '${id}' not found.`);
      return;
    }

    this.selectedLootId = record.id;

    if (options.notifyRuntime) {
      this.runtime?.setLootTableId(record.id);
    }

    if (options.persist !== false) {
      this.persistState();
    }

    this.notifyControlState();
  }

  protected startAuto() {
    if (!this.runtime) {
      return;
    }
    this.runtime.setTickInterval(this.tickIntervalSeconds);
    this.runtime.startAuto();
    this.running = true;
    this.ensureAnimationLoop();
    this.notifyControlState();
    this.refreshStatus();
  }

  protected stopAuto() {
    this.runtime?.stopAuto();
    this.running = false;
    this.stopAnimationLoop();
    this.notifyControlState();
    this.refreshStatus();
  }

  protected onFrame = (time: number) => {
    if (!this.runtime || !this.runtimeState?.running) {
      this.stopAnimationLoop();
      return;
    }

    const delta = (time - this.lastTimestamp) / 1000;
    this.lastTimestamp = time;
    this.runtime.tick(delta);

    this.rafHandle = requestAnimationFrame(this.onFrame);
  };

  protected applyRewards(summary: EncounterSummary) {
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

    this.runtime?.grantEncounterRewards(rewards);
    this.refreshInventorySnapshot();

    if (rewards.equipment && rewards.equipment.length) {
      this.pushLog(`[Loot] Equipment: ${formatEquipmentRewards(rewards.equipment)}`);
    }
    if (rewards.augments && rewards.augments.length) {
      this.pushLog(`[Loot] Augments: ${formatAugmentRewards(rewards.augments)}`);
    }
    const shardQty = rewards.materials?.["boss-shard"] ?? 0;
    if (shardQty > 0) {
      this.pushLog(`[Loot] Shards: boss-shard x${shardQty}`);
    }

    if (this.hero && rewards.xp > 0) {
      const levels = this.hero.addExperience(rewards.xp);
      if (levels > 0) {
        this.renderStatsTable();
        this.syncInventoryView();
      }
    }

    this.rewardClaimed = true;
    this.renderRewards();
    this.persistState();
  }

  protected refreshStatus(force = false) {
    const runningState = this.runtimeState?.running ?? false;
    const statusLabel = this.runtimeState
      ? runningState
        ? "Running"
        : "Paused"
      : "Idle";

    const summary = this.lastSummary;
    const heroHealth = this.hero ? Math.max(0, this.hero.health) : 0;
    const heroMaxHealth = this.hero ? Math.max(0, this.hero.maxHealth) : 0;
    const enemyHealth = this.enemy ? Math.max(0, this.enemy.health) : 0;
    const enemyMaxHealth = this.enemy ? Math.max(0, this.enemy.maxHealth) : 0;

    const payload: StatusPayload = {
      label: `${statusLabel} • tick ${this.tickIntervalSeconds.toFixed(2)}s`,
      stage: this.currentStageName || "-",
      wave: this.currentWaveNumber,
      opponent: this.currentEnemyLabel || "-",
      elapsedSeconds: summary?.elapsedSeconds ?? 0,
      swings: summary?.swings ?? 0,
      heroDamage: summary?.totalDamageFromSource ?? 0,
      enemyDamage: summary?.totalDamageFromTarget ?? 0,
      winner: summary?.victor ?? null,
      heroHealth,
      heroMaxHealth,
      enemyHealth,
      enemyMaxHealth,
      bossTimerRemaining: this.bossTimerRemaining,
      bossTimerTotal: this.bossTimerTotal,
      bossEnraged: this.bossEnraged,
    };

    this.listeners.onStatus?.(payload);
  }

  protected renderRewards() {
    this.listeners.onRewards?.({
      last: this.lastRewards,
      total: this.totalRewards,
    });
  }

  protected renderTelemetry() {
    const hero = this.telemetry.hero;
    const enemy = this.telemetry.enemy;

    const rows: TelemetryRow[] = [
      { label: "Attempts", hero: `${hero.attempts}`, enemy: `${enemy.attempts}` },
      { label: "Hits", hero: this.formatCount(hero.hits, hero.attempts), enemy: this.formatCount(enemy.hits, enemy.attempts) },
      { label: "Crits", hero: this.formatCount(hero.crits, hero.hits), enemy: this.formatCount(enemy.crits, enemy.hits) },
      { label: "Misses", hero: this.formatCount(hero.misses, hero.attempts), enemy: this.formatCount(enemy.misses, enemy.attempts) },
      { label: "Dodges", hero: this.formatCount(hero.dodges, hero.attempts), enemy: this.formatCount(enemy.dodges, enemy.attempts) },
      { label: "Parries", hero: this.formatCount(hero.parries, hero.attempts), enemy: this.formatCount(enemy.parries, enemy.attempts) },
      { label: "Avg Hit", hero: this.formatAverage(hero.totalDamage, hero.hits), enemy: this.formatAverage(enemy.totalDamage, enemy.hits) },
      { label: "Total Damage", hero: `${Math.round(hero.totalDamage)}`, enemy: `${Math.round(enemy.totalDamage)}` },
    ];

    this.listeners.onTelemetry?.(rows);
  }

  protected renderHistory() {
    this.listeners.onHistory?.(this.history.slice(-30).reverse());
  }

  protected renderStatsTable() {
    if (!this.hero) {
      this.listeners.onStats?.([{ label: "Status", value: "No hero", raw: 0 }]);
      return;
    }

    const rows = this.buildStatRows(this.hero);
    this.listeners.onStats?.(rows);
  }

  protected buildStatRows(hero: Character): StatRow[] {
    const proto = Reflect.getPrototypeOf(hero);
    return Object.entries(Object.getOwnPropertyDescriptors(proto))
      .filter(([name, descriptor]) => typeof descriptor.get === "function" && name !== "__proto__")
      .map(([name]) => {
        const raw = (hero as any)[name];
        const numericRaw = typeof raw === "number" && Number.isFinite(raw) ? raw : Number.NaN;
        return {
          label: name,
          value: this.formatStatValue(name, raw),
          raw: numericRaw,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
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
    const equipment = formatEquipmentRewards(rewards.equipment ?? []);
    if (equipment) {
      parts.push(`Eq: ${equipment}`);
    }
    const augments = formatAugmentRewards(rewards.augments ?? []);
    if (augments) {
      parts.push(`Aug: ${augments}`);
    }
    return parts.length ? parts.join("; ") : "-";
  }

  protected pushLog(entry: string) {
    this.listeners.onLog?.(entry);
  }

  protected setStatusMessage(message: string) {
    this.listeners.onLog?.(`[Status] ${message}`);
  }

  protected updateCraftingAvailability() {
    this.notifyCraftingState();
  }

  protected persistState() {
    if (!this.hero) {
      return;
    }

    try {
      const runtimeSnapshot = this.runtime ? this.runtime.getInventorySnapshot() : null;
      if (runtimeSnapshot) {
        this.inventorySnapshot = {
          equipped: { ...(runtimeSnapshot.equipped ?? {}) },
          inventory: runtimeSnapshot.inventory?.map((item) => this.cloneOwnedEquipment(item)) ?? [],
          materials: { ...(runtimeSnapshot.materials ?? {}) },
          consumables: { ...(runtimeSnapshot.consumables ?? {}) },
        };
      }

      const baseSnapshot = this.inventorySnapshot ?? {
        equipped: {},
        inventory: [],
        materials: {},
        consumables: {},
      };

      const snapshot: InventorySnapshot = {
        equipped: {},
        inventory: [],
        materials: { ...(baseSnapshot.materials ?? {}) },
        consumables: { ...(baseSnapshot.consumables ?? {}) },
      };

      Object.entries(baseSnapshot.equipped ?? {}).forEach(([slot, owned]) => {
        snapshot.equipped[slot] = owned ? this.cloneOwnedEquipment(owned) : null;
      });

      snapshot.inventory = (baseSnapshot.inventory ?? []).map((item) =>
        this.cloneOwnedEquipment(item)
      );

      const heroId = this.selectedHeroId ?? this.heroOptions[0]?.id ?? "";

      const progression = this.runtime ? this.runtime.getProgressionSnapshot() : null;

      const state: PersistedState = {
        version: 3,
        heroId,
        stageIndex: this.stageIndex,
        totalWavesCompleted: this.totalWavesCompleted,
        tickInterval: this.tickIntervalSeconds,
        lootTableId: this.selectedLootId ?? undefined,
        rewards: normalizeRewards(this.totalRewards),
        lastRewards: normalizeRewards(this.lastRewards),
        heroProgress: this.hero.serializeProgress(),
        history: this.history.slice(-40),
        historyCounter: this.historyCounter,
        inventorySnapshot: snapshot,
        resumeAfterVictory: this.resumeAfterVictory,
        highestStageCleared: progression?.highestStageCleared,
        clearedStages: progression ? [...progression.clearedStageIds] : undefined,
        statBonusMultiplier: progression?.statBonusMultiplier,
        progressionSnapshot: progression ?? undefined,
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
      if (!state || (state.version !== 2 && state.version !== 3)) {
        window.localStorage.removeItem(STORAGE_KEY);
        return false;
      }
      if (this.heroOptions.some((option) => option.id === state.heroId)) {
        this.selectedHeroId = state.heroId;
        this.runtime?.setHero(state.heroId, false);
      }

      this.selectedLootId = state.lootTableId ?? null;
      if (state.lootTableId) {
        this.selectLootTable(state.lootTableId, { persist: false, notifyRuntime: true });
      } else {
        this.selectLootTable(null, { persist: false, notifyRuntime: true });
      }

      this.stageIndex = Math.max(0, state.stageIndex ?? 0);
      this.ensureStageListCoverage(this.stageIndex);
      this.runtime?.setStageIndex(this.stageIndex);
      this.totalWavesCompleted = Math.max(0, state.totalWavesCompleted ?? 0);
      this.tickIntervalSeconds = Math.max(0.01, state.tickInterval ?? 0.1);
      this.runtime?.setTickInterval(this.tickIntervalSeconds);
      this.totalRewards = normalizeRewards(state.rewards);
      this.lastRewards = normalizeRewards(state.lastRewards);

      this.pendingSourceProgress = state.heroProgress;
      this.resumeAfterVictory = !!state.resumeAfterVictory;
      this.updateStagePreview();

      this.history = state.history ? state.history.slice(-40) : [];
      this.historyCounter = state.historyCounter ?? this.history.length;
      this.renderHistory();
      const sourceSnapshot = state.inventorySnapshot ?? null;
      const snapshot: InventorySnapshot = {
        equipped: {},
        inventory: [],
        materials: { ...(sourceSnapshot?.materials ?? {}) },
        consumables: { ...(sourceSnapshot?.consumables ?? {}) },
      };

      Object.entries(sourceSnapshot?.equipped ?? {}).forEach(([slot, owned]) => {
        snapshot.equipped[slot] = owned ? this.cloneOwnedEquipment(owned) : null;
      });

      snapshot.inventory = (sourceSnapshot?.inventory ?? []).map((item) =>
        this.cloneOwnedEquipment(item)
      );

      if (this.runtime) {
        this.runtime.setInventorySnapshot(snapshot);
      }
      this.inventorySnapshot = snapshot;
      this.applyInventorySnapshot(snapshot);
      this.syncInventoryView();

      const progressionSnapshot =
        state.progressionSnapshot ??
        (state.version === 2
          ? {
              highestStageCleared: state.highestStageCleared ?? 0,
              clearedStageIds: state.clearedStages ?? [],
              statBonusMultiplier: state.statBonusMultiplier ?? 1,
            }
          : undefined);
      if (progressionSnapshot && this.runtime) {
        this.runtime.setProgressionSnapshot(progressionSnapshot);
        this.updateStagePreview();
      }
      if (this.listeners.onControls) {
        this.notifyControlState();
      }
      return true;
    } catch (err) {
      console.warn("[Harness] Failed to restore state", err);
      return false;
    }
  }

  getItemDefinition(itemId: string): ItemDefinition | null {
    const def = this.itemDefs.get(itemId);
    return def ? this.cloneData(def) : null;
  }

  getEquipmentActionState(instanceId: string): EquipmentActionState | null {
    const owned = this.getOwnedEquipment(instanceId);
    if (!owned) {
      return null;
    }
    const def = this.itemDefs.get(owned.itemId);
    const slot = this.findEquippedSlot(instanceId);
    const upgrade = this.describeUpgrade(def, owned);
    const socket = this.describeSocket(owned);
    const salvageBase = this.describeSalvage(def, owned);
    const canSalvage = this.canSalvage(instanceId);

    const salvage: ActionDescriptor = {
      label: salvageBase.label,
      title: !canSalvage ? "Unequip item before salvaging" : salvageBase.title,
      disabled: salvageBase.disabled || !canSalvage,
    };

    return {
      instanceId,
      slot,
      isEquipped: slot !== null,
      upgrade,
      salvage,
      socket,
    };
  }

  equipFromInventory(instanceId: string): boolean {
    return this.equipOwnedFromInventory(instanceId);
  }

  upgradeOwnedEquipment(instanceId: string): boolean {
    return this.upgradeEquipment(instanceId);
  }

  salvageOwnedEquipment(instanceId: string): boolean {
    return this.salvageEquipment(instanceId);
  }

  socketOwnedEquipment(instanceId: string): boolean {
    return this.socketAugment(instanceId);
  }

  useConsumableItem(consumableId: string): boolean {
    return this.useConsumable(consumableId);
  }

  selectEquipmentRecipe(id: string | null) {
    const next = id && this.recipeMap.has(id) ? id : null;
    this.setSelectedRecipe("equipment", next);
  }

  selectConsumableRecipe(id: string | null) {
    const next = id && this.recipeMap.has(id) ? id : null;
    this.setSelectedRecipe("consumable", next);
  }

  selectMaterialRecipe(id: string | null) {
    const next = id && this.recipeMap.has(id) ? id : null;
    this.setSelectedRecipe("material", next);
  }

  craftEquipmentRecipe(id: string): boolean {
    const next = this.recipeMap.has(id) ? id : null;
    return next ? this.craftEquipment(next) : false;
  }

  craftConsumableRecipe(id: string): boolean {
    const next = this.recipeMap.has(id) ? id : null;
    return next ? this.craftConsumable(next) : false;
  }

  craftMaterialRecipe(id: string): boolean {
    const next = this.recipeMap.has(id) ? id : null;
    return next ? this.craftMaterial(next) : false;
  }

  equipCraftedResult(itemId: string): boolean {
    return this.equipFirstMatchingItem(itemId);
  }

  startSimulation() {
    if (!this.runtimeState) {
      this.resetEncounter(false);
    }
    this.startAuto();
  }

  pauseSimulation() {
    this.stopAuto();
  }

  resetSimulation(freshHero = true) {
    this.resetEncounter(freshHero);
  }

  updateTickInterval(value: number) {
    const next = Math.max(0.01, Number.isFinite(value) ? value : this.tickIntervalSeconds);
    this.tickIntervalSeconds = next;
    this.runtime?.setTickInterval(next);
    this.persistState();
    this.refreshStatus(true);
    this.notifyControlState();
  }

  setAutoResume(enabled: boolean) {
    this.resumeAfterVictory = enabled;
    this.notifyControlState();
    this.persistState();
  }

  selectHero(heroId: string) {
    if (!this.heroOptions.some((preset) => preset.id === heroId)) {
      console.warn(`[Harness] Unknown hero '${heroId}'`);
      return;
    }
    this.selectedHeroId = heroId;
    this.runtime?.setHero(heroId, true);
    this.resetEncounter(true);
  }

  selectStage(index: number) {
    const target = Math.max(0, index);
    this.stageIndex = target;
    this.ensureStageListCoverage(target);
    this.runtime?.setStageIndex(target);
    this.updateStagePreview();
    this.resetEncounter(false);
  }

  selectLoot(id: string | null) {
    this.selectLootTable(id, { persist: true, notifyRuntime: true });
    this.resetEncounter(false);
  }

  unequipSlot(slot: EquippedSlotKey): boolean {
    if (!this.runtime) {
      return false;
    }
    this.pauseSimulation();
    const result = this.runtime.unequipSlot(slot);
    if (
      result.success ||
      result.inventoryChanged ||
      result.materialsChanged ||
      result.consumablesChanged
    ) {
      this.refreshInventorySnapshot();
    } else {
      this.updateCraftingAvailability();
    }
    this.persistState();
    return result.success;
  }

  getEquipPreview(instanceId: string): StatPreviewRow[] | null {
    if (!this.hero) {
      return null;
    }

    const ownedSource =
      this.equipmentInventory.find((item) => item.instanceId === instanceId) ??
      (Object.values(this.equippedItems).find((item) => item?.instanceId === instanceId) ?? null);

    if (!ownedSource) {
      return null;
    }

    const definition = this.itemDefs.get(ownedSource.itemId);
    if (!definition || !definition.slot) {
      return null;
    }

    const slotKey = definition.slot as EquippedSlotKey;
    const baseRows = this.buildStatRows(this.hero);
    const loadout = this.cloneLoadout({ [slotKey]: ownedSource });
    const previewHero = this.createHeroClone(loadout);
    if (!previewHero) {
      return null;
    }

    const previewRows = this.buildStatRows(previewHero);
    const previewMap = new Map(previewRows.map((row) => [row.label, row]));

    return baseRows
      .map((baseRow) => {
        const previewRow = previewMap.get(baseRow.label) ?? baseRow;
        const baseRaw = Number.isFinite(baseRow.raw) ? baseRow.raw : Number.NaN;
        const previewRaw = Number.isFinite(previewRow.raw) ? previewRow.raw : Number.NaN;
        const delta = previewRaw - baseRaw;

        return {
          label: baseRow.label,
          current: baseRow.value,
          preview: previewRow.value,
          delta,
          deltaFormatted: this.formatDeltaValue(baseRow.label, delta),
        };
      })
      .filter((row) => Number.isFinite(row.delta));
  }

  protected formatDeltaValue(label: string, delta: number): string {
    if (!Number.isFinite(delta) || Math.abs(delta) < 1e-4) {
      return "±0";
    }

    const isPercent = label.toLowerCase().includes("percent");
    const scaled = isPercent ? delta * 100 : delta;
    const magnitude = Math.abs(scaled);
    const precision = magnitude >= 100 ? 0 : magnitude >= 10 ? 1 : 2;
    const formatted = scaled.toFixed(precision);
    return `${scaled >= 0 ? "+" : ""}${formatted}${isPercent ? "%" : ""}`;
  }

  protected cloneData<T>(data: T): T {
    return JSON.parse(JSON.stringify(data));
  }
}
