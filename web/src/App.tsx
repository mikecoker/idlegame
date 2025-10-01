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
} from "./simulatorHarness";
import ControlBar from "./components/ControlBar";
import CraftingPanel from "./components/CraftingPanel";
import HistoryPanel from "./components/HistoryPanel";
import PartyPanel from "./components/PartyPanel";
import InventoryPanel from "./components/InventoryPanel";
import LogPanel from "./components/LogPanel";
import Paperdoll from "./components/Paperdoll";
import RewardsPanel, { RewardsRow, RewardPreview } from "./components/RewardsPanel";
import StatusPanel from "./components/StatusPanel";
import TabStrip, { TabKey } from "./components/TabStrip";
import ArenaPanel from "./components/ArenaPanel";
import TelemetryPanel from "./components/TelemetryPanel";
import { formatAugmentList, formatEquipmentList } from "@core/utils/formatting";
import type { StagePreview } from "@core/progression/StageGenerator";
import "./styles/App.css";

const LOG_LIMIT = 300;

const App = () => {
  const harnessRef = useRef<SimulatorHarness | null>(null);
  const [harnessReady, setHarnessReady] = useState(false);
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("hero");
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
    Boot: null,
    Hand: null,
  });
  const [inventory, setInventory] = useState<OwnedEquipment[]>([]);
  const [selectedGearHeroId, setSelectedGearHeroId] = useState<string | null>(null);

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

  const gearHeroOptions = useMemo(() => {
    if (!controls?.partySlots) {
      return [] as Array<{ id: string; label: string }>;
    }
    return controls.partySlots
      .filter((slot) => slot.heroId && slot.unlocked)
      .map((slot) => ({
        id: slot.heroId as string,
        label: slot.heroLabel ?? (slot.heroId as string),
      }));
  }, [controls?.partySlots]);

  const selectedGearHeroLabel = useMemo(() => {
    if (selectedGearHeroId) {
      return (
        gearHeroOptions.find((option) => option.id === selectedGearHeroId)?.label ??
        selectedGearHeroId
      );
    }
    return gearHeroOptions[0]?.label ?? "Hero";
  }, [gearHeroOptions, selectedGearHeroId]);

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

  const handleSalvageAll = useCallback(() => {
    harnessRef.current?.salvageAllInventory();
  }, []);

  const handleEquipBest = useCallback(() => {
    harnessRef.current?.equipBestGear();
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

  useEffect(() => {
    const harness = harnessRef.current;
    if (!harness || !harnessReady) {
      return;
    }
    if (!gearHeroOptions.length) {
      if (selectedGearHeroId !== null) {
        setSelectedGearHeroId(null);
      }
      harness.setActiveGearHero(null);
      return;
    }
    const availableIds = gearHeroOptions.map((option) => option.id);
    let nextId = selectedGearHeroId;
    if (!nextId || !availableIds.includes(nextId)) {
      if (controls?.primaryHeroId && availableIds.includes(controls.primaryHeroId)) {
        nextId = controls.primaryHeroId;
      } else {
        nextId = gearHeroOptions[0].id;
      }
      if (nextId !== selectedGearHeroId) {
        setSelectedGearHeroId(nextId);
      }
    }
    harness.setActiveGearHero(nextId);
  }, [harnessReady, gearHeroOptions, controls?.primaryHeroId, selectedGearHeroId]);

  const handleGearHeroChange = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value;
    const heroId = value || null;
    setSelectedGearHeroId(heroId);
    harnessRef.current?.setActiveGearHero(heroId);
  }, []);

  useEffect(() => {
    if (!harnessReady) {
      return;
    }
    const activeHero = harnessRef.current?.getActiveGearHeroId() ?? null;
    if (activeHero && activeHero !== selectedGearHeroId) {
      setSelectedGearHeroId(activeHero);
    }
  }, [harnessReady, selectedGearHeroId]);

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

  const handlePartyAssign = useCallback((slotIndex: number, heroId: string | null) => {
    harnessRef.current?.assignPartySlot(slotIndex, heroId);
  }, []);

  const handlePartySwap = useCallback((sourceIndex: number, targetIndex: number) => {
    if (sourceIndex < 0 || targetIndex < 0) {
      return;
    }
    harnessRef.current?.swapPartySlots(sourceIndex, targetIndex);
  }, []);

  const handlePartyClear = useCallback((slotIndex: number) => {
    harnessRef.current?.clearPartySlot(slotIndex);
  }, []);

  const handlePartyPromote = useCallback((slotIndex: number) => {
    harnessRef.current?.promotePartySlot(slotIndex);
  }, []);

  const handleSelectHero = useCallback((heroId: string) => {
    setSelectedGearHeroId(heroId);
  }, []);

  const handleUsePotion = useCallback((heroId: string) => {
    harnessRef.current?.useHealthPotionOnHero(heroId);
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

  const stagePreview: RewardPreview | null = useMemo(() => {
    const preview = harnessRef.current?.getStagePreview();
    if (!preview) {
      return null;
    }
    return {
      stageNumber: preview.stageNumber,
      stageName: preview.name,
      waveCount: preview.waveCount,
      lootTableId: preview.lootTableId,
      enemyGold: preview.rewards.enemyGold,
      enemyXp: preview.rewards.enemyXp,
      bossGold: preview.rewards.bossGold,
      bossShards: preview.rewards.bossShards,
      bossGemChance: preview.rewards.bossGemChance,
      firstClearBonusPercent: preview.rewards.firstClearBonusPercent,
      bossTimerSeconds: preview.bossConfig.timerSeconds,
      enrageThresholdPercent: preview.bossConfig.enrageHpPercent,
      enrageMultiplier: preview.bossConfig.enrageAttackMultiplier,
    };
  }, [status?.stage, controls?.selectedStageIndex]);

  const permanentBonusPercent = useMemo(() => {
    return harnessRef.current?.getPermanentBonusPercent() ?? 0;
  }, [status?.stage, rewards, controls?.selectedStageIndex]);

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

      <StatusPanel status={status} onUsePotion={handleUsePotion} />
      <TabStrip active={activeTab} onChange={setActiveTab} />

      {activeTab === "hero" ? (
        <main className="content-grid">
          <section className="panel party-panel">
            <h2>Party Composition</h2>
            <PartyPanel
              slots={controls?.partySlots ?? []}
              heroOptions={controls?.heroOptions ?? []}
              unlockedSlots={controls?.unlockedPartySlots ?? 0}
              selectedHeroId={selectedGearHeroId}
              onAssign={handlePartyAssign}
              onClear={handlePartyClear}
              onSwap={handlePartySwap}
              onPromote={handlePartyPromote}
              onSelectHero={handleSelectHero}
            />
          </section>
          <section className="panel paperdoll-panel">
            <h2>Hero Loadout</h2>
            <div className="loadout-selector">
              <label className="input-field">
                Loadout Hero
                <select
                  value={selectedGearHeroId ?? ""}
                  onChange={handleGearHeroChange}
                  disabled={!gearHeroOptions.length}
                >
                  {gearHeroOptions.length ? (
                    gearHeroOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))
                  ) : (
                    <option value="" disabled>
                      No party heroes
                    </option>
                  )}
                </select>
              </label>
            </div>
            <Paperdoll
              heroLabel={selectedGearHeroLabel}
              equipped={equipped}
              resolveItem={getItemDefinition}
              stats={statsRows}
              getActionState={getActionState}
              onUnequip={handleUnequipSlot}
              onUpgrade={handleUpgrade}
              onSocket={handleSocket}
              onEquipBest={handleEquipBest}
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
             onSalvageAll={handleSalvageAll}
             onUseConsumable={handleUseConsumable}
             activeHeroLabel={selectedGearHeroLabel}
           />
        </main>
      ) : null}

      {activeTab === "dungeon" ? (
        <main className="content-grid">
          <RewardsPanel
            rows={rewardRows}
            preview={stagePreview}
            permanentBonusPercent={permanentBonusPercent}
          />
          <TelemetryPanel rows={telemetryRows} />
          <HistoryPanel history={history} />
          <LogPanel logs={logs} />
        </main>
      ) : null}

      {activeTab === "crafting" ? (
        <main className="content-grid">
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
        </main>
      ) : null}

      {activeTab === "arena" ? (
        <ArenaPanel
          isRunning={status?.label === "Running"}
          onStartArena={() => harnessRef.current?.startArena()}
          onStopArena={() => harnessRef.current?.stopArena()}
        />
      ) : null}
    </div>
  );
};

export default App;
