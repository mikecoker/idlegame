import { _decorator, Component, JsonAsset } from "cc";
import { CombatSim } from "./combatsim";
import { Character, CharacterData } from "./character";
import { UICharacter } from "./UICharacter";
import { EncounterLoop, EncounterSummary } from "./encounter";
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

        switch (event.result) {
          case "miss":
            console.log(
              `[Encounter] ${attackerLabel} swings at ${defenderLabel} and misses`
            );
            break;
          case "dodge":
            console.log(
              `[Encounter] ${defenderLabel} dodges ${attackerLabel}'s attack`
            );
            break;
          case "parry":
            console.log(
              `[Encounter] ${defenderLabel} parries ${attackerLabel}`
            );
            break;
          case "hit":
          default: {
            const damage = Math.max(0, Math.round(event.damage));
            const critText = event.critical ? " (crit)" : "";
            console.log(
              `[Encounter] ${attackerLabel} hits ${defenderLabel} for ${damage}${critText}`
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
  }

  protected cloneData(data: CharacterData): CharacterData {
    return JSON.parse(JSON.stringify(data));
  }
}
