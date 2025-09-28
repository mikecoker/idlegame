import type { ChangeEvent, FC } from "react";
import type { ControlStatePayload } from "../simulatorHarness";

interface ControlBarProps {
  controls: ControlStatePayload | null;
  harnessReady: boolean;
  onStart(): void;
  onPause(): void;
  onReset(): void;
  onTickChange(event: ChangeEvent<HTMLInputElement>): void;
  onHeroChange(event: ChangeEvent<HTMLSelectElement>): void;
  onStageChange(event: ChangeEvent<HTMLSelectElement>): void;
  onLootChange(event: ChangeEvent<HTMLSelectElement>): void;
  onAutoResumeToggle(event: ChangeEvent<HTMLInputElement>): void;
}

const ControlBar: FC<ControlBarProps> = ({
  controls,
  harnessReady,
  onStart,
  onPause,
  onReset,
  onTickChange,
  onHeroChange,
  onStageChange,
  onLootChange,
  onAutoResumeToggle,
}) => (
  <header className="top-bar">
    <div className="controls-group">
      <button type="button" onClick={onStart} disabled={!harnessReady || controls?.isRunning}>
        Start
      </button>
      <button type="button" onClick={onPause} disabled={!harnessReady || !controls?.isRunning}>
        Pause
      </button>
      <button type="button" onClick={onReset} disabled={!harnessReady}>
        Reset
      </button>
    </div>
    <div className="input-group">
      <label className="input-field">
        Tick (s)
        <input
          type="number"
          step="0.05"
          min="0.01"
          value={controls ? controls.tickInterval.toFixed(2) : "0.10"}
          onChange={onTickChange}
          disabled={!harnessReady}
        />
      </label>
      <label className="input-field">
        Hero
        <select
          value={controls?.selectedHeroId ?? ""}
          onChange={onHeroChange}
          disabled={!harnessReady || !controls?.heroOptions.length}
        >
          {controls?.heroOptions.length ? (
            controls.heroOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))
          ) : (
            <option value="" disabled>
              Loading heroes...
            </option>
          )}
        </select>
      </label>
      <label className="input-field">
        Stage
        <select
          value={String(controls?.selectedStageIndex ?? 0)}
          onChange={onStageChange}
          disabled={!harnessReady || !controls?.stageOptions.length}
        >
          {controls?.stageOptions.length ? (
            controls.stageOptions.map((option) => (
              <option key={option.index} value={option.index}>
                {option.label}
              </option>
            ))
          ) : (
            <option value="0" disabled>
              Loading stages...
            </option>
          )}
        </select>
      </label>
      <label className="input-field">
        Loot Table
        <select
          value={controls?.selectedLootId ?? ""}
          onChange={onLootChange}
          disabled={!harnessReady || !controls?.lootOptions.length}
        >
          {controls?.lootOptions.length ? (
            controls.lootOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))
          ) : (
            <option value="" disabled>
              Loading loot tables...
            </option>
          )}
        </select>
      </label>
      <label className="input-field toggle-field">
        Auto Resume
        <input
          type="checkbox"
          checked={controls?.autoResume ?? false}
          onChange={onAutoResumeToggle}
          disabled={!harnessReady}
        />
      </label>
    </div>
  </header>
);

export default ControlBar;
