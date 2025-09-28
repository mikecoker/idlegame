export type AbilityTrigger = "onAttackHit" | "onTick";

export interface AbilityBase {
  id: string;
  name?: string;
  description?: string;
  trigger: AbilityTrigger;
  requiresTier?: number;
  cooldownSeconds?: number;
}

export interface AreaDamageAbility extends AbilityBase {
  type: "area-damage";
  percentOfDamage: number;
  maxTargets: number;
  falloffPercent?: number;
}

export interface HealingAuraAbility extends AbilityBase {
  type: "healing-aura";
  healPercent: number;
  intervalSeconds: number;
  target?: "self" | "allies";
}

export type AbilityDefinition = AreaDamageAbility | HealingAuraAbility;

export function cloneAbilityDefinition(definition: AbilityDefinition): AbilityDefinition {
  return JSON.parse(JSON.stringify(definition)) as AbilityDefinition;
}

export function isAreaDamageAbility(
  ability: AbilityDefinition
): ability is AreaDamageAbility {
  return ability.type === "area-damage";
}

export function isHealingAuraAbility(
  ability: AbilityDefinition
): ability is HealingAuraAbility {
  return ability.type === "healing-aura";
}
