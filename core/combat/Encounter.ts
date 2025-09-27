import { CombatSim, AttackOutcome } from "./CombatSim";
import { Character } from "../characters/Character";
import { ItemRarity } from "../items/Item";

export interface LootEquipmentDrop {
  itemId: string;
  chance: number;
  min?: number;
  max?: number;
  rarityWeights?: Partial<Record<ItemRarity, number>>;
}

export interface LootAugmentDrop {
  augmentId: string;
  chance: number;
  min?: number;
  max?: number;
}

export interface RewardEquipmentItem {
  itemId: string;
  rarity: ItemRarity;
  quantity: number;
}

export interface RewardAugmentItem {
  augmentId: string;
  quantity: number;
}

export interface EncounterConfig {
  tickInterval: number;
  rewardConfig?: EncounterRewardConfig;
}

export interface EncounterSummary {
  elapsedSeconds: number;
  swings: number;
  totalDamageFromSource: number;
  totalDamageFromTarget: number;
  victor: "source" | "target" | null;
  running: boolean;
  rewards: EncounterRewards;
}

export interface EncounterRewardConfig {
  xpPerWin?: number;
  goldMin?: number;
  goldMax?: number;
  materialDrops?: Array<{ id: string; chance: number; min: number; max: number }>;
  equipmentDrops?: LootEquipmentDrop[];
  augmentDrops?: LootAugmentDrop[];
}

export interface EncounterRewards {
  xp: number;
  gold: number;
  materials: Record<string, number>;
  equipment: RewardEquipmentItem[];
  augments: RewardAugmentItem[];
}

export interface EncounterEvent extends AttackOutcome {
  timestamp: number;
}

const MIN_INTERVAL = 0.01;
const MIN_ATTACK_DELAY = 0.2;

interface AttackHandState {
  type: "main" | "off";
  delay: number;
  cooldown: number;
}

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
  protected _sourceHands: AttackHandState[] = [];
  protected _targetHands: AttackHandState[] = [];
  protected _rewardConfig: EncounterRewardConfig;
  protected _rewards: EncounterRewards = {
    xp: 0,
    gold: 0,
    materials: {},
    equipment: [],
    augments: [],
  };

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
    this._sourceHands = this.createHandsForCharacter(this._source);
    this._targetHands = this.createHandsForCharacter(this._target);
    this._rewardConfig = {
      xpPerWin: config?.rewardConfig?.xpPerWin ?? 0,
      goldMin: config?.rewardConfig?.goldMin ?? 0,
      goldMax: config?.rewardConfig?.goldMax ?? 0,
      materialDrops: config?.rewardConfig?.materialDrops ?? [],
      equipmentDrops: config?.rewardConfig?.equipmentDrops ?? [],
      augmentDrops: config?.rewardConfig?.augmentDrops ?? [],
    };
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

  tick(deltaSeconds: number): EncounterEvent[] {
    if (!this._running || this._victor) {
      return [];
    }

    this._accumulator += deltaSeconds;
    const events: EncounterEvent[] = [];

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
      rewards: this._rewards,
    };
  }

  protected advanceTick(): EncounterEvent[] {
    const outcomes: EncounterEvent[] = [];

    this.applyHandTicks(this._sourceHands, this._source, this._target, outcomes);
    this.applyHandTicks(this._targetHands, this._target, this._source, outcomes);

    return outcomes;
  }

  protected applyHandTicks(
    hands: AttackHandState[],
    attacker: Character,
    defender: Character,
    outcomes: EncounterEvent[]
  ) {
    hands.forEach((hand) => {
      hand.cooldown -= this._tickInterval;
      while (hand.cooldown <= 0 && !this._victor) {
        hand.cooldown += hand.delay;
        const outcome = this.resolveAndApply(attacker, defender, hand.type);
        outcomes.push(outcome);
      }
    });
  }

  protected resolveAndApply(
    attacker: Character,
    defender: Character,
    hand: "main" | "off"
  ): EncounterEvent {
    const outcome = this._sim.resolveAttack(attacker, defender, hand);
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
        if (this._victor === "source") {
          this.awardRewards();
        }
      }
    }

    return {
      ...outcome,
      timestamp: this._elapsedSeconds,
    };
  }

  protected getAttackDelay(character: Character): number {
    const delay = character.getAttackDelaySeconds();
    return Math.max(MIN_ATTACK_DELAY, delay);
  }

  protected getOffhandDelay(character: Character): number | null {
    if (!character.hasOffHandWeapon()) {
      return null;
    }
    const delay = character.getAttackDelaySeconds("off");
    return Math.max(MIN_ATTACK_DELAY, delay);
  }

  protected createHandsForCharacter(character: Character): AttackHandState[] {
    const hands: AttackHandState[] = [];
    const mainDelay = this.getAttackDelay(character);
    hands.push({ type: "main", delay: mainDelay, cooldown: 0 });

    const offDelay = this.getOffhandDelay(character);
    if (offDelay !== null) {
      hands.push({ type: "off", delay: offDelay, cooldown: offDelay / 2 });
    }
    return hands;
  }

  protected awardRewards() {
    const config = this._rewardConfig;
    const rewards: EncounterRewards = {
      xp: config.xpPerWin ?? 0,
      gold: this.rollGold(config.goldMin, config.goldMax),
      materials: {},
      equipment: [],
      augments: [],
    };
    if (Array.isArray(config.materialDrops)) {
      config.materialDrops.forEach((drop) => {
        if (Math.random() <= drop.chance) {
          const qty = this.randRange(drop.min, drop.max);
          if (qty > 0) {
            rewards.materials[drop.id] = (rewards.materials[drop.id] ?? 0) + qty;
          }
        }
      });
    }

    if (Array.isArray(config.equipmentDrops)) {
      config.equipmentDrops.forEach((drop) => {
        if (Math.random() <= drop.chance) {
          const qty = this.randRange(Math.max(1, drop.min ?? 1), Math.max(1, drop.max ?? drop.min ?? 1));
          if (qty <= 0) {
            return;
          }
          const rarity = this.pickEquipmentRarity(drop.rarityWeights);
          this.pushEquipmentReward(rewards.equipment, drop.itemId, rarity, qty);
        }
      });
    }

    if (Array.isArray(config.augmentDrops)) {
      config.augmentDrops.forEach((drop) => {
        if (Math.random() <= drop.chance) {
          const qty = this.randRange(Math.max(1, drop.min ?? 1), Math.max(1, drop.max ?? drop.min ?? 1));
          if (qty > 0) {
            this.pushAugmentReward(rewards.augments, drop.augmentId, qty);
          }
        }
      });
    }
    this._rewards = rewards;
  }

  protected rollGold(min?: number, max?: number): number {
    if (min === undefined && max === undefined) {
      return 0;
    }
    const low = Math.max(0, min ?? 0);
    const high = Math.max(low, max ?? low);
    return this.randRange(low, high);
  }

  protected randRange(min: number, max: number): number {
    if (max <= min) {
      return Math.floor(min);
    }
    return Math.floor(Math.random() * (max - min + 1)) + Math.floor(min);
  }

  protected pickEquipmentRarity(weights?: Partial<Record<ItemRarity, number>>): ItemRarity {
    const table: Record<ItemRarity, number> = {
      common: 1,
      uncommon: 0,
      rare: 0,
      epic: 0,
      legendary: 0,
    };
    if (weights) {
      Object.entries(weights).forEach(([key, value]) => {
        const rarity = key as ItemRarity;
        if (table[rarity] !== undefined && Number.isFinite(value)) {
          table[rarity] = Math.max(0, Number(value));
        }
      });
    }

    const total = Object.values(table).reduce((sum, val) => sum + val, 0);
    if (total <= 0) {
      return "common";
    }

    const roll = Math.random() * total;
    let accumulator = 0;
    for (const [rarity, weight] of Object.entries(table) as Array<[ItemRarity, number]>) {
      accumulator += weight;
      if (roll <= accumulator) {
        return rarity;
      }
    }
    return "common";
  }

  protected pushEquipmentReward(collection: RewardEquipmentItem[], itemId: string, rarity: ItemRarity, qty: number) {
    const existing = collection.find((entry) => entry.itemId === itemId && entry.rarity === rarity);
    if (existing) {
      existing.quantity += qty;
    } else {
      collection.push({ itemId, rarity, quantity: qty });
    }
  }

  protected pushAugmentReward(collection: RewardAugmentItem[], augmentId: string, qty: number) {
    const existing = collection.find((entry) => entry.augmentId === augmentId);
    if (existing) {
      existing.quantity += qty;
    } else {
      collection.push({ augmentId, quantity: qty });
    }
  }
}
