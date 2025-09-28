import type { FC } from "react";

interface RewardsRow {
  label: string;
  last: string;
  total: string;
}

interface RewardPreview {
  stageNumber: number;
  stageName: string;
  waveCount: number;
  lootTableId: string | null;
  enemyGold: number;
  enemyXp: number;
  bossGold: number;
  bossShards: number;
  bossGemChance: number;
  firstClearBonusPercent: number;
  bossTimerSeconds: number;
  enrageThresholdPercent: number;
  enrageMultiplier: number;
}

interface RewardsPanelProps {
  rows: RewardsRow[];
  preview: RewardPreview | null;
  permanentBonusPercent: number;
}

const RewardsPanel: FC<RewardsPanelProps> = ({ rows, preview, permanentBonusPercent }) => (
  <section className="panel rewards-panel">
    <div className="rewards-header">
      <h2>Rewards</h2>
      <div className="reward-bonus-chip">
        <span className="bonus-label">Permanent Bonus</span>
        <span className="bonus-value">+{permanentBonusPercent.toFixed(1)}%</span>
      </div>
    </div>

    {preview ? (
      <div className="reward-preview">
        <div className="reward-preview-summary">
          <div className="reward-preview-title">
            Stage {preview.stageNumber}: {preview.stageName}
          </div>
          <div className="reward-preview-meta">
            <span>Waves: {preview.waveCount}</span>
            <span>Loot Table: {preview.lootTableId ?? "Default"}</span>
            <span>Boss Timer: {preview.bossTimerSeconds.toFixed(0)}s</span>
            <span>Enrage: {(preview.enrageThresholdPercent * 100).toFixed(0)}% HP → ×
              {preview.enrageMultiplier.toFixed(2)} ATK
            </span>
          </div>
        </div>
        <div className="reward-preview-grid">
          <RewardPreviewCard label="Enemy Gold / XP" value={`${formatNumber(preview.enemyGold)} / ${formatNumber(preview.enemyXp)}`} />
          <RewardPreviewCard label="Boss Gold" value={formatNumber(preview.bossGold)} />
          <RewardPreviewCard label="Boss Shards" value={formatNumber(preview.bossShards)} />
          <RewardPreviewCard label="Gem Chance" value={`${(preview.bossGemChance * 100).toFixed(1)}%`} />
          <RewardPreviewCard
            label="First Clear Bonus"
            value={`+${(preview.firstClearBonusPercent * 100).toFixed(1)}% stats`}
          />
        </div>
      </div>
    ) : null}

    <table>
      <thead>
        <tr>
          <th>Metric</th>
          <th>Last</th>
          <th>Total</th>
        </tr>
      </thead>
      <tbody>
        {rows.length ? (
          rows.map((row) => (
            <tr key={row.label}>
              <th>{row.label}</th>
              <td>{row.last}</td>
              <td>{row.total}</td>
            </tr>
          ))
        ) : (
          <tr>
            <td colSpan={3}>No rewards yet</td>
          </tr>
        )}
      </tbody>
    </table>
  </section>
);

const RewardPreviewCard: FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="reward-preview-card">
    <span className="reward-preview-label">{label}</span>
    <span className="reward-preview-value">{value}</span>
  </div>
);

function formatNumber(value: number): string {
  return Number.isFinite(value) ? Math.round(value).toLocaleString() : "-";
}

export type { RewardsRow, RewardPreview };
export default RewardsPanel;
