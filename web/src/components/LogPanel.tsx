import type { FC } from "react";

interface LogPanelProps {
  logs: string[];
}

const LogPanel: FC<LogPanelProps> = ({ logs }) => (
  <section className="panel log-panel">
    <h2>Event Log</h2>
    <div id="log-output" className="log-output">
      {logs.map((entry, idx) => (
        <div key={`log-${idx}`}>{entry}</div>
      ))}
    </div>
  </section>
);

export default LogPanel;
