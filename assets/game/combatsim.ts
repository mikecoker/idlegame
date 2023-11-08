import { Character } from "./character";

export class CombatSim {
  randInt(min: number, max?: number): number {
    if (!max) {
      max = min;
      min = 0;
    }
    return Math.floor(Math.random() * max + min);
  }

  checkToHit(attacker: Character, defender: Character): boolean {
    const toHit =
      (200 * attacker.accuracy) / (attacker.accuracy + defender.evasion);
    return this.randInt(100) <= toHit;
  }

  checkToCrit(attacker: Character): boolean {
    return Math.random() < attacker.critPercent;
  }

  getBaseDamage(attacker: Character, mainHand: boolean): number {
    const min = Math.max(
      attacker.getDamage(mainHand, true) * (mainHand ? 1 : 0.5),
      1
    );
    const max = Math.max(
      attacker.getDamage(mainHand, false) * (mainHand ? 1 : 0.5),
      1
    );

    // todo: factor in weapon skill at the current level to determine the amount of the max we can achieve
    return this.randInt(min, max);
  }

  calculateDamage(attacker: Character, defender: Character): number {
    // value = 0.1f * armor / (8.5f * level + 40);
    // value = Math.Max(Math.Min(value, 0.75f), 0);

    const defCap = Math.min(400, defender.defense);
    let dmg = (100 / (100 + defCap)) * attacker.attackPower;
    if (this.checkToCrit(attacker)) {
      dmg *= 2.0;
    }
    return dmg;
  }

  doCombat(attacker: Character, defender: Character) {
    if (this.checkToHit(attacker, defender)) {
      const dmg = this.calculateDamage(attacker, defender);
      return dmg;
    }
    return 0;
  }
}

// Damage = (BaseDamage + SkillDamage) * (1 - ArmorReduction) * RandomFactor
// ArmorReduction = Armor / (Armor + 400)
// RandomFactor = 0.95 + (0.05 * Random(0, 100))
// CriticalHit = Random(0, 100) < CriticalChance
// CriticalDamage = Damage * 2
// Damage = CriticalHit ? CriticalDamage : Damage
// Damage = Damage * (1 - BlockReduction)
// BlockReduction = Block / (Block + 200)
// q: what's the difference between block and armor?
// a: block is a chance to block all damage, armor is a reduction of damage
// q: how can skill damage be calculated?
// a: skill damage is a multiplier on the base damage
// q: how can we calculate skill damage?
// q: how can we get a base damage?
// a: base damage is the character's attack power
// q: how can we calculate attack power?
// a: attack power is a function of strength
// q: what is the exact formula?

// MeleeHitOutcome Unit::RollMeleeOutcomeAgainst(const Unit* pVictim, WeaponAttackType attType, int32 crit_chance, int32 miss_chance, int32 dodge_chance, int32 parry_chance, int32 block_chance, bool SpellCasted) const
// {
//     if (pVictim->GetTypeId() == TYPEID_UNIT && ((Creature*)pVictim)->IsInEvadeMode())
//     {
//         return MELEE_HIT_EVADE;
//     }

//     int32 attackerMaxSkillValueForLevel = GetMaxSkillValueForLevel(pVictim);
//     int32 victimMaxSkillValueForLevel = pVictim->GetMaxSkillValueForLevel(this);

//     int32 attackerWeaponSkill = GetWeaponSkillValue(attType, pVictim);
//     int32 victimDefenseSkill = pVictim->GetDefenseSkillValue(this);

//     // bonus from skills is 0.04%
//     int32 skillBonus  = 4 * (attackerWeaponSkill - victimMaxSkillValueForLevel);
//     int32 sum = 0;
//     int32 roll = urand(0, 10000);
//     int32 tmp = miss_chance;

//     DEBUG_FILTER_LOG(LOG_FILTER_COMBAT, "RollMeleeOutcomeAgainst: skill bonus of %d for attacker", skillBonus);
//     DEBUG_FILTER_LOG(LOG_FILTER_COMBAT, "RollMeleeOutcomeAgainst: rolled %d, miss %d, dodge %d, parry %d, block %d, crit %d",
//                      roll, miss_chance, dodge_chance, parry_chance, block_chance, crit_chance);

//     if (tmp > 0 && roll < (sum += tmp))
//     {
//         DEBUG_FILTER_LOG(LOG_FILTER_COMBAT, "RollMeleeOutcomeAgainst: MISS");
//         return MELEE_HIT_MISS;
//     }

//     // always crit against a sitting target (except 0 crit chance)
//     if (pVictim->GetTypeId() == TYPEID_PLAYER && crit_chance > 0 && !pVictim->IsStandState())
//     {
//         DEBUG_FILTER_LOG(LOG_FILTER_COMBAT, "RollMeleeOutcomeAgainst: CRIT (sitting victim)");
//         return MELEE_HIT_CRIT;
//     }

//     bool from_behind = !pVictim->HasInArc(M_PI_F, this);

//     if (from_behind)
//     {
//         DEBUG_FILTER_LOG(LOG_FILTER_COMBAT, "RollMeleeOutcomeAgainst: attack came from behind.");
//     }

//     // Dodge chance

//     // only players can't dodge if attacker is behind
//     if (pVictim->GetTypeId() != TYPEID_PLAYER || !from_behind)
//     {
//         tmp = dodge_chance;
//         if ((tmp > 0)                                       // check if unit _can_ dodge
//             && ((tmp -= skillBonus) > 0)
//             && roll < (sum += tmp))
//         {
//             DEBUG_FILTER_LOG(LOG_FILTER_COMBAT, "RollMeleeOutcomeAgainst: DODGE <%d, %d)", sum - tmp, sum);
//             return MELEE_HIT_DODGE;
//         }
//     }

//     // parry chances
//     // check if attack comes from behind, nobody can parry or block if attacker is behind
//     if (!from_behind)
//     {
//         if (parry_chance > 0 && (pVictim->GetTypeId() == TYPEID_PLAYER || !(((Creature*)pVictim)->GetCreatureInfo()->ExtraFlags & CREATURE_FLAG_EXTRA_NO_PARRY)))
//         {
//             parry_chance -= skillBonus;

//             if (parry_chance > 0 &&                         // check if unit _can_ parry
//                 (roll < (sum += parry_chance)))
//             {
//                 DEBUG_FILTER_LOG(LOG_FILTER_COMBAT, "RollMeleeOutcomeAgainst: PARRY <%d, %d)", sum - parry_chance, sum);
//                 return MELEE_HIT_PARRY;
//             }
//         }
//     }

//     // Max 40% chance to score a glancing blow against mobs that are higher level (can do only players and pets and not with ranged weapon)
//     if (attType != RANGED_ATTACK && !SpellCasted &&
//         (GetTypeId() == TYPEID_PLAYER || ((Creature*)this)->IsPet()) &&
//         pVictim->GetTypeId() != TYPEID_PLAYER && !((Creature*)pVictim)->IsPet() &&
//         getLevel() < pVictim->GetLevelForTarget(this))
//     {
//         // cap possible value (with bonuses > max skill)
//         int32 skill = attackerWeaponSkill;
//         int32 maxskill = attackerMaxSkillValueForLevel;
//         skill = (skill > maxskill) ? maxskill : skill;

//         tmp = (10 + 2 * (victimDefenseSkill - skill)) * 100;
//         tmp = tmp > 4000 ? 4000 : tmp;
//         if (roll < (sum += tmp))
//         {
//             DEBUG_FILTER_LOG(LOG_FILTER_COMBAT, "RollMeleeOutcomeAgainst: GLANCING <%d, %d)", sum - 4000, sum);
//             return MELEE_HIT_GLANCING;
//         }
//     }

//     // block chances
//     // check if attack comes from behind, nobody can parry or block if attacker is behind
//     if (!from_behind)
//     {
//         if (pVictim->GetTypeId() == TYPEID_PLAYER || !(((Creature*)pVictim)->GetCreatureInfo()->ExtraFlags & CREATURE_FLAG_EXTRA_NO_BLOCK))
//         {
//             tmp = block_chance;
//             if ((tmp > 0)                                   // check if unit _can_ block
//                 && ((tmp -= skillBonus) > 0)
//                 && (roll < (sum += tmp)))
//             {
//                 // Critical chance
//                 tmp = crit_chance;
//                 if (GetTypeId() == TYPEID_PLAYER && SpellCasted && tmp > 0)
//                 {
//                     if (roll_chance_i(tmp / 100))
//                     {
//                         DEBUG_LOG("RollMeleeOutcomeAgainst: BLOCKED CRIT");
//                         return MELEE_HIT_BLOCK_CRIT;
//                     }
//                 }
//                 DEBUG_FILTER_LOG(LOG_FILTER_COMBAT, "RollMeleeOutcomeAgainst: BLOCK <%d, %d)", sum - tmp, sum);
//                 return MELEE_HIT_BLOCK;
//             }
//         }
//     }

//     // Critical chance
//     tmp = crit_chance;

//     if (tmp > 0 && roll < (sum += tmp))
//     {
//         DEBUG_FILTER_LOG(LOG_FILTER_COMBAT, "RollMeleeOutcomeAgainst: CRIT <%d, %d)", sum - tmp, sum);
//         return MELEE_HIT_CRIT;
//     }

//     if ((GetTypeId() != TYPEID_PLAYER && !((Creature*)this)->IsPet()) &&
//         !(((Creature*)this)->GetCreatureInfo()->ExtraFlags & CREATURE_FLAG_EXTRA_NO_CRUSH) &&
//         !SpellCasted /*Only autoattack can be crashing blow*/)
//     {
//         // mobs can score crushing blows if they're 3 or more levels above victim
//         // or when their weapon skill is 15 or more above victim's defense skill
//         tmp = victimDefenseSkill;
//         int32 tmpmax = victimMaxSkillValueForLevel;
//         // having defense above your maximum (from items, talents etc.) has no effect
//         tmp = tmp > tmpmax ? tmpmax : tmp;
//         // tmp = mob's level * 5 - player's current defense skill
//         tmp = attackerMaxSkillValueForLevel - tmp;
//         if (tmp >= 15)
//         {
//             // add 2% chance per lacking skill point, min. is 15%
//             tmp = tmp * 200 - 1500;
//             if (roll < (sum += tmp))
//             {
//                 DEBUG_FILTER_LOG(LOG_FILTER_COMBAT, "RollMeleeOutcomeAgainst: CRUSHING <%d, %d)", sum - tmp, sum);
//                 return MELEE_HIT_CRUSHING;
//             }
//         }
//     }

//     DEBUG_FILTER_LOG(LOG_FILTER_COMBAT, "RollMeleeOutcomeAgainst: NORMAL");
//     return MELEE_HIT_NORMAL;
// }
