import type { FC } from "react";
import type {
  EquipmentActionState,
  ItemDefinition,
  OwnedEquipment,
  StatPreviewRow,
} from "../simulatorHarness";
import {
  describeItemDetails,
  formatOwnedSummary,
  formatAugmentNames,
} from "../utils/formatting";

interface InventoryPanelProps {
  inventory: OwnedEquipment[];
  materials: { materials: Record<string, number>; consumables: Record<string, number> } | null;
  harnessReady: boolean;
  resolveItem: (itemId: string) => ItemDefinition | null;
  getActionState: (instanceId: string) => EquipmentActionState | null;
  getPreview: (instanceId: string) => StatPreviewRow[] | null;
  onEquip: (instanceId: string) => void;
  onUpgrade: (instanceId: string) => void;
  onSocket: (instanceId: string) => void;
  onSalvage: (instanceId: string) => void;
  onUseConsumable: (itemId: string) => void;
}

const InventoryPanel: FC<InventoryPanelProps> = ({
  inventory,
  materials,
  harnessReady,
  resolveItem,
  getActionState,
  getPreview,
  onEquip,
  onUpgrade,
  onSocket,
  onSalvage,
  onUseConsumable,
}) => (
  <section className="panel equipment-panel">
    <h2>Equipment & Inventory</h2>
    <div className="equipment-grid">
      <div className="equipment-column wide">
        <h3>Inventory</h3>
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Details</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {inventory.length === 0 ? (
              <tr>
                <td colSpan={3}>Inventory empty</td>
              </tr>
            ) : (
              inventory.map((owned) => {
                const definition = resolveItem(owned.itemId);
                const actions = getActionState(owned.instanceId);
                const previewStats = harnessReady ? getPreview(owned.instanceId) : null;
                const previewHighlights = previewStats
                  ? previewStats
                      .filter((row) => Number.isFinite(row.delta) && Math.abs(row.delta) > 0.001)
                      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
                      .slice(0, 3)
                  : null;

                return (
                  <tr key={owned.instanceId}>
                    <td>
                      <div className="item-cell">
                        <div className="item-name">{definition?.name ?? owned.itemId}</div>
                        <div className="item-meta">{formatOwnedSummary(owned, definition)}</div>
                        {owned.augments.length ? (
                          <div className="item-meta">
                            Augments: {formatAugmentNames(owned.augments, resolveItem)}
                          </div>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <div className="item-meta">
                        {describeItemDetails(owned, definition, resolveItem)}
                      </div>
                      {previewHighlights && previewHighlights.length ? (
                        <div className="stat-preview">
                          {previewHighlights.map((row) => (
                            <span
                              key={`${owned.instanceId}-${row.label}`}
                              className={`delta-chip ${
                                row.delta > 0
                                  ? "delta-positive"
                                  : row.delta < 0
                                  ? "delta-negative"
                                  : ""
                              }`}
                            >
                              {row.label}: {row.deltaFormatted}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <div className="table-actions">
                        <button
                          type="button"
                          onClick={() => onEquip(owned.instanceId)}
                          disabled={!harnessReady}
                          title={definition?.slot ? `Equip to ${definition.slot}` : "Equip"}
                        >
                          Equip
                        </button>
                        <button
                          type="button"
                          onClick={() => onUpgrade(owned.instanceId)}
                          disabled={!harnessReady || (actions?.upgrade.disabled ?? true)}
                          title={actions?.upgrade.title ?? "Upgrade"}
                        >
                          {actions?.upgrade.label ?? "Upgrade"}
                        </button>
                        <button
                          type="button"
                          onClick={() => onSocket(owned.instanceId)}
                          disabled={!harnessReady || (actions?.socket.disabled ?? true)}
                          title={actions?.socket.title ?? "Socket"}
                        >
                          {actions?.socket.label ?? "Socket"}
                        </button>
                        <button
                          type="button"
                          onClick={() => onSalvage(owned.instanceId)}
                          disabled={!harnessReady || (actions?.salvage.disabled ?? true)}
                          title={actions?.salvage.title ?? "Salvage"}
                        >
                          {actions?.salvage.label ?? "Salvage"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>

    <div className="inventory-grid">
      <div>
        <h3>Materials</h3>
        <table>
          <thead>
            <tr>
              <th>Material</th>
              <th>Qty</th>
            </tr>
          </thead>
          <tbody>
            {materials && Object.keys(materials.materials).length ? (
              Object.entries(materials.materials)
                .sort((a, b) => a[0].localeCompare(b[0]))
                .map(([id, qty]) => (
                  <tr key={id}>
                    <td>{id}</td>
                    <td>{qty}</td>
                  </tr>
                ))
            ) : (
              <tr>
                <td colSpan={2}>No materials</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div>
        <h3>Consumables & Augments</h3>
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Qty</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {materials && Object.keys(materials.consumables).length ? (
              Object.entries(materials.consumables)
                .sort((a, b) => a[0].localeCompare(b[0]))
                .map(([id, qty]) => {
                  const definition = resolveItem(id);
                  const label = definition?.name ?? id;
                  const typeLabel = definition ? ` (${definition.type})` : "";
                  const isConsumable = definition?.type === "consumable";
                  return (
                    <tr key={id}>
                      <td>
                        {label}
                        {typeLabel}
                      </td>
                      <td>{qty}</td>
                      <td>
                        {isConsumable ? (
                          <div className="table-actions">
                            <button
                              type="button"
                              onClick={() => onUseConsumable(id)}
                              disabled={!harnessReady || qty <= 0}
                              title={`Use ${label}`}
                            >
                              Use
                            </button>
                          </div>
                        ) : (
                          <span className="item-hint">Socket via gear</span>
                        )}
                      </td>
                    </tr>
                  );
                })
            ) : (
              <tr>
                <td colSpan={3}>No consumables</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  </section>
);

export default InventoryPanel;
