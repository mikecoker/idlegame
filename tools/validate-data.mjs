#!/usr/bin/env node
import { promises as fs } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { z } from "zod";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

const HERO_MANIFEST_PATH = "assets/data/heroes/manifest.json";
const ENEMY_MANIFEST_PATH = "assets/data/enemies/manifest.json";
const PROGRESSION_PATH = "assets/data/encounters/progression.json";
const PROGRESSION_CONFIG_PATH = "assets/data/progression/config.json";
const LOOT_MANIFEST_PATH = "assets/data/loot/manifest.json";

const ZHeroManifest = z.object({
  presets: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1).optional(),
        path: z.string().min(1),
      })
    )
    .min(1, "At least one hero preset must be defined"),
});

const ZEnemyManifest = z.object({
  tiers: z.record(
    z.array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1).optional(),
        path: z.string().min(1),
      })
    )
  ),
});

const ZStageComposition = z.record(z.number().int().nonnegative());

const ZStageDefinition = z.object({
  name: z.string().min(1).optional(),
  waves: z.number().int().positive().optional(),
  composition: z.array(ZStageComposition).optional(),
  lootTable: z.string().min(1).optional(),
  finalBoss: ZStageComposition.optional(),
});

const ZProgressionManifest = z.object({
  stages: z.array(ZStageDefinition).min(1, "At least one stage must be defined"),
});

const ZScalingFormula = z.object({
  base: z.number().min(0),
  exponent: z.number().positive().optional(),
  perStage: z.number().min(0).optional(),
});

const ZEnemiesPerWave = z.object({
  base: z.number().int().positive(),
  perFiveStages: z.number().int().nonnegative(),
});

const ZEnemyScalingConfig = z.object({
  hp: ZScalingFormula,
  attack: ZScalingFormula,
  defense: ZScalingFormula,
  speed: ZScalingFormula,
});

const ZBossConfig = z.object({
  hp: ZScalingFormula,
  attack: ZScalingFormula,
  defense: ZScalingFormula,
  speed: z.number().positive(),
  timerSeconds: z.number().positive(),
  enrage: z.object({
    hpPercent: z.number().min(0).max(1),
    attackMultiplier: z.number().min(1),
  }),
});

const ZRewardScaling = z.object({
  gold: ZScalingFormula,
  xp: ZScalingFormula,
});

const ZBossRewardScaling = z.object({
  gold: ZScalingFormula,
  shards: ZScalingFormula,
  gemChance: ZScalingFormula,
});

const ZLootRouting = z.object({
  default: z.string().min(1),
  thresholds: z
    .array(
      z.object({
        stage: z.number().int().positive(),
        table: z.string().min(1),
      })
    )
    .optional(),
});

const ZProgressionConfig = z.object({
  wavesPerStage: z.number().int().positive(),
  enemiesPerWave: ZEnemiesPerWave,
  enemyScaling: ZEnemyScalingConfig,
  boss: ZBossConfig,
  rewards: z.object({
    enemy: ZRewardScaling,
    boss: ZBossRewardScaling,
  }),
  lootTables: ZLootRouting,
  firstClearBonusPercent: z.number().min(0).max(0.5).optional(),
});

const ZLootManifest = z.object({
  tables: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1).optional(),
        path: z.string().min(1),
      })
    )
    .min(1, "At least one loot table must be declared"),
});

const ZLootTable = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  xpPerWin: z.number().nonnegative().optional(),
  gold: z
    .object({
      min: z.number().nonnegative(),
      max: z.number().nonnegative().optional(),
    })
    .optional(),
  materialDrops: z
    .array(
      z.object({
        id: z.string().min(1),
        chance: z.number().min(0).max(1),
        min: z.number().int().nonnegative().optional(),
        max: z.number().int().nonnegative().optional(),
      })
    )
    .optional(),
  equipmentDrops: z
    .array(
      z.object({
        itemId: z.string().min(1),
        chance: z.number().min(0).max(1),
        min: z.number().int().nonnegative().optional(),
        max: z.number().int().nonnegative().optional(),
        rarityWeights: z.record(z.string(), z.number().nonnegative()).optional(),
      })
    )
    .optional(),
  augmentDrops: z
    .array(
      z.object({
        augmentId: z.string().min(1),
        chance: z.number().min(0).max(1),
        min: z.number().int().nonnegative().optional(),
        max: z.number().int().nonnegative().optional(),
      })
    )
    .optional(),
});

async function loadJson(relativePath) {
  const fullPath = resolve(projectRoot, relativePath);
  const raw = await fs.readFile(fullPath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse JSON in ${relativePath}: ${err.message}`);
  }
}

async function validateHeroManifest() {
  const data = await loadJson(HERO_MANIFEST_PATH);
  const manifest = ZHeroManifest.parse(data);
  await Promise.all(
    manifest.presets.map(async (preset) => {
      try {
        await loadJson(preset.path);
      } catch (err) {
        throw new Error(`Preset '${preset.id}' references missing file ${preset.path}: ${err.message}`);
      }
    })
  );
  return `Validated ${manifest.presets.length} hero presets.`;
}

async function validateEnemyManifest() {
  const data = await loadJson(ENEMY_MANIFEST_PATH);
  const manifest = ZEnemyManifest.parse(data);
  let count = 0;
  for (const [tier, entries] of Object.entries(manifest.tiers)) {
    for (const entry of entries) {
      try {
        await loadJson(entry.path);
        count += 1;
      } catch (err) {
        throw new Error(`Enemy '${entry.id}' in tier '${tier}' references missing file ${entry.path}: ${err.message}`);
      }
    }
  }
  return `Validated ${count} enemy templates across ${Object.keys(manifest.tiers).length} tiers.`;
}

async function validateProgression() {
  const data = await loadJson(PROGRESSION_PATH);
  const progression = ZProgressionManifest.parse(data);
  return `Validated ${progression.stages.length} stage definitions.`;
}

async function validateLootTables() {
  const manifest = ZLootManifest.parse(await loadJson(LOOT_MANIFEST_PATH));
  let validated = 0;
  for (const entry of manifest.tables) {
    const table = ZLootTable.parse(await loadJson(entry.path));
    if (!table.id) {
      throw new Error(`Loot table at ${entry.path} is missing an 'id'.`);
    }
    validated += 1;
  }
  return `Validated ${validated} loot tables.`;
}

async function validateProgressionConfig() {
  const data = await loadJson(PROGRESSION_CONFIG_PATH);
  const config = ZProgressionConfig.parse(data);
  if (config.lootTables.thresholds) {
    const sorted = [...config.lootTables.thresholds].sort((a, b) => a.stage - b.stage);
    for (let i = 0; i < sorted.length; i += 1) {
      if (sorted[i] !== config.lootTables.thresholds[i]) {
        throw new Error("Progression loot thresholds must be sorted by ascending stage");
      }
    }
  }
  return `Validated progression config: waves=${config.wavesPerStage}, first clear bonus=${(config.firstClearBonusPercent ?? 0) * 100}%`;
}

async function main() {
  const tasks = [
    ["Hero manifest", validateHeroManifest],
    ["Enemy manifest", validateEnemyManifest],
    ["Stage progression", validateProgression],
    ["Progression config", validateProgressionConfig],
    ["Loot tables", validateLootTables],
  ];

  const results = [];
  for (const [label, task] of tasks) {
    try {
      const message = await task();
      results.push({ label, status: "ok", message });
    } catch (err) {
      results.push({ label, status: "error", message: err.message });
      process.exitCode = 1;
    }
  }

  const longest = Math.max(...results.map((entry) => entry.label.length));
  results.forEach((entry) => {
    const status = entry.status === "ok" ? "✅" : "❌";
    const padded = `${entry.label}`.padEnd(longest + 2, " ");
    console.log(`${status} ${padded}${entry.message}`);
  });
}

main().catch((err) => {
  console.error("Unhandled validation error", err);
  process.exitCode = 1;
});
