import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import type { EncounterRewards } from "../../assets/game/encounter";
import {
  SimulatorHarness,
  StatusPayload,
  EncounterHistoryEntry,
  OwnedEquipment,
  EquippedSlotKey,
  EquipmentActionState,
  ItemDefinition,
  CraftingStatePayload,
  ControlStatePayload,
  TelemetryRow,
  StatRow,
} from "./legacyHarness";
import "./styles/App.css";

const LOG_LIMIT = 300;

const App = () => {
  const harnessRef = useRef<SimulatorHarness | null>(null);
  const [harnessReady, setHarnessReady] = useState(false);
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [rewards, setRewards] = useState<{ last: EncounterRewards; total: EncounterRewards } | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [history, setHistory] = useState<EncounterHistoryEntry[]>([]);
  const [materials, setMaterials] = useState<{ materials: Record<string, number>; consumables: Record<string, number> } | null>(null);
  const [controls, setControls] = useState<ControlStatePayload | null>(null);
  const [telemetryRows, setTelemetryRows] = useState<TelemetryRow[]>([]);
  const [statsRows, setStatsRows] = useState<StatRow[]>([]);
  const [crafting, setCrafting] = useState<CraftingStatePayload | null>(null);
  const [equipped, setEquipped] = useState<Record<EquippedSlotKey, OwnedEquipment | null>>({
    MainHand: null,
    OffHand: null,
    Head: null,
    Chest: null,
  });
  const [inventory, setInventory] = useState<OwnedEquipment[]>([]);

  useEffect(() => {
    let cancelled = false;

    const harness = new SimulatorHarness({
      onStatus: (payload) => setStatus(payload),
      onRewards: (payload) =>
        setRewards({
          last: JSON.parse(JSON.stringify(payload.last)) as EncounterRewards,
          total: JSON.parse(JSON.stringify(payload.total)) as EncounterRewards,
        }),
      onLog: (entry) =>
        setLogs((prev) => {
          const next = [...prev, entry];
          return next.slice(-LOG_LIMIT);
        }),
      onHistory: (entries) => setHistory(entries),
      onInventory: ({ equipped: eq, inventory: inv }) => {
        setEquipped(eq);
        setInventory(inv);
      },
      onMaterials: (payload) => setMaterials(payload),
      onControls: (payload) => setControls(payload),
      onTelemetry: (rows) => setTelemetryRows(rows),
      onStats: (rows) => setStatsRows(rows),
      onCrafting: (payload) => setCrafting(payload),
    });

    harnessRef.current = harness;
    setHarnessReady(false);

    harness
      .init()
      .then(() => {
        if (!cancelled) {
          setHarnessReady(true);
        }
      })
      .catch((err) => {
        console.error("Failed to initialise simulator harness", err);
        if (!cancelled) {
          setLogs((prev) => [...prev, `[Error] ${err instanceof Error ? err.message : String(err)}`]);
        }
      });

    return () => {
      cancelled = true;
      if ((harness as any)?.stopAuto) {
        (harness as any).stopAuto();
      }
      harnessRef.current = null;
    };
  }, []);

  const getItemDefinition = useCallback(
    (itemId: string): ItemDefinition | null => harnessRef.current?.getItemDefinition(itemId) ?? null,
    []
  );

  const getActionState = useCallback(
    (instanceId: string): EquipmentActionState | null =>
      harnessRef.current?.getEquipmentActionState(instanceId) ?? null,
    []
  );

  const handleEquip = useCallback((instanceId: string) => {
    harnessRef.current?.equipFromInventory(instanceId);
  }, []);

  const handleUpgrade = useCallback((instanceId: string) => {
    harnessRef.current?.upgradeOwnedEquipment(instanceId);
  }, []);

  const handleSocket = useCallback((instanceId: string) => {
    harnessRef.current?.socketOwnedEquipment(instanceId);
  }, []);

  const handleSalvage = useCallback((instanceId: string) => {
    harnessRef.current?.salvageOwnedEquipment(instanceId);
  }, []);

  const handleUseConsumable = useCallback((itemId: string) => {
    harnessRef.current?.useConsumableItem(itemId);
  }, []);

  const handleSelectEquipmentRecipe = useCallback((recipeId: string | null) => {
    harnessRef.current?.selectEquipmentRecipe(recipeId);
  }, []);

  const handleSelectConsumableRecipe = useCallback((recipeId: string | null) => {
    harnessRef.current?.selectConsumableRecipe(recipeId);
  }, []);

  const handleSelectMaterialRecipe = useCallback((recipeId: string | null) => {
    harnessRef.current?.selectMaterialRecipe(recipeId);
  }, []);

  const handleCraftEquipment = useCallback((recipeId: string | null) => {
    if (!recipeId) {
      return;
    }
    harnessRef.current?.craftEquipmentRecipe(recipeId);
  }, []);

  const handleEquipCrafted = useCallback((itemId: string | null) => {
    if (!itemId) {
      return;
    }
    harnessRef.current?.equipCraftedResult(itemId);
  }, []);

  const handleCraftConsumable = useCallback((recipeId: string | null) => {
    if (!recipeId) {
      return;
    }
    harnessRef.current?.craftConsumableRecipe(recipeId);
  }, []);

  const handleUseCraftedConsumable = useCallback((itemId: string | null) => {
    if (!itemId) {
      return;
    }
    harnessRef.current?.useConsumableItem(itemId);
  }, []);

  const handleCraftMaterial = useCallback((recipeId: string | null) => {
    if (!recipeId) {
      return;
    }
    harnessRef.current?.craftMaterialRecipe(recipeId);
  }, []);

  const handleStart = useCallback(() => {
    harnessRef.current?.startSimulation();
  }, []);

  const handlePause = useCallback(() => {
    harnessRef.current?.pauseSimulation();
  }, []);

  const handleReset = useCallback(() => {
    harnessRef.current?.resetSimulation(true);
  }, []);

  const handleTickChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const next = parseFloat(event.target.value);
    if (!Number.isNaN(next)) {
      harnessRef.current?.updateTickInterval(next);
    }
  }, []);

  const handleHeroChange = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    const heroId = event.target.value;
    if (heroId) {
      harnessRef.current?.selectHero(heroId);
    }
  }, []);

  const handleStageChange = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    const index = parseInt(event.target.value, 10);
    if (Number.isFinite(index)) {
      harnessRef.current?.selectStage(index);
    }
  }, []);

  const handleLootChange = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value;
    harnessRef.current?.selectLoot(value || null);
  }, []);

  const handleAutoResumeToggle = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    harnessRef.current?.setAutoResume(event.target.checked);
  }, []);

  const rewardRows = useMemo(() => {
    if (!rewards) {
      return [];
    }
    const formatMaterials = (materials: Record<string, number>) =>
      Object.entries(materials)
        .map(([id, qty]) => `${id} x${qty}`)
        .join(", ");

    const equipmentLast = formatEquipmentList(rewards.last);
    const equipmentTotal = formatEquipmentList(rewards.total);
    const augmentLast = formatAugmentList(rewards.last);
    const augmentTotal = formatAugmentList(rewards.total);

    return [
      { label: "XP", last: `${rewards.last.xp}`, total: `${rewards.total.xp}` },
      { label: "Gold", last: `${rewards.last.gold}`, total: `${rewards.total.gold}` },
      {
        label: "Materials",
        last: formatMaterials(rewards.last.materials) || "-",
        total: formatMaterials(rewards.total.materials) || "-",
      },
      {
        label: "Equipment",
        last: equipmentLast || "-",
        total: equipmentTotal || "-",
      },
      {
        label: "Augments",
        last: augmentLast || "-",
        total: augmentTotal || "-",
      },
    ];
  }, [rewards]);

  const materialRows = useMemo(() => {
    if (!materials) {
      return [];
    }
    return Object.entries(materials.materials).sort((a, b) => a[0].localeCompare(b[0]));
  }, [materials]);

  const consumableRows = useMemo(() => {
    if (!materials) {
      return [];
    }
    return Object.entries(materials.consumables).sort((a, b) => a[0].localeCompare(b[0]));
  }, [materials]);

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div className="controls-group">
          <button type="button" onClick={handleStart} disabled={!harnessReady || controls?.isRunning}>Start</button>
          <button type="button" onClick={handlePause} disabled={!harnessReady || !controls?.isRunning}>Pause</button>
          <button type="button" onClick={handleReset} disabled={!harnessReady}>Reset</button>
        </div>
        <div className="input-group">
          <label className="input-field">
            Tick (s)
            <input
              type="number"
              step="0.05"
              min="0.01"
              value={controls ? controls.tickInterval.toFixed(2) : "0.10"}
              onChange={handleTickChange}
              disabled={!harnessReady}
            />
          </label>
          <label className="input-field">
            Hero
            <select
              value={controls?.selectedHeroId ?? ""}
              onChange={handleHeroChange}
              disabled={!harnessReady || !controls?.heroOptions.length}
            >
              {controls?.heroOptions.length ? (
                controls.heroOptions.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))
              ) : (
                <option value="" disabled>
                  Loading heroes...
                </option>
              )}
            </select>
          </label>
          <label className="input-field">
            Stage
            <select
              value={String(controls?.selectedStageIndex ?? 0)}
              onChange={handleStageChange}
              disabled={!harnessReady || !controls?.stageOptions.length}
            >
              {controls?.stageOptions.length ? (
                controls.stageOptions.map((option) => (
                  <option key={option.index} value={option.index}>{option.label}</option>
                ))
              ) : (
                <option value="0" disabled>
                  Loading stages...
                </option>
              )}
            </select>
          </label>
          <label className="input-field">
            Loot Table
            <select
              value={controls?.selectedLootId ?? ""}
              onChange={handleLootChange}
              disabled={!harnessReady || !controls?.lootOptions.length}
            >
              {controls?.lootOptions.length ? (
                controls.lootOptions.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))
              ) : (
                <option value="" disabled>
                  Loading loot tables...
                </option>
              )}
            </select>
          </label>
          <label className="input-field toggle-field">
            Auto Resume
            <input
              type="checkbox"
              checked={controls?.autoResume ?? false}
              onChange={handleAutoResumeToggle}
              disabled={!harnessReady}
            />
          </label>
        </div>
      </header>

      <main className="content-grid">
        <section className="panel status-panel">
          <h2>Status</h2>
          <div id="status-text" className="status-text">{status?.label ?? "Idle"}</div>
          <table className="status-table">
            <tbody>
              <tr><th>Stage</th><td>{status?.stage ?? "-"}</td></tr>
              <tr><th>Wave</th><td>{status?.wave ?? 0}</td></tr>
              <tr><th>Opponent</th><td>{status?.opponent ?? "-"}</td></tr>
              <tr><th>Elapsed</th><td>{status ? `${status.elapsedSeconds.toFixed(1)}s` : "0.0s"}</td></tr>
              <tr><th>Swings</th><td>{status?.swings ?? 0}</td></tr>
              <tr><th>Hero Dmg</th><td>{status?.heroDamage ?? 0}</td></tr>
              <tr><th>Enemy Dmg</th><td>{status?.enemyDamage ?? 0}</td></tr>
              <tr><th>Winner</th><td>{status?.winner ?? "-"}</td></tr>
            </tbody>
          </table>
        </section>

        <section className="panel rewards-panel">
          <h2>Rewards</h2>
          <table>
            <thead>
              <tr><th>Metric</th><th>Last</th><th>Total</th></tr>
            </thead>
            <tbody>
              {rewardRows.length ? (
                rewardRows.map((row) => (
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

        <section className="panel telemetry-panel">
          <h2>Telemetry</h2>
          <table>
            <thead>
              <tr><th>Metric</th><th>Hero</th><th>Enemy</th></tr>
            </thead>
            <tbody>
              {telemetryRows.length ? (
                telemetryRows.map((row) => (
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

        <section className="panel stats-panel">
          <h2>Hero Snapshot</h2>
          <table>
            <thead>
              <tr><th>Stat</th><th>Value</th></tr>
            </thead>
            <tbody>
              {statsRows.length ? (
                statsRows.map((row) => (
                  <tr key={row.label}>
                    <th>{row.label}</th>
                    <td>{row.value}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={2}>No stats available</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <section className="panel equipment-panel">
          <h2>Equipment & Inventory</h2>
          <div className="equipment-grid">
            <div className="equipment-column">
              <h3>Equipped</h3>
              <table>
                <thead>
                  <tr><th>Slot</th><th>Item</th><th></th></tr>
                </thead>
                <tbody>
                  {(Object.entries(equipped) as Array<[EquippedSlotKey, OwnedEquipment | null]>).map(([slotKey, owned]) => {
                    const definition = owned ? getItemDefinition(owned.itemId) : null;
                    const actions = owned ? getActionState(owned.instanceId) : null;
                    return (
                      <tr key={slotKey}>
                        <th>{slotKey}</th>
                        <td>
                          {owned ? (
                            <div className="item-cell">
                              <div className="item-name">{definition?.name ?? owned.itemId}</div>
                              <div className="item-meta">{formatOwnedSummary(owned, definition)}</div>
                              {owned.augments.length ? (
                                <div className="item-meta">
                                  Augments: {formatAugmentNames(owned.augments, getItemDefinition)}
                                </div>
                              ) : null}
                            </div>
                          ) : (
                            "Empty"
                          )}
                        </td>
                        <td>
                          {owned && actions ? (
                            <div className="table-actions">
                              <button
                                type="button"
                                onClick={() => handleUpgrade(owned.instanceId)}
                                disabled={!harnessReady || actions.upgrade.disabled}
                                title={actions.upgrade.title}
                              >
                                {actions.upgrade.label}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleSocket(owned.instanceId)}
                                disabled={!harnessReady || actions.socket.disabled}
                                title={actions.socket.title}
                              >
                                {actions.socket.label}
                              </button>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="equipment-column">
              <h3>Inventory</h3>
              <table>
                <thead>
                  <tr><th>Item</th><th>Details</th><th></th></tr>
                </thead>
                <tbody>
                  {inventory.length === 0 ? (
                    <tr>
                      <td colSpan={3}>Inventory empty</td>
                    </tr>
                  ) : (
                    inventory.map((owned) => {
                      const definition = getItemDefinition(owned.itemId);
                      const actions = getActionState(owned.instanceId);
                      return (
                        <tr key={owned.instanceId}>
                          <td>
                            <div className="item-cell">
                              <div className="item-name">{definition?.name ?? owned.itemId}</div>
                              <div className="item-meta">{formatOwnedSummary(owned, definition)}</div>
                            </div>
                          </td>
                          <td>
                            <div className="item-meta">{describeItemDetails(owned, definition, getItemDefinition)}</div>
                          </td>
                          <td>
                            <div className="table-actions">
                              <button
                                type="button"
                                onClick={() => handleEquip(owned.instanceId)}
                                disabled={!harnessReady}
                                title={definition?.slot ? `Equip to ${definition.slot}` : "Equip"}
                              >
                                Equip
                              </button>
                              <button
                                type="button"
                                onClick={() => handleUpgrade(owned.instanceId)}
                                disabled={!harnessReady || (actions?.upgrade.disabled ?? true)}
                                title={actions?.upgrade.title ?? "Upgrade"}
                              >
                                {actions?.upgrade.label ?? "Upgrade"}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleSocket(owned.instanceId)}
                                disabled={!harnessReady || (actions?.socket.disabled ?? true)}
                                title={actions?.socket.title ?? "Socket"}
                              >
                                {actions?.socket.label ?? "Socket"}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleSalvage(owned.instanceId)}
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
                  <tr><th>Material</th><th>Qty</th></tr>
                </thead>
                <tbody>
                  {materialRows.length === 0 ? (
                    <tr>
                      <td colSpan={2}>No materials</td>
                    </tr>
                  ) : (
                    materialRows.map(([id, qty]) => (
                      <tr key={id}>
                        <td>{id}</td>
                        <td>{qty}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div>
              <h3>Consumables & Augments</h3>
              <table>
                <thead>
                  <tr><th>Item</th><th>Qty</th><th></th></tr>
                </thead>
                <tbody>
                  {consumableRows.length === 0 ? (
                    <tr>
                      <td colSpan={3}>No consumables</td>
                    </tr>
                  ) : (
                    consumableRows.map(([id, qty]) => {
                      const definition = getItemDefinition(id);
                      const label = definition?.name ?? id;
                      const typeLabel = definition ? ` (${titleCase(definition.type)})` : "";
                      const isConsumable = definition?.type === "consumable";
                      return (
                        <tr key={id}>
                          <td>{label}{typeLabel}</td>
                          <td>{qty}</td>
                          <td>
                            {isConsumable ? (
                              <div className="table-actions">
                                <button
                                  type="button"
                                  onClick={() => handleUseConsumable(id)}
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
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="panel crafting-panel">
          <h2>Crafting & Refinement</h2>
          {crafting ? (
            <div className="crafting-stack">
              <div className="craft-row">
                <label className="input-field">
                  Equipment Recipe
                  <select
                    value={crafting.equipment.selectedId ?? ""}
                    onChange={(event) =>
                      handleSelectEquipmentRecipe(event.target.value ? event.target.value : null)
                    }
                  >
                    {crafting.equipment.options.length === 0 ? (
                      <option value="" disabled>No equipment recipes</option>
                    ) : (
                      crafting.equipment.options.map((option) => (
                        <option key={option.id} value={option.id}>{option.label}</option>
                      ))
                    )}
                  </select>
                </label>
                <div className="craft-details">
                  {crafting.equipment.details.map((line, index) => (
                    <div key={`equip-detail-${index}`}>{line}</div>
                  ))}
                </div>
                <div className="craft-buttons">
                  <button
                    type="button"
                    onClick={() => handleCraftEquipment(crafting.equipment.selectedId)}
                    disabled={!harnessReady || crafting.equipment.primaryAction.disabled}
                    title={crafting.equipment.primaryAction.title}
                  >
                    {crafting.equipment.primaryAction.label}
                  </button>
                  {crafting.equipment.secondaryAction ? (
                    <button
                      type="button"
                      onClick={() =>
                        handleEquipCrafted(crafting.equipment.selectedOption?.resultId ?? null)
                      }
                      disabled={
                        !harnessReady || crafting.equipment.secondaryAction.disabled
                      }
                      title={crafting.equipment.secondaryAction.title}
                    >
                      {crafting.equipment.secondaryAction.label}
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="craft-row">
                <label className="input-field">
                  Consumable Recipe
                  <select
                    value={crafting.consumables.selectedId ?? ""}
                    onChange={(event) =>
                      handleSelectConsumableRecipe(event.target.value ? event.target.value : null)
                    }
                  >
                    {crafting.consumables.options.length === 0 ? (
                      <option value="" disabled>No consumable recipes</option>
                    ) : (
                      crafting.consumables.options.map((option) => (
                        <option key={option.id} value={option.id}>{option.label}</option>
                      ))
                    )}
                  </select>
                </label>
                <div className="craft-details">
                  {crafting.consumables.details.map((line, index) => (
                    <div key={`consumable-detail-${index}`}>{line}</div>
                  ))}
                </div>
                <div className="craft-buttons">
                  <button
                    type="button"
                    onClick={() => handleCraftConsumable(crafting.consumables.selectedId)}
                    disabled={!harnessReady || crafting.consumables.primaryAction.disabled}
                    title={crafting.consumables.primaryAction.title}
                  >
                    {crafting.consumables.primaryAction.label}
                  </button>
                  {crafting.consumables.secondaryAction ? (
                    <button
                      type="button"
                      onClick={() =>
                        handleUseCraftedConsumable(
                          crafting.consumables.selectedOption?.resultId ?? null
                        )
                      }
                      disabled={
                        !harnessReady || crafting.consumables.secondaryAction.disabled
                      }
                      title={crafting.consumables.secondaryAction.title}
                    >
                      {crafting.consumables.secondaryAction.label}
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="craft-row">
                <label className="input-field">
                  Material Refinement
                  <select
                    value={crafting.materials.selectedId ?? ""}
                    onChange={(event) =>
                      handleSelectMaterialRecipe(event.target.value ? event.target.value : null)
                    }
                  >
                    {crafting.materials.options.length === 0 ? (
                      <option value="" disabled>No material recipes</option>
                    ) : (
                      crafting.materials.options.map((option) => (
                        <option key={option.id} value={option.id}>{option.label}</option>
                      ))
                    )}
                  </select>
                </label>
                <div className="craft-details">
                  {crafting.materials.details.map((line, index) => (
                    <div key={`material-detail-${index}`}>{line}</div>
                  ))}
                </div>
                <div className="craft-buttons">
                  <button
                    type="button"
                    onClick={() => handleCraftMaterial(crafting.materials.selectedId)}
                    disabled={!harnessReady || crafting.materials.primaryAction.disabled}
                    title={crafting.materials.primaryAction.title}
                  >
                    {crafting.materials.primaryAction.label}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div>Crafting data not available.</div>
          )}
        </section>

        <section className="panel log-panel">
          <h2>Event Log</h2>
          <div id="log-output" className="log-output">
            {logs.map((entry, idx) => (
              <div key={`log-${idx}`}>{entry}</div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
};

function formatEquipmentList(rewards: EncounterRewards): string {
  return rewards.equipment
    .map((entry) => `${entry.itemId} (${entry.rarity}) x${entry.quantity}`)
    .join(", ");
}

function formatAugmentList(rewards: EncounterRewards): string {
  return rewards.augments
    .map((entry) => `${entry.augmentId} x${entry.quantity}`)
    .join(", ");
}

function formatRewardsShort(rewards: EncounterRewards): string {
  const parts: string[] = [];
  if (rewards.xp) {
    parts.push(`XP ${rewards.xp}`);
  }
  if (rewards.gold) {
    parts.push(`Gold ${rewards.gold}`);
  }
  const materials = Object.entries(rewards.materials ?? {})
    .map(([id, qty]) => `${id} x${qty}`)
    .join(", ");
  if (materials) {
    parts.push(materials);
  }
  const eq = formatEquipmentList(rewards);
  if (eq) {
    parts.push(`Eq: ${eq}`);
  }
  const aug = formatAugmentList(rewards);
  if (aug) {
    parts.push(`Aug: ${aug}`);
  }
  return parts.length ? parts.join("; ") : "-";
}

function formatOwnedSummary(owned: OwnedEquipment, definition: ItemDefinition | null): string {
  const parts: string[] = [];
  if (definition?.tier) {
    parts.push(`Tier ${definition.tier}`);
  }
  parts.push(titleCase(owned.rarity));
  parts.push(`+${owned.upgradeLevel}/${owned.maxUpgradeLevel}`);
  if (definition?.slot) {
    parts.push(definition.slot);
  }
  if (owned.socketSlots > 0) {
    parts.push(`Sockets ${owned.augments.length}/${owned.socketSlots}`);
  }
  return parts.join(" • ");
}

function describeItemDetails(
  owned: OwnedEquipment,
  definition: ItemDefinition | null,
  resolver: (id: string) => ItemDefinition | null
): string {
  if (!definition) {
    return `Item ID: ${owned.itemId}`;
  }
  const parts: string[] = [];
  if (definition.type === "weapon" && definition.weapon) {
    parts.push(
      `Damage ${definition.weapon.minDamage}-${definition.weapon.maxDamage} @ ${definition.weapon.delay}s`
    );
  } else if (definition.type === "armor" && definition.armor) {
    parts.push(`Armor ${definition.armor.armor}`);
  } else {
    parts.push(titleCase(definition.type));
  }
  if (owned.augments.length) {
    parts.push(`Augments: ${formatAugmentNames(owned.augments, resolver)}`);
  }
  return parts.join(" • ") || "-";
}

function formatAugmentNames(
  augmentIds: string[],
  resolver: (id: string) => ItemDefinition | null
): string {
  return augmentIds
    .map((augmentId) => resolver(augmentId)?.name ?? augmentId)
    .join(", ");
}

function titleCase(value: string): string {
  if (!value) {
    return "";
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export default App;
