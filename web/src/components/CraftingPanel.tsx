import type { FC } from "react";
import type { CraftingStatePayload, CraftingGroupState } from "../legacyHarness";

interface CraftingPanelProps {
  crafting: CraftingStatePayload | null;
  harnessReady: boolean;
  onSelectEquipment(id: string | null): void;
  onSelectConsumable(id: string | null): void;
  onSelectMaterial(id: string | null): void;
  onCraftEquipment(id: string | null): void;
  onEquipCrafted(resultId: string | null): void;
  onCraftConsumable(id: string | null): void;
  onUseConsumable(resultId: string | null): void;
  onCraftMaterial(id: string | null): void;
}

const CraftingPanel: FC<CraftingPanelProps> = ({
  crafting,
  harnessReady,
  onSelectEquipment,
  onSelectConsumable,
  onSelectMaterial,
  onCraftEquipment,
  onEquipCrafted,
  onCraftConsumable,
  onUseConsumable,
  onCraftMaterial,
}) => (
  <section className="panel crafting-panel">
    <h2>Crafting & Refinement</h2>
    {crafting ? (
      <div className="crafting-stack">
        <CraftingRow
          title="Equipment Recipe"
          group={crafting.equipment}
          harnessReady={harnessReady}
          onSelect={onSelectEquipment}
          onPrimary={(id) => onCraftEquipment(id)}
          onSecondary={(option) => onEquipCrafted(option?.resultId ?? null)}
        />
        <CraftingRow
          title="Consumable Recipe"
          group={crafting.consumables}
          harnessReady={harnessReady}
          onSelect={onSelectConsumable}
          onPrimary={(id) => onCraftConsumable(id)}
          onSecondary={(option) => onUseConsumable(option?.resultId ?? null)}
        />
        <CraftingRow
          title="Material Refinement"
          group={crafting.materials}
          harnessReady={harnessReady}
          onSelect={onSelectMaterial}
          onPrimary={(id) => onCraftMaterial(id)}
        />
      </div>
    ) : (
      <div>Crafting data not available.</div>
    )}
  </section>
);

interface CraftingRowProps {
  title: string;
  group: CraftingGroupState;
  harnessReady: boolean;
  onSelect(id: string | null): void;
  onPrimary(id: string | null): void;
  onSecondary?(option: CraftingGroupState["selectedOption"]): void;
}

const CraftingRow: FC<CraftingRowProps> = ({
  title,
  group,
  harnessReady,
  onSelect,
  onPrimary,
  onSecondary,
}) => (
  <div className="craft-row">
    <label className="input-field">
      {title}
      <select
        value={group.selectedId ?? ""}
        onChange={(event) => onSelect(event.target.value ? event.target.value : null)}
      >
        {group.options.length === 0 ? (
          <option value="" disabled>
            No recipes
          </option>
        ) : (
          group.options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))
        )}
      </select>
    </label>
    <div className="craft-details">
      {group.details.map((line, index) => (
        <div key={`${group.type}-detail-${index}`}>{line}</div>
      ))}
    </div>
    <div className="craft-buttons">
      <button
        type="button"
        onClick={() => onPrimary(group.selectedId)}
        disabled={!harnessReady || group.primaryAction.disabled}
        title={group.primaryAction.title}
      >
        {group.primaryAction.label}
      </button>
      {onSecondary && group.secondaryAction ? (
        <button
          type="button"
          onClick={() => onSecondary(group.selectedOption)}
          disabled={!harnessReady || group.secondaryAction.disabled}
          title={group.secondaryAction.title}
        >
          {group.secondaryAction.label}
        </button>
      ) : null}
    </div>
  </div>
);

export default CraftingPanel;
