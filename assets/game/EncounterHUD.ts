import { _decorator, Component, EditBox, Label } from "cc";
import { Simulator } from "./Simulator";

const { ccclass, property } = _decorator;

@ccclass("EncounterHUD")
export class EncounterHUD extends Component {
  @property(Simulator)
  simulator: Simulator = null;

  @property(EditBox)
  tickIntervalInput: EditBox = null;

  @property(Label)
  statusLabel: Label = null;

  @property({ tooltip: "Seconds between status label refreshes" })
  statusRefreshRate = 0.25;

  protected _statusTimer = 0;

  onEnable() {
    this.syncTickIntervalField();
    this.refreshStatus(true);
  }

  update(deltaTime: number) {
    if (!this.simulator) {
      return;
    }

    this._statusTimer += deltaTime;
    if (this._statusTimer >= this.statusRefreshRate) {
      this._statusTimer = 0;
      this.refreshStatus();
    }
  }

  onToggleAuto() {
    if (!this.simulator) {
      return;
    }
    this.simulator.toggleAuto();
    this.refreshStatus(true);
  }

  onResetEncounter() {
    if (!this.simulator) {
      return;
    }
    this.simulator.resetEncounter(this.simulator.autoStart);
    this.syncTickIntervalField();
    this.refreshStatus(true);
  }

  onApplyTickInterval() {
    if (!this.simulator || !this.tickIntervalInput) {
      return;
    }

    const parsed = parseFloat(this.tickIntervalInput.string);
    if (Number.isFinite(parsed) && parsed > 0) {
      this.simulator.updateTickInterval(parsed);
      if (this.simulator.isRunning()) {
        this.simulator.startAuto();
      }
    }

    this.syncTickIntervalField();
    this.refreshStatus(true);
  }

  protected refreshStatus(force = false) {
    if (!this.statusLabel) {
      return;
    }

    const summary = this.simulator?.getSummary();
    const tick = this.simulator?.getTickInterval() ?? 0;

    let state = "Idle";
    if (!this.simulator) {
      state = "No simulator";
    } else if (this.simulator.isRunning()) {
      state = "Running";
    } else if (this.simulator.isComplete()) {
      const victor = summary?.victor ?? "none";
      state = `Completed (${victor})`;
    } else if (summary) {
      state = "Paused";
    }

    let details = "";
    if (summary) {
      const elapsed = summary.elapsedSeconds.toFixed(1);
      details =
        `Time: ${elapsed}s  Swings: ${summary.swings}` +
        `  Dmg src/dst: ${summary.totalDamageFromSource}/${summary.totalDamageFromTarget}`;
    }

    const tickText = tick > 0 ? tick.toFixed(2) : "-";
    const header = `${state} (tick ${tickText}s)`;
    const body = details.length ? `\n${details}` : "";

    if (force || this.statusLabel.string !== `${header}${body}`) {
      this.statusLabel.string = `${header}${body}`;
    }
  }

  protected syncTickIntervalField() {
    if (!this.tickIntervalInput || !this.simulator) {
      return;
    }
    const tick = this.simulator.getTickInterval();
    this.tickIntervalInput.string = tick > 0 ? tick.toFixed(2) : "";
  }
}
