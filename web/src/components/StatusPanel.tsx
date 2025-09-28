import type { FC } from "react";
import type { StatusPayload } from "../simulatorHarness";

interface StatusPanelProps {
  status: StatusPayload | null;
}

const STATUS_METRICS: Array<{ key: keyof StatusPayload | "label"; label: string; formatter?: (value: number | string | null) => string }>= [
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
];

const StatusPanel: FC<StatusPanelProps> = ({ status }) => (
  <section className="status-bar">
    {STATUS_METRICS.map(({ key, label, formatter }) => (
      <div key={key} className="status-chip">
        <span className="status-label">{label}</span>
        <span className="status-value">
          {formatMetric(status, key, formatter)}
        </span>
      </div>
    ))}
  </section>
);

function formatMetric(
  status: StatusPayload | null,
  key: keyof StatusPayload | "label",
  formatter?: (value: number | string | null) => string
): string {
  if (!status) {
    return key === "label" ? "Idle" : "-";
  }
  const raw = key === "label" ? status.label : (status[key] as number | string | null);
  if (formatter) {
    return formatter(raw);
  }
  if (raw === null || raw === undefined || raw === "") {
    return "-";
  }
  return typeof raw === "number" && Number.isFinite(raw) ? String(raw) : String(raw);
}

export default StatusPanel;
