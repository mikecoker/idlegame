import type { FC } from "react";
import type {
  EquippedSlotKey,
  ItemDefinition,
  OwnedEquipment,
  StatRow,
} from "../simulatorHarness";
import { formatAugmentNames, formatOwnedSummary } from "../utils/formatting";

interface PaperdollProps {
  equipped: Record<EquippedSlotKey, OwnedEquipment | null>;
  resolveItem: (itemId: string) => ItemDefinition | null;
  stats: StatRow[];
  onUnequip?: (slot: EquippedSlotKey) => void;
}

const SLOT_ORDER: Array<{ key: EquippedSlotKey; icon: string; label: string }> = [
  { key: "Head", icon: "🛡️", label: "Head" },
  { key: "Chest", icon: "🥋", label: "Chest" },
  { key: "MainHand", icon: "⚔️", label: "Main Hand" },
  { key: "OffHand", icon: "🛡", label: "Off Hand" },
];

const Paperdoll: FC<PaperdollProps> = ({ equipped, resolveItem, stats, onUnequip }) => {
  return (
    <div className="paperdoll">
      <div className="paperdoll-avatar-card">
        <div className="paperdoll-avatar" aria-hidden>
          <div className="avatar-glow" />
          <div className="avatar-outline" />
        </div>
        <p className="avatar-caption">Gear affects every swing—experiment freely.</p>
      </div>

      <div className="paperdoll-details">
        <div className="paperdoll-slots">
          {SLOT_ORDER.map(({ key, icon, label }) => {
            const owned = equipped[key];
            const definition = owned ? resolveItem(owned.itemId) : null;
            return (
              <div key={key} className="paperdoll-slot-card">
                <header className="slot-header">
                  <span className="slot-icon" aria-hidden>
                    {icon}
                  </span>
                  <span className="slot-title">{label}</span>
                </header>

                {owned ? (
                  <>
                    <div className="slot-body">
                      <div className="slot-name">{definition?.name ?? owned.itemId}</div>
                      <div className="slot-summary">{formatOwnedSummary(owned, definition)}</div>
                      {owned.augments.length ? (
                        <div className="slot-augments">
                          Augments: {formatAugmentNames(owned.augments, resolveItem)}
                        </div>
                      ) : null}
                    </div>
                    <div className="slot-actions">
                      {onUnequip ? (
                        <button type="button" onClick={() => onUnequip(key)}>
                          Unequip
                        </button>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <div className="slot-empty">No item equipped</div>
                )}
              </div>
            );
          })}
        </div>

        <div className="paperdoll-stats">
          <h3>Current Stats</h3>
          {stats.length ? (
            <ul>
              {stats.map((row) => (
                <li key={row.label}>
                  <span className="stat-label">{row.label}</span>
                  <span className="stat-value">{row.value}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="paperdoll-stats-empty">Stats will appear once the hero enters combat.</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Paperdoll;
