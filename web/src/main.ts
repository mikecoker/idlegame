import { CombatSim } from "../../assets/game/combatsim";
import {
  Character,
  CharacterData,
  CharacterProgressSnapshot,
} from "../../assets/game/character";
import {
  EncounterEvent,
  EncounterLoop,
  EncounterSummary,
  EncounterRewardConfig,
  EncounterRewards,
} from "../../assets/game/encounter";

const BASE_STAT_KEYS = [
  "strength",
  "agility",
  "dexterity",
  "stamina",
  "intelligence",
  "wisdom",
  "charisma",
  "defense",
] as const;

const DERIVED_STAT_KEYS = [
  "baseHitpoints",
  "baseMana",
  "attackPerStr",
  "accPerStr",
  "evaPerAgi",
  "dexPerCrit",
  "acPerDef",
  "hpPerStamina",
  "manaPerIntOrWis",
  "baseDodge",
  "dodgePerAgi",
  "baseParry",
  "parryPerDex",
  "baseAttackDelay",
  "minAttackDelay",
  "attackDelayReductionPerAgi",
] as const;

type CombatantRole = "source" | "target";

type BaseStatKey = (typeof BASE_STAT_KEYS)[number];
type DerivedStatKey = (typeof DERIVED_STAT_KEYS)[number];
type BaseStatsShape = { [K in BaseStatKey]: number };
type DerivedStatsShape = { [K in DerivedStatKey]: number };
type CharacterDataShape = {
  baseStats: BaseStatsShape;
  derivedStats: DerivedStatsShape;
};

interface Preset {
  id: string;
  label: string;
  data: CharacterData;
}

interface PresetManifestEntry {
  id: string;
  label: string;
  path: string;
}

interface LootTableManifestEntry {
  id: string;
  label: string;
  path: string;
}

interface LootTableFileData {
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

interface LootTableRecord {
  id: string;
  label: string;
  config: EncounterRewardConfig;
}

interface CombatTelemetry {
  attempts: number;
  hits: number;
  crits: number;
  misses: number;
  dodges: number;
  parries: number;
  totalDamage: number;
}

interface PersistedState {
  version: number;
  tickInterval: number;
  sourcePresetId: string;
  targetPresetId: string;
  lootTableId?: string;
  totalRewards: EncounterRewards;
  lastRewards?: EncounterRewards;
  rewardConfig?: EncounterRewardConfig;
  customSource?: CharacterData;
  customTarget?: CharacterData;
  sourceProgress?: CharacterProgressSnapshot;
  targetProgress?: CharacterProgressSnapshot;
  timestamp: number;
}

const DERIVED_DEFAULTS: Record<DerivedStatKey, number> = {
  baseHitpoints: 10,
  baseMana: 10,
  attackPerStr: 5,
  accPerStr: 2,
  evaPerAgi: 2,
  dexPerCrit: 5,
  acPerDef: 10,
  hpPerStamina: 4,
  manaPerIntOrWis: 4,
  baseDodge: 5,
  dodgePerAgi: 0.2,
  baseParry: 2,
  parryPerDex: 0.1,
  baseAttackDelay: 2,
  minAttackDelay: 0.6,
  attackDelayReductionPerAgi: 0,
};

const DEFAULT_REWARD_CONFIG: EncounterRewardConfig = {
  xpPerWin: 25,
  goldMin: 3,
  goldMax: 10,
  materialDrops: [
    { id: "iron-ore", chance: 0.4, min: 1, max: 3 },
    { id: "leather", chance: 0.25, min: 1, max: 2 },
  ],
};

const STORAGE_KEY = "idle-eq-harness-state-v1";
const OFFLINE_BATCH_SECONDS = 30;
const OFFLINE_BATCH_LIMIT = 200;

function createTelemetryBucket(): CombatTelemetry {
  return {
    attempts: 0,
    hits: 0,
    crits: 0,
    misses: 0,
    dodges: 0,
    parries: 0,
    totalDamage: 0,
  };
}

class SimulatorHarness {
  protected presets: Preset[] = [];
  protected sim = new CombatSim();
  protected encounter: EncounterLoop | null = null;
  protected srcChar: Character | null = null;
  protected dstChar: Character | null = null;
  protected running = false;
  protected rafHandle: number | null = null;
  protected lastTimestamp = 0;
  protected summary: EncounterSummary | null = null;
  protected tickInterval = 0.1;
  protected logLines: string[] = [];
  protected telemetry: Record<CombatantRole, CombatTelemetry> = {
    source: createTelemetryBucket(),
    target: createTelemetryBucket(),
  };
  protected rewardConfig: EncounterRewardConfig = { ...DEFAULT_REWARD_CONFIG };
  protected lastRewards: EncounterRewards = this.createEmptyRewards();
  protected totalRewards: EncounterRewards = this.createEmptyRewards();
  protected rewardClaimed = false;
  protected lootTables: LootTableRecord[] = [];
  protected selectedLootTableId: string | null = null;
  protected pendingProgress: {
    source?: CharacterProgressSnapshot;
    target?: CharacterProgressSnapshot;
  } = {};
  protected pendingOfflineSeconds = 0;
  protected skipNextRewardReset = false;
  protected customEditors: Record<
    CombatantRole,
    {
      textarea: HTMLTextAreaElement | null;
      error: HTMLElement | null;
      loadButton: HTMLButtonElement | null;
      applyButton: HTMLButtonElement | null;
    }
  > = {
    source: { textarea: null, error: null, loadButton: null, applyButton: null },
    target: { textarea: null, error: null, loadButton: null, applyButton: null },
  };

  async init() {
    this.setStatusMessage("Loading presets...");
    this.presets = await this.loadPresets();
    this.lootTables = await this.loadLootTables();
    this.populatePresetSelect("source-select");
    this.populatePresetSelect("target-select");
    this.populateLootSelect();
    this.setupCustomEditors();
    this.restoreState();
    this.syncTickInput();
    this.bindControls();
    this.resetEncounter();
    this.renderStatsTable();
    this.renderTelemetry();
    this.refreshStatus(true);
    this.persistState();
  }

  protected async loadPresets(): Promise<Preset[]> {
    try {
      const manifestResponse = await fetch("./dist/assets/presets.json", {
        cache: "no-cache",
      });
      if (!manifestResponse.ok) {
        throw new Error(`${manifestResponse.status} ${manifestResponse.statusText}`);
      }

      const manifest = (await manifestResponse.json()) as PresetManifestEntry[];
      const results: Preset[] = [];

      for (const entry of manifest) {
        try {
          const presetResponse = await fetch(`./${entry.path}`, {
            cache: "no-cache",
          });
          if (!presetResponse.ok) {
            throw new Error(`${presetResponse.status} ${presetResponse.statusText}`);
          }
          const data = (await presetResponse.json()) as CharacterData;
          results.push({ id: entry.id, label: entry.label, data });
        } catch (err) {
          console.error(
            `Failed to load preset '${entry.id}' from ${entry.path}:`,
            err
          );
        }
      }

      if (!results.length) {
        this.setStatusMessage("No presets found.");
      }

      return results;
    } catch (err) {
      console.error("Failed to load preset manifest", err);
      this.setStatusMessage("Failed to load preset manifest.");
      return [];
    }
  }

  protected async loadLootTables(): Promise<LootTableRecord[]> {
    try {
      const response = await fetch("./dist/assets/data/loot/manifest.json", {
        cache: "no-cache",
      });
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }

      const manifest = (await response.json()) as {
        tables: LootTableManifestEntry[];
      };
      const tables: LootTableRecord[] = [];

      for (const entry of manifest.tables ?? []) {
        try {
          const tableResponse = await fetch(`./${entry.path}`, {
            cache: "no-cache",
          });
          if (!tableResponse.ok) {
            throw new Error(
              `${tableResponse.status} ${tableResponse.statusText}`
            );
          }
          const fileData = (await tableResponse.json()) as LootTableFileData;
          tables.push({
            id: entry.id,
            label: entry.label ?? fileData.name ?? entry.id,
            config: this.mapLootFileToConfig(fileData),
          });
        } catch (err) {
          console.warn(`Failed to load loot table '${entry.id}'`, err);
        }
      }

      return tables.length
        ? tables
        : [
            {
              id: "default",
              label: "Default",
              config: { ...DEFAULT_REWARD_CONFIG },
            },
          ];
    } catch (err) {
      console.warn("[Harness] Failed to load loot manifest", err);
      return [
        {
          id: "default",
          label: "Default",
          config: { ...DEFAULT_REWARD_CONFIG },
        },
      ];
    }
  }

  protected bindControls() {
    const startBtn = document.getElementById("start-button") as
      | HTMLButtonElement
      | null;
    const pauseBtn = document.getElementById("pause-button") as
      | HTMLButtonElement
      | null;
    const resetBtn = document.getElementById("reset-button") as
      | HTMLButtonElement
      | null;
    const tickInput = document.getElementById("tick-input") as HTMLInputElement | null;
    const sourceSelect = this.getSelect("source-select");
    const targetSelect = this.getSelect("target-select");
    const lootSelect = document.getElementById("loot-select") as
      | HTMLSelectElement
      | null;

    startBtn?.addEventListener("click", () => {
      this.start();
    });

    pauseBtn?.addEventListener("click", () => {
      this.pause();
    });

    resetBtn?.addEventListener("click", () => {
      this.resetEncounter();
      this.renderStatsTable();
      this.renderTelemetry();
      this.refreshStatus(true);
      this.persistState();
    });

    tickInput?.addEventListener("change", () => {
      const value = Math.max(0.01, parseFloat(tickInput.value) || this.tickInterval);
      this.tickInterval = value;
      tickInput.value = value.toFixed(2);
      if (this.encounter) {
        this.encounter.setTickInterval(value);
      }
      this.persistState();
    });

    sourceSelect?.addEventListener("change", () => {
      this.loadEditorFromSelection("source");
      this.resetEncounter();
      this.renderStatsTable();
      this.renderTelemetry();
      this.refreshStatus(true);
      this.persistState();
    });

    targetSelect?.addEventListener("change", () => {
      this.loadEditorFromSelection("target");
      this.resetEncounter();
      this.renderStatsTable();
      this.renderTelemetry();
      this.refreshStatus(true);
      this.persistState();
    });

    lootSelect?.addEventListener("change", () => {
      const selected = lootSelect.value;
      this.selectLootTable(selected);
      this.resetEncounter();
      this.refreshStatus(true);
    });
  }

  protected setupCustomEditors() {
    ( ["source", "target"] as CombatantRole[] ).forEach((role) => {
      const refs = this.customEditors[role];
      refs.textarea = document.getElementById(
        `${role}-custom-json`
      ) as HTMLTextAreaElement | null;
      refs.error = document.getElementById(
        `${role}-custom-error`
      ) as HTMLElement | null;
      refs.loadButton = document.getElementById(
        `${role}-load-current`
      ) as HTMLButtonElement | null;
      refs.applyButton = document.getElementById(
        `${role}-apply-custom`
      ) as HTMLButtonElement | null;

      refs.loadButton?.addEventListener("click", () => {
        this.loadEditorFromSelection(role);
      });

      refs.applyButton?.addEventListener("click", () => {
        this.applyCustomPreset(role);
      });

      refs.textarea?.addEventListener("input", () => {
        this.clearEditorError(role);
      });
    });

    this.loadEditorFromSelection("source");
    this.loadEditorFromSelection("target");
  }

  protected loadEditorFromSelection(role: CombatantRole) {
    const refs = this.customEditors[role];
    if (!refs.textarea) {
      return;
    }

    const selectId = role === "source" ? "source-select" : "target-select";
    const select = this.getSelect(selectId);
    const preset = this.getPresetById(select?.value ?? null);

    if (!preset) {
      refs.textarea.value = '{"baseStats":{},"derivedStats":{}}';
      return;
    }

    refs.textarea.value = JSON.stringify(preset.data, null, 2);
    this.clearEditorError(role);
  }

  protected applyCustomPreset(role: CombatantRole) {
    const refs = this.customEditors[role];
    if (!refs.textarea) {
      return;
    }

    const raw = refs.textarea.value.trim();
    if (!raw) {
      this.setEditorError(role, "Provide CharacterData JSON.");
      return;
    }

    try {
      const parsed = JSON.parse(raw);
      const normalized = this.normalizeCharacterData(parsed);
      const presetId = role === "source" ? "custom-source" : "custom-target";
      const presetLabel = role === "source" ? "Custom Source" : "Custom Target";
      const preset: Preset = {
        id: presetId,
        label: presetLabel,
        data: this.cloneData(normalized),
      };

      const currentSelections = {
        source: this.getSelect("source-select")?.value ?? null,
        target: this.getSelect("target-select")?.value ?? null,
      };

      this.ensurePresetListContains(preset);

      this.populatePresetSelect(
        "source-select",
        role === "source" ? presetId : currentSelections.source ?? undefined
      );
      this.populatePresetSelect(
        "target-select",
        role === "target" ? presetId : currentSelections.target ?? undefined
      );

      this.setSelectValue(role === "source" ? "source-select" : "target-select", presetId);
      this.loadEditorFromSelection(role);

      this.resetEncounter();
      this.renderStatsTable();
      this.renderTelemetry();
      this.refreshStatus(true);
      this.clearEditorError(role);
      this.persistState();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to parse preset.";
      this.setEditorError(role, message);
    }
  }

  protected normalizeCharacterData(raw: unknown): CharacterData {
    if (!raw || typeof raw !== "object") {
      throw new Error("Preset must be an object containing baseStats and derivedStats.");
    }

    const baseSource = (raw as Record<string, unknown>).baseStats as
      | Record<string, unknown>
      | undefined;
    const derivedSource = (raw as Record<string, unknown>).derivedStats as
      | Record<string, unknown>
      | undefined;

    if (!baseSource || typeof baseSource !== "object") {
      throw new Error("Missing baseStats block.");
    }

    if (!derivedSource || typeof derivedSource !== "object") {
      throw new Error("Missing derivedStats block.");
    }

    const baseStats = {} as BaseStatsShape;
    BASE_STAT_KEYS.forEach((key) => {
      const value = Number(baseSource[key] ?? 0);
      if (!Number.isFinite(value)) {
        throw new Error(`baseStats.${key} must be a number.`);
      }
      baseStats[key] = value;
    });

    const derivedStats = {} as DerivedStatsShape;
    DERIVED_STAT_KEYS.forEach((key) => {
      const sourceValue =
        derivedSource[key] !== undefined ? derivedSource[key] : DERIVED_DEFAULTS[key];
      const value = Number(sourceValue);
      if (!Number.isFinite(value)) {
        throw new Error(`derivedStats.${key} must be a number.`);
      }
      derivedStats[key] = value;
    });

    const result: CharacterDataShape = {
      baseStats,
      derivedStats,
    };
    return result as CharacterData;
  }

  protected ensurePresetListContains(preset: Preset) {
    const index = this.presets.findIndex((p) => p.id === preset.id);
    if (index >= 0) {
      this.presets[index] = preset;
    } else {
      this.presets.push(preset);
    }
    this.presets.sort((a, b) => a.label.localeCompare(b.label));
  }

  protected getPresetById(id: string | null | undefined): Preset | undefined {
    if (!id) {
      return undefined;
    }
    return this.presets.find((preset) => preset.id === id);
  }

  protected populatePresetSelect(selectId: string, desiredId?: string) {
    const select = this.getSelect(selectId);
    if (!select) {
      return;
    }

    const previous = desiredId ?? select.value ?? "";
    select.innerHTML = "";

    if (!this.presets.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No presets";
      select.appendChild(option);
      select.disabled = true;
      return;
    }

    let matched = false;
    this.presets.forEach((preset) => {
      const option = document.createElement("option");
      option.value = preset.id;
      option.textContent = preset.label;
      if (!matched && preset.id === previous) {
        option.selected = true;
        matched = true;
      }
      select.appendChild(option);
    });

    if (!matched) {
      select.selectedIndex = 0;
    }

    select.disabled = false;
  }

  protected populateLootSelect(desiredId?: string) {
    const select = document.getElementById("loot-select") as HTMLSelectElement | null;
    if (!select) {
      return;
    }

    select.innerHTML = "";
    if (!this.lootTables.length) {
      const option = document.createElement("option");
      option.value = "default";
      option.textContent = "Default";
      select.appendChild(option);
      select.disabled = true;
      this.selectLootTable("default", { persist: false });
      return;
    }

    select.disabled = false;
    let matched = false;
    const targetId = desiredId ?? this.selectedLootTableId ?? this.lootTables[0].id;

    this.lootTables.forEach((table) => {
      const option = document.createElement("option");
      option.value = table.id;
      option.textContent = table.label;
      if (!matched && table.id === targetId) {
        option.selected = true;
        matched = true;
      }
      select.appendChild(option);
    });

    if (!matched) {
      select.selectedIndex = 0;
    }

    const selected = select.value;
    this.selectLootTable(selected, { persist: false });
  }

  protected getSelect(selectId: string): HTMLSelectElement | null {
    return document.getElementById(selectId) as HTMLSelectElement | null;
  }

  protected setSelectValue(selectId: string, value: string | null) {
    if (!value) {
      return;
    }
    const select = this.getSelect(selectId);
    if (!select) {
      return;
    }
    select.value = value;
    if (select.value !== value && select.options.length) {
      select.selectedIndex = 0;
    }
  }

  protected start() {
    if (!this.encounter) {
      return;
    }
    this.encounter.setTickInterval(this.tickInterval);
    this.encounter.start();
    this.running = true;
    this.lastTimestamp = performance.now();
    if (this.rafHandle === null) {
      this.rafHandle = requestAnimationFrame(this.onFrame);
    }
  }

  protected pause() {
    if (!this.encounter) {
      return;
    }
    this.encounter.stop();
    this.running = false;
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
  }

  protected onFrame = (time: number) => {
    if (!this.encounter || !this.running) {
      this.rafHandle = null;
      return;
    }

    const delta = (time - this.lastTimestamp) / 1000;
    this.lastTimestamp = time;

    const events: EncounterEvent[] = this.encounter.tick(delta);
    if (events.length) {
      events.forEach((event) => {
        this.recordTelemetry(event);
        const attacker = event.attacker === this.srcChar ? "Source" : "Target";
        const defender = event.defender === this.srcChar ? "Source" : "Target";
        const stamp = event.timestamp.toFixed(2);
        const handLabel = event.hand === "main" ? "main" : "off";
        switch (event.result) {
          case "miss":
            this.pushLog(
              `[${stamp}s][${handLabel}] ${attacker} swings at ${defender} and misses.`
            );
            break;
          case "dodge":
            this.pushLog(
              `[${stamp}s][${handLabel}] ${defender} dodges ${attacker}.`
            );
            break;
          case "parry":
            this.pushLog(
              `[${stamp}s][${handLabel}] ${defender} parries ${attacker}.`
            );
            break;
          case "hit":
          default: {
            const dmg = Math.round(event.damage);
            const crit = event.critical ? " CRIT!" : "";
            this.pushLog(
              `[${stamp}s][${handLabel}] ${attacker} hits ${defender} for ${dmg}.${crit}`
            );
            break;
          }
        }
      });
      this.renderStatsTable();
      this.flushLogs();
      this.renderTelemetry();
    }

    this.summary = this.encounter.getSummary();
    this.refreshStatus();
    this.claimRewardsIfReady();

    if (this.encounter.isComplete) {
      this.running = false;
      this.rafHandle = null;
      return;
    }

    this.rafHandle = requestAnimationFrame(this.onFrame);
  };

  protected resetEncounter() {
    const sourceSelect = this.getSelect("source-select");
    const targetSelect = this.getSelect("target-select");

    const srcPreset =
      this.getPresetById(sourceSelect?.value ?? null) ?? this.presets[0] ?? null;
    const dstPreset =
      this.getPresetById(targetSelect?.value ?? null) ?? this.presets[1] ?? this.presets[0] ?? null;

    if (!srcPreset || !dstPreset) {
      this.srcChar = null;
      this.dstChar = null;
      this.encounter = null;
      this.summary = null;
      this.resetTelemetry();
      this.logLines = [];
      this.flushLogs();
      return;
    }

    const srcData = this.cloneData(srcPreset.data);
    const dstData = this.cloneData(dstPreset.data);

    this.srcChar = new Character(srcData);
    this.dstChar = new Character(dstData);
    this.srcChar.resetVitals();
    this.dstChar.resetVitals();

    this.encounter = new EncounterLoop(this.sim, this.srcChar, this.dstChar, {
      tickInterval: this.tickInterval,
      rewardConfig: this.rewardConfig,
    });

    if (this.pendingProgress.source && this.srcChar) {
      this.srcChar.restoreProgress(this.pendingProgress.source);
    }
    if (this.pendingProgress.target && this.dstChar) {
      this.dstChar.restoreProgress(this.pendingProgress.target);
    }
    this.pendingProgress = {};

    this.summary = this.encounter.getSummary();
    this.logLines = [];
    this.flushLogs();
    this.pause();
    this.resetTelemetry();
    this.rewardClaimed = false;
    if (this.skipNextRewardReset) {
      this.skipNextRewardReset = false;
    } else {
      this.lastRewards = this.createEmptyRewards();
    }
    this.renderRewards();
    this.applyOfflineRewardsIfAny();
    this.persistState();
  }

  protected recordTelemetry(event: EncounterEvent) {
    const role: CombatantRole =
      event.attacker === this.srcChar
        ? "source"
        : event.attacker === this.dstChar
        ? "target"
        : "source";

    const bucket = this.telemetry[role];
    bucket.attempts += 1;

    switch (event.result) {
      case "hit":
        bucket.hits += 1;
        bucket.totalDamage += Math.max(0, event.damage);
        if (event.critical) {
          bucket.crits += 1;
        }
        break;
      case "miss":
        bucket.misses += 1;
        break;
      case "dodge":
        bucket.dodges += 1;
        break;
      case "parry":
        bucket.parries += 1;
        break;
    }
  }

  protected resetTelemetry() {
    this.telemetry.source = createTelemetryBucket();
    this.telemetry.target = createTelemetryBucket();
    this.renderTelemetry();
  }

  protected renderTelemetry() {
    const table = document.getElementById("telemetry-table");
    if (!table) {
      return;
    }

    const src = this.telemetry.source;
    const dst = this.telemetry.target;

    const metrics = [
      {
        label: "Attempts",
        source: `${src.attempts}`,
        target: `${dst.attempts}`,
      },
      {
        label: "Hits",
        source: this.formatCountWithRate(src.hits, src.attempts),
        target: this.formatCountWithRate(dst.hits, dst.attempts),
      },
      {
        label: "Crits",
        source: this.formatCountWithRate(src.crits, src.hits),
        target: this.formatCountWithRate(dst.crits, dst.hits),
      },
      {
        label: "Misses",
        source: this.formatCountWithRate(src.misses, src.attempts),
        target: this.formatCountWithRate(dst.misses, dst.attempts),
      },
      {
        label: "Dodges",
        source: this.formatCountWithRate(src.dodges, src.attempts),
        target: this.formatCountWithRate(dst.dodges, dst.attempts),
      },
      {
        label: "Parries",
        source: this.formatCountWithRate(src.parries, src.attempts),
        target: this.formatCountWithRate(dst.parries, dst.attempts),
      },
      {
        label: "Average Hit",
        source: this.formatAverage(src.totalDamage, src.hits),
        target: this.formatAverage(dst.totalDamage, dst.hits),
      },
      {
        label: "Total Damage",
        source: Math.round(src.totalDamage).toString(),
        target: Math.round(dst.totalDamage).toString(),
      },
    ];

    table.innerHTML = "";
    metrics.forEach((metric) => {
      const row = document.createElement("tr");
      const header = document.createElement("th");
      header.textContent = metric.label;
      const sourceCell = document.createElement("td");
      sourceCell.textContent = metric.source;
      const targetCell = document.createElement("td");
      targetCell.textContent = metric.target;
      row.appendChild(header);
      row.appendChild(sourceCell);
      row.appendChild(targetCell);
      table.appendChild(row);
    });
  }

  protected claimRewardsIfReady() {
    if (this.rewardClaimed || !this.summary) {
      return;
    }
    if (this.summary.victor !== "source") {
      return;
    }

    const rewards = this.summary.rewards;
    this.lastRewards = {
      xp: rewards.xp,
      gold: rewards.gold,
      materials: { ...rewards.materials },
    };

    this.totalRewards.xp += rewards.xp;
    this.totalRewards.gold += rewards.gold;
    Object.entries(rewards.materials).forEach(([id, qty]) => {
      this.totalRewards.materials[id] =
        (this.totalRewards.materials[id] ?? 0) + qty;
    });

    if (this.srcChar && rewards.xp > 0) {
      const levels = this.srcChar.addExperience(rewards.xp);
      if (levels > 0) {
        this.renderStatsTable();
      }
    }

    this.rewardClaimed = true;
    this.renderRewards();
    this.persistState();
  }

  protected renderRewards() {
    const table = document.getElementById("reward-table");
    if (!table) {
      return;
    }

    const materialLast = this.formatMaterials(this.lastRewards.materials);
    const materialTotal = this.formatMaterials(this.totalRewards.materials);

    const rows = [
      {
        label: "XP",
        last: this.lastRewards.xp.toString(),
        total: this.totalRewards.xp.toString(),
      },
      {
        label: "Gold",
        last: this.lastRewards.gold.toString(),
        total: this.totalRewards.gold.toString(),
      },
      {
        label: "Materials",
        last: materialLast.length ? materialLast : "-",
        total: materialTotal.length ? materialTotal : "-",
      },
    ];

    table.innerHTML = "";
    rows.forEach((row) => {
      const tr = document.createElement("tr");
      const label = document.createElement("th");
      label.textContent = row.label;
      const lastTd = document.createElement("td");
      lastTd.textContent = row.last;
      const totalTd = document.createElement("td");
      totalTd.textContent = row.total;
      tr.appendChild(label);
      tr.appendChild(lastTd);
      tr.appendChild(totalTd);
      table.appendChild(tr);
    });
  }

  protected refreshStatus(force = false) {
    const statusNode = document.getElementById("status-text");
    const elapsedCell = document.getElementById("elapsed-cell");
    const swingsCell = document.getElementById("swings-cell");
    const srcDmgCell = document.getElementById("src-dmg-cell");
    const dstDmgCell = document.getElementById("dst-dmg-cell");
    const winnerCell = document.getElementById("winner-cell");

    const summary = this.summary;
    if (!summary) {
      if (statusNode && (force || statusNode.textContent !== "Idle")) {
        statusNode.textContent = "Idle";
      }
      return;
    }

    const runningState = this.encounter?.isRunning ?? false;
    if (statusNode) {
      let text = runningState ? "Running" : "Paused";
      if (summary.victor) {
        text = `Completed (${summary.victor})`;
      }
      const content = `${text} • tick ${this.tickInterval.toFixed(2)}s`;
      if (force || statusNode.textContent !== content) {
        statusNode.textContent = content;
      }
    }

    if (elapsedCell) elapsedCell.textContent = `${summary.elapsedSeconds.toFixed(2)}s`;
    if (swingsCell) swingsCell.textContent = `${summary.swings}`;
    if (srcDmgCell) srcDmgCell.textContent = `${summary.totalDamageFromSource}`;
    if (dstDmgCell) dstDmgCell.textContent = `${summary.totalDamageFromTarget}`;
    if (winnerCell) winnerCell.textContent = summary.victor ?? "-";

    const dpsSrc = summary.elapsedSeconds
      ? (summary.totalDamageFromSource / summary.elapsedSeconds).toFixed(2)
      : "-";
    const dpsDst = summary.elapsedSeconds
      ? (summary.totalDamageFromTarget / summary.elapsedSeconds).toFixed(2)
      : "-";

    const dpsRowId = "dps-row";
    let dpsRow = document.getElementById(dpsRowId);
    if (!dpsRow) {
      const tableBody = document.querySelector("#status-panel tbody");
      if (tableBody) {
        const row = document.createElement("tr");
        row.id = dpsRowId;
        const header = document.createElement("th");
        header.textContent = "DPS (src/dst)";
        const cell = document.createElement("td");
        row.appendChild(header);
        row.appendChild(cell);
        tableBody.appendChild(row);
        dpsRow = row;
      }
    }

    if (dpsRow) {
      const cell = dpsRow.lastElementChild as HTMLElement | null;
      if (cell) {
        cell.textContent = `${dpsSrc} / ${dpsDst}`;
      }
    }
  }

  protected renderStatsTable() {
    const table = document.getElementById("stats-table");
    if (!table) {
      return;
    }
    table.innerHTML = "";

    if (!this.srcChar || !this.dstChar) {
      const row = document.createElement("tr");
      const headerCell = document.createElement("th");
      headerCell.textContent = "Status";
      const messageCell = document.createElement("td");
      messageCell.colSpan = 2;
      messageCell.textContent = "No preset data loaded";
      row.appendChild(headerCell);
      row.appendChild(messageCell);
      table.appendChild(row);
      return;
    }

    const stats = this.collectStatNames();
    stats.forEach((statName) => {
      const row = document.createElement("tr");
      const statCell = document.createElement("th");
      statCell.textContent = statName;

      const srcValue = (this.srcChar as any)[statName];
      const dstValue = (this.dstChar as any)[statName];

      const srcCell = document.createElement("td");
      srcCell.textContent = this.formatStatValue(statName, srcValue);
      const dstCell = document.createElement("td");
      dstCell.textContent = this.formatStatValue(statName, dstValue);

      row.appendChild(statCell);
      row.appendChild(srcCell);
      row.appendChild(dstCell);
      table.appendChild(row);
    });
  }

  protected collectStatNames(): string[] {
    if (!this.srcChar) {
      return [];
    }
    const proto = Reflect.getPrototypeOf(this.srcChar);
    return Object.entries(Object.getOwnPropertyDescriptors(proto))
      .filter(([name, descriptor]) => typeof descriptor.get === "function" && name !== "__proto__")
      .map(([name]) => name)
      .sort();
  }

  protected formatStatValue(statName: string, value: unknown): string {
    if (value === undefined || value === null) {
      return "-";
    }

    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        return "-";
      }
      const lower = statName.toLowerCase();
      if (lower.includes("percent")) {
        return `${(value * 100).toFixed(1)}%`;
      }
      if (Math.abs(value) >= 10 && Number.isInteger(value)) {
        return value.toString();
      }
      if (Math.abs(value) < 1) {
        return value.toFixed(3);
      }
      return value.toFixed(2);
    }

    return `${value}`;
  }

  protected formatCountWithRate(count: number, denominator: number): string {
    if (denominator <= 0) {
      return `${count} (-)`;
    }
    return `${count} (${this.formatPercent(count, denominator)})`;
  }

  protected formatPercent(numerator: number, denominator: number): string {
    if (denominator <= 0) {
      return "-";
    }
    return `${((numerator / denominator) * 100).toFixed(1)}%`;
  }

  protected formatAverage(total: number, samples: number): string {
    if (samples <= 0) {
      return "-";
    }
    return (total / samples).toFixed(2);
  }

  protected formatMaterials(materials: Record<string, number>): string {
    return Object.entries(materials)
      .map(([id, qty]) => `${id} x${qty}`)
      .join(", ");
  }

  protected persistState() {
    if (!this.supportsStorage()) {
      return;
    }

    try {
      const state: PersistedState = {
        version: 1,
        tickInterval: this.tickInterval,
        sourcePresetId: this.getSelect("source-select")?.value ?? "",
        targetPresetId: this.getSelect("target-select")?.value ?? "",
        lootTableId: this.selectedLootTableId ?? undefined,
        totalRewards: this.cloneRewards(this.totalRewards),
        lastRewards: this.cloneRewards(this.lastRewards),
        rewardConfig: this.cloneRewardConfig(this.rewardConfig),
        customSource: this.getCustomPresetData("source"),
        customTarget: this.getCustomPresetData("target"),
        sourceProgress: this.srcChar?.serializeProgress(),
        targetProgress: this.dstChar?.serializeProgress(),
        timestamp: Date.now(),
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      console.warn("[Harness] Failed to persist state", err);
    }
  }

  protected restoreState() {
    const state = this.loadPersistedState();
    if (!state) {
      this.loadEditorFromSelection("source");
      this.loadEditorFromSelection("target");
      this.renderRewards();
      return;
    }

    this.tickInterval = Math.max(0.01, state.tickInterval ?? this.tickInterval);

    if (state.customSource) {
      this.injectCustomPreset("source", state.customSource);
    }
    if (state.customTarget) {
      this.injectCustomPreset("target", state.customTarget);
    }

    this.populatePresetSelect("source-select", state.sourcePresetId || undefined);
    this.populatePresetSelect("target-select", state.targetPresetId || undefined);
    this.populateLootSelect(state.lootTableId || undefined);

    if (state.rewardConfig) {
      this.rewardConfig = {
        ...this.rewardConfig,
        ...state.rewardConfig,
        materialDrops:
          state.rewardConfig.materialDrops ?? this.rewardConfig.materialDrops,
      };
    }

    if (state.customSource && this.customEditors.source.textarea) {
      this.customEditors.source.textarea.value = JSON.stringify(
        state.customSource,
        null,
        2
      );
    } else {
      this.loadEditorFromSelection("source");
    }

    if (state.customTarget && this.customEditors.target.textarea) {
      this.customEditors.target.textarea.value = JSON.stringify(
        state.customTarget,
        null,
        2
      );
    } else {
      this.loadEditorFromSelection("target");
    }

    this.totalRewards = this.cloneRewards(state.totalRewards);
    this.lastRewards = state.lastRewards
      ? this.cloneRewards(state.lastRewards)
      : this.createEmptyRewards();
    this.skipNextRewardReset = true;
    this.renderRewards();

    this.pendingProgress = {
      source: state.sourceProgress,
      target: state.targetProgress,
    };
    this.pendingOfflineSeconds = this.computeOfflineSeconds(state.timestamp);
  }

  protected supportsStorage(): boolean {
    try {
      return typeof window !== "undefined" && !!window.localStorage;
    } catch (err) {
      return false;
    }
  }

  protected loadPersistedState(): PersistedState | null {
    if (!this.supportsStorage()) {
      return null;
    }
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== 1) {
        return null;
      }
      return parsed as PersistedState;
    } catch (err) {
      console.warn("[Harness] Failed to load persisted state", err);
      return null;
    }
  }

  protected cloneRewards(rewards: EncounterRewards): EncounterRewards {
    return {
      xp: rewards?.xp ?? 0,
      gold: rewards?.gold ?? 0,
      materials: { ...(rewards?.materials ?? {}) },
    };
  }

  protected cloneRewardConfig(
    config: EncounterRewardConfig
  ): EncounterRewardConfig {
    return {
      xpPerWin: config.xpPerWin,
      goldMin: config.goldMin,
      goldMax: config.goldMax,
      materialDrops: config.materialDrops
        ? config.materialDrops.map((drop) => ({ ...drop }))
        : undefined,
    };
  }

  protected mapLootFileToConfig(data: LootTableFileData): EncounterRewardConfig {
    const materialDrops = (data.materialDrops ?? []).map((drop) => ({
      id: drop.id,
      chance: Number(drop.chance) || 0,
      min: Math.max(0, Math.floor(drop.min ?? 0)),
      max: Math.max(0, Math.floor(drop.max ?? drop.min ?? 0)),
    }));
    return {
      xpPerWin: Math.max(0, Math.floor(data.xpPerWin ?? 0)),
      goldMin: Math.max(0, Math.floor(data.gold?.min ?? 0)),
      goldMax: Math.max(0, Math.floor(data.gold?.max ?? data.gold?.min ?? 0)),
      materialDrops,
    };
  }

  protected getCustomPresetData(role: CombatantRole): CharacterData | undefined {
    const id = role === "source" ? "custom-source" : "custom-target";
    const preset = this.getPresetById(id);
    if (!preset) {
      return undefined;
    }
    return this.cloneData(preset.data);
  }

  protected injectCustomPreset(role: CombatantRole, data: CharacterData) {
    const preset: Preset = {
      id: role === "source" ? "custom-source" : "custom-target",
      label: role === "source" ? "Custom Source" : "Custom Target",
      data: this.cloneData(data),
    };
    this.ensurePresetListContains(preset);
  }

  protected computeOfflineSeconds(timestamp: number): number {
    const now = Date.now();
    if (!timestamp || timestamp > now) {
      return 0;
    }
    return (now - timestamp) / 1000;
  }

  protected applyOfflineRewardsIfAny() {
    if (!this.srcChar || this.pendingOfflineSeconds <= OFFLINE_BATCH_SECONDS) {
      this.pendingOfflineSeconds = 0;
      return;
    }

    const runs = Math.min(
      Math.floor(this.pendingOfflineSeconds / OFFLINE_BATCH_SECONDS),
      OFFLINE_BATCH_LIMIT
    );

    if (runs <= 0) {
      this.pendingOfflineSeconds = 0;
      return;
    }

    const aggregate = this.createEmptyRewards();
    aggregate.materials = {};

    for (let i = 0; i < runs; i++) {
      aggregate.xp += this.rewardConfig.xpPerWin ?? 0;
      aggregate.gold += this.randRangeInt(
        this.rewardConfig.goldMin ?? 0,
        this.rewardConfig.goldMax ?? (this.rewardConfig.goldMin ?? 0)
      );
      (this.rewardConfig.materialDrops ?? []).forEach((drop) => {
        if (Math.random() <= drop.chance) {
          const qty = this.randRangeInt(drop.min, drop.max);
          if (qty > 0) {
            aggregate.materials[drop.id] =
              (aggregate.materials[drop.id] ?? 0) + qty;
          }
        }
      });
    }

    this.totalRewards.xp += aggregate.xp;
    this.totalRewards.gold += aggregate.gold;
    Object.entries(aggregate.materials).forEach(([id, qty]) => {
      this.totalRewards.materials[id] =
        (this.totalRewards.materials[id] ?? 0) + qty;
    });

    if (aggregate.xp > 0) {
      const levels = this.srcChar.addExperience(aggregate.xp);
      if (levels > 0) {
        this.renderStatsTable();
      }
    }

    this.lastRewards = aggregate;
    this.rewardClaimed = true;
    this.renderRewards();
    this.pushLog(
      `[Offline] Awarded ${aggregate.xp} XP and ${aggregate.gold} gold (${runs} victories over ${Math.round(
        this.pendingOfflineSeconds
      )}s).`
    );

    this.pendingOfflineSeconds = 0;
    this.persistState();
  }

  protected randRangeInt(min: number, max: number): number {
    const low = Math.floor(Math.min(min, max));
    const high = Math.floor(Math.max(min, max));
    if (high <= low) {
      return Math.max(0, low);
    }
    return Math.floor(Math.random() * (high - low + 1)) + Math.max(0, low);
  }

  protected selectLootTable(id: string | null, options: { persist?: boolean } = {}) {
    if (!id && this.lootTables.length) {
      id = this.lootTables[0].id;
    }
    if (!id) {
      this.rewardConfig = { ...DEFAULT_REWARD_CONFIG };
      this.selectedLootTableId = null;
      if (options.persist !== false) {
        this.persistState();
      }
      return;
    }

    const record = this.lootTables.find((table) => table.id === id);
    if (!record) {
      this.rewardConfig = { ...DEFAULT_REWARD_CONFIG };
      this.selectedLootTableId = null;
      if (options.persist !== false) {
        this.persistState();
      }
      return;
    }

    this.rewardConfig = this.cloneRewardConfig(record.config);
    this.selectedLootTableId = record.id;

    const select = document.getElementById("loot-select") as HTMLSelectElement | null;
    if (select && select.value !== record.id) {
      select.value = record.id;
    }

    if (options.persist !== false) {
      this.persistState();
    }
  }

  protected pushLog(entry: string) {
    this.logLines.push(entry);
    if (this.logLines.length > 250) {
      this.logLines.splice(0, this.logLines.length - 250);
    }
  }

  protected flushLogs() {
    const logNode = document.getElementById("log-output");
    if (!logNode) {
      return;
    }
    logNode.textContent = this.logLines.join("\n");
    logNode.scrollTop = logNode.scrollHeight;
  }

  protected setStatusMessage(message: string) {
    const statusNode = document.getElementById("status-text");
    if (statusNode) {
      statusNode.textContent = message;
    }
  }

  protected setEditorError(role: CombatantRole, message: string) {
    const refs = this.customEditors[role];
    if (refs.error) {
      refs.error.textContent = message;
    }
  }

  protected clearEditorError(role: CombatantRole) {
    const refs = this.customEditors[role];
    if (refs.error) {
      refs.error.textContent = "";
    }
  }

  protected syncTickInput() {
    const tickInput = document.getElementById("tick-input") as HTMLInputElement | null;
    if (!tickInput) {
      return;
    }
    tickInput.value = this.tickInterval.toFixed(2);
  }

  protected cloneData<T>(data: T): T {
    return JSON.parse(JSON.stringify(data));
  }

  protected createEmptyRewards(): EncounterRewards {
    return {
      xp: 0,
      gold: 0,
      materials: {},
    };
  }
}

const harness = new SimulatorHarness();
window.addEventListener("DOMContentLoaded", () => {
  harness.init().catch((err) => {
    console.error("Failed to initialise simulator harness", err);
    const statusNode = document.getElementById("status-text");
    if (statusNode) {
      statusNode.textContent = "Failed to load presets";
    }
  });
});
