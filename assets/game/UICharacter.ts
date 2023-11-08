import { _decorator, Component, instantiate, Node, Prefab } from "cc";
import { UIStatLine } from "./UIStatLine";
import { Character } from "./character";
const { ccclass, property } = _decorator;

@ccclass("UICharacter")
export class UICharacter extends Component {
  protected _stats: UIStatLine[] = [];

  @property(Prefab)
  statLinePrefab: Prefab = null;

  start() {}

  setCharacter(character: Character) {
    this._stats.forEach((stat) => {
      stat.node.destroy();
    });
    this._stats = [];

    // const statNames = Object.keys(character).filter((key) => {
    //   return typeof character[key] !== "function";
    // });

    const statNames = Object.entries(
      Object.getOwnPropertyDescriptors(Reflect.getPrototypeOf(character))
    )
      .filter((e) => typeof e[1].get === "function" && e[0] !== "__proto__")
      .map((e) => e[0]);

    statNames.forEach((statName) => {
      const stat = character[statName];
      const statLine = instantiate(this.statLinePrefab);
      this.node.addChild(statLine);

      const uiStatLine = statLine.getComponent(UIStatLine);
      uiStatLine.setStat(statName, stat.toString());
      this._stats.push(uiStatLine);
    });
  }
}
