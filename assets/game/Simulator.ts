import { _decorator, Component, JsonAsset, Node } from "cc";
import { CombatSim } from "./combatsim";
import { Character, CharacterData } from "./character";
import { UICharacter } from "./UICharacter";
const { ccclass, property } = _decorator;

@ccclass("Simulator")
export class Simulator extends Component {
  @property(JsonAsset)
  characterOneData: JsonAsset = null;

  @property(UICharacter)
  srcCharacter: UICharacter = null;

  @property(JsonAsset)
  characterTwoData: JsonAsset = null;

  @property(UICharacter)
  dstCharacter: UICharacter = null;

  protected _sim: CombatSim;
  protected _src: Character;
  protected _dst: Character;

  start() {
    this._sim = new CombatSim();

    const srcData = this.characterOneData.json as any;
    this._src = new Character(srcData);
    this.srcCharacter.setCharacter(this._src);

    const dstData = this.characterTwoData.json as CharacterData;
    this._dst = new Character(dstData);
    this.dstCharacter.setCharacter(this._dst);
  }

  doTurn() {
    const dmg = this._sim.doCombat(this._src, this._dst);
    console.log(`src hits dst for ${dmg} damage`);

    const dmg2 = this._sim.doCombat(this._dst, this._src);
    console.log(`dst hits src for ${dmg2} damage`);
  }

  update(deltaTime: number) {}
}
