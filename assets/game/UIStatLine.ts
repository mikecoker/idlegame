import { _decorator, Component, Label, Node } from "cc";
const { ccclass, property } = _decorator;

@ccclass("UIStatLine")
export class UIStatLine extends Component {
  @property(Label)
  stat: Label = null;

  @property(Label)
  value: Label = null;

  public setStat(stat: string, value: string) {
    this.stat.string = stat;
    this.value.string = value;
  }
}
