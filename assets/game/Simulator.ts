import { _decorator, Component, JsonAsset } from "cc";
import { CombatSim } from "./combatsim";
import { Character, CharacterData } from "./character";
import { UICharacter } from "./UICharacter";
import { EncounterEvent, EncounterLoop, EncounterSummary } from "./encounter";
const { ccclass, property } = _decorator;

interface LootTableConfig {
  id?: string;
  name?: string;
  xpPerWin?: number;
  gold?: {
    min?: number;
    max?: number;
  };
  materialDrops?: Array<{
    id: string;
    chance: number;
    min?: number;
    max?: number;
  }>;
}

interface EnemyUnit {
  id: string;
  label: string;
  tier: string;
  data: CharacterData;
}

interface StageComposition {
  [tier: string]: number;
}

interface StageDefinition {
  name?: string;
  waves?: number;
  composition?: StageComposition[];
  lootTable?: string;
}

interface ProgressionData {
  stages: StageDefinition[];
}

const DEFAULT_LOOT_TABLE: LootTableConfig = {
  id: "default",
  name: "Default Loot",
  xpPerWin: 25,
  gold: { min: 3, max: 10 },
  materialDrops: [
    { id: "iron-ore", chance: 0.4, min: 1, max: 3 },
    { id: "leather", chance: 0.25, min: 1, max: 2 },
  ],
};

const DEFAULT_STAGE: StageDefinition = {
  name: "Endless",
  waves: 999,
  composition: [{ small: 1 }, { small: 2 }],
};

@ccclass("Simulator")
export class Simulator extends Component {
  @property(JsonAsset)
  heroData: JsonAsset = null;

  @property([JsonAsset])
  enemyWaveData: JsonAsset[] = [];

  @property(JsonAsset)
  progressionData: JsonAsset = null;

  @property(UICharacter)
  srcCharacter: UICharacter = null;

  @property(UICharacter)
  dstCharacter: UICharacter = null;

  @property(JsonAsset)
  lootTable: JsonAsset = null;

  protected _sim: CombatSim;
  protected _hero: Character | null = null;
  protected _enemy: Character | null = null;
  protected _encounter: EncounterLoop | null = null;
  protected _announcedResult = false;

  protected _enemyPools: Record<string, EnemyUnit[]> = {
    small: [],
    medium: [],
    boss: [],
  };

  protected _stages: StageDefinition[] = [];
  protected _stageIndex = 0;
  protected _stageWaveCompleted = 0;
  protected _currentWaveQueue: EnemyUnit[] = [];

  protected _totalWavesCompleted = 0;
  protected _currentWaveNumber = 0;
  protected _currentStageName = "";
  protected _currentEnemyLabel = "";

  @property({ tooltip: "Simulation tick resolution in seconds" })
  tickIntervalSeconds = 0.1;

  @property({ tooltip: "Automatically start the encounter on load" })
  autoStart = true;

  start() {
    this._sim = new CombatSim();
    this.resetEncounter(this.autoStart, true);
  }

  resetEncounter(autoStart = this.autoStart, freshHero = true) {
    if (!this.ensureHero(freshHero)) {
      return;
    }

    this.tickIntervalSeconds = Math.max(0.01, this.tickIntervalSeconds);
    this.loadEnemyPools();
    this.loadStages();

    this._stageIndex = 0;
    this._stageWaveCompleted = 0;
    this._totalWavesCompleted = 0;
    this._currentWaveQueue = [];
    this._currentWaveNumber = 0;
    this._currentStageName = this._stages[0]?.name ?? "";

    this._hero.resetVitals();
    this.srcCharacter.setCharacter(this._hero);

    this._encounter = null;
    this._announcedResult = false;

    if (!this.prepareNextWave()) {
      console.warn("[Simulator] Failed to prepare first wave");
      return;
    }

    this.startNextEncounter(autoStart);
  }

  startAuto() {
    if (!this._encounter) {
      return;
    }
    this._encounter.setTickInterval(this.tickIntervalSeconds);
    this._encounter.start();
  }

  stopAuto() {
    this._encounter?.stop();
  }

  toggleAuto() {
    if (!this._encounter) {
      return;
    }
    if (this._encounter.isRunning) {
      this.stopAuto();
    } else {
      this.startAuto();
    }
  }

  updateTickInterval(seconds: number) {
    const clamped = Math.max(0.01, seconds || 0.01);
    this.tickIntervalSeconds = clamped;
    this._encounter?.setTickInterval(clamped);
  }

  isRunning(): boolean {
    return this._encounter?.isRunning ?? false;
  }

  isComplete(): boolean {
    return this._encounter?.isComplete ?? false;
  }

  getTickInterval(): number {
    if (this._encounter) {
      return this._encounter.getTickInterval();
    }
    return this.tickIntervalSeconds;
  }

  getSummary(): EncounterSummary | null {
    if (!this._encounter) {
      return null;
    }
    return this._encounter.getSummary();
  }

  update(deltaTime: number) {
    if (!this._encounter) {
      return;
    }

    const events = this._encounter.tick(deltaTime);
    if (events.length) {
      events.forEach((event: EncounterEvent) => {
        const attackerLabel = this.getCombatantLabel(event.attacker);
        const defenderLabel = this.getCombatantLabel(event.defender);
        const time = event.timestamp.toFixed(2);
        const handLabel = event.hand === "main" ? "main" : "off";

        switch (event.result) {
          case "miss":
            console.log(
              `[Encounter][${time}s][${handLabel}] ${attackerLabel} swings at ${defenderLabel} and misses`
            );
            break;
          case "dodge":
            console.log(
              `[Encounter][${time}s][${handLabel}] ${defenderLabel} dodges ${attackerLabel}'s attack`
            );
            break;
          case "parry":
            console.log(
              `[Encounter][${time}s][${handLabel}] ${defenderLabel} parries ${attackerLabel}`
            );
            break;
          case "hit":
          default: {
            const damage = Math.max(0, Math.round(event.damage));
            const critText = event.critical ? " (crit)" : "";
            console.log(
              `[Encounter][${time}s][${handLabel}] ${attackerLabel} hits ${defenderLabel} for ${damage}${critText}`
            );
            break;
          }
        }
      });

      this.srcCharacter.refreshValues();
      this.dstCharacter.refreshValues();
    }

    if (this._encounter.isComplete && !this._announcedResult) {
      const summary = this._encounter.getSummary();
      this.logSummary(summary);
      this._announcedResult = true;

      if (summary.victor === "source") {
        this.handleHeroVictory(summary);
      } else if (summary.victor === "target") {
        this.handleHeroDefeat();
      }
    }
  }

  protected getCombatantLabel(character: Character): string {
    if (character === this._hero) {
      return "hero";
    }
    if (character === this._enemy) {
      return this._currentEnemyLabel || "enemy";
    }
    return "unknown";
  }

  protected handleHeroVictory(summary: EncounterSummary) {
    if (!this._hero) {
      return;
    }

    if (this._currentWaveQueue.length) {
      this.startNextEncounter(true);
      return;
    }

    this.completeWave();
    if (!this.prepareNextWave()) {
      console.log("[Encounter] All stages complete.");
      return;
    }

    this.startNextEncounter(true);
  }

  protected handleHeroDefeat() {
    console.log("[Encounter] Hero defeated. Simulation paused.");
    this.stopAuto();
  }

  protected startNextEncounter(autoStart = false) {
    if (!this._hero || !this._hero.isAlive) {
      return;
    }

    if (!this._currentWaveQueue.length) {
      if (!this.prepareNextWave()) {
        return;
      }
    }

    const unit = this._currentWaveQueue.shift();
    if (!unit) {
      return;
    }

    this._enemy = new Character(this.cloneData(unit.data));
    this._enemy.resetVitals();
    this._currentEnemyLabel = unit.label;

    this.dstCharacter.setCharacter(this._enemy);

    this._encounter = new EncounterLoop(this._sim, this._hero, this._enemy, {
      tickInterval: this.tickIntervalSeconds,
      rewardConfig: this.getRewardConfig(),
    });

    this._announcedResult = false;
    console.log(
      `[Encounter] Stage ${this._stageIndex + 1} (${this._currentStageName}) — Wave ${this._currentWaveNumber}: ${unit.label}`
    );

    if (autoStart || this.autoStart) {
      this.startAuto();
    }
  }

  protected ensureHero(fresh: boolean): boolean {
    if (!fresh && this._hero) {
      return true;
    }

    const baseData =
      (this.heroData?.json as CharacterData) ??
      (this.enemyWaveData?.[0]?.json as CharacterData) ??
      null;

    if (!baseData) {
      console.warn("[Simulator] No hero JSON assigned");
      return false;
    }

    this._hero = new Character(this.cloneData(baseData));
    return true;
  }

  protected loadEnemyPools() {
    this._enemyPools = { small: [], medium: [], boss: [] };

    const sources = this.enemyWaveData?.length ? this.enemyWaveData : [];

    sources.forEach((asset) => {
      const json: any = asset.json ?? {};
      const tier = (json.tier as string) ?? "small";
      const id = (json.id as string) ?? asset.name ?? "enemy";
      const label = (json.name as string) ?? id;
      const data = this.cloneData(json as CharacterData);
      this._enemyPools[tier] = this._enemyPools[tier] || [];
      this._enemyPools[tier].push({ id, label, tier, data });
    });
  }

  protected loadStages() {
    const json = (this.progressionData?.json as ProgressionData) ?? null;
    const stages = json?.stages?.length ? json.stages : [DEFAULT_STAGE];
    this._stages = stages.map((stage, index) => ({
      name: stage.name ?? `Stage ${index + 1}`,
      waves: Math.max(1, Math.floor(stage.waves ?? 1)),
      composition: stage.composition?.length ? stage.composition : DEFAULT_STAGE.composition,
      lootTable: stage.lootTable,
    }));
  }

  protected prepareNextWave(): boolean {
    if (!this._stages.length) {
      return false;
    }

    if (this._stageIndex >= this._stages.length) {
      this._stageIndex = this._stages.length - 1;
    }

    let stage = this._stages[this._stageIndex];

    while (stage && stage.waves !== undefined && this._stageWaveCompleted >= stage.waves) {
      this._stageIndex = Math.min(this._stageIndex + 1, this._stages.length - 1);
      this._stageWaveCompleted = 0;
      stage = this._stages[this._stageIndex];
    }

    if (!stage) {
      return false;
    }

    const compositionList = stage.composition && stage.composition.length
      ? stage.composition
      : DEFAULT_STAGE.composition;

    const pattern = compositionList[this._stageWaveCompleted % compositionList.length];
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
      const fallback = this.pickEnemyFromTier("small") || this.pickEnemyFromTier("medium") || this.pickEnemyFromTier("boss");
      if (!fallback) {
        return false;
      }
      queue.push(fallback);
    }

    this._currentWaveQueue = queue;
    this._currentWaveNumber = this._totalWavesCompleted + 1;
    this._currentStageName = stage.name ?? `Stage ${this._stageIndex + 1}`;
    this.applyStageLoot(stage.lootTable);

    return true;
  }

  protected pickEnemyFromTier(tier: string): EnemyUnit | null {
    const pool = this._enemyPools[tier] ?? [];
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
    this._stageWaveCompleted += 1;
    this._totalWavesCompleted += 1;
    this._currentWaveQueue = [];
  }

  protected applyStageLoot(lootId?: string) {
    if (!lootId) {
      return;
    }
    // In the editor we rely on the assigned lootTable asset; we simply log here.
    console.log(`[Encounter] Applying loot table '${lootId}'`);
  }

  protected logSummary(summary: EncounterSummary) {
    const winner =
      summary.victor === "source"
        ? "Hero"
        : summary.victor === "target"
        ? "Enemy"
        : "No one";

    const duration = summary.elapsedSeconds.toFixed(1);
    console.log(
      `[Encounter] ${winner} wins after ${summary.swings} swings in ${duration}s (Stage ${this._stageIndex + 1}, Wave ${this._currentWaveNumber})`
    );
    console.log(
      `[Encounter] Damage dealt — hero: ${summary.totalDamageFromSource}, enemy: ${summary.totalDamageFromTarget}`
    );

    if (summary.victor === "source" && summary.rewards) {
      const rewardLines = [`XP: ${summary.rewards.xp}`, `Gold: ${summary.rewards.gold}`];
      const materialEntries = Object.entries(summary.rewards.materials ?? {});
      if (materialEntries.length) {
        rewardLines.push(
          `Materials: ${materialEntries
            .map(([id, count]) => `${id} x${count}`)
            .join(", ")}`
        );
      }
      console.log(`[Encounter] Rewards — ${rewardLines.join("; ")}`);

      if (this._hero && summary.rewards.xp > 0) {
        const levelsGained = this._hero.addExperience(summary.rewards.xp);
        const progress = (this._hero.experienceProgress * 100).toFixed(1);
        console.log(
          `[Encounter] Hero gains ${summary.rewards.xp} XP (level ${this._hero.level}, ${progress}% to next)`
        );
        if (levelsGained > 0) {
          this.srcCharacter.refreshValues();
        }
      }
    }
  }

  protected getRewardConfig() {
    const table = this.parseLootTable();
    return {
      xpPerWin: table.xpPerWin ?? 0,
      goldMin: table.gold?.min ?? 0,
      goldMax: table.gold?.max ?? table.gold?.min ?? 0,
      materialDrops: table.materialDrops?.map((drop) => ({
        id: drop.id,
        chance: drop.chance,
        min: drop.min,
        max: drop.max,
      })),
    };
  }

  protected parseLootTable(): LootTableConfig {
    const json = (this.lootTable?.json as LootTableConfig) ?? null;
    if (!json) {
      return DEFAULT_LOOT_TABLE;
    }

    const goldMin = Math.max(0, Math.floor(json.gold?.min ?? 0));
    const goldMax = Math.max(goldMin, Math.floor(json.gold?.max ?? goldMin));

    const materialDrops = (json.materialDrops ?? []).map((drop) => ({
      id: drop.id,
      chance: this.clamp01(drop.chance ?? 0),
      min: Math.max(0, Math.floor(drop.min ?? 0)),
      max: Math.max(0, Math.floor(drop.max ?? drop.min ?? 0)),
    }));

    return {
      id: json.id ?? DEFAULT_LOOT_TABLE.id,
      name: json.name ?? DEFAULT_LOOT_TABLE.name,
      xpPerWin: Math.max(0, Math.floor(json.xpPerWin ?? 0)),
      gold: { min: goldMin, max: goldMax },
      materialDrops,
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

  protected cloneData(data: CharacterData): CharacterData {
    return JSON.parse(JSON.stringify(data));
  }
}
