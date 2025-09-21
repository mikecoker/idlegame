import { CombatSim, AttackOutcome } from "./combatsim";
import { Character } from "./character";

export interface EncounterConfig {
  tickInterval: number;
}

export interface EncounterSummary {
  elapsedSeconds: number;
  swings: number;
  totalDamageFromSource: number;
  totalDamageFromTarget: number;
  victor: "source" | "target" | null;
  running: boolean;
}

const MIN_INTERVAL = 0.01;
const MIN_ATTACK_DELAY = 0.2;

export class EncounterLoop {
  protected _sim: CombatSim;
  protected _source: Character;
  protected _target: Character;
  protected _tickInterval: number;
  protected _accumulator = 0;
  protected _running = false;
  protected _elapsedSeconds = 0;
  protected _swings = 0;
  protected _totalDamageFromSource = 0;
  protected _totalDamageFromTarget = 0;
  protected _victor: "source" | "target" | null = null;
  protected _sourceCooldown = 0;
  protected _targetCooldown = 0;

  constructor(
    sim: CombatSim,
    source: Character,
    target: Character,
    config?: Partial<EncounterConfig>
  ) {
    this._sim = sim;
    this._source = source;
    this._target = target;
    this._tickInterval = Math.max(config?.tickInterval ?? 0.1, MIN_INTERVAL);
    this._sourceCooldown = 0;
    this._targetCooldown = 0;
  }

  start() {
    if (this._victor) {
      return;
    }
    this._running = true;
  }

  stop() {
    this._running = false;
  }

  setTickInterval(seconds: number) {
    this._tickInterval = Math.max(seconds, MIN_INTERVAL);
  }

  getTickInterval(): number {
    return this._tickInterval;
  }

  get isRunning(): boolean {
    return this._running;
  }

  get isComplete(): boolean {
    return this._victor !== null;
  }

  tick(deltaSeconds: number): AttackOutcome[] {
    if (!this._running || this._victor) {
      return [];
    }

    this._accumulator += deltaSeconds;
    const events: AttackOutcome[] = [];

    while (this._accumulator >= this._tickInterval && !this._victor) {
      this._accumulator -= this._tickInterval;
      this._elapsedSeconds += this._tickInterval;
      const roundEvents = this.advanceTick();
      events.push(...roundEvents);
    }

    if (this._victor) {
      this._running = false;
    }

    return events;
  }

  getSummary(): EncounterSummary {
    return {
      elapsedSeconds: this._elapsedSeconds,
      swings: this._swings,
      totalDamageFromSource: this._totalDamageFromSource,
      totalDamageFromTarget: this._totalDamageFromTarget,
      victor: this._victor,
      running: this._running,
    };
  }

  protected advanceTick(): AttackOutcome[] {
    const outcomes: AttackOutcome[] = [];

    this._sourceCooldown -= this._tickInterval;
    this._targetCooldown -= this._tickInterval;

    while (this._sourceCooldown <= 0 && !this._victor) {
      this._sourceCooldown += this.getAttackDelay(this._source);
      const outcome = this.resolveAndApply(this._source, this._target);
      outcomes.push(outcome);
    }

    while (this._targetCooldown <= 0 && !this._victor) {
      this._targetCooldown += this.getAttackDelay(this._target);
      const outcome = this.resolveAndApply(this._target, this._source);
      outcomes.push(outcome);
    }

    return outcomes;
  }

  protected resolveAndApply(
    attacker: Character,
    defender: Character
  ): AttackOutcome {
    const outcome = this._sim.resolveAttack(attacker, defender);
    this._swings += 1;

    if (outcome.result === "hit" && outcome.damage > 0) {
      const dmg = Math.max(0, Math.round(outcome.damage));
      defender.applyDamage(dmg);
      if (attacker === this._source) {
        this._totalDamageFromSource += dmg;
      } else {
        this._totalDamageFromTarget += dmg;
      }
      if (!defender.isAlive) {
        this._victor = attacker === this._source ? "source" : "target";
      }
    }

    return outcome;
  }

  protected getAttackDelay(character: Character): number {
    const delay = character.getAttackDelaySeconds();
    return Math.max(MIN_ATTACK_DELAY, delay);
  }
}
