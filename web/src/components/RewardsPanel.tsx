import type { FC } from "react";

interface RewardsRow {
  label: string;
  last: string;
  total: string;
}

interface RewardsPanelProps {
  rows: RewardsRow[];
}

const RewardsPanel: FC<RewardsPanelProps> = ({ rows }) => (
  <section className="panel rewards-panel">
    <h2>Rewards</h2>
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

export type { RewardsRow };
export default RewardsPanel;
