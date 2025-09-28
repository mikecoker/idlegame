import type { FC } from "react";
import type { EncounterHistoryEntry } from "../simulatorHarness";
import { formatRewardsShort } from "@core/utils/formatting";

interface HistoryPanelProps {
  history: EncounterHistoryEntry[];
}

const HistoryPanel: FC<HistoryPanelProps> = ({ history }) => (
  <section className="panel history-panel">
    <h2>Encounter History</h2>
    <div className="history-scroll">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Stage</th>
            <th>Wave</th>
            <th>Opponent</th>
            <th>Result</th>
            <th>Hero HP</th>
            <th>Enemy HP</th>
            <th>Rewards</th>
          </tr>
        </thead>
        <tbody>
          {history.length === 0 ? (
            <tr>
              <td colSpan={8}>No encounters yet</td>
            </tr>
          ) : (
            history.map((entry) => (
              <tr key={entry.index}>
                <td>#{entry.index}</td>
                <td>{entry.stage}</td>
                <td>{entry.wave}</td>
                <td>{entry.opponent}</td>
                <td>{entry.result}</td>
                <td>{entry.heroHP}</td>
                <td>{entry.enemyHP}</td>
                <td>{formatRewardsShort(entry.rewards)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  </section>
);

export default HistoryPanel;
