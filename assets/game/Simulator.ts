import { _decorator, Component, JsonAsset } from "cc";
import { SimulationRuntime, SimulationState } from "../../core/runtime/SimulationRuntime";
import { EncounterEvent, EncounterSummary } from "../../core/combat/Encounter";
import { Character } from "../../core/characters/Character";
import { CocosDataSource } from "../../platforms/cocos/CocosDataSource";
import { UICharacter } from "./UICharacter";
const { ccclass, property } = _decorator;

@ccclass("Simulator")
export class Simulator extends Component {
  @property(JsonAsset)
  heroData: JsonAsset = null;

  @property([JsonAsset])
  heroRoster: JsonAsset[] = [];

  @property([JsonAsset])
  enemyWaveData: JsonAsset[] = [];

  @property(JsonAsset)
  progressionData: JsonAsset = null;

  @property(JsonAsset)
  lootTable: JsonAsset = null;

  @property([JsonAsset])
  additionalLootTables: JsonAsset[] = [];

  @property(UICharacter)
  srcCharacter: UICharacter = null;

  @property(UICharacter)
  dstCharacter: UICharacter = null;

  @property({ tooltip: "Simulation tick resolution in seconds" })
  tickIntervalSeconds = 0.1;

  @property({ tooltip: "Automatically start the encounter on load" })
  autoStart = true;

  protected runtime: SimulationRuntime | null = null;
  protected state: SimulationState | null = null;
  protected heroRef: Character | null = null;
  protected enemyRef: Character | null = null;
  protected lastSummary: EncounterSummary | null = null;

  async start() {
    await this.bootstrapRuntime();
  }

  protected async bootstrapRuntime() {
    const dataSource = new CocosDataSource({
      heroes: this.collectHeroSources(),
      enemies: this.enemyWaveData.map((asset) => ({ asset })),
      progression: this.progressionData,
      lootTables: this.collectLootSources(),
    });

    this.runtime = new SimulationRuntime(dataSource, {
      tickIntervalSeconds: this.tickIntervalSeconds,
      autoStart: this.autoStart,
      hooks: {
        onStateChanged: (state) => this.handleStateChanged(state),
        onEncounterEvents: (events) => this.handleEncounterEvents(events),
        onEncounterComplete: (summary) => this.handleEncounterComplete(summary),
        onLog: (entry) => console.log(entry),
      },
    });

    try {
      await this.runtime.initialize(true);
    } catch (err) {
      console.error("[Simulator] Failed to initialise runtime", err);
      return;
    }

    const initialState = this.runtime.getState();
    this.handleStateChanged(initialState);
  }

  update(deltaTime: number) {
    if (!this.runtime) {
      return;
    }
    this.runtime.tick(deltaTime);
  }

  startAuto() {
    this.runtime?.startAuto();
  }

  stopAuto() {
    this.runtime?.stopAuto();
  }

  toggleAuto() {
    this.runtime?.toggleAuto();
  }

  resetEncounter(autoStart = this.autoStart, freshHero = true) {
    this.runtime?.resetEncounter(autoStart, freshHero);
  }

  updateTickInterval(seconds: number) {
    const clamped = Math.max(0.01, seconds || 0.01);
    this.tickIntervalSeconds = clamped;
    this.runtime?.setTickInterval(clamped);
  }

  isRunning(): boolean {
    return this.runtime?.isRunning() ?? false;
  }

  isComplete(): boolean {
    return this.runtime?.isComplete() ?? false;
  }

  getSummary(): EncounterSummary | null {
    return this.lastSummary;
  }

  protected handleStateChanged(state: SimulationState) {
    this.state = state;

    if (state.hero && state.hero !== this.heroRef) {
      this.heroRef = state.hero;
      this.srcCharacter?.setCharacter(state.hero);
    } else if (state.hero) {
      this.srcCharacter?.refreshValues();
    }

    if (state.enemy && state.enemy !== this.enemyRef) {
      this.enemyRef = state.enemy;
      this.dstCharacter?.setCharacter(state.enemy);
    } else if (state.enemy) {
      this.dstCharacter?.refreshValues();
    }
  }

  protected handleEncounterEvents(events: EncounterEvent[]) {
    if (!events.length) {
      return;
    }

    events.forEach((event) => {
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

    this.srcCharacter?.refreshValues();
    this.dstCharacter?.refreshValues();
  }

  protected handleEncounterComplete(summary: EncounterSummary) {
    this.lastSummary = summary;
    const winner =
      summary.victor === "source"
        ? "Hero"
        : summary.victor === "target"
        ? "Enemy"
        : "No one";

    const duration = summary.elapsedSeconds.toFixed(1);
    console.log(
      `[Encounter] ${winner} wins after ${summary.swings} swings in ${duration}s (Stage ${
        (this.state?.stageIndex ?? 0) + 1
      }, Wave ${this.state?.waveNumber ?? 0})`
    );
    console.log(
      `[Encounter] Damage dealt — hero: ${summary.totalDamageFromSource}, enemy: ${summary.totalDamageFromTarget}`
    );

    if (summary.rewards) {
      const rewards = summary.rewards;
      const rewardLines = [`XP: ${rewards.xp}`, `Gold: ${rewards.gold}`];
      const materials = Object.entries(rewards.materials ?? {});
      if (materials.length) {
        rewardLines.push(
          `Materials: ${materials
            .map(([id, count]) => `${id} x${count}`)
            .join(", ")}`
        );
      }

      const equipment = (rewards.equipment ?? []).map(
        (entry) => `${entry.itemId} (${entry.rarity}) x${entry.quantity}`
      );
      if (equipment.length) {
        rewardLines.push(`Equipment: ${equipment.join(", ")}`);
      }

      const augments = (rewards.augments ?? []).map(
        (entry) => `${entry.augmentId} x${entry.quantity}`
      );
      if (augments.length) {
        rewardLines.push(`Augments: ${augments.join(", ")}`);
      }
      console.log(`[Encounter] Rewards — ${rewardLines.join("; ")}`);
    }
  }

  protected getCombatantLabel(character: Character): string {
    if (character === this.heroRef) {
      return "hero";
    }
    if (character === this.enemyRef) {
      return this.state?.enemyLabel || "enemy";
    }
    return "unknown";
  }

  protected collectHeroSources() {
    const sources = [];
    if (this.heroData) {
      sources.push({ asset: this.heroData, id: this.heroData.name });
    }
    if (this.heroRoster?.length) {
      this.heroRoster.forEach((asset) => {
        if (asset) {
          sources.push({ asset, id: asset.name });
        }
      });
    }
    return sources;
  }

  protected collectLootSources() {
    const sources = [] as { asset: JsonAsset | null }[];
    if (this.lootTable) {
      sources.push({ asset: this.lootTable });
    }
    if (this.additionalLootTables?.length) {
      this.additionalLootTables.forEach((asset) => {
        if (asset) {
          sources.push({ asset });
        }
      });
    }
    return sources;
  }
}
