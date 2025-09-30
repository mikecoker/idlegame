import type { FC } from "react";

type TabKey = "hero" | "crafting" | "dungeon" | "arena";

interface TabStripProps {
  active: TabKey;
  onChange(tab: TabKey): void;
}

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "hero", label: "Hero & Inventory" },
  { key: "crafting", label: "Crafting" },
  { key: "dungeon", label: "Dungeon Sim" },
  { key: "arena", label: "Training Arena" },
];

const TabStrip: FC<TabStripProps> = ({ active, onChange }) => (
  <nav className="tab-strip">
    {TABS.map((tab) => (
      <button
        key={tab.key}
        type="button"
        className={`tab-button ${active === tab.key ? "tab-button-active" : ""}`}
        onClick={() => onChange(tab.key)}
      >
        {tab.label}
      </button>
    ))}
  </nav>
);

export type { TabKey };
export default TabStrip;
