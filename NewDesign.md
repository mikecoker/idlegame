# Idle RPG Systems Design Document

## Core Game Loop

The player commands a team of up to 5 creatures that automatically battle through stages consisting of 10 waves each, culminating in a boss encounter. The game continues earning resources while offline based on the highest stage cleared. Victory requires strategic team composition, gear optimization, and resource management.

## Stage & Enemy Progression

### Stage Structure

- Each stage contains 10 waves of enemies followed by a boss
- **Enemies per wave**: `3 + floor(stage/5)`
- Defeating the boss unlocks the next stage
- Failed boss attempts reset to wave 1 but keep partial rewards

### Stage Scaling

- **Base Enemy HP**: `HP = 50 * stage^1.2`
- **Enemy Damage**: `DMG = 10 * stage^1.1`
- **Enemy Defense**: `DEF = 5 * stage^1.05`
- **Enemy Speed**: `SPD = 0.5 + 0.01 * stage` (attacks per second)
- **Gold Reward**: `Gold = 10 * stage` per enemy
- **Experience Reward**: `XP = 5 * stage` per enemy

### Boss Scaling

- **Boss HP**: `HP = 500 * stage^1.5`
- **Boss Damage**: `ATK = 20 * stage^1.3`
- **Boss Defense**: `DEF = 10 * stage^1.1`
- **Boss Speed**: 1 attack per 1.5 seconds

### Boss Mechanics

- **Time Limit**: 60 seconds to defeat or stage resets
- **Phase Transitions**: At 50% HP, boss enters enrage (+50% ATK)
- **Rewards**:
  - Gold: `1000 * stage`
  - Shards: `10 * stage`
  - Gem drop chance: `5% * stage`
  - Permanent +5% stat boost to all creatures upon first defeat

### Time Gates

- **Normal Enemy Spawn**: Based on wave composition
- **Boss Timer**: 60 seconds to defeat or stage resets
- **Offline Progress**: Calculates at 50% speed, capped at 24 hours

## Creature System

### Starting Creatures

Players begin with 1-3 basic creatures (Warrior, Mage, Healer) and can deploy up to 5 in battle.

### Creature Stats

- **Base Stats**: HP, Attack (ATK), Defense (DEF), Speed (SPD)
- **HP Scaling**: `HP_level = Base_HP * (1 + 0.1 * (level - 1))`
- **ATK/DEF Scaling**: `Stat_level = Base_Stat * (1 + 0.05 * (level - 1))`
- **SPD**: Determines attack frequency (attacks every `1/SPD` seconds)
- **XP Required**: `XP = 100 * level^1.5`

### Evolution System

- Unlocks at levels 10, 20, 30, 50
- Requires essence: `Essence = 100 * evolution_tier^2`
- Boosts base stats by 50%
- Unlocks special abilities (area damage, healing aura, etc.)
- Opens gem socket slots (up to 3 at max evolution)

### Creature Acquisition

- **Summoning**: Use shards for gacha-style summons
- **Rates**:
  - Common: 60%
  - Rare: 30%
  - Epic: 8%
  - Legendary: 2%

### 2. Prestige System

Unlocks at Stage 100, resets stages but grants Prestige Points (PP)

- **PP Earned**: `PP = floor(sqrt(highest_stage - 99)) * (1 + total_prestiges * 0.1)`
- **Prestige Bonuses** (multiplicative):
  - Damage: +5% per PP
  - Gold Gain: +10% per PP
  - XP Gain: +8% per PP
  - HP: +3% per PP

### 3. Ascension System

Unlocks at Prestige 10, higher tier reset

- **Ascension Shards**: `AS = floor(total_prestiges/10) * (1 + highest_stage/1000)`
- **Ascension Perks**:
  - Starting Stage: +10 per AS spent
  - Boss HP Reduction: -2% per AS spent (cap 50%)
  - Offline Earnings: +5% per AS spent

## Equipment System

### Gear Slots

6 Equipment slots: Weapon, Armor, Helmet, Boots, Gloves, Accessory

### Rarity Tiers & Stat Multipliers

- Common (Gray): 1x stats
- Uncommon (Green): 1.5x stats
- Rare (Blue): 2.5x stats
- Epic (Purple): 4x stats
- Legendary (Orange): 7x stats
- Mythic (Red): 12x stats

### Base Stats Formula

- **Item Level**: `min(player_level, floor(highest_stage/5))`
- **Weapon Attack**: `5 * item_level * (1.1^item_level) * rarity_multiplier`
- **Armor HP**: `25 * item_level * (1.08^item_level) * rarity_multiplier`
- **Other Gear**: Mixed stats at 60% efficiency

### Drop Rates

- **Drop Chance**: 2% base, +0.5% per 10 stages
- **Rarity Weights**:
  - Common: 1000
  - Uncommon: 200 / (1 + stage/100)
  - Rare: 50 / (1 + stage/200)
  - Epic: 10 / (1 + stage/500)
  - Legendary: 2 / (1 + stage/1000)
  - Mythic: 0.1 / (1 + stage/2000)

## Enhancement Systems

### 1. Gem System

Gems socket into equipment (1 slot common, 3 slots mythic)

#### Gem Types & Effects

- **Ruby** (Red): +Attack %
  - Formula: `2 * gem_level * (1.05^gem_level)`
- **Sapphire** (Blue): +HP %
  - Formula: `5 * gem_level * (1.04^gem_level)`
- **Emerald** (Green): +Gold Find %
  - Formula: `3 * gem_level * (1.03^gem_level)`
- **Diamond** (White): +All Stats %
  - Formula: `1 * gem_level * (1.06^gem_level)`
- **Onyx** (Black): +Crit Damage %
  - Formula: `4 * gem_level * (1.04^gem_level)`

#### Gem Fusion

- 3 gems of same type/level = 1 gem of next level
- Max level: 20
- Fusion cost: `100 * current_level^2` gold

### 2. Enchantment System

Permanent modifiers applied to gear slots, adding elemental properties and special effects.

#### Enchantment Types

- **Fire Enchant**: +10% ATK as fire damage, ignores 20% DEF
- **Ice Enchant**: 15% chance to slow enemy SPD by 30%
- **Lightning Enchant**: Chain damage to 2 additional enemies at 50% power
- **Holy Enchant**: +5% healing to all allies per attack
- **Shadow Enchant**: 10% life steal

#### Enchantment Scaling

- **Level Range**: 1-5
- **Effect Scaling**: `Effect = base_effect * (1 + 0.15 * level)`
- **Cost**: `Shards = 20 * level * gear_tier`
- **Reroll Cost**: `Gold = 500 * gear_tier^2`

### 3. Artifact System

Permanent passive bonuses, found rarely from bosses

#### Artifact Examples

- **Sword of Storms**: +2% attack per 100 enemies killed (no cap)
- **Golden Crown**: +1% gold per stage cleared (cap 1000%)
- **Chrono Crystal**: -0.1 seconds enemy spawn time per 10 stages
- **Blood Gem**: Heal 1% max HP per kill
- **Experience Tome**: +0.5% XP permanently per level gained

**Artifact Drop Rate**: 0.1% from bosses, increases by 0.01% per 100 stages

## Consumable Items

### Consumable Items

#### Types & Effects

1. **Health Potion**: Restores 50% HP to all creatures mid-battle
   - Essence Cost: `50 * effectiveness_level^1.2`
2. **Boost Elixir**: +20% ATK/SPD for 5 minutes
   - Essence Cost: `75 * effectiveness_level^1.2`
3. **XP Scroll**: Doubles XP gain for 1 hour
   - Essence Cost: `100 * effectiveness_level^1.2`
4. **Boss Slayer**: +100% damage vs bosses for next attempt
   - Gold Cost: `5000 * current_stage`
5. **Time Warp**: Gain 1 hour of offline progress instantly
   - Gold Cost: `10000 * (2^uses_today)`

**Cooldowns**: 10 minutes between uses to prevent spam
**Strategic Use**: Most effective when saved for boss encounters or progression walls

## Skill Tree System

Unlocks at level 50, uses Skill Points (1 per level after 50)

### Branches

1. **Warrior Path** (Red)

   - Tier 1: +2% attack per point (max 50)
   - Tier 2: +1% crit chance per point (max 25)
   - Tier 3: +5% crit damage per point (max 100)

2. **Guardian Path** (Blue)

   - Tier 1: +5% HP per point (max 50)
   - Tier 2: +1% damage reduction per point (max 30)
   - Tier 3: +2% life steal per point (max 20)

3. **Treasure Hunter Path** (Gold)
   - Tier 1: +3% gold find per point (max 50)
   - Tier 2: +1% item drop rate per point (max 25)
   - Tier 3: +2% rare item chance per point (max 50)

**Respec Cost**: `1000 * total_skill_points * (1.5^respecs_used)`

## Combat Formulas

### Damage Calculation

```
Base_Damage = (ATK_attacker - DEF_defender) * (1 + crit_chance)
Crit_Chance = 0.1 base (10%), modifiable by gear and gems
Elemental_Damage = Base_Damage * Elemental_Multiplier
Final_Damage = max(1, Base_Damage + Elemental_Damage)
```

### Team DPS Check

```
Total_DPS = Sum(Creature_ATK * Creature_SPD) for all deployed creatures
Boss_DPS_Required = Boss_HP / Time_Limit
If Total_DPS < Boss_DPS_Required: Stage fails, retry needed
```

### Attack Speed

```
Attack_Interval = 1 / SPD seconds
SPD modified by gems, gear, and consumables
```

## Progression Gates & Unlocks

- **Stage 10**: Equipment system unlocks
- **Stage 25**: Gem system unlocks
- **Stage 50**: Enchantment system unlocks
- **Level 50**: Skill tree unlocks
- **Stage 100**: Prestige system unlocks
- **Stage 250**: Artifacts begin dropping
- **Stage 500**: Mythic equipment enabled
- **Prestige 10**: Ascension system unlocks

## Economy Balancing

### Gold Sinks Priority

1. Consumables (temporary power)
2. Enchantments (permanent gear boost)
3. Gem fusion (long-term investment)
4. Skill respecs (build experimentation)

### Resource Generation Rates

- **Active Play**: 100% efficiency
- **Offline**: 50% efficiency (upgradeable to 80%)
- **Ad Bonus**: +100% for 4 hours (3 per day)

## Monetization Hooks (Optional)

1. **Premium Currency**: Crystals
   - Skip boss fights
   - Instant offline progress
   - Guaranteed legendary drops
2. **Battle Pass**: Monthly progression

   - Free track: Resources and consumables
   - Premium track: Exclusive artifacts and mythic gear

3. **VIP Levels**: Permanent account benefits
   - Auto-collect resources
   - Increased offline efficiency
   - Extra equipment slots

## Performance Optimizations

- Enemy HP/damage cached per stage
- Batch process offline calculations
- Progressive save system (every 30 seconds)
- Damage numbers pooled and recycled
- UI updates throttled to 10 FPS when idle

## Late Game Content

### Infinite Scaling

After stage 1000, enemies gain additional multipliers:

- HP: Additional ×1.5 per 100 stages
- Damage: Additional ×1.3 per 100 stages
- Rewards scale logarithmically to prevent inflation

### Challenge Modes (Post-Ascension)

1. **No Equipment Run**: 10x rewards
2. **Boss Rush**: Only bosses, 5x XP
3. **Glass Cannon**: 1 HP, 100x damage
4. **Pacifist**: No direct damage, companion-only

This system creates multiple interdependent progression loops that maintain player engagement through early, mid, and late game while providing clear goals and satisfying number growth.
