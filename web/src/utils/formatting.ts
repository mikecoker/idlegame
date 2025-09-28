import type { EncounterRewards } from "@core/combat/Encounter";
import type { ItemDefinition, OwnedEquipment } from "../legacyHarness";

export function titleCase(value: string): string {
  if (!value) {
    return "";
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function formatAugmentNames(
  augmentIds: string[],
  resolver: (id: string) => ItemDefinition | null
): string {
  return augmentIds.map((augmentId) => resolver(augmentId)?.name ?? augmentId).join(", ");
}

export function formatOwnedSummary(
  owned: OwnedEquipment,
  definition: ItemDefinition | null
): string {
  const parts: string[] = [];
  if (definition?.tier) {
    parts.push(`Tier ${definition.tier}`);
  }
  parts.push(titleCase(owned.rarity));
  parts.push(`+${owned.upgradeLevel}/${owned.maxUpgradeLevel}`);
  if (definition?.slot) {
    parts.push(definition.slot);
  }
  if (owned.socketSlots > 0) {
    parts.push(`Sockets ${owned.augments.length}/${owned.socketSlots}`);
  }
  return parts.join(" • ");
}

export function describeItemDetails(
  owned: OwnedEquipment,
  definition: ItemDefinition | null,
  resolver: (id: string) => ItemDefinition | null
): string {
  if (!definition) {
    return `Item ID: ${owned.itemId}`;
  }
  const parts: string[] = [];
  if (definition.type === "weapon" && definition.weapon) {
    parts.push(
      `Damage ${definition.weapon.minDamage}-${definition.weapon.maxDamage} @ ${definition.weapon.delay}s`
    );
  } else if (definition.type === "armor" && definition.armor) {
    parts.push(`Armor ${definition.armor.armor}`);
  } else {
    parts.push(titleCase(definition.type));
  }
  if (owned.augments.length) {
    parts.push(`Augments: ${formatAugmentNames(owned.augments, resolver)}`);
  }
  return parts.join(" • ") || "-";
}

export function formatEquipmentList(rewards: EncounterRewards): string {
  return rewards.equipment
    .map((entry) => `${entry.itemId} (${entry.rarity}) x${entry.quantity}`)
    .join(", ");
}

export function formatAugmentList(rewards: EncounterRewards): string {
  return rewards.augments
    .map((entry) => `${entry.augmentId} x${entry.quantity}`)
    .join(", ");
}

export function formatRewardsShort(rewards: EncounterRewards): string {
  const parts: string[] = [];
  if (rewards.xp) {
    parts.push(`XP ${rewards.xp}`);
  }
  if (rewards.gold) {
    parts.push(`Gold ${rewards.gold}`);
  }
  const materials = Object.entries(rewards.materials ?? {})
    .map(([id, qty]) => `${id} x${qty}`)
    .join(", ");
  if (materials) {
    parts.push(materials);
  }
  const eq = formatEquipmentList(rewards);
  if (eq) {
    parts.push(`Eq: ${eq}`);
  }
  const aug = formatAugmentList(rewards);
  if (aug) {
    parts.push(`Aug: ${aug}`);
  }
  return parts.length ? parts.join("; ") : "-";
}
