import { CombatSim } from "../../assets/game/combatsim";
import { Character, CharacterData } from "../../assets/game/character";
import { EncounterLoop, EncounterSummary } from "../../assets/game/encounter";

interface Preset {
  id: string;
  label: string;
  data: CharacterData;
}

const PRESET_MANIFEST = [
  { id: "rogue", label: "Rogue", path: "assets/data/rogue.json" },
  { id: "warrior", label: "Warrior", path: "assets/data/warrior.json" },
] as const;

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

  async init() {
    this.presets = await this.loadPresets();
    this.populatePresetSelect('source-select');
    this.populatePresetSelect('target-select');
    this.syncTickInput();
    this.bindControls();
    this.resetEncounter();
    this.renderStatsTable();
    this.refreshStatus();
  }

  protected async loadPresets(): Promise<Preset[]> {
    const results: Preset[] = [];
    for (const entry of PRESET_MANIFEST) {
      try {
        const response = await fetch(entry.path);
        if (!response.ok) {
          throw new Error(`${response.status} ${response.statusText}`);
        }
        const data = (await response.json()) as CharacterData;
        results.push({ id: entry.id, label: entry.label, data });
      } catch (err) {
        console.error(`Failed to load preset '${entry.id}' from ${entry.path}:`, err);
      }
    }
    return results;
  }

  protected populatePresetSelect(selectId: string) {
    const select = document.getElementById(selectId) as HTMLSelectElement;
    if (!select) return;
    select.innerHTML = "";
    if (this.presets.length === 0) {
      const option = document.createElement('option');
      option.value = "";
      option.textContent = "No presets";
      select.appendChild(option);
      select.disabled = true;
      return;
    }

    select.disabled = false;
    this.presets.forEach((preset, index) => {
      const option = document.createElement('option');
      option.value = preset.id;
      option.textContent = preset.label;
      if (index === 0) {
        option.selected = true;
      }
      select.appendChild(option);
    });
  }

  protected bindControls() {
    const startBtn = document.getElementById('start-button') as HTMLButtonElement;
    const pauseBtn = document.getElementById('pause-button') as HTMLButtonElement;
    const resetBtn = document.getElementById('reset-button') as HTMLButtonElement;
    const tickInput = document.getElementById('tick-input') as HTMLInputElement;
    const sourceSelect = document.getElementById('source-select') as HTMLSelectElement;
    const targetSelect = document.getElementById('target-select') as HTMLSelectElement;

    startBtn?.addEventListener('click', () => {
      this.start();
    });

    pauseBtn?.addEventListener('click', () => {
      this.pause();
    });

    resetBtn?.addEventListener('click', () => {
      this.resetEncounter();
      this.renderStatsTable();
      this.refreshStatus();
    });

    tickInput?.addEventListener('change', () => {
      const value = Math.max(0.01, parseFloat(tickInput.value) || this.tickInterval);
      this.tickInterval = value;
      tickInput.value = value.toFixed(2);
      if (this.encounter) {
        this.encounter.setTickInterval(value);
      }
    });

    sourceSelect?.addEventListener('change', () => {
      this.resetEncounter();
      this.renderStatsTable();
      this.refreshStatus();
    });

    targetSelect?.addEventListener('change', () => {
      this.resetEncounter();
      this.renderStatsTable();
      this.refreshStatus();
    });
  }

  protected resetEncounter() {
    const sourceSelect = document.getElementById('source-select') as HTMLSelectElement;
    const targetSelect = document.getElementById('target-select') as HTMLSelectElement;
    if (!this.presets.length) {
      this.srcChar = null;
      this.dstChar = null;
      this.encounter = null;
      this.summary = null;
      return;
    }

    const srcPreset = this.presets.find((p) => p.id === sourceSelect?.value) ?? this.presets[0];
    const dstPreset =
      this.presets.find((p) => p.id === targetSelect?.value) ??
      this.presets[1] ??
      this.presets[0];

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
  }

  protected start() {
    if (!this.encounter) return;
    this.encounter.setTickInterval(this.tickInterval);
    this.encounter.start();
    this.running = true;
    this.lastTimestamp = performance.now();
    if (this.rafHandle === null) {
      this.rafHandle = requestAnimationFrame(this.onFrame);
    }
  }

  protected pause() {
    if (!this.encounter) return;
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

    const events = this.encounter.tick(delta);
    if (events.length) {
      events.forEach((event) => {
        const attacker = event.attacker === this.srcChar ? 'Source' : 'Target';
        const defender = event.defender === this.srcChar ? 'Source' : 'Target';
        switch (event.result) {
          case 'miss':
            this.pushLog(`${attacker} swings at ${defender} and misses.`);
            break;
          case 'dodge':
            this.pushLog(`${defender} dodges ${attacker}.`);
            break;
          case 'parry':
            this.pushLog(`${defender} parries ${attacker}.`);
            break;
          case 'hit':
          default: {
            const dmg = Math.round(event.damage);
            const crit = event.critical ? ' CRIT!' : '';
            this.pushLog(`${attacker} hits ${defender} for ${dmg}.${crit}`);
            break;
          }
        }
      });
      this.renderStatsTable();
      this.flushLogs();
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

  protected refreshStatus() {
    const statusNode = document.getElementById('status-text');
    const elapsedCell = document.getElementById('elapsed-cell');
    const swingsCell = document.getElementById('swings-cell');
    const srcDmgCell = document.getElementById('src-dmg-cell');
    const dstDmgCell = document.getElementById('dst-dmg-cell');
    const winnerCell = document.getElementById('winner-cell');

    const summary = this.summary;
    if (!summary) {
      if (statusNode) statusNode.textContent = 'Idle';
      return;
    }

    const runningState = this.encounter?.isRunning ?? false;
    if (statusNode) {
      let text = runningState ? 'Running' : 'Paused';
      if (summary.victor) {
        text = `Completed (${summary.victor})`;
      }
      statusNode.textContent = `${text} • tick ${this.tickInterval.toFixed(2)}s`;
    }

    if (elapsedCell) elapsedCell.textContent = `${summary.elapsedSeconds.toFixed(2)}s`;
    if (swingsCell) swingsCell.textContent = `${summary.swings}`;
    if (srcDmgCell) srcDmgCell.textContent = `${summary.totalDamageFromSource}`;
    if (dstDmgCell) dstDmgCell.textContent = `${summary.totalDamageFromTarget}`;
    if (winnerCell) winnerCell.textContent = summary.victor ?? '-';
  }

  protected renderStatsTable() {
    const table = document.getElementById('stats-table');
    if (!table) return;
    table.innerHTML = '';
    if (!this.srcChar || !this.dstChar) {
      const row = document.createElement('tr');
      const headerCell = document.createElement('th');
      headerCell.textContent = 'Status';
      const messageCell = document.createElement('td');
      messageCell.colSpan = 2;
      messageCell.textContent = 'No preset data loaded';
      row.appendChild(headerCell);
      row.appendChild(messageCell);
      table.appendChild(row);
      return;
    }

    const stats: string[] = this.collectStatNames();

    stats.forEach((name) => {
      const row = document.createElement('tr');
      const statCell = document.createElement('th');
      statCell.textContent = name;

      const srcCell = document.createElement('td');
      srcCell.textContent = this.formatValue((this.srcChar as any)[name]);

      const dstCell = document.createElement('td');
      dstCell.textContent = this.formatValue((this.dstChar as any)[name]);

      row.appendChild(statCell);
      row.appendChild(srcCell);
      row.appendChild(dstCell);
      table.appendChild(row);
    });
  }

  protected collectStatNames(): string[] {
    if (!this.srcChar) return [];
    const proto = Reflect.getPrototypeOf(this.srcChar);
    return Object.entries(Object.getOwnPropertyDescriptors(proto))
      .filter(([name, descriptor]) => typeof descriptor.get === 'function' && name !== '__proto__')
      .map(([name]) => name)
      .sort();
  }

  protected formatValue(value: unknown): string {
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return '-';
      if (Math.abs(value) >= 10 && Number.isInteger(value)) {
        return value.toString();
      }
      if (value >= 1) {
        return value.toFixed(2);
      }
      return value.toFixed(3);
    }
    return `${value}`;
  }

  protected pushLog(entry: string) {
    this.logLines.push(entry);
    if (this.logLines.length > 200) {
      this.logLines.splice(0, this.logLines.length - 200);
    }
  }

  protected flushLogs() {
    const logNode = document.getElementById('log-output');
    if (!logNode) return;
    logNode.textContent = this.logLines.join('\n');
    logNode.scrollTop = logNode.scrollHeight;
  }

  protected cloneData<T>(data: T): T {
    return JSON.parse(JSON.stringify(data));
  }

  protected syncTickInput() {
    const tickInput = document.getElementById('tick-input') as HTMLInputElement;
    if (!tickInput) return;
    tickInput.value = this.tickInterval.toFixed(2);
  }
}

const harness = new SimulatorHarness();
window.addEventListener('DOMContentLoaded', () => {
  harness.init().catch((err) => {
    console.error('Failed to initialise simulator harness', err);
    const statusNode = document.getElementById('status-text');
    if (statusNode) {
      statusNode.textContent = 'Failed to load presets';
    }
  });
});
