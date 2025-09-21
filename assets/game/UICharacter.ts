import { _decorator, Component, instantiate, Node, Prefab } from "cc";
import { UIStatLine } from "./UIStatLine";
import { Character } from "./character";
const { ccclass, property } = _decorator;

@ccclass("UICharacter")
export class UICharacter extends Component {
  protected _statLines: Map<string, UIStatLine> = new Map();
  protected _character: Character | null = null;

  @property(Prefab)
  statLinePrefab: Prefab = null;

  start() {}

  setCharacter(character: Character) {
    this._character = character;
    this.clearStatLines();

    const statNames = this.getStatNames(character);
    statNames.forEach((statName) => {
      const value = this.readStatValue(character, statName);
      const statLineNode = instantiate(this.statLinePrefab);
      this.node.addChild(statLineNode);

      const uiStatLine = statLineNode.getComponent(UIStatLine);
      uiStatLine.setStat(statName, value);
      this._statLines.set(statName, uiStatLine);
    });
  }

  refreshValues() {
    if (!this._character) {
      return;
    }

    this._statLines.forEach((line, statName) => {
      const value = this.readStatValue(this._character, statName);
      line.setValue(value);
    });
  }

  protected clearStatLines() {
    this._statLines.forEach((line) => {
      line.node.destroy();
    });
    this._statLines.clear();
  }

  protected getStatNames(character: Character): string[] {
    return Object.entries(
      Object.getOwnPropertyDescriptors(Reflect.getPrototypeOf(character))
    )
      .filter((entry) => typeof entry[1].get === "function" && entry[0] !== "__proto__")
      .map((entry) => entry[0]);
  }

  protected readStatValue(character: Character, statName: string): string {
    const rawValue = (character as any)[statName];
    if (typeof rawValue === "number") {
      if (statName.toLowerCase().includes("percent")) {
        return `${(rawValue * 100).toFixed(1)}%`;
      }
      return Number.isInteger(rawValue)
        ? rawValue.toString()
        : rawValue.toFixed(2);
    }
    return `${rawValue}`;
  }
}
