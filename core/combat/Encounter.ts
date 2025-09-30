import { CombatSim, AttackOutcome } from "./CombatSim";
import { Character } from "../characters/Character";
import { ItemRarity } from "../items/Item";
import { LootConsumableDrop } from "../economy/LootTable";
import {
  AbilityDefinition,
  AreaDamageAbility,
  HealingAuraAbility,
  isAreaDamageAbility,
  isHealingAuraAbility,
} from "../characters/Abilities";

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
  onLog?: (message: string) => void;
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
  consumableDrops?: LootConsumableDrop[];
}

export interface EncounterRewards {
  xp: number;
  gold: number;
  materials: Record<string, number>;
  equipment: RewardEquipmentItem[];
  augments: RewardAugmentItem[];
  consumables: Record<string, number>;
}

export interface EncounterEvent extends AttackOutcome {
  timestamp: number;
}

const MIN_INTERVAL = 0.01;
const MIN_ATTACK_DELAY = 0.2;

type CombatSide = "source" | "target";

type AttackHand = "main" | "off";

interface AbilityState {
  definition: AbilityDefinition;
  cooldownRemaining: number;
  intervalRemaining?: number;
}

interface AttackHandState {
  type: AttackHand;
  delay: number;
  cooldown: number;
}

interface CombatantState {
  character: Character;
  hands: AttackHandState[];
  abilities: AbilityState[];
}

export class EncounterLoop {
  protected readonly _sim: CombatSim;
  protected readonly _sourceParty: CombatantState[];
  protected readonly _targetParty: CombatantState[];
  protected readonly _rewardConfig: EncounterRewardConfig;
  protected readonly _logger?: (message: string) => void;

  protected _tickInterval: number;
  protected _accumulator = 0;
  protected _running = false;
  protected _elapsedSeconds = 0;
  protected _swings = 0;
  protected _totalDamageFromSource = 0;
  protected _totalDamageFromTarget = 0;
  protected _victor: CombatSide | null = null;
  protected _rewards: EncounterRewards = {
    xp: 0,
    gold: 0,
    materials: {},
    equipment: [],
    augments: [],
    consumables: {},
  };
  protected _rewardsGranted = false;

  constructor(
    sim: CombatSim,
    sourceParty: Character[],
    targetParty: Character[],
    config?: Partial<EncounterConfig>
  ) {
    this._sim = sim;
    this._tickInterval = Math.max(config?.tickInterval ?? 0.1, MIN_INTERVAL);
    this._rewardConfig = {
      xpPerWin: config?.rewardConfig?.xpPerWin ?? 0,
      goldMin: config?.rewardConfig?.goldMin ?? 0,
      goldMax: config?.rewardConfig?.goldMax ?? 0,
      materialDrops: config?.rewardConfig?.materialDrops ?? [],
      equipmentDrops: config?.rewardConfig?.equipmentDrops ?? [],
      augmentDrops: config?.rewardConfig?.augmentDrops ?? [],
    };
    this._logger = config?.onLog;

    this._sourceParty = sourceParty.map((character) =>
      this.createCombatantState(character)
    );
    this._targetParty = targetParty.map((character) =>
      this.createCombatantState(character)
    );
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

      this.processAbilityTicks(this._sourceParty, "source");
      this.processAbilityTicks(this._targetParty, "target");

      this.processAttacks(this._sourceParty, this._targetParty, "source", events);
      if (this._victor) {
        break;
      }
      this.processAttacks(this._targetParty, this._sourceParty, "target", events);
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

  protected createCombatantState(character: Character): CombatantState {
    return {
      character,
      hands: this.createHandsForCharacter(character),
      abilities: this.createAbilityStates(character),
    };
  }

  protected createAbilityStates(character: Character): AbilityState[] {
    if (typeof character.getUnlockedAbilities !== "function") {
      return [];
    }
    const abilities = character.getUnlockedAbilities();
    return abilities.map((definition) => {
      const state: AbilityState = {
        definition,
        cooldownRemaining: 0,
      };
      if (isHealingAuraAbility(definition)) {
        const interval = Math.max(definition.intervalSeconds ?? 0, this._tickInterval);
        state.intervalRemaining = interval;
      }
      return state;
    });
  }

  protected processAbilityTicks(party: CombatantState[], side: CombatSide) {
    party.forEach((combatant) => {
      if (!combatant.character.isAlive) {
        return;
      }
      combatant.abilities.forEach((abilityState) => {
        if (abilityState.cooldownRemaining > 0) {
          abilityState.cooldownRemaining = Math.max(
            0,
            abilityState.cooldownRemaining - this._tickInterval
          );
        }
        const ability = abilityState.definition;
        if (!isHealingAuraAbility(ability)) {
          return;
        }
        if (!ability.intervalSeconds || ability.intervalSeconds <= 0) {
          return;
        }
        const nextTick =
          (abilityState.intervalRemaining ?? ability.intervalSeconds) - this._tickInterval;
        abilityState.intervalRemaining = nextTick;
        if (nextTick > 0) {
          return;
        }
        if (abilityState.cooldownRemaining > 0) {
          abilityState.intervalRemaining = ability.intervalSeconds;
          return;
        }
        this.triggerHealingAura(combatant, ability, side);
        abilityState.intervalRemaining = ability.intervalSeconds;
        abilityState.cooldownRemaining = ability.cooldownSeconds ?? 0;
      });
    });
  }

  protected triggerHealingAura(
    combatant: CombatantState,
    ability: HealingAuraAbility,
    side: CombatSide
  ) {
    const allies = side === "source" ? this._sourceParty : this._targetParty;
    const healPercent = Math.max(0, ability.healPercent ?? 0);
    if (healPercent <= 0) {
      return;
    }

    let totalHealed = 0;
    allies.forEach((ally) => {
      if (!ally.character.isAlive) {
        return;
      }
      const before = ally.character.health;
      ally.character.healPercent(healPercent);
      const healed = ally.character.health - before;
      if (healed > 0) {
        totalHealed += healed;
      }
    });

    if (totalHealed > 0 && this._logger) {
      const percent = (healPercent * 100).toFixed(1);
      this._logger(
        `[Encounter] ${ability.name ?? ability.id ?? "Healing Aura"} restores ${percent}% health to ${
          side === "source" ? "party" : "enemies"
        }.`
      );
    }
  }

  protected processAttacks(
    attackers: CombatantState[],
    defenders: CombatantState[],
    side: CombatSide,
    events: EncounterEvent[]
  ) {
    if (!this.anyAlive(defenders)) {
      this.evaluateVictory();
      return;
    }

    for (const combatant of attackers) {
      if (this._victor || !combatant.character.isAlive) {
        continue;
      }

      for (const hand of combatant.hands) {
        if (this._victor || !combatant.character.isAlive) {
          break;
        }
        hand.cooldown -= this._tickInterval;
        while (hand.cooldown <= 0 && !this._victor) {
          const event = this.performAttack(combatant, defenders, side, hand.type);
          hand.cooldown += hand.delay;
          if (event) {
            events.push(event);
          } else {
            break;
          }
        }
      }
    }
  }

  protected performAttack(
    combatant: CombatantState,
    defenders: CombatantState[],
    side: CombatSide,
    hand: AttackHand
  ): EncounterEvent | null {
    const defender = this.selectPrimaryTarget(defenders);
    if (!defender) {
      this.evaluateVictory();
      return null;
    }

    const outcome = this._sim.resolveAttack(
      combatant.character,
      defender.character,
      hand
    );
    this._swings += 1;

    if (outcome.result === "hit" && outcome.damage > 0) {
      const baseDamage = Math.max(0, Math.round(outcome.damage));
      defender.character.applyDamage(baseDamage);
      if (side === "source") {
        this._totalDamageFromSource += baseDamage;
      } else {
        this._totalDamageFromTarget += baseDamage;
      }

      this.handleAttackAbilities(
        combatant,
        defender,
        defenders,
        side,
        baseDamage
      );
      this.evaluateVictory();
    }

    return {
      ...outcome,
      timestamp: this._elapsedSeconds,
    };
  }

  protected handleAttackAbilities(
    combatant: CombatantState,
    primaryTarget: CombatantState,
    defenders: CombatantState[],
    side: CombatSide,
    baseDamage: number
  ) {
    combatant.abilities.forEach((abilityState) => {
      const ability = abilityState.definition;
      if (!isAreaDamageAbility(ability)) {
        return;
      }
      if (abilityState.cooldownRemaining > 0) {
        return;
      }
      const maxTargets = Math.max(0, ability.maxTargets ?? 0);
      if (maxTargets <= 0) {
        return;
      }
      const percent = ability.percentOfDamage ?? 0;
      if (percent <= 0) {
        return;
      }

      const targets = this.selectAdditionalTargets(defenders, primaryTarget, maxTargets);
      if (!targets.length) {
        return;
      }

      const splashDamage = Math.max(0, Math.round(baseDamage * percent));
      if (splashDamage <= 0) {
        return;
      }

      targets.forEach((target) => {
        if (!target.character.isAlive) {
          return;
        }
        target.character.applyDamage(splashDamage);
        if (side === "source") {
          this._totalDamageFromSource += splashDamage;
        } else {
          this._totalDamageFromTarget += splashDamage;
        }
      });

      abilityState.cooldownRemaining = ability.cooldownSeconds ?? 0;
      if (this._logger) {
        const percentText = (percent * 100).toFixed(1);
        this._logger(
          `[Encounter] ${ability.name ?? ability.id ?? "Area ability"} hits ${targets.length} target(s) for ${percentText}% splash damage.`
        );
      }

      this.evaluateVictory();
    });
  }

  protected selectPrimaryTarget(defenders: CombatantState[]): CombatantState | null {
    for (const defender of defenders) {
      if (defender.character.isAlive) {
        return defender;
      }
    }
    return null;
  }

  protected selectAdditionalTargets(
    defenders: CombatantState[],
    primary: CombatantState,
    maxTargets: number
  ): CombatantState[] {
    if (maxTargets <= 0) {
      return [];
    }

    const targets: CombatantState[] = [];
    for (const defender of defenders) {
      if (targets.length >= maxTargets) {
        break;
      }
      if (defender === primary) {
        continue;
      }
      if (!defender.character.isAlive) {
        continue;
      }
      targets.push(defender);
    }
    return targets;
  }

  protected anyAlive(party: CombatantState[]): boolean {
    return party.some((combatant) => combatant.character.isAlive);
  }

  protected evaluateVictory() {
    const enemiesAlive = this.anyAlive(this._targetParty);
    const heroesAlive = this.anyAlive(this._sourceParty);

    if (!enemiesAlive && heroesAlive) {
      if (!this._victor) {
        this._victor = "source";
        this.awardRewards();
      }
    } else if (!heroesAlive && enemiesAlive) {
      if (!this._victor) {
        this._victor = "target";
      }
    } else if (!heroesAlive && !enemiesAlive) {
      if (!this._victor) {
        this._victor = "target";
      }
    }
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
    if (this._rewardsGranted) {
      return;
    }
    this._rewardsGranted = true;

    const config = this._rewardConfig;
    const rewards: EncounterRewards = {
      xp: config.xpPerWin ?? 0,
      gold: this.rollGold(config.goldMin, config.goldMax),
      materials: {},
      equipment: [],
      augments: [],
      consumables: {},
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
          const qty = this.randRange(
            Math.max(1, drop.min ?? 1),
            Math.max(1, drop.max ?? drop.min ?? 1)
          );
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
          const qty = this.randRange(
            Math.max(1, drop.min ?? 1),
            Math.max(1, drop.max ?? drop.min ?? 1)
          );
          if (qty > 0) {
            this.pushAugmentReward(rewards.augments, drop.augmentId, qty);
          }
        }
      });
    }

    if (Array.isArray(config.consumableDrops)) {
      config.consumableDrops.forEach((drop) => {
        if (Math.random() <= drop.chance) {
          const qty = this.randRange(
            Math.max(1, drop.min ?? 1),
            Math.max(1, drop.max ?? drop.min ?? 1)
          );
          if (qty > 0) {
            rewards.consumables[drop.itemId] = (rewards.consumables[drop.itemId] ?? 0) + qty;
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

  protected pushEquipmentReward(
    collection: RewardEquipmentItem[],
    itemId: string,
    rarity: ItemRarity,
    qty: number
  ) {
    const existing = collection.find(
      (entry) => entry.itemId === itemId && entry.rarity === rarity
    );
    if (existing) {
      existing.quantity += qty;
    } else {
      collection.push({ itemId, rarity, quantity: qty });
    }
  }

  protected pushAugmentReward(
    collection: RewardAugmentItem[],
    augmentId: string,
    qty: number
  ) {
    const existing = collection.find((entry) => entry.augmentId === augmentId);
    if (existing) {
      existing.quantity += qty;
    } else {
      collection.push({ augmentId, quantity: qty });
    }
  }
}
