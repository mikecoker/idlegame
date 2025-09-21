import { CombatSim } from "../../assets/game/combatsim";
import { Character, CharacterData } from "../../assets/game/character";
import {
  EncounterEvent,
  EncounterLoop,
  EncounterSummary,
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

interface CombatTelemetry {
  attempts: number;
  hits: number;
  crits: number;
  misses: number;
  dodges: number;
  parries: number;
  totalDamage: number;
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
    this.populatePresetSelect("source-select");
    this.populatePresetSelect("target-select");
    this.setupCustomEditors();
    this.syncTickInput();
    this.bindControls();
    this.resetEncounter();
    this.renderStatsTable();
    this.renderTelemetry();
    this.refreshStatus(true);
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
    });

    tickInput?.addEventListener("change", () => {
      const value = Math.max(0.01, parseFloat(tickInput.value) || this.tickInterval);
      this.tickInterval = value;
      tickInput.value = value.toFixed(2);
      if (this.encounter) {
        this.encounter.setTickInterval(value);
      }
    });

    sourceSelect?.addEventListener("change", () => {
      this.loadEditorFromSelection("source");
      this.resetEncounter();
      this.renderStatsTable();
      this.renderTelemetry();
      this.refreshStatus(true);
    });

    targetSelect?.addEventListener("change", () => {
      this.loadEditorFromSelection("target");
      this.resetEncounter();
      this.renderStatsTable();
      this.renderTelemetry();
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
        switch (event.result) {
          case "miss":
            this.pushLog(`[${stamp}s] ${attacker} swings at ${defender} and misses.`);
            break;
          case "dodge":
            this.pushLog(`[${stamp}s] ${defender} dodges ${attacker}.`);
            break;
          case "parry":
            this.pushLog(`[${stamp}s] ${defender} parries ${attacker}.`);
            break;
          case "hit":
          default: {
            const dmg = Math.round(event.damage);
            const crit = event.critical ? " CRIT!" : "";
            this.pushLog(`[${stamp}s] ${attacker} hits ${defender} for ${dmg}.${crit}`);
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
    });

    this.summary = this.encounter.getSummary();
    this.logLines = [];
    this.flushLogs();
    this.pause();
    this.resetTelemetry();
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
