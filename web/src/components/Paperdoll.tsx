import type { FC } from "react";
import type {
  EquippedSlotKey,
  ItemDefinition,
  OwnedEquipment,
  StatRow,
  EquipmentActionState,
} from "../simulatorHarness";
import { formatAugmentNames, formatOwnedSummary } from "@core/utils/formatting";

interface PaperdollProps {
  equipped: Record<EquippedSlotKey, OwnedEquipment | null>;
  resolveItem: (itemId: string) => ItemDefinition | null;
  stats: StatRow[];
  getActionState?: (instanceId: string) => EquipmentActionState | null;
  onUnequip?: (slot: EquippedSlotKey) => void;
  onUpgrade?: (instanceId: string) => void;
  onSocket?: (instanceId: string) => void;
  onEquipBest?: () => void;
  heroLabel?: string;
}

const SLOT_ORDER: Array<{ key: EquippedSlotKey; icon: string; label: string }> = [
  { key: "MainHand", icon: "⚔️", label: "Weapon" },
  { key: "Chest", icon: "🥋", label: "Armor" },
  { key: "Head", icon: "🪖", label: "Helmet" },
  { key: "Boot", icon: "🥾", label: "Boots" },
  { key: "Hand", icon: "🧤", label: "Gloves" },
  { key: "OffHand", icon: "💍", label: "Accessory" },
];

const Paperdoll: FC<PaperdollProps> = ({
  equipped,
  resolveItem,
  stats,
  getActionState,
  onUnequip,
  onUpgrade,
  onSocket,
  onEquipBest,
  heroLabel,
}) => {
  return (
    <div className="paperdoll">
      {heroLabel ? (
        <header className="paperdoll-header">
          {heroLabel}
          {onEquipBest ? (
            <button type="button" onClick={onEquipBest} style={{ marginLeft: 'auto' }}>
              Equip Best
            </button>
          ) : null}
        </header>
      ) : null}
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
                       <div className={`slot-name rarity-${owned.rarity}`}>{definition?.name ?? owned.itemId}</div>
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
                       {onUpgrade && owned ? (() => {
                         const actions = getActionState?.(owned.instanceId);
                         return (
                           <button
                             type="button"
                             onClick={() => onUpgrade(owned.instanceId)}
                             disabled={actions?.upgrade.disabled ?? true}
                             title={actions?.upgrade.title ?? ""}
                           >
                             {actions?.upgrade.label ?? "Upgrade"}
                           </button>
                         );
                       })() : null}
                       {onSocket && owned ? (() => {
                         const actions = getActionState?.(owned.instanceId);
                         return (
                           <button
                             type="button"
                             onClick={() => onSocket(owned.instanceId)}
                             disabled={actions?.socket.disabled ?? true}
                             title={actions?.socket.title ?? ""}
                           >
                             {actions?.socket.label ?? "Socket"}
                           </button>
                         );
                       })() : null}
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
