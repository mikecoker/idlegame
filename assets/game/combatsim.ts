import { Character } from "./character";

export class CombatSim {
  checkToHit(attacker: Character, defender: Character): boolean {
    // check dodge

    // offense + weapon skill & buffs add to accuracy

    // accuracy vs avoidance
    return true;
  }

  calculateDamage(attacker: Character, defender: Character): number {
    return 1;
  }

  doCombat(attacker: Character, defender: Character) {
    if (this.checkToHit(attacker, defender)) {
      const dmg = this.calculateDamage(attacker, defender);
      attacker.applyDamage(dmg);
    }
  }
}
