import type { FC } from "react";
import type { TelemetryRow } from "../simulatorHarness";

interface TelemetryPanelProps {
  rows: TelemetryRow[];
}

const TelemetryPanel: FC<TelemetryPanelProps> = ({ rows }) => (
  <section className="panel telemetry-panel">
    <h2>Telemetry</h2>
    <table>
      <thead>
        <tr>
          <th>Metric</th>
          <th>Hero</th>
          <th>Enemy</th>
        </tr>
      </thead>
      <tbody>
        {rows.length ? (
          rows.map((row) => (
            <tr key={row.label}>
              <th>{row.label}</th>
              <td>{row.hero}</td>
              <td>{row.enemy}</td>
            </tr>
          ))
        ) : (
          <tr>
            <td colSpan={3}>No telemetry yet</td>
          </tr>
        )}
      </tbody>
    </table>
  </section>
);

export default TelemetryPanel;
