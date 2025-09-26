import type { FC } from "react";
import type { StatusPayload } from "../legacyHarness";

interface StatusPanelProps {
  status: StatusPayload | null;
}

const StatusPanel: FC<StatusPanelProps> = ({ status }) => (
  <section className="panel status-panel">
    <h2>Status</h2>
    <div className="status-text">{status?.label ?? "Idle"}</div>
    <table className="status-table">
      <tbody>
        <tr>
          <th>Stage</th>
          <td>{status?.stage ?? "-"}</td>
        </tr>
        <tr>
          <th>Wave</th>
          <td>{status?.wave ?? 0}</td>
        </tr>
        <tr>
          <th>Opponent</th>
          <td>{status?.opponent ?? "-"}</td>
        </tr>
        <tr>
          <th>Elapsed</th>
          <td>{status ? `${status.elapsedSeconds.toFixed(1)}s` : "0.0s"}</td>
        </tr>
        <tr>
          <th>Swings</th>
          <td>{status?.swings ?? 0}</td>
        </tr>
        <tr>
          <th>Hero Dmg</th>
          <td>{status?.heroDamage ?? 0}</td>
        </tr>
        <tr>
          <th>Enemy Dmg</th>
          <td>{status?.enemyDamage ?? 0}</td>
        </tr>
        <tr>
          <th>Winner</th>
          <td>{status?.winner ?? "-"}</td>
        </tr>
      </tbody>
    </table>
  </section>
);

export default StatusPanel;
