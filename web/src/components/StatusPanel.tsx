import type { FC } from "react";
import type { StatusPayload, VitalSnapshot } from "../simulatorHarness";

interface StatusPanelProps {
  status: StatusPayload | null;
  onUsePotion?: (heroId: string) => void;
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
  { key: "heroDamage", label: "Ally Dmg" },
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

const StatusPanel: FC<StatusPanelProps> = ({ status, onUsePotion }) => {
  const partyVitals = status?.partyVitals ?? [];
  const enemyVitals = status?.enemyVitals ?? [];

  return (
    <section className="status-bar">
      <div className="status-health-container">
        <VitalsGroup title="Allies" vitals={partyVitals} variant="hero" onUsePotion={onUsePotion} />
        <VitalsGroup title="Enemies" vitals={enemyVitals} variant="enemy" />
      </div>
      <div className="status-chip-row">
        {STATUS_METRICS.map(({ key, label, formatter }) => (
          <div key={key} className="status-chip">
            <span className="status-label">{label}</span>
            <span className="status-value">{formatMetric(status, key, formatter)}</span>
          </div>
        ))}
      </div>
    </section>
  );
};

interface VitalsGroupProps {
  title: string;
  vitals: VitalSnapshot[];
  variant: "hero" | "enemy";
  onUsePotion?: (heroId: string) => void;
}

const VitalsGroup: FC<VitalsGroupProps> = ({ title, vitals, variant, onUsePotion }) => (
  <div className="status-vital-card">
    <header className="status-vital-header">{title}</header>
    {vitals.length ? (
      vitals.map((entry) => (
        <div key={entry.id} className="status-vital-entry">
          <HealthBar
            label={entry.label}
            current={entry.current}
            max={entry.max}
            variant={variant}
            alive={entry.alive}
            isBoss={entry.isBoss}
            slotIndex={entry.slotIndex}
            isPrimary={entry.isPrimary}
          />
          {variant === "hero" ? (
            <>
              <XPBar level={entry.level} percent={entry.xpPercent} />
              <div className="status-action-row">
                <button
                  type="button"
                  onClick={() => onUsePotion?.(entry.id)}
                  disabled={!entry.canUsePotion}
                >
                  Use Potion
                </button>
              </div>
            </>
          ) : null}
        </div>
      ))
    ) : (
      <div className="status-vital-empty">No combatants</div>
    )}
  </div>
);

interface HealthBarProps {
  label: string;
  current: number;
  max: number;
  variant: "hero" | "enemy";
  alive?: boolean;
  isBoss?: boolean;
  slotIndex?: number;
  isPrimary?: boolean;
}

const HealthBar: FC<HealthBarProps> = ({
  label,
  current,
  max,
  variant,
  alive = true,
  isBoss = false,
  slotIndex,
  isPrimary,
}) => {
  const clampedMax = max > 0 ? max : 0;
  const safeCurrent = Math.max(0, current);
  const ratio = clampedMax > 0 ? Math.min(1, Math.max(0, safeCurrent / clampedMax)) : 0;
  const percentage = Math.round(ratio * 100);
  const currentDisplay = Math.round(safeCurrent).toLocaleString();
  const maxDisplay = Math.round(clampedMax).toLocaleString();
  const defeated = !alive || safeCurrent <= 0;
  const trackClass = `status-health-track status-health-${variant}${isBoss ? " status-health-boss" : ""}`;
  const tags: string[] = [];
  if (typeof slotIndex === "number" && Number.isFinite(slotIndex)) {
    tags.push(`Slot ${slotIndex + 1}`);
  }
  if (isPrimary && variant === "hero") {
    tags.push("Leader");
  }
  const suffix = tags.length ? ` (${tags.join(" • ")})` : "";

  return (
    <div
      className="status-health-bar"
      role="meter"
      aria-valuemin={0}
      aria-valuemax={clampedMax}
      aria-valuenow={safeCurrent}
    >
      <div className="status-health-header">
        <span className="status-label">
          {label}
          {suffix}
          {isBoss ? " (Boss)" : ""}
        </span>
        <span className={`status-value${defeated ? " status-value-defeated" : ""}`}>
          {defeated ? "Defeated" : `${currentDisplay} / ${maxDisplay} (${percentage}%)`}
        </span>
      </div>
      <div className={trackClass}>
        <div className="status-health-fill" style={{ width: `${defeated ? 0 : percentage}%` }} />
      </div>
    </div>
  );
};

interface XPBarProps {
  level?: number;
  percent?: number;
}

const XPBar: FC<XPBarProps> = ({ level, percent }) => {
  const clamped = percent ? Math.min(1, Math.max(0, percent)) : 0;
  const percentage = Math.round(clamped * 100);
  return (
    <div className="status-xp-bar">
      <div className="status-xp-header">
        <span className="status-label">Level {level ?? "-"}</span>
        <span className="status-value">{percentage}%</span>
      </div>
      <div className="status-xp-track">
        <div className="status-xp-fill" style={{ width: `${percentage}%` }} />
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
  if (key === "label") {
    return status.label;
  }
  const raw = status[key] as number | string | boolean | null | VitalSnapshot[];
  if (Array.isArray(raw)) {
    return raw.length ? String(raw.length) : "-";
  }
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
