import type { FC } from "react";
import type { StatusPayload } from "../simulatorHarness";

interface StatusPanelProps {
  status: StatusPayload | null;
}

const STATUS_METRICS: Array<{
  key: keyof StatusPayload | "label";
  label: string;
  formatter?: (value: number | string | boolean | null) => string;
}> = [
  { key: "label", label: "State" },
  { key: "stage", label: "Stage" },
  { key: "wave", label: "Wave" },
  { key: "opponent", label: "Opponent" },
  {
    key: "elapsedSeconds",
    label: "Elapsed",
    formatter: (value) => `${Number(value ?? 0).toFixed(1)}s`,
  },
  { key: "swings", label: "Swings" },
  { key: "heroDamage", label: "Hero Dmg" },
  { key: "enemyDamage", label: "Enemy Dmg" },
  { key: "winner", label: "Winner" },
  {
    key: "bossTimerRemaining",
    label: "Boss Timer",
    formatter: (value) => `${Number(value ?? 0).toFixed(1)}s`,
  },
  {
    key: "bossTimerTotal",
    label: "Timer Total",
    formatter: (value) => `${Number(value ?? 0).toFixed(1)}s`,
  },
  {
    key: "bossEnraged",
    label: "Enraged",
    formatter: (value) => (value ? "Yes" : "No"),
  },
];

const StatusPanel: FC<StatusPanelProps> = ({ status }) => {
  const heroHealth = status?.heroHealth ?? 0;
  const heroMax = status?.heroMaxHealth ?? 0;
  const enemyHealth = status?.enemyHealth ?? 0;
  const enemyMax = status?.enemyMaxHealth ?? 0;
  const enemyLabel = status?.opponent && status.opponent !== "-" ? status.opponent : "Enemy";

  return (
    <section className="status-bar">
      <div className="status-health-container">
        <HealthBar
          label="Hero HP"
          current={heroHealth}
          max={heroMax}
          variant="hero"
        />
        <HealthBar
          label={`${enemyLabel} HP`}
          current={enemyHealth}
          max={enemyMax}
          variant="enemy"
        />
      </div>
      <div className="status-chip-row">
        {STATUS_METRICS.map(({ key, label, formatter }) => (
          <div key={key} className="status-chip">
            <span className="status-label">{label}</span>
            <span className="status-value">
              {formatMetric(status, key, formatter)}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
};

interface HealthBarProps {
  label: string;
  current: number;
  max: number;
  variant: "hero" | "enemy";
}

const HealthBar: FC<HealthBarProps> = ({ label, current, max, variant }) => {
  const clampedMax = max > 0 ? max : 0;
  const ratio = clampedMax > 0 ? Math.min(1, Math.max(0, current / clampedMax)) : 0;
  const percentage = Math.round(ratio * 100);
  const currentDisplay = Math.round(current);
  const maxDisplay = Math.round(clampedMax);

  return (
    <div
      className="status-health-bar"
      role="meter"
      aria-valuemin={0}
      aria-valuemax={clampedMax}
      aria-valuenow={Math.max(0, current)}
    >
      <div className="status-health-header">
        <span className="status-label">{label}</span>
        <span className="status-value">
          {`${currentDisplay.toLocaleString()} / ${maxDisplay.toLocaleString()} (${percentage}%)`}
        </span>
      </div>
      <div className={`status-health-track status-health-${variant}`}>
        <div className="status-health-fill" style={{ width: `${percentage}%` }} />
      </div>
    </div>
  );
};

function formatMetric(
  status: StatusPayload | null,
  key: keyof StatusPayload | "label",
  formatter?: (value: number | string | boolean | null) => string
): string {
  if (!status) {
    return key === "label" ? "Idle" : "-";
  }
  const raw =
    key === "label"
      ? status.label
      : (status[key] as number | string | boolean | null);
  if (formatter) {
    return formatter(raw);
  }
  if (raw === null || raw === undefined || raw === "") {
    return "-";
  }
  if (typeof raw === "boolean") {
    return raw ? "Yes" : "No";
  }
  return typeof raw === "number" && Number.isFinite(raw) ? String(raw) : String(raw);
}

export default StatusPanel;
