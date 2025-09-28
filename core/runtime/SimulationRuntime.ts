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
import {
  DEFAULT_BOSS_COMPOSITION,
  DEFAULT_STAGE,
  EnemyUnit,
  StageDefinition,
  StageComposition,
} from "../progression/Stage";
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
}

export class SimulationRuntime {
  protected readonly sim: CombatSim;
  protected encounter: EncounterLoop | null = null;

  protected heroes: HeroDefinition[] = [];
  protected enemyPools: Record<string, EnemyUnit[]> = { small: [], medium: [], boss: [] };
  protected stages: StageDefinition[] = [];
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
    this.stages = this.sanitiseStages(await this.dataSource.loadStages());

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
    };
  }

  listHeroes(): HeroDefinition[] {
    return this.heroes.map((hero) => ({ ...hero, data: this.cloneData(hero.data) }));
  }

  listStages(): StageDefinition[] {
    return this.stages.map((stage) => ({ ...stage, composition: stage.composition?.map((entry) => ({ ...entry })) }));
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
    this.stageIndex = Math.max(0, Math.min(index, Math.max(this.stages.length - 1, 0)));
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
    this.currentStageName = this.stages[this.stageIndex]?.name ?? DEFAULT_STAGE.name ?? "";
    this.currentWaveIsBoss = false;

    this.hero.resetVitals();
    this.encounter = null;
    this.announcedResult = false;

    if (!this.prepareNextWave()) {
      this.log("[Runtime] Failed to prepare first wave.");
      return;
    }

    this.startNextEncounter(autoStart);
    this.emitState();
  }

  startAuto() {
    if (!this.encounter) {
      return;
    }
    this.encounter.setTickInterval(this.tickIntervalSeconds);
    this.encounter.start();
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
    if (!this.stages.length) {
      return false;
    }

    if (this.stageIndex >= this.stages.length) {
      this.stageIndex = this.stages.length - 1;
    }

    let stage = this.stages[this.stageIndex];

    while (stage && stage.waves !== undefined && this.stageWaveCompleted >= stage.waves) {
      this.stageIndex = Math.min(this.stageIndex + 1, this.stages.length - 1);
      this.stageWaveCompleted = 0;
      stage = this.stages[this.stageIndex];
    }

    if (!stage) {
      return false;
    }

    const compositionList = stage.composition && stage.composition.length
      ? stage.composition
      : DEFAULT_STAGE.composition ?? [];

    const waveIndex = this.stageWaveCompleted;
    const isFinalWave = waveIndex === (stage.waves ?? compositionList.length) - 1;
    const pattern = this.cloneWavePattern(
      isFinalWave ? stage.finalBoss ?? DEFAULT_BOSS_COMPOSITION : compositionList[waveIndex % compositionList.length]
    );

    const queue: EnemyUnit[] = [];

    Object.entries(pattern).forEach(([tier, count]) => {
      const total = Math.max(0, Math.floor(count));
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
      if (!fallback) {
        return false;
      }
      queue.push(fallback);
    }

    this.currentWaveQueue = queue;
    this.currentWaveNumber = this.totalWavesCompleted + 1;
    this.currentStageName = stage.name ?? `Stage ${this.stageIndex + 1}`;
    this.applyStageLoot(stage.lootTable);
    this.currentWaveIsBoss = isFinalWave;

    return true;
  }

  protected pickEnemyFromTier(tier: string): EnemyUnit | null {
    const pool = this.enemyPools[tier] ?? [];
    if (!pool.length) {
      return null;
    }
    const index = Math.floor(Math.random() * pool.length);
    const source = pool[index];
    return {
      id: source.id,
      label: source.label,
      tier: source.tier,
      data: this.cloneData(source.data),
    };
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
    return {
      xpPerWin: table.xpPerWin ?? 0,
      goldMin: table.gold?.min ?? 0,
      goldMax: table.gold?.max ?? table.gold?.min ?? 0,
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

  protected cloneWavePattern(pattern?: StageComposition) {
    if (!pattern) {
      return {};
    }
    return { ...pattern };
  }

  protected sanitiseStages(stages: StageDefinition[]): StageDefinition[] {
    if (!stages?.length) {
      return [DEFAULT_STAGE];
    }
    return stages.map((stage, index) => ({
      id: stage.id ?? `stage-${index + 1}`,
      name: stage.name ?? `Stage ${index + 1}`,
      waves: Math.max(1, Math.floor(stage.waves ?? DEFAULT_STAGE.waves ?? 1)),
      composition: stage.composition?.map((entry) => ({ ...entry })) ?? DEFAULT_STAGE.composition,
      lootTable: stage.lootTable,
      finalBoss: stage.finalBoss ? { ...stage.finalBoss } : DEFAULT_BOSS_COMPOSITION,
    }));
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
