import type { ChangeEvent, FC } from "react";
import type { PartySlotControl, ControlOption } from "../simulatorHarness";

interface PartyPanelProps {
  slots: PartySlotControl[];
  heroOptions: ControlOption[];
  unlockedSlots: number;
  selectedHeroId: string | null;
  onAssign(slotIndex: number, heroId: string | null): void;
  onClear(slotIndex: number): void;
  onSwap(sourceIndex: number, targetIndex: number): void;
  onPromote(slotIndex: number): void;
  onSelectHero(heroId: string): void;
}

const PartyPanel: FC<PartyPanelProps> = ({
  slots,
  heroOptions,
  unlockedSlots,
  selectedHeroId,
  onAssign,
  onClear,
  onSwap,
  onPromote,
  onSelectHero,
}) => {
  if (!slots.length) {
    return <div className="party-empty">Party layout will appear once the simulator is ready.</div>;
  }

  const lastUnlockedIndex = Math.max(0, Math.min(slots.length - 1, unlockedSlots - 1));

  const handleAssign = (slotIndex: number) => (event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value;
    onAssign(slotIndex, value ? value : null);
  };

  return (
    <div className="party-grid">
      {slots.map((slot) => {
        const isLocked = !slot.unlocked;
        const prevIndex = slot.index - 1;
        const nextIndex = slot.index + 1;
        const otherAssignments = new Set(
      slots
        .filter((entry) => entry.index !== slot.index && entry.heroId)
        .map((entry) => entry.heroId as string)
    );

    const slotClass = ["party-slot"];
    if (isLocked) {
      slotClass.push("locked");
    }
    if (slot.isPrimary) {
      slotClass.push("primary");
    }
    if (slot.heroId === selectedHeroId) {
      slotClass.push("selected");
    }

    return (
      <div
        key={slot.index}
        className={slotClass.join(" ")}
        onClick={() => slot.heroId && onSelectHero(slot.heroId)}
        style={{ cursor: slot.heroId ? 'pointer' : 'default' }}
      >
        <div className="party-slot-header">
          <span>Slot {slot.index + 1}</span>
          <div className="party-slot-header-right">
            {slot.heroLabel ? <span className="party-slot-label">{slot.heroLabel}</span> : null}
            {slot.isPrimary ? <span className="party-slot-badge">Leader</span> : null}
          </div>
        </div>

        {isLocked ? (
          <div className="party-slot-lock-info">Unlocks at stage {slot.unlockStage}</div>
        ) : (
              <div className="party-slot-body">
                <label className="party-slot-select">
                  Hero
                  <select
                    value={slot.heroId ?? ""}
                    onChange={handleAssign(slot.index)}
                    disabled={!heroOptions.length}
                  >
                    <option value="">Empty</option>
                    {heroOptions.map((option) => (
                      <option
                        key={option.id}
                        value={option.id}
                        disabled={option.id !== slot.heroId && otherAssignments.has(option.id)}
                      >
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="party-slot-actions">
                  <button
                    type="button"
                    onClick={() => onSwap(slot.index, prevIndex)}
                    disabled={prevIndex < 0 || !slots[prevIndex]?.unlocked}
                  >
                    Move Up
                  </button>
                  <button
                    type="button"
                    onClick={() => onSwap(slot.index, nextIndex)}
                    disabled={nextIndex > lastUnlockedIndex || !slots[nextIndex]?.unlocked}
                  >
                    Move Down
                  </button>
                  <button
                    type="button"
                    onClick={() => onPromote(slot.index)}
                    disabled={slot.isPrimary || !slot.heroId}
                  >
                    Set Leader
                  </button>
                  <button
                    type="button"
                    onClick={() => onClear(slot.index)}
                    disabled={!slot.heroId}
                  >
                    Clear
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default PartyPanel;
