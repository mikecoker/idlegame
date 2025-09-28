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

export interface SimulationState {
  heroId: string | null;
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
  protected stageCache: Map<number, StageBlueprint> = new Map();
  protected stageRewards: StageRewardsSummary | null = null;
  protected bossConfig: BossEncounterConfig | null = null;
  protected bossTimerTotal = 0;
  protected bossTimerRemaining = 0;
  protected bossEnraged = false;
  protected lootTables: Map<string, LootTableConfig> = new Map();
  protected itemDefinitions: ItemDefinition[] = [];
  protected craftingRecipes: CraftingRecipe[] = [];

  protected hero: Character | null = null;
  protected enemy: Character | null = null;

  protected stageIndex = 0;
  protected stageWaveCompleted = 0;
  protected totalWavesCompleted = 0;
  protected currentWaveQueue: EnemyUnit[] = [];
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
    if (!this.selectedLootId && this.lootTables.size) {
      this.selectedLootId = Array.from(this.lootTables.keys())[0];
    }

    this.ensureHero(freshHero);
    this.refreshHeroLoadout(false);
    this.resetEncounterInternal();
    this.initialized = true;
    this.emitState();
  }

  getState(): SimulationState {
    return {
      heroId: this.selectedHeroId,
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
    this.selectedHeroId = heroId;
    this.ensureHero(fresh);
    this.refreshHeroLoadout();
    this.emitState();
  }

  setStageIndex(index: number) {
    this.stageIndex = Math.max(0, index);
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
      this.applyProgressionBonusesToHero();
      return;
    }
    this.clearedStages = new Set(snapshot.clearedStageIds ?? []);
    this.highestStageCleared = Math.max(0, snapshot.highestStageCleared ?? 0);
    const multiplier = snapshot.statBonusMultiplier ?? 1;
    this.permanentStatMultiplier = Math.max(1, multiplier);
    this.appliedProgressionMultiplier = 1;
    this.applyProgressionBonusesToHero();
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
    this.refreshHeroLoadout();
    this.emitState();
  }

  equipFromInventory(instanceId: string): InventoryMutationResult {
    const guard = this.ensureInventoryReady();
    if (guard) {
      return this.processInventoryMutation(guard);
    }
    const result = this.playerInventory.equipFromInventory(instanceId);
    return this.processInventoryMutation(result);
  }

  equipFirstMatching(itemId: string): InventoryMutationResult {
    const guard = this.ensureInventoryReady();
    if (guard) {
      return this.processInventoryMutation(guard);
    }
    const result = this.playerInventory.equipFirstMatching(itemId);
    return this.processInventoryMutation(result);
  }

  unequipSlot(slot: string): InventoryMutationResult {
    const guard = this.ensureInventoryReady();
    if (guard) {
      return this.processInventoryMutation(guard);
    }
    const result = this.playerInventory.unequipSlot(slot);
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

  useConsumableItem(consumableId: string): ConsumableUseResult {
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
    if (result.success && result.effect?.kind === "heal" && this.hero) {
      this.hero.healPercent(result.effect.percent);
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
    this.ensureHero(freshHero);
    this.refreshHeroLoadout();
    this.resetEncounterInternal(autoStart);
  }

  protected resetEncounterInternal(autoStart = this.autoStart) {
    if (!this.hero) {
      return;
    }

    this.tickIntervalSeconds = Math.max(0.01, this.tickIntervalSeconds);

    this.stageWaveCompleted = 0;
    this.totalWavesCompleted = 0;
    this.currentWaveQueue = [];
    this.currentWaveNumber = 0;
    const blueprint = this.getStageBlueprint(this.stageIndex + 1);
    this.currentStageName = blueprint?.name ?? `Stage ${this.stageIndex + 1}`;
    this.stageRewards = blueprint?.rewards ?? null;
    this.bossConfig = blueprint?.bossConfig ?? null;
    this.bossTimerTotal = blueprint?.bossConfig?.timerSeconds ?? 0;
    this.bossTimerRemaining = this.bossTimerTotal;
    this.bossEnraged = false;
    this.currentWaveIsBoss = false;

    this.hero.resetVitals();
    this.encounter = null;
    this.announcedResult = false;

    this.applyProgressionBonusesToHero();

    if (!this.prepareNextWave()) {
      this.log("[Runtime] Failed to prepare first wave.");
      return;
    }

    this.startNextEncounter(autoStart);
    this.emitState();
  }

  startAuto() {
    if (!this.encounter) {
      if (!this.hero || !this.hero.isAlive) {
        return;
      }
      if (!this.currentWaveQueue.length) {
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

      if (!this.bossEnraged && this.bossConfig && this.enemy && this.enemy.isAlive) {
        const hpRatio = this.enemy.maxHealth > 0 ? this.enemy.health / this.enemy.maxHealth : 1;
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
    if (!this.hero) {
      return;
    }

    if (summary.rewards?.xp) {
      const xp = summary.rewards.xp;
      const levelsGained = this.hero.addExperience(xp);
      const progressPct = (this.hero.experienceProgress * 100).toFixed(1);
      this.log(
        `[Runtime] Hero gains ${xp} XP (level ${this.hero.level}, ${progressPct}% to next).`
      );
      if (levelsGained > 0) {
        this.log(`[Runtime] Hero advanced ${levelsGained} levels.`);
      }
    }

    if (this.currentWaveQueue.length) {
      this.startNextEncounter(true);
      return;
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
    this.log("[Runtime] Hero defeated. Encounter paused.");
    const bossWave = this.currentWaveIsBoss;
    this.stopAuto();
    this.encounter = null;

    if (this.hero) {
      this.hero.resetVitals();
    }

    if (bossWave) {
      this.log(
        `[Runtime] Boss stands firm. Resetting stage ${this.stageIndex + 1} to wave 1.`
      );
      this.stageWaveCompleted = 0;
      this.currentWaveQueue = [];
      this.currentWaveNumber = 0;
      this.currentEnemyLabel = "";
      this.currentWaveIsBoss = false;
      if (!this.prepareNextWave()) {
        this.log("[Runtime] Failed to reset stage after boss defeat.");
      }
    }
  }

  protected startNextEncounter(autoStart = false) {
    if (!this.hero || !this.hero.isAlive) {
      return;
    }

    if (!this.currentWaveQueue.length) {
      if (!this.prepareNextWave()) {
        return;
      }
    }

    const unit = this.currentWaveQueue.shift();
    if (!unit) {
      return;
    }

    this.enemy = new Character(this.cloneData(unit.data));
    this.enemy.resetVitals();
    this.currentEnemyLabel = unit.label;

    this.encounter = new EncounterLoop(this.sim, this.hero, this.enemy, {
      tickInterval: this.tickIntervalSeconds,
      rewardConfig: this.getRewardConfig(),
    });

    this.announcedResult = false;
    this.log(
      `[Runtime] Stage ${this.stageIndex + 1} (${this.currentStageName}) — Wave ${this.currentWaveNumber}: ${unit.label}`
    );

    if (autoStart || this.autoStart) {
      this.startAuto();
    }
  }

  protected ensureHero(fresh: boolean) {
    if (!fresh && this.hero) {
      return;
    }

    const definition = this.heroes.find((hero) => hero.id === this.selectedHeroId);
    if (!definition) {
      this.log("[Runtime] No hero definition available to initialize.");
      this.hero = null;
      return;
    }

    this.hero = new Character(this.cloneData(definition.data));
    this.appliedProgressionMultiplier = 1;
    this.applyProgressionBonusesToHero();
  }

  protected refreshHeroLoadout(resetVitals = false) {
    if (!this.hero) {
      return;
    }
    this.hero.clearEquipment();
    const equipped = this.playerInventory.getEquippedEntries();
    equipped.forEach(([, owned]) => {
      const equipment = this.itemLibrary.createEquipmentForOwned(owned);
      if (equipment) {
        this.hero!.equipItem(equipment);
      }
    });
    if (resetVitals) {
      this.hero.resetVitals();
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
      this.refreshHeroLoadout();
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

    this.currentWaveQueue = wave.enemies.map((enemy) => ({
      id: enemy.id,
      label: enemy.label,
      tier: enemy.tier,
      data: this.cloneData(enemy.data),
    }));

    if (!this.currentWaveQueue.length) {
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
    return true;
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
    if (!this.stageCache.has(stageNumber)) {
      const blueprint = this.stageGenerator.generateStage(stageNumber, this.enemyPools);
      this.stageCache.set(stageNumber, blueprint);
    }
    return this.stageCache.get(stageNumber) ?? null;
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
    if (!this.enemy || !this.bossConfig) {
      return;
    }
    this.bossEnraged = true;
    this.enemy.applyAttackMultiplier(this.bossConfig.enrageAttackMultiplier);
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
    this.applyProgressionBonusesToHero();
    return isFirst;
  }

  protected applyProgressionBonusesToHero() {
    if (!this.hero) {
      return;
    }
    const targetMultiplier = this.permanentStatMultiplier;
    const diff = targetMultiplier / this.appliedProgressionMultiplier;
    if (Math.abs(diff - 1) < 1e-4) {
      return;
    }
    this.hero.applyGlobalStatBonus(diff);
    this.appliedProgressionMultiplier = targetMultiplier;
    this.hero.updateStats();
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
