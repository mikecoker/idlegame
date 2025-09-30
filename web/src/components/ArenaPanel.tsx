import type { FC } from "react";

interface ArenaPanelProps {
  isRunning: boolean;
  onStartArena: () => void;
  onStopArena: () => void;
}

const ArenaPanel: FC<ArenaPanelProps> = ({ isRunning, onStartArena, onStopArena }) => (
  <main className="content-grid">
    <section className="panel arena-panel">
      <h2>Training Arena</h2>
      <p>Grind XP safely with endless weak enemies. Heroes respawn automatically.</p>
      <div className="arena-controls">
        {!isRunning ? (
          <button type="button" onClick={onStartArena}>
            Start Training
          </button>
        ) : (
          <button type="button" onClick={onStopArena}>
            Stop Training
          </button>
        )}
      </div>
    </section>
  </main>
);

export default ArenaPanel;