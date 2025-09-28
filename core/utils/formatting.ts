import { getRarityMultiplier, getUpgradeMultiplier } from "@core/items/ItemDefinition";
import type {
  EncounterRewards,
  RewardAugmentItem,
  RewardEquipmentItem,
} from "@core/combat/Encounter";
import type { ItemDefinition, OwnedEquipment } from "@core/items/ItemDefinition";

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
  const rarityMultiplier = getRarityMultiplier(owned.rarity);
  const upgradeMultiplier = getUpgradeMultiplier(owned.upgradeLevel);
  const totalMultiplier = rarityMultiplier * upgradeMultiplier;

  if (definition.type === "weapon" && definition.weapon) {
    const minDamage = Math.max(1, Math.round(definition.weapon.minDamage * totalMultiplier));
    const maxDamage = Math.max(minDamage, Math.round(definition.weapon.maxDamage * totalMultiplier));
    const delay = definition.weapon.delay;
    parts.push(`Damage ${minDamage}-${maxDamage} @ ${delay}s`);
  } else if (definition.type === "armor" && definition.armor) {
    const armor = Math.max(0, Math.round((definition.armor.armor ?? 0) * totalMultiplier));
    parts.push(`Armor ${armor}`);
  } else {
    parts.push(titleCase(definition.type));
  }
  if (owned.augments.length) {
    parts.push(`Augments: ${formatAugmentNames(owned.augments, resolver)}`);
  }
  return parts.join(" • ") || "-";
}

export function formatEquipmentRewards(list: RewardEquipmentItem[] = []): string {
  return list
    .map((entry) => `${entry.itemId} (${entry.rarity}) x${entry.quantity}`)
    .join(", ");
}

export function formatAugmentRewards(list: RewardAugmentItem[] = []): string {
  return list.map((entry) => `${entry.augmentId} x${entry.quantity}`).join(", ");
}

export function formatEquipmentList(rewards: EncounterRewards): string {
  return formatEquipmentRewards(rewards.equipment ?? []);
}

export function formatAugmentList(rewards: EncounterRewards): string {
  return formatAugmentRewards(rewards.augments ?? []);
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
  const equipment = formatEquipmentRewards(rewards.equipment ?? []);
  if (equipment) {
    parts.push(`Eq: ${equipment}`);
  }
  const augments = formatAugmentRewards(rewards.augments ?? []);
  if (augments) {
    parts.push(`Aug: ${augments}`);
  }
  return parts.length ? parts.join("; ") : "-";
}
