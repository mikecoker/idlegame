import { _decorator, Component, JsonAsset } from "cc";
import { CombatSim } from "./combatsim";
import { Character, CharacterData } from "./character";
import { UICharacter } from "./UICharacter";
import { EncounterEvent, EncounterLoop, EncounterSummary } from "./encounter";
const { ccclass, property } = _decorator;

@ccclass("Simulator")
export class Simulator extends Component {
  @property(JsonAsset)
  characterOneData: JsonAsset = null;

  @property(UICharacter)
  srcCharacter: UICharacter = null;

  @property(JsonAsset)
  characterTwoData: JsonAsset = null;

  @property(UICharacter)
  dstCharacter: UICharacter = null;

  @property(JsonAsset)
  lootTable: JsonAsset = null;

  protected _sim: CombatSim;
  protected _src: Character;
  protected _dst: Character;
  protected _encounter: EncounterLoop | null = null;
  protected _announcedResult = false;

  @property({ tooltip: "Simulation tick resolution in seconds" })
  tickIntervalSeconds = 0.1;

  @property({ tooltip: "Automatically start the encounter on load" })
  autoStart = true;

  start() {
    this._sim = new CombatSim();
    this.resetEncounter(this.autoStart);
  }

  resetEncounter(autoStart = this.autoStart) {
    if (!this.characterOneData || !this.characterTwoData) {
      return;
    }

    this.tickIntervalSeconds = Math.max(0.01, this.tickIntervalSeconds);

    const srcData = this.cloneData(
      (this.characterOneData.json as CharacterData) ?? ({} as CharacterData)
    );
    const dstData = this.cloneData(
      (this.characterTwoData.json as CharacterData) ?? ({} as CharacterData)
    );

    this._src = new Character(srcData);
    this._dst = new Character(dstData);

    this._src.resetVitals();
    this._dst.resetVitals();

    this.srcCharacter.setCharacter(this._src);
    this.dstCharacter.setCharacter(this._dst);

    this._encounter = new EncounterLoop(this._sim, this._src, this._dst, {
      tickInterval: this.tickIntervalSeconds,
      rewardConfig: this.getRewardConfig(),
    });

    this._announcedResult = false;

    if (autoStart) {
      this.startAuto();
    }
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

      this.srcCharacter.refreshValues();
      this.dstCharacter.refreshValues();
    }

    if (this._encounter.isComplete && !this._announcedResult) {
      const summary = this._encounter.getSummary();
      this.logSummary(summary);
      this._announcedResult = true;
    }
  }

  protected getCombatantLabel(character: Character): string {
    if (character === this._src) {
      return "source";
    }
    if (character === this._dst) {
      return "target";
    }
    return "unknown";
  }

  protected logSummary(summary: EncounterSummary) {
    const winner =
      summary.victor === "source"
        ? "Source"
        : summary.victor === "target"
        ? "Target"
        : "No one";

    const duration = summary.elapsedSeconds.toFixed(1);
    console.log(
      `[Encounter] ${winner} wins after ${summary.swings} swings in ${duration}s`
    );
    console.log(
      `[Encounter] Damage dealt — source: ${summary.totalDamageFromSource}, target: ${summary.totalDamageFromTarget}`
    );
    if (summary.victor === "source") {
      const rewardLines = [`XP: ${summary.rewards.xp}`, `Gold: ${summary.rewards.gold}`];
      const materialEntries = Object.entries(summary.rewards.materials);
      if (materialEntries.length) {
        rewardLines.push(
          `Materials: ${materialEntries
            .map(([id, count]) => `${id} x${count}`)
            .join(", ")}`
        );
      }
      console.log(`[Encounter] Rewards — ${rewardLines.join("; ")}`);

      if (summary.rewards.xp > 0) {
        const levelsGained = this._src.addExperience(summary.rewards.xp);
        const progress = (this._src.experienceProgress * 100).toFixed(1);
        console.log(
          `[Encounter] Source gains ${summary.rewards.xp} XP (level ${this._src.level}, ${progress}% to next)`
        );
        if (levelsGained > 0) {
          this.srcCharacter.refreshValues();
        }
      }
    }
  }

  protected cloneData(data: CharacterData): CharacterData {
    return JSON.parse(JSON.stringify(data));
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
}

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
