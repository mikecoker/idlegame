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
  StatPreviewRow,
} from "./legacyHarness";
import ControlBar from "./components/ControlBar";
import CraftingPanel from "./components/CraftingPanel";
import HistoryPanel from "./components/HistoryPanel";
import InventoryPanel from "./components/InventoryPanel";
import LogPanel from "./components/LogPanel";
import Paperdoll from "./components/Paperdoll";
import RewardsPanel, { RewardsRow } from "./components/RewardsPanel";
import StatusPanel from "./components/StatusPanel";
import TelemetryPanel from "./components/TelemetryPanel";
import { formatAugmentList, formatEquipmentList } from "./utils/formatting";
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

  const handleUnequipSlot = useCallback((slot: EquippedSlotKey) => {
    harnessRef.current?.unequipSlot(slot);
  }, []);

  const getEquipPreview = useCallback(
    (instanceId: string): StatPreviewRow[] | null =>
      harnessRef.current?.getEquipPreview(instanceId) ?? null,
    []
  );

  const rewardRows: RewardsRow[] = useMemo(() => {
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

  return (
    <div className="app-shell">
      <ControlBar
        controls={controls}
        harnessReady={harnessReady}
        onStart={handleStart}
        onPause={handlePause}
        onReset={handleReset}
        onTickChange={handleTickChange}
        onHeroChange={handleHeroChange}
        onStageChange={handleStageChange}
        onLootChange={handleLootChange}
        onAutoResumeToggle={handleAutoResumeToggle}
      />

      <main className="content-grid">
        <StatusPanel status={status} />
        <RewardsPanel rows={rewardRows} />
        <TelemetryPanel rows={telemetryRows} />
        <HistoryPanel history={history} />
        <section className="panel paperdoll-panel">
          <h2>Hero Loadout</h2>
          <Paperdoll
            equipped={equipped}
            resolveItem={getItemDefinition}
            stats={statsRows}
            onUnequip={handleUnequipSlot}
          />
        </section>
        <InventoryPanel
          inventory={inventory}
          materials={materials}
          harnessReady={harnessReady}
          resolveItem={getItemDefinition}
          getActionState={getActionState}
          getPreview={getEquipPreview}
          onEquip={handleEquip}
          onUpgrade={handleUpgrade}
          onSocket={handleSocket}
          onSalvage={handleSalvage}
          onUseConsumable={handleUseConsumable}
        />
        <CraftingPanel
          crafting={crafting}
          harnessReady={harnessReady}
          onSelectEquipment={handleSelectEquipmentRecipe}
          onSelectConsumable={handleSelectConsumableRecipe}
          onSelectMaterial={handleSelectMaterialRecipe}
          onCraftEquipment={handleCraftEquipment}
          onEquipCrafted={handleEquipCrafted}
          onCraftConsumable={handleCraftConsumable}
          onUseConsumable={handleUseCraftedConsumable}
          onCraftMaterial={handleCraftMaterial}
        />
        <LogPanel logs={logs} />
      </main>
    </div>
  );
};

export default App;
