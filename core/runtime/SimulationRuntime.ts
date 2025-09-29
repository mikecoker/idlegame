import { CombatSim } from "../combat/CombatSim";
import {
  EncounterEvent,
  EncounterLoop,
  EncounterSummary,
  EncounterRewards,
} from "../combat/Encounter";
import { Character, CharacterData } from "../characters/Character";
import { GameDataSource, HeroDefinition } from "../data/DataSource";
import {
  DEFAULT_LOOT_TABLE_ID,
  LootAugmentDrop,
  LootEquipmentDrop,
  LootMaterialDrop,
  LootRange,
  LootTableConfig,
} from "../economy/LootTable";
import { EnemyUnit, StageDefinition } from "../progression/Stage";
import { ProgressionConfig } from "../progression/ProgressionConfig";
import {
  StageGenerator,
  StageBlueprint,
  BossEncounterConfig,
  StageRewardsSummary,
  StagePreview,
} from "../progression/StageGenerator";
import {
  CraftingRecipe,
  ItemDefinition,
  ItemLibrary,
} from "../items/ItemDefinition";
import {
  ConsumableUseResult,
  InventoryMutationResult,
  InventorySnapshot,
  PlayerInventory,
} from "./PlayerInventory";

export interface SimulationRuntimeHooks {
  onStateChanged?(state: SimulationState): void;
  onLog?(entry: string): void;
  onEncounterEvents?(events: EncounterEvent[]): void;
  onEncounterComplete?(summary: EncounterSummary): void;
}

export interface SimulationRuntimeOptions {
  tickIntervalSeconds?: number;
  autoStart?: boolean;
  hooks?: SimulationRuntimeHooks;
}

export interface PartySummary {
  size: number;
  alive: number;
  averageLevel: number;
  totalAttackPower: number;
  totalDps: number;
}

export interface PartySlotState {
  index: number;
  heroId: string | null;
  unlocked: boolean;
  unlockStage: number;
  isPrimary: boolean;
}

export interface PartyConfiguration {
  maxSlots: number;
  unlockedSlots: number;
  primaryIndex: number;
  primaryHeroId: string | null;
  slots: PartySlotState[];
}

export interface EnemyRosterEntry {
  id: string;
  label: string;
}

export interface SimulationState {
  heroId: string | null;
  primaryHeroId: string | null;
  primarySlotIndex: number;
  stageIndex: number;
  stageName: string;
  waveNumber: number;
  totalWavesCompleted: number;
  enemyLabel: string;
  isBossWave: boolean;
  running: boolean;
  hero: Character | null;
  enemy: Character | null;
  lootTableId: string | null;
  bossTimerRemaining: number;
  bossTimerTotal: number;
  bossEnraged: boolean;
  party: Character[];
  enemyParty: Character[];
  partyIds: string[];
  partySlotOrder: number[];
  partySummary: PartySummary;
  enemyRoster: EnemyRosterEntry[];
}

export interface ProgressionSnapshot {
  highestStageCleared: number;
  clearedStageIds: number[];
  statBonusMultiplier: number;
}

export class SimulationRuntime {
  protected readonly sim: CombatSim;
  protected encounter: EncounterLoop | null = null;

  protected heroes: HeroDefinition[] = [];
  protected enemyPools: Record<string, EnemyUnit[]> = { small: [], medium: [], boss: [] };
  protected progressionConfig: ProgressionConfig | null = null;
  protected stageGenerator: StageGenerator | null = null;
  protected stageCache: Map<string, StageBlueprint> = new Map();
  protected stageRewards: StageRewardsSummary | null = null;
  protected bossConfig: BossEncounterConfig | null = null;
  protected bossTimerTotal = 0;
  protected bossTimerRemaining = 0;
  protected bossEnraged = false;
  protected lootTables: Map<string, LootTableConfig> = new Map();
  protected itemDefinitions: ItemDefinition[] = [];
  protected craftingRecipes: CraftingRecipe[] = [];

  protected party: Character[] = [];
  protected enemyParty: Character[] = [];
  protected hero: Character | null = null;
  protected enemy: Character | null = null;
  protected primarySlotIndex = 0;
  protected activePartySlots: number[] = [];
  protected activePartyIds: string[] = [];

  protected stageIndex = 0;
  protected stageWaveCompleted = 0;
  protected totalWavesCompleted = 0;
  protected currentWaveUnits: EnemyUnit[] = [];
  protected enemyRoster: EnemyRosterEntry[] = [];
  protected currentWaveNumber = 0;
  protected currentStageName = "";
  protected currentEnemyLabel = "";
  protected currentWaveIsBoss = false;
  protected announcedResult = false;

  protected clearedStages: Set<number> = new Set();
  protected highestStageCleared = 0;
  protected permanentStatMultiplier = 1;
  protected appliedProgressionMultiplier = 1;
  protected gemRewardPool = ["ember-gem", "glacial-core", "storm-sigil"];

  protected tickIntervalSeconds: number;
  protected autoStart: boolean;

  protected selectedHeroId: string | null = null;
  protected selectedLootId: string | null = null;

  protected selectedHeroIds: (string | null)[] = [];
  protected partyRoster: Map<string, Character> = new Map();
  protected readonly maxPartySize = 5;
  protected readonly partySlotThresholds = [0, 10, 25, 50, 80];

  protected initialized = false;
  protected itemLibrary = new ItemLibrary();
  protected playerInventory = new PlayerInventory(this.itemLibrary);
  protected pendingInventorySnapshot: InventorySnapshot | null = null;

  constructor(
    protected readonly dataSource: GameDataSource,
    options?: SimulationRuntimeOptions
  ) {
    this.sim = new CombatSim();
    this.tickIntervalSeconds = Math.max(0.01, options?.tickIntervalSeconds ?? 0.1);
    this.autoStart = options?.autoStart ?? true;
    this.hooks = options?.hooks ?? {};
  }

  protected hooks: SimulationRuntimeHooks;

  async initialize(freshHero = true): Promise<void> {
    this.heroes = await this.dataSource.loadHeroes();
    this.enemyPools = await this.dataSource.loadEnemyPools();
    this.progressionConfig = await this.dataSource.loadProgressionConfig();
    this.stageCache.clear();
    if (this.progressionConfig) {
      this.stageGenerator = new StageGenerator(this.progressionConfig);
    }

    this.updatePartyUnlocks();
    this.normalizePrimarySelection(this.calculateUnlockedPartySize());

    const lootTables = await this.dataSource.loadLootTables();
    this.lootTables.clear();
    lootTables.forEach((table) => {
      const id = table.id ?? DEFAULT_LOOT_TABLE_ID;
      this.lootTables.set(id, this.sanitiseLootTable({ ...table, id }));
    });

    if (!this.lootTables.size) {
      const fallback = this.sanitiseLootTable({
        id: DEFAULT_LOOT_TABLE_ID,
        name: "Default Loot",
        xpPerWin: 0,
        gold: { min: 0, max: 0 },
        materialDrops: [],
        equipmentDrops: [],
        augmentDrops: [],
      });
      this.lootTables.set(fallback.id, fallback);
    }

    this.itemDefinitions = await this.dataSource.loadItemDefinitions();
    this.itemLibrary.setDefinitions(this.itemDefinitions);
    this.craftingRecipes = await this.dataSource.loadCraftingRecipes();
    this.playerInventory.reset();
    if (this.pendingInventorySnapshot) {
      this.playerInventory.setSnapshot(this.pendingInventorySnapshot);
      this.pendingInventorySnapshot = null;
    }

    if (!this.selectedHeroId && this.heroes.length) {
      this.selectedHeroId = this.heroes[0].id;
    }
    if (!this.selectedHeroIds.length && this.heroes.length) {
      this.selectedHeroIds = new Array(this.maxPartySize).fill(null);
      this.heroes.forEach((hero, index) => {
        if (index < this.maxPartySize) {
          this.selectedHeroIds[index] = hero.id;
        }
      });
    } else if (this.selectedHeroIds.length) {
      this.selectedHeroIds[0] = this.selectedHeroIds[0] ?? this.selectedHeroId;
    }
    if (this.selectedHeroIds[0]) {
      this.selectedHeroId = this.selectedHeroIds[0];
    }
    if (!this.selectedLootId && this.lootTables.size) {
      this.selectedLootId = Array.from(this.lootTables.keys())[0];
    }

    this.ensureParty(freshHero);
    this.refreshHeroLoadout(false);
    this.resetEncounterInternal();
    this.initialized = true;
    this.emitState();
  }

  getState(): SimulationState {
    return {
      heroId: this.selectedHeroId,
      primaryHeroId: this.selectedHeroId,
      primarySlotIndex: this.primarySlotIndex,
      stageIndex: this.stageIndex,
      stageName: this.currentStageName,
      waveNumber: this.currentWaveNumber,
      totalWavesCompleted: this.totalWavesCompleted,
      enemyLabel: this.currentEnemyLabel,
      isBossWave: this.currentWaveIsBoss,
      running: this.encounter?.isRunning ?? false,
      hero: this.hero,
      enemy: this.enemy,
      lootTableId: this.selectedLootId,
      bossTimerRemaining: this.currentWaveIsBoss ? this.bossTimerRemaining : 0,
      bossTimerTotal: this.currentWaveIsBoss ? this.bossTimerTotal : 0,
      bossEnraged: this.currentWaveIsBoss ? this.bossEnraged : false,
      party: this.party,
      enemyParty: this.enemyParty,
      partyIds: this.activePartyIds.slice(),
      partySlotOrder: this.activePartySlots.slice(),
      partySummary: this.getPartySummary(),
      enemyRoster: this.enemyRoster.map((entry) => ({ ...entry })),
    };
  }

  listHeroes(): HeroDefinition[] {
    return this.heroes.map((hero) => ({ ...hero, data: this.cloneData(hero.data) }));
  }

  listStages(): StageDefinition[] {
    const maxStages = Math.max(this.stageIndex + 10, this.highestStageCleared + 10, 50);
    const stages: StageDefinition[] = [];
    for (let index = 0; index < maxStages; index += 1) {
      const stageNumber = index + 1;
      const blueprint = this.getStageBlueprint(stageNumber);
      stages.push({
        id: `stage-${stageNumber}`,
        name: blueprint?.name ?? `Stage ${stageNumber}`,
        waves: blueprint?.waves.length ?? 0,
        lootTable: blueprint?.lootTableId ?? null,
      });
    }
    return stages;
  }

  listLootTables(): LootTableConfig[] {
    return Array.from(this.lootTables.values()).map((table) => ({
      ...table,
      gold: table.gold ? { ...table.gold } : undefined,
      materialDrops: table.materialDrops ? table.materialDrops.map((drop) => ({ ...drop })) : undefined,
      equipmentDrops: table.equipmentDrops ? table.equipmentDrops.map((drop) => ({ ...drop })) : undefined,
      augmentDrops: table.augmentDrops ? table.augmentDrops.map((drop) => ({ ...drop })) : undefined,
    }));
  }

  setHooks(hooks: SimulationRuntimeHooks) {
    this.hooks = hooks;
  }

  setTickInterval(seconds: number) {
    this.tickIntervalSeconds = Math.max(0.01, seconds);
    this.encounter?.setTickInterval(this.tickIntervalSeconds);
    this.emitState();
  }

  getTickInterval(): number {
    return this.encounter?.getTickInterval() ?? this.tickIntervalSeconds;
  }

  setHero(heroId: string, fresh = true) {
    this.ensurePartyArrayShape();
    const unlocked = this.calculateUnlockedPartySize();
    let slotIndex = this.selectedHeroIds.findIndex(
      (id, idx) => idx < unlocked && id === heroId
    );

    if (slotIndex < 0) {
      const preferredSlot = this.primarySlotIndex < unlocked ? this.primarySlotIndex : 0;
      this.setPartySlot(preferredSlot, heroId, {
        refreshRoster: fresh,
        resetEncounter: false,
      });
      slotIndex = this.selectedHeroIds.findIndex(
        (id, idx) => idx < unlocked && id === heroId
      );
    } else if (fresh) {
      this.setPartySlot(slotIndex, heroId, {
        refreshRoster: true,
        resetEncounter: false,
      });
    }

    if (slotIndex >= 0) {
      this.setPrimarySlot(slotIndex, { refreshRoster: false, resetEncounter: false });
    }
  }

  getPartyConfiguration(): PartyConfiguration {
    this.ensurePartyArrayShape();
    const unlocked = this.calculateUnlockedPartySize();
    return {
      maxSlots: this.maxPartySize,
      unlockedSlots: unlocked,
      primaryIndex: Math.min(this.primarySlotIndex, unlocked - 1),
      primaryHeroId: this.selectedHeroId,
      slots: this.selectedHeroIds.map((heroId, index) => ({
        index,
        heroId,
        unlocked: index < unlocked,
        unlockStage:
          this.partySlotThresholds[index] ??
          this.partySlotThresholds[this.partySlotThresholds.length - 1] ??
          0,
        isPrimary:
          index === this.primarySlotIndex &&
          index < unlocked &&
          Boolean(heroId) &&
          heroId === this.selectedHeroId,
      })),
    };
  }

  setPartySlot(
    slotIndex: number,
    heroId: string | null,
    options: { refreshRoster?: boolean; resetEncounter?: boolean } = {}
  ) {
    this.ensurePartyArrayShape();
    const normalizedIndex = Math.max(0, Math.min(this.maxPartySize - 1, Math.floor(slotIndex)));
    const unlocked = this.calculateUnlockedPartySize();
    if (normalizedIndex >= unlocked) {
      this.log(
        `[Runtime] Cannot assign hero to locked slot ${normalizedIndex + 1}. Unlock stage ${
          this.partySlotThresholds[normalizedIndex] ?? "?"
        }.`
      );
      return;
    }

    if (heroId && !this.heroes.some((hero) => hero.id === heroId)) {
      this.log(`[Runtime] Hero '${heroId}' not found. Party slot unchanged.`);
      return;
    }

    const nextId = heroId ?? null;
    const existing = this.selectedHeroIds[normalizedIndex] ?? null;
    if (existing === nextId) {
      return;
    }

    if (nextId) {
      for (let index = 0; index < this.selectedHeroIds.length; index += 1) {
        if (index !== normalizedIndex && this.selectedHeroIds[index] === nextId) {
          this.selectedHeroIds[index] = null;
        }
      }
    }

    this.selectedHeroIds[normalizedIndex] = nextId;
    if (nextId && (!this.selectedHeroId || this.primarySlotIndex === normalizedIndex)) {
      this.selectedHeroId = nextId;
      this.primarySlotIndex = normalizedIndex;
    }
    this.normalizePrimarySelection(unlocked);

    this.applyPartySelection({
      refreshRoster: options.refreshRoster ?? false,
      resetEncounter: options.resetEncounter ?? false,
    });
  }

  swapPartySlots(a: number, b: number, options: { resetEncounter?: boolean } = {}) {
    this.ensurePartyArrayShape();
    const unlocked = this.calculateUnlockedPartySize();
    const first = Math.max(0, Math.min(this.maxPartySize - 1, Math.floor(a)));
    const second = Math.max(0, Math.min(this.maxPartySize - 1, Math.floor(b)));

    if (first === second) {
      return;
    }
    if (first >= unlocked || second >= unlocked) {
      this.log(`[Runtime] Cannot swap locked party slots (${first + 1}, ${second + 1}).`);
      return;
    }

    const firstId = this.selectedHeroIds[first] ?? null;
    const secondId = this.selectedHeroIds[second] ?? null;
    this.selectedHeroIds[first] = secondId;
    this.selectedHeroIds[second] = firstId;

    if (this.primarySlotIndex === first) {
      this.primarySlotIndex = second;
    } else if (this.primarySlotIndex === second) {
      this.primarySlotIndex = first;
    }

    this.normalizePrimarySelection(unlocked);
    this.applyPartySelection({
      refreshRoster: false,
      resetEncounter: options.resetEncounter ?? false,
    });
  }

  setPrimarySlot(slotIndex: number, options: { refreshRoster?: boolean; resetEncounter?: boolean } = {}) {
    this.ensurePartyArrayShape();
    const unlocked = this.calculateUnlockedPartySize();
    const normalized = Math.max(0, Math.min(this.maxPartySize - 1, Math.floor(slotIndex)));

    if (normalized >= unlocked) {
      this.log(
        `[Runtime] Cannot promote locked slot ${normalized + 1}. Unlock stage ${
          this.partySlotThresholds[normalized] ?? '?'
        }.`
      );
      return;
    }

    const heroId = this.selectedHeroIds[normalized];
    if (!heroId) {
      this.log(`[Runtime] Cannot promote empty slot ${normalized + 1}.`);
      return;
    }

    this.primarySlotIndex = normalized;
    this.selectedHeroId = heroId;
    this.normalizePrimarySelection(unlocked);
    this.applyPartySelection({
      refreshRoster: options.refreshRoster ?? false,
      resetEncounter: options.resetEncounter ?? false,
    });
  }

  setPartyOrder(order: (string | null)[], options: { resetEncounter?: boolean } = {}) {
    this.ensurePartyArrayShape();
    const unlocked = this.calculateUnlockedPartySize();
    const sanitized: (string | null)[] = new Array(this.maxPartySize).fill(null);
    const unique = new Set<string>();

    for (let index = 0; index < Math.min(order.length, unlocked); index += 1) {
      const heroId = order[index];
      if (!heroId) {
        continue;
      }
      if (!this.heroes.some((hero) => hero.id === heroId)) {
        continue;
      }
      if (unique.has(heroId)) {
        continue;
      }
      sanitized[index] = heroId;
      unique.add(heroId);
    }

    for (let index = 0; index < this.maxPartySize; index += 1) {
      this.selectedHeroIds[index] = index < sanitized.length ? sanitized[index] : null;
    }

    if (this.selectedHeroId) {
      const primaryIndex = this.selectedHeroIds.findIndex(
        (id, idx) => idx < unlocked && id === this.selectedHeroId
      );
      if (primaryIndex >= 0) {
        this.primarySlotIndex = primaryIndex;
      }
    }

    this.normalizePrimarySelection(unlocked);
    this.applyPartySelection({
      refreshRoster: false,
      resetEncounter: options.resetEncounter ?? false,
    });
  }

  clearPartySlot(slotIndex: number, options: { resetEncounter?: boolean } = {}) {
    this.setPartySlot(slotIndex, null, {
      refreshRoster: false,
      resetEncounter: options.resetEncounter,
    });
  }

  setStageIndex(index: number) {
    this.stageIndex = Math.max(0, index);
    this.updatePartyUnlocks();
    this.ensureParty(false);
    this.resetEncounterInternal();
    this.emitState();
  }

  setLootTableId(lootId: string | null) {
    if (lootId && !this.lootTables.has(lootId)) {
      this.log(`Unknown loot table '${lootId}', ignoring.`);
      return;
    }
    this.selectedLootId = lootId;
    this.emitState();
  }

  getProgressionSnapshot(): ProgressionSnapshot {
    return {
      highestStageCleared: this.highestStageCleared,
      clearedStageIds: Array.from(this.clearedStages.values()).sort((a, b) => a - b),
      statBonusMultiplier: this.permanentStatMultiplier,
    };
  }

  setProgressionSnapshot(snapshot: ProgressionSnapshot | null | undefined) {
    if (!snapshot) {
      this.clearedStages.clear();
      this.highestStageCleared = 0;
      this.permanentStatMultiplier = 1;
      this.appliedProgressionMultiplier = 1;
      this.applyProgressionBonusesToParty();
      return;
    }
    this.clearedStages = new Set(snapshot.clearedStageIds ?? []);
    this.highestStageCleared = Math.max(0, snapshot.highestStageCleared ?? 0);
    const multiplier = snapshot.statBonusMultiplier ?? 1;
    this.permanentStatMultiplier = Math.max(1, multiplier);
    this.appliedProgressionMultiplier = 1;
    this.updatePartyUnlocks();
    this.ensureParty(false);
    this.applyProgressionBonusesToParty();
  }

  getStagePreview(stageNumber?: number): StagePreview | null {
    const blueprint = this.getStageBlueprint(stageNumber ?? this.stageIndex + 1);
    if (!blueprint) {
      return null;
    }
    return {
      stageNumber: blueprint.stageNumber,
      name: blueprint.name,
      waveCount: blueprint.waves.length,
      lootTableId: blueprint.lootTableId,
      rewards: { ...blueprint.rewards },
      bossConfig: { ...blueprint.bossConfig },
    };
  }

  listItemDefinitions(): ItemDefinition[] {
    return this.itemLibrary.listDefinitions();
  }

  getItemDefinition(itemId: string): ItemDefinition | undefined {
    return this.itemLibrary.getDefinition(itemId);
  }

  listCraftingRecipes(): CraftingRecipe[] {
    return this.craftingRecipes.map((recipe) => ({
      ...recipe,
      cost: { ...(recipe.cost ?? {}) },
    }));
  }

  getInventorySnapshot(): InventorySnapshot {
    return this.playerInventory.getSnapshot();
  }

  setInventorySnapshot(snapshot: InventorySnapshot | null) {
    if (!snapshot) {
      this.playerInventory.reset();
      this.pendingInventorySnapshot = null;
      if (this.initialized) {
        this.refreshHeroLoadout();
        this.emitState();
      }
      return;
    }

    const clone = this.cloneInventorySnapshot(snapshot);
    if (!this.initialized) {
      this.pendingInventorySnapshot = clone;
      return;
    }

    this.playerInventory.setSnapshot(clone);
    this.refreshAllHeroLoadouts();
    this.emitState();
  }

  equipFromInventory(
    instanceId: string,
    options: { heroId?: string | null } = {}
  ): InventoryMutationResult {
    const guard = this.ensureInventoryReady();
    if (guard) {
      return this.processInventoryMutation(guard);
    }
    const heroId = this.resolveInventoryHeroId(options.heroId);
    const result = this.playerInventory.equipFromInventory(instanceId, heroId ?? undefined);
    return this.processInventoryMutation(result);
  }

  equipFirstMatching(
    itemId: string,
    options: { heroId?: string | null } = {}
  ): InventoryMutationResult {
    const guard = this.ensureInventoryReady();
    if (guard) {
      return this.processInventoryMutation(guard);
    }
    const heroId = this.resolveInventoryHeroId(options.heroId);
    const result = this.playerInventory.equipFirstMatching(itemId, heroId ?? undefined);
    return this.processInventoryMutation(result);
  }

  unequipSlot(
    slot: string,
    options: { heroId?: string | null } = {}
  ): InventoryMutationResult {
    const guard = this.ensureInventoryReady();
    if (guard) {
      return this.processInventoryMutation(guard);
    }
    const heroId = this.resolveInventoryHeroId(options.heroId);
    const result = this.playerInventory.unequipSlot(slot, heroId ?? undefined);
    return this.processInventoryMutation(result);
  }

  upgradeOwnedEquipment(instanceId: string): InventoryMutationResult {
    const guard = this.ensureInventoryReady();
    if (guard) {
      return this.processInventoryMutation(guard);
    }
    const result = this.playerInventory.upgradeEquipment(instanceId);
    return this.processInventoryMutation(result);
  }

  salvageOwnedEquipment(instanceId: string): InventoryMutationResult {
    const guard = this.ensureInventoryReady();
    if (guard) {
      return this.processInventoryMutation(guard);
    }
    const result = this.playerInventory.salvageEquipment(instanceId);
    return this.processInventoryMutation(result);
  }

  socketOwnedEquipment(instanceId: string, augmentId: string): InventoryMutationResult {
    const guard = this.ensureInventoryReady();
    if (guard) {
      return this.processInventoryMutation(guard);
    }
    const result = this.playerInventory.socketEquipment(instanceId, augmentId);
    return this.processInventoryMutation(result);
  }

  useConsumableItem(consumableId: string, options: { targetHeroId?: string } = {}): ConsumableUseResult {
    const guard = this.ensureInventoryReady();
    if (guard) {
      const messages = guard.messages ?? ["Inventory unavailable."];
      messages.forEach((message) => this.log(`[Consumable] ${message}`));
      return {
        success: false,
        messages,
      };
    }
    const result = this.playerInventory.useConsumable(consumableId);
    if (result.success && result.effect?.kind === "heal") {
      const percent = result.effect.percent;
      const targetId = options.targetHeroId ?? null;
      const target = targetId ? this.getPartyMemberByHeroId(targetId) : this.hero;
      if (target) {
        target.healPercent(percent);
      } else if (this.party.length) {
        this.party.forEach((member) => member.healPercent(percent));
      }
    }
    return this.processConsumableResult(result);
  }

  craftRecipe(recipeId: string): InventoryMutationResult {
    const guard = this.ensureInventoryReady();
    if (guard) {
      return this.processInventoryMutation(guard);
    }
    const recipe = this.craftingRecipes.find((entry) => entry.id === recipeId);
    if (!recipe) {
      return {
        success: false,
        messages: [`Recipe '${recipeId}' not found.`],
      };
    }
    const result = this.playerInventory.craftRecipe(recipe);
    return this.processInventoryMutation(result);
  }

  grantEncounterRewards(rewards: EncounterRewards): InventoryMutationResult {
    const guard = this.ensureInventoryReady();
    if (guard) {
      return this.processInventoryMutation(guard);
    }
    const result = this.playerInventory.grantRewards(rewards);
    return this.processInventoryMutation(result);
  }

  getUpgradeCostForInstance(instanceId: string): Record<string, number> | null {
    return this.playerInventory.getUpgradeCostForInstance(instanceId);
  }

  getSalvageResultForInstance(instanceId: string) {
    return this.playerInventory.getSalvageResultForInstance(instanceId);
  }

  getAvailableAugmentIds(): string[] {
    return this.playerInventory.getAvailableAugments();
  }

  resetEncounter(autoStart = this.autoStart, freshHero = true) {
    if (!this.initialized) {
      return;
    }
    this.ensureParty(freshHero);
    this.refreshHeroLoadout();
    this.resetPartyVitals();
    this.resetEncounterInternal(autoStart);
  }

  protected resetEncounterInternal(autoStart = this.autoStart) {
    if (!this.party.length) {
      return;
    }

    this.tickIntervalSeconds = Math.max(0.01, this.tickIntervalSeconds);

    this.stageWaveCompleted = 0;
    this.totalWavesCompleted = 0;
    this.currentWaveUnits = [];
    this.enemyRoster = [];
    this.currentWaveNumber = 0;
    const blueprint = this.getStageBlueprint(this.stageIndex + 1);
    this.currentStageName = blueprint?.name ?? `Stage ${this.stageIndex + 1}`;
    this.stageRewards = blueprint?.rewards ?? null;
    this.bossConfig = blueprint?.bossConfig ?? null;
    this.bossTimerTotal = blueprint?.bossConfig?.timerSeconds ?? 0;
    this.bossTimerRemaining = this.bossTimerTotal;
    this.bossEnraged = false;
    this.currentWaveIsBoss = false;

    this.resetPartyVitals();
    this.enemyParty = [];
    this.encounter = null;
    this.announcedResult = false;

    this.applyProgressionBonusesToParty();

    if (!this.prepareNextWave()) {
      this.log("[Runtime] Failed to prepare first wave.");
      return;
    }

    this.startNextEncounter(autoStart);
    this.emitState();
  }

  startAuto() {
    if (!this.encounter) {
      const hasActiveParty = this.party.some((member) => member.isAlive);
      if (!hasActiveParty) {
        return;
      }
      if (!this.currentWaveUnits.length) {
        if (!this.prepareNextWave()) {
          return;
        }
      }
      this.startNextEncounter(true);
    }
    this.encounter?.setTickInterval(this.tickIntervalSeconds);
    this.encounter?.start();
    this.emitState();
  }

  stopAuto() {
    this.encounter?.stop();
    this.emitState();
  }

  toggleAuto() {
    if (!this.encounter) {
      return;
    }
    if (this.encounter.isRunning) {
      this.stopAuto();
    } else {
      this.startAuto();
    }
  }

  isRunning(): boolean {
    return this.encounter?.isRunning ?? false;
  }

  isComplete(): boolean {
    return this.encounter?.isComplete ?? false;
  }

  tick(deltaSeconds: number) {
    if (!this.encounter) {
      return;
    }

    if (this.currentWaveIsBoss) {
      if (this.bossTimerRemaining > 0) {
        this.bossTimerRemaining = Math.max(0, this.bossTimerRemaining - deltaSeconds);
        if (this.bossTimerRemaining <= 0 && !this.announcedResult) {
          this.handleBossTimeout();
          return;
        }
      }

      const boss = this.enemyParty[0];
      if (!this.bossEnraged && this.bossConfig && boss && boss.isAlive) {
        const hpRatio = boss.maxHealth > 0 ? boss.health / boss.maxHealth : 1;
        if (hpRatio <= Math.max(0, Math.min(1, this.bossConfig.enrageHpPercent))) {
          this.applyBossEnrage();
        }
      }
    }

    const events = this.encounter.tick(deltaSeconds);
    if (events.length && this.hooks.onEncounterEvents) {
      this.hooks.onEncounterEvents(events);
    }

    if (this.encounter.isComplete && !this.announcedResult) {
      const summary = this.encounter.getSummary();
      this.announcedResult = true;
      this.handleEncounterSummary(summary);
    }

    this.emitState();
  }

  protected handleEncounterSummary(summary: EncounterSummary | null) {
    if (!summary) {
      return;
    }

    if (this.hooks.onEncounterComplete) {
      this.hooks.onEncounterComplete(summary);
    }

    switch (summary.victor) {
      case "source":
        this.handleHeroVictory(summary);
        break;
      case "target":
        this.handleHeroDefeat();
        break;
      default:
        this.log("[Runtime] Encounter ended without a victor.");
        break;
    }
  }

  protected handleHeroVictory(summary: EncounterSummary) {
    if (!this.party.length) {
      return;
    }

    if (summary.rewards?.xp) {
      const xp = summary.rewards.xp;
      const recipients = this.party.filter((member) => member.isAlive);
      const baseShare = recipients.length ? Math.floor(xp / recipients.length) : xp;
      const remainder = recipients.length ? xp - baseShare * recipients.length : 0;
      recipients.forEach((member, index) => {
        const gain = baseShare + (index < remainder ? 1 : 0);
        const levelsGained = member.addExperience(gain);
        const label = this.getHeroLabel(member);
        const progressPct = (member.experienceProgress * 100).toFixed(1);
        this.log(
          `[Runtime] ${label} gains ${gain} XP (level ${member.level}, ${progressPct}% to next).`
        );
        if (levelsGained > 0) {
          this.log(`[Runtime] ${label} advanced ${levelsGained} levels.`);
        }
      });
    }

    const wasBossWave = this.currentWaveIsBoss;
    const clearedStageIndex = this.stageIndex;
    const clearedStageName = this.currentStageName;

    this.completeWave();
    if (wasBossWave) {
      this.applyBossVictory(clearedStageIndex + 1, summary);
    }
    if (!this.prepareNextWave()) {
      this.log("[Runtime] All stages complete.");
      this.encounter = null;
      this.stopAuto();
      return;
    }

    if (wasBossWave) {
      this.log(
        `[Runtime] Stage ${clearedStageIndex + 1} (${clearedStageName}) cleared. Pausing before the next stage.`
      );
      this.encounter = null;
      this.stopAuto();
      return;
    }

    this.startNextEncounter(true);
  }

  protected handleHeroDefeat() {
    this.log("[Runtime] Party defeated. Encounter paused.");
    const bossWave = this.currentWaveIsBoss;
    this.stopAuto();
    this.encounter = null;

    this.resetPartyVitals();
    this.enemyParty = [];
    this.enemy = null;
    this.enemyRoster = [];

    if (bossWave) {
      this.log(
        `[Runtime] Boss stands firm. Resetting stage ${this.stageIndex + 1} to wave 1.`
      );
      this.stageWaveCompleted = 0;
      this.currentWaveUnits = [];
      this.currentWaveNumber = 0;
      this.currentEnemyLabel = "";
      this.currentWaveIsBoss = false;
      if (!this.prepareNextWave()) {
        this.log("[Runtime] Failed to reset stage after boss defeat.");
      }
    }
  }

  protected startNextEncounter(autoStart = false) {
    const activeParty = this.party.filter((member) => member.isAlive);
    if (!activeParty.length) {
      return;
    }

    if (!this.currentWaveUnits.length) {
      if (!this.prepareNextWave()) {
        return;
      }
    }

    this.enemyParty = this.currentWaveUnits.map((unit) => {
      const foe = new Character(this.cloneData(unit.data));
      foe.resetVitals();
      return foe;
    });
    this.enemy = this.enemyParty[0] ?? null;
    this.currentEnemyLabel = this.buildEnemyLabel(this.currentWaveUnits);

    this.encounter = new EncounterLoop(this.sim, this.party, this.enemyParty, {
      tickInterval: this.tickIntervalSeconds,
      rewardConfig: this.getRewardConfig(),
      onLog: (message) => this.log(message),
    });

    this.announcedResult = false;
    const enemyLabel = this.currentEnemyLabel || "Unknown foes";
    this.log(
      `[Runtime] Stage ${this.stageIndex + 1} (${this.currentStageName}) — Wave ${this.currentWaveNumber}: ${enemyLabel}`
    );

    if (autoStart || this.autoStart) {
      this.startAuto();
    }
  }

  protected applyPartySelection(options: { refreshRoster: boolean; resetEncounter: boolean }) {
    this.ensureParty(options.refreshRoster);
    this.refreshHeroLoadout();
    if (options.resetEncounter) {
      this.resetEncounterInternal(false);
    }
    this.emitState();
  }

  protected normalizePrimarySelection(unlockedSlots?: number) {
    this.ensurePartyArrayShape();
    const unlocked = typeof unlockedSlots === "number" ? unlockedSlots : this.calculateUnlockedPartySize();
    if (unlocked <= 0) {
      this.primarySlotIndex = 0;
      this.selectedHeroId = null;
      return;
    }

    let resolvedIndex = Math.max(0, Math.min(unlocked - 1, this.primarySlotIndex));
    let resolvedHeroId = resolvedIndex < unlocked ? this.selectedHeroIds[resolvedIndex] ?? null : null;

    if (this.selectedHeroId) {
      const preferredIndex = this.selectedHeroIds.findIndex(
        (id, idx) => idx < unlocked && id === this.selectedHeroId
      );
      if (preferredIndex >= 0) {
        resolvedIndex = preferredIndex;
        resolvedHeroId = this.selectedHeroId;
      }
    }

    if (!resolvedHeroId) {
      const fallbackIndex = this.selectedHeroIds.findIndex(
        (id, idx) => idx < unlocked && Boolean(id)
      );
      if (fallbackIndex >= 0) {
        resolvedIndex = fallbackIndex;
        resolvedHeroId = this.selectedHeroIds[fallbackIndex];
      }
    }

    if (!resolvedHeroId) {
      this.primarySlotIndex = Math.max(0, Math.min(unlocked - 1, resolvedIndex));
      this.selectedHeroId = null;
      return;
    }

    this.primarySlotIndex = resolvedIndex;
    this.selectedHeroId = resolvedHeroId;
  }

  protected resolveInventoryHeroId(heroId?: string | null): string | null {
    if (heroId && this.heroes.some((hero) => hero.id === heroId)) {
      return heroId;
    }
    if (this.selectedHeroId && this.heroes.some((hero) => hero.id === this.selectedHeroId)) {
      return this.selectedHeroId;
    }
    const candidate = this.selectedHeroIds.find((id): id is string => Boolean(id));
    if (candidate) {
      return candidate;
    }
    return this.heroes[0]?.id ?? null;
  }

  protected ensurePartyArrayShape() {
    if (this.selectedHeroIds.length !== this.maxPartySize) {
      const next: (string | null)[] = new Array(this.maxPartySize).fill(null);
      for (let index = 0; index < Math.min(this.selectedHeroIds.length, this.maxPartySize); index += 1) {
        next[index] = this.selectedHeroIds[index] ?? null;
      }
      this.selectedHeroIds = next;
    }
  }

  protected ensureParty(fresh: boolean) {
    if (fresh) {
      this.partyRoster.clear();
    }

    const unlockedSlots = this.calculateUnlockedPartySize();
    this.normalizePrimarySelection(unlockedSlots);

    const slotOrder: number[] = [];
    if (
      this.primarySlotIndex < unlockedSlots &&
      this.selectedHeroIds[this.primarySlotIndex]
    ) {
      slotOrder.push(this.primarySlotIndex);
    }
    for (let slot = 0; slot < unlockedSlots; slot += 1) {
      if (slot === this.primarySlotIndex) {
        continue;
      }
      if (this.selectedHeroIds[slot]) {
        slotOrder.push(slot);
      }
    }

    const nextParty: Character[] = [];
    const activeSlots: number[] = [];
    const activeIds: string[] = [];

    slotOrder.forEach((slot) => {
      const heroId = this.selectedHeroIds[slot];
      if (!heroId) {
        return;
      }
      const definition = this.heroes.find((hero) => hero.id === heroId);
      if (!definition) {
        this.log(`[Runtime] Hero '${heroId}' not found. Clearing slot ${slot + 1}.`);
        this.selectedHeroIds[slot] = null;
        return;
      }

      let character = this.partyRoster.get(heroId);
      if (!character || fresh) {
        character = new Character(this.cloneData(definition.data));
        character.resetVitals();
        this.partyRoster.set(heroId, character);
      }
      this.applyEquipmentToCharacter(heroId, character, fresh);
      nextParty.push(character);
      activeSlots.push(slot);
      activeIds.push(heroId);
    });

    if (!fresh) {
      const activeSet = new Set(activeIds);
      Array.from(this.partyRoster.keys()).forEach((id) => {
        if (!activeSet.has(id)) {
          this.partyRoster.delete(id);
        }
      });
    }

    this.party = nextParty;
    this.activePartySlots = activeSlots;
    this.activePartyIds = activeIds;
    this.hero = this.party[0] ?? null;

    if (activeIds.length) {
      this.primarySlotIndex = activeSlots[0];
      this.selectedHeroId = activeIds[0];
    } else {
      this.selectedHeroId = null;
    }

    this.applyProgressionBonusesToParty();
  }

  protected calculateUnlockedPartySize(): number {
    let unlocked = 1;
    const highestStage = Math.max(this.highestStageCleared, this.stageIndex + 1);
    for (let index = 0; index < this.partySlotThresholds.length; index += 1) {
      const requirement = this.partySlotThresholds[index];
      if (highestStage >= requirement) {
        unlocked = index + 1;
      }
    }
    return Math.min(this.maxPartySize, Math.max(1, unlocked));
  }

  protected getHeroReferenceLevel(): number {
    if (this.hero) {
      return this.hero.level;
    }
    if (this.party.length) {
      return this.party[0].level;
    }
    const selectedId =
      this.selectedHeroId ?? this.selectedHeroIds.find((id): id is string => Boolean(id)) ?? null;
    if (selectedId) {
      const definition = this.heroes.find((hero) => hero.id === selectedId);
      const level = definition?.data?.progression?.initialLevel;
      if (typeof level === "number" && level > 0) {
        return level;
      }
    }
    const fallback = this.heroes[0]?.data?.progression?.initialLevel;
    return typeof fallback === "number" && fallback > 0 ? fallback : 1;
  }

  protected getHeroLevelBand(level: number): number {
    if (level >= 15) {
      return 2;
    }
    if (level >= 10) {
      return 1;
    }
    return 0;
  }

  protected getStageCacheKey(stageNumber: number, heroLevel?: number): string {
    const band = this.getHeroLevelBand(heroLevel ?? this.getHeroReferenceLevel());
    return `${stageNumber}|${band}`;
  }

  protected updatePartyUnlocks() {
    if (!this.selectedHeroIds.length) {
      this.selectedHeroIds = new Array(this.maxPartySize).fill(null);
    }
    const unlocked = this.calculateUnlockedPartySize();
    const assigned = new Set(
      this.selectedHeroIds.filter((value): value is string => Boolean(value))
    );
    let heroCursor = 0;
    for (let slot = 0; slot < unlocked; slot += 1) {
      if (this.selectedHeroIds[slot]) {
        assigned.add(this.selectedHeroIds[slot]!);
        continue;
      }
      while (heroCursor < this.heroes.length && assigned.has(this.heroes[heroCursor].id)) {
        heroCursor += 1;
      }
      if (heroCursor < this.heroes.length) {
        const heroId = this.heroes[heroCursor].id;
        this.selectedHeroIds[slot] = heroId;
        assigned.add(heroId);
        heroCursor += 1;
      }
    }
  }

  protected resetPartyVitals() {
    this.party.forEach((member) => member.resetVitals());
  }

  protected buildEnemyLabel(units: EnemyUnit[]): string {
    if (!units.length) {
      return "";
    }
    if (units.length === 1) {
      return units[0].label;
    }
    const counts = new Map<string, number>();
    units.forEach((unit) => {
      counts.set(unit.label, (counts.get(unit.label) ?? 0) + 1);
    });
    return Array.from(counts.entries())
      .map(([label, count]) => (count > 1 ? `${count}x ${label}` : label))
      .join(", ");
  }

  protected getHeroLabel(character: Character): string {
    for (const [heroId, instance] of this.partyRoster.entries()) {
      if (instance === character) {
        const definition = this.heroes.find((hero) => hero.id === heroId);
        return definition?.label ?? heroId;
      }
    }
    if (character === this.hero) {
      return "Hero";
    }
    return "Ally";
  }

  protected getPartyMemberByHeroId(heroId: string | null | undefined): Character | null {
    if (!heroId) {
      return null;
    }
    const index = this.selectedHeroIds.findIndex((id) => id === heroId);
    if (index >= 0 && index < this.party.length) {
      const member = this.party[index];
      if (member) {
        return member;
      }
    }
    return this.partyRoster.get(heroId) ?? null;
  }

  protected getPartySummary(): PartySummary {
    if (!this.party.length) {
      return {
        size: 0,
        alive: 0,
        averageLevel: 0,
        totalAttackPower: 0,
        totalDps: 0,
      };
    }
    const size = this.party.length;
    const alive = this.party.filter((member) => member.isAlive).length;
    const totalLevels = this.party.reduce((sum, member) => sum + member.level, 0);
    const totalAttackPower = this.party.reduce(
      (sum, member) => sum + member.attackPower,
      0
    );
    const totalDps = this.party.reduce((sum, member) => {
      const delay = member.getAttackDelaySeconds();
      return sum + member.attackPower / Math.max(0.1, delay);
    }, 0);
    return {
      size,
      alive,
      averageLevel: size ? totalLevels / size : 0,
      totalAttackPower,
      totalDps,
    };
  }

  protected refreshHeroLoadout(resetVitals = false) {
    this.refreshHeroLoadoutForHero(this.selectedHeroId, resetVitals);
  }

  protected refreshAllHeroLoadouts(resetVitals = false) {
    const heroIds = new Set<string>();
    this.partyRoster.forEach((_, heroId) => heroIds.add(heroId));
    this.selectedHeroIds.forEach((id) => {
      if (id) {
        heroIds.add(id);
      }
    });
    if (!heroIds.size && this.selectedHeroId) {
      heroIds.add(this.selectedHeroId);
    }
    heroIds.forEach((heroId) => this.refreshHeroLoadoutForHero(heroId, resetVitals));
  }

  protected refreshHeroLoadoutForHero(
    heroId: string | null | undefined,
    resetVitals = false
  ) {
    const targetId = this.resolveInventoryHeroId(heroId);
    if (!targetId) {
      return;
    }
    const partyMember = this.getPartyMemberByHeroId(targetId);
    const character = partyMember ?? this.partyRoster.get(targetId) ?? null;
    if (!character) {
      return;
    }
    this.applyEquipmentToCharacter(targetId, character, resetVitals);
  }

  protected applyEquipmentToCharacter(
    heroId: string,
    character: Character,
    resetVitals = false
  ) {
    character.clearEquipment();
    const equipped = this.playerInventory.getEquippedEntries(heroId);
    equipped.forEach(([, owned]) => {
      const equipment = this.itemLibrary.createEquipmentForOwned(owned);
      if (equipment) {
        character.equipItem(equipment);
      }
    });
    if (resetVitals) {
      character.resetVitals();
    }
  }

  protected cloneInventorySnapshot(snapshot: InventorySnapshot): InventorySnapshot {
    return JSON.parse(JSON.stringify(snapshot)) as InventorySnapshot;
  }

  protected processInventoryMutation(result: InventoryMutationResult): InventoryMutationResult {
    if (result.messages) {
      result.messages.forEach((message) => this.log(`[Inventory] ${message}`));
    }
    if (result.heroNeedsRefresh) {
      const heroIds = result.heroIds && result.heroIds.length
        ? result.heroIds
        : [this.resolveInventoryHeroId()].filter((value): value is string => Boolean(value));
      heroIds.forEach((heroId) => this.refreshHeroLoadoutForHero(heroId, false));
    }
    if (result.resetEncounter) {
      this.resetEncounter(false, false);
      return result;
    }
    if (
      result.heroNeedsRefresh ||
      result.inventoryChanged ||
      result.materialsChanged ||
      result.consumablesChanged
    ) {
      this.emitState();
    }
    return result;
  }

  protected processConsumableResult(result: ConsumableUseResult): ConsumableUseResult {
    if (result.messages) {
      result.messages.forEach((message) => this.log(`[Consumable] ${message}`));
    }
    if (result.success || result.consumablesChanged) {
      this.emitState();
    }
    return result;
  }

  protected ensureInventoryReady(): InventoryMutationResult | null {
    if (!this.initialized) {
      return {
        success: false,
        messages: ["Simulation runtime not initialized."],
      };
    }
    if (!this.hero) {
      return {
        success: false,
        messages: ["Hero is not available."],
      };
    }
    return null;
  }

  protected prepareNextWave(): boolean {
    const stageNumber = this.stageIndex + 1;
    let blueprint = this.getStageBlueprint(stageNumber);

    if (!blueprint) {
      return false;
    }

    while (this.stageWaveCompleted >= blueprint.waves.length) {
      this.stageIndex += 1;
      this.stageWaveCompleted = 0;
      const nextStageNumber = this.stageIndex + 1;
      blueprint = this.getStageBlueprint(nextStageNumber);
      if (!blueprint) {
        return false;
      }
    }

    const wave = blueprint.waves[this.stageWaveCompleted];
    if (!wave) {
      return false;
    }

    this.stageRewards = blueprint.rewards;
    this.bossConfig = blueprint.bossConfig;
    this.currentStageName = blueprint.name;
    this.applyStageLoot(blueprint.lootTableId);
    this.currentWaveIsBoss = wave.isBoss;

    this.currentWaveUnits = wave.enemies.map((enemy) => ({
      id: enemy.id,
      label: enemy.label,
      tier: enemy.tier,
      data: this.cloneData(enemy.data),
    }));
    this.enemyRoster = this.currentWaveUnits.map((unit) => ({ id: unit.id, label: unit.label }));

    if (!this.currentWaveUnits.length) {
      return false;
    }

    this.currentWaveNumber = this.stageWaveCompleted + 1;
    if (this.currentWaveIsBoss) {
      this.bossTimerTotal = this.bossConfig?.timerSeconds ?? 0;
      this.bossTimerRemaining = this.bossTimerTotal;
      this.bossEnraged = false;
    } else {
      this.bossTimerTotal = 0;
      this.bossTimerRemaining = 0;
      this.bossEnraged = false;
    }
    this.enemyParty = [];
    this.enemy = null;
    return true;
  }

  protected completeWave() {
    this.stageWaveCompleted += 1;
    this.totalWavesCompleted += 1;
    this.currentWaveUnits = [];
    this.enemyParty = [];
    this.enemy = null;
    this.enemyRoster = [];
    this.currentEnemyLabel = "";
    this.currentWaveIsBoss = false;
  }

  protected applyStageLoot(lootId?: string) {
    if (!lootId) {
      return;
    }
    this.selectedLootId = lootId;
    this.log(`[Runtime] Applying loot table '${lootId}'.`);
  }

  protected getRewardConfig() {
    const table = this.getActiveLootTable();
    const stageGold = Math.max(0, Math.round(this.stageRewards?.enemyGold ?? 0));
    const stageXp = Math.max(0, Math.round(this.stageRewards?.enemyXp ?? 0));
    const baseGoldMin = table.gold?.min ?? 0;
    const baseGoldMax = table.gold?.max ?? table.gold?.min ?? 0;
    return {
      xpPerWin: (table.xpPerWin ?? 0) + stageXp,
      goldMin: stageGold + baseGoldMin,
      goldMax: stageGold + baseGoldMax,
      materialDrops: this.cloneDrops(table.materialDrops),
      equipmentDrops: this.cloneEquipmentDrops(table.equipmentDrops),
      augmentDrops: this.cloneAugmentDrops(table.augmentDrops),
    };
  }

  protected getActiveLootTable(): LootTableConfig {
    if (this.selectedLootId && this.lootTables.has(this.selectedLootId)) {
      return this.lootTables.get(this.selectedLootId)!;
    }
    return this.lootTables.values().next().value;
  }

  protected cloneDrops(source?: LootMaterialDrop[]) {
    return source?.map((drop) => ({
      id: drop.id,
      chance: drop.chance,
      min: drop.min,
      max: drop.max,
    }));
  }

  protected cloneEquipmentDrops(source?: LootEquipmentDrop[]) {
    return source?.map((drop) => ({
      itemId: drop.itemId,
      chance: drop.chance,
      min: drop.min,
      max: drop.max,
      rarityWeights: drop.rarityWeights ? { ...drop.rarityWeights } : undefined,
    }));
  }

  protected cloneAugmentDrops(source?: LootAugmentDrop[]) {
    return source?.map((drop) => ({
      augmentId: drop.augmentId,
      chance: drop.chance,
      min: drop.min,
      max: drop.max,
    }));
  }

  protected getStageBlueprint(stageNumber: number): StageBlueprint | null {
    if (!this.stageGenerator) {
      return null;
    }
    const heroLevel = this.getHeroReferenceLevel();
    const cacheKey = this.getStageCacheKey(stageNumber, heroLevel);
    if (!this.stageCache.has(cacheKey)) {
      const blueprint = this.stageGenerator.generateStage(stageNumber, this.enemyPools, { heroLevel });
      this.stageCache.set(cacheKey, blueprint);
    }
    return this.stageCache.get(cacheKey) ?? null;
  }

  protected handleBossTimeout() {
    if (this.bossTimerRemaining > 0) {
      return;
    }
    this.log("[Runtime] Boss time limit reached. Retreating to regroup.");
    this.announcedResult = true;
    if (this.hooks.onEncounterComplete) {
      this.hooks.onEncounterComplete({
        victor: "target",
        swings: 0,
        elapsedSeconds: this.bossTimerTotal,
        totalDamageFromSource: 0,
        totalDamageFromTarget: 0,
        rewards: this.createEmptyRewards(),
        running: false,
      } as EncounterSummary);
    }
    this.handleHeroDefeat();
    this.emitState();
  }

  protected applyBossEnrage() {
    if (!this.bossConfig) {
      return;
    }
    const targets = this.enemyParty.length ? this.enemyParty : this.enemy ? [this.enemy] : [];
    if (!targets.length) {
      return;
    }
    this.bossEnraged = true;
    targets.forEach((foe) => foe.applyAttackMultiplier(this.bossConfig!.enrageAttackMultiplier));
    this.log("[Runtime] Boss enters an enraged frenzy! Attack power surges.");
    this.emitState();
  }

  protected applyBossVictory(stageNumber: number, summary: EncounterSummary) {
    const blueprint = this.getStageBlueprint(stageNumber);
    if (!blueprint || !this.stageRewards) {
      return;
    }
    const rewards = this.stageRewards;
    const bonus = this.createEmptyRewards();
    if (rewards.bossGold > 0) {
      bonus.gold = Math.max(0, Math.round(rewards.bossGold));
    }
    if (rewards.bossShards > 0) {
      bonus.materials["boss-shard"] = Math.max(1, Math.round(rewards.bossShards));
    }
    if (rewards.bossGemChance > 0 && Math.random() <= rewards.bossGemChance) {
      bonus.augments.push({ augmentId: this.pickGemReward(stageNumber), quantity: 1 });
    }

    if (
      bonus.gold > 0 ||
      Object.keys(bonus.materials).length > 0 ||
      bonus.equipment.length > 0 ||
      bonus.augments.length > 0
    ) {
      summary.rewards = this.mergeEncounterRewards(summary.rewards, bonus);
      this.grantEncounterRewards(bonus);
      const parts: string[] = [];
      if (bonus.gold) {
        parts.push(`${bonus.gold} gold`);
      }
      Object.entries(bonus.materials).forEach(([id, qty]) => {
        parts.push(`${id} x${qty}`);
      });
      if (bonus.augments.length) {
        parts.push(`${bonus.augments.map((a) => a.augmentId).join(", ")}`);
      }
      this.log(`[Runtime] Boss rewards claimed: ${parts.join(", ")}.`);
    }

    const firstClear = this.recordStageClear(stageNumber, rewards.firstClearBonusPercent);
    if (firstClear && rewards.firstClearBonusPercent > 0) {
      const percent = rewards.firstClearBonusPercent * 100;
      const total = (this.permanentStatMultiplier - 1) * 100;
      this.log(
        `[Runtime] First clear bonus unlocked! Permanent +${percent.toFixed(1)}% stats (total ${total.toFixed(1)}%).`
      );
    }
  }

  protected recordStageClear(stageNumber: number, bonusPercent: number): boolean {
    const isFirst = !this.clearedStages.has(stageNumber);
    this.clearedStages.add(stageNumber);
    if (stageNumber > this.highestStageCleared) {
      this.highestStageCleared = stageNumber;
    }
    const normalizedBonus = Math.max(0, bonusPercent ?? 0);
    this.permanentStatMultiplier = 1 + this.clearedStages.size * normalizedBonus;
    this.updatePartyUnlocks();
    this.ensureParty(false);
    this.applyProgressionBonusesToParty();
    return isFirst;
  }

  protected applyProgressionBonusesToParty() {
    const targetMultiplier = this.permanentStatMultiplier;
    const diff = targetMultiplier / this.appliedProgressionMultiplier;
    if (Math.abs(diff - 1) < 1e-4) {
      return;
    }
    this.party.forEach((member) => {
      member.applyGlobalStatBonus(diff);
      member.updateStats();
    });
    if (this.party.length === 0 && this.hero) {
      this.hero.applyGlobalStatBonus(diff);
      this.hero.updateStats();
    }
    this.appliedProgressionMultiplier = targetMultiplier;
  }

  protected mergeEncounterRewards(
    base: EncounterRewards | undefined,
    bonus: EncounterRewards
  ): EncounterRewards {
    const target = base ? { ...base } : this.createEmptyRewards();
    target.xp = (target.xp ?? 0) + (bonus.xp ?? 0);
    target.gold = (target.gold ?? 0) + (bonus.gold ?? 0);

    const materials: Record<string, number> = { ...(target.materials ?? {}) };
    Object.entries(bonus.materials ?? {}).forEach(([id, qty]) => {
      materials[id] = (materials[id] ?? 0) + qty;
    });
    target.materials = materials;

    target.equipment = [...(target.equipment ?? [])];
    bonus.equipment?.forEach((entry) => {
      const existing = target.equipment?.find(
        (item) => item.itemId === entry.itemId && item.rarity === entry.rarity
      );
      if (existing) {
        existing.quantity += entry.quantity;
      } else {
        target.equipment.push({ ...entry });
      }
    });

    target.augments = [...(target.augments ?? [])];
    bonus.augments?.forEach((entry) => {
      const existing = target.augments?.find((item) => item.augmentId === entry.augmentId);
      if (existing) {
        existing.quantity += entry.quantity;
      } else {
        target.augments.push({ ...entry });
      }
    });

    return target;
  }

  protected createEmptyRewards(): EncounterRewards {
    return {
      xp: 0,
      gold: 0,
      materials: {},
      equipment: [],
      augments: [],
    };
  }

  protected pickGemReward(stageNumber: number): string {
    if (!this.gemRewardPool.length) {
      return "ember-gem";
    }
    const index = Math.abs(stageNumber - 1) % this.gemRewardPool.length;
    return this.gemRewardPool[index];
  }

  protected sanitiseLootTable(table: LootTableConfig): LootTableConfig {
    const gold: LootRange | undefined = table.gold
      ? {
          min: Math.max(0, Math.floor(table.gold.min ?? 0)),
          max: Math.max(0, Math.floor(table.gold.max ?? table.gold.min ?? 0)),
        }
      : undefined;

    const materialDrops = table.materialDrops?.map((drop) => ({
      id: drop.id,
      chance: this.clamp01(drop.chance ?? 0),
      min: drop.min !== undefined ? Math.max(0, Math.floor(drop.min)) : undefined,
      max: drop.max !== undefined ? Math.max(0, Math.floor(drop.max)) : undefined,
    }));

    const equipmentDrops = table.equipmentDrops?.map((drop) => ({
      itemId: drop.itemId,
      chance: this.clamp01(drop.chance ?? 0),
      min: drop.min !== undefined ? Math.max(0, Math.floor(drop.min)) : undefined,
      max: drop.max !== undefined ? Math.max(0, Math.floor(drop.max)) : undefined,
      rarityWeights: drop.rarityWeights ? { ...drop.rarityWeights } : undefined,
    }));

    const augmentDrops = table.augmentDrops?.map((drop) => ({
      augmentId: drop.augmentId,
      chance: this.clamp01(drop.chance ?? 0),
      min: drop.min !== undefined ? Math.max(0, Math.floor(drop.min)) : undefined,
      max: drop.max !== undefined ? Math.max(0, Math.floor(drop.max)) : undefined,
    }));

    return {
      id: table.id ?? DEFAULT_LOOT_TABLE_ID,
      name: table.name,
      xpPerWin: Math.max(0, Math.floor(table.xpPerWin ?? 0)),
      gold,
      materialDrops,
      equipmentDrops,
      augmentDrops,
    };
  }

  protected clamp01(value: number): number {
    if (!Number.isFinite(value)) {
      return 0;
    }
    if (value < 0) {
      return 0;
    }
    if (value > 1) {
      return 1;
    }
    return value;
  }

  protected log(message: string) {
    if (this.hooks.onLog) {
      this.hooks.onLog(message);
    }
  }

  protected emitState() {
    if (this.hooks.onStateChanged) {
      this.hooks.onStateChanged(this.getState());
    }
  }

  protected cloneData<T>(data: T): T {
    return JSON.parse(JSON.stringify(data)) as T;
  }
}
