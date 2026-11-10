import { describe, expect, it } from 'vitest';
import { Battle } from '../src/game/Battle';
import {
  CHEST_REEL_COUNTS,
  JACKPOT_DROP_COOLDOWN,
  JACKPOT_REWARDS,
  JackpotDropTracker,
  applyJackpotReward,
  jackpotHpDropScale,
  rollJackpot,
  type ChestTier,
  type JackpotReward,
} from '../src/game/RogueJackpot';
import { RogueliteRun } from '../src/game/RogueliteMode';
import { JACKPOT_ICONS, JACKPOT_ICON_PALETTE, JACKPOT_ICON_SIZE } from '../src/render/JackpotIcons';

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const reward = (id: string): JackpotReward => JACKPOT_REWARDS.find((r) => r.id === id)!;
const WEAK = { cost: 40, isBoss: false };

describe('ボーナス: ボクセルの絵柄', () => {
  it('全報酬に正しい大きさの絵柄があり、色はパレットにある', () => {
    for (const r of JACKPOT_REWARDS) {
      const rows = JACKPOT_ICONS[r.id];
      expect(rows, r.id).toBeDefined();
      expect(rows.length, r.id).toBe(JACKPOT_ICON_SIZE);
      for (const row of rows) {
        expect(row.length, r.id).toBe(JACKPOT_ICON_SIZE);
        for (const ch of row) if (ch !== '.') expect(JACKPOT_ICON_PALETTE[ch], `${r.id}:${ch}`).toBeDefined();
      }
    }
  });
});

describe('ボーナス: 宝箱のドロップ', () => {
  it('外れが続くと必ず出る', () => {
    const tracker = new JackpotDropTracker(3, () => 0.999);
    let drops = 0;
    for (let i = 0; i < 10; i++) if (tracker.onKill(i * 10, WEAK, 5000) !== null) drops++;
    expect(drops).toBeGreaterThan(0);
  });

  it('1戦の上限と間隔を守る', () => {
    const tracker = new JackpotDropTracker(2, () => 0);
    expect(tracker.onKill(0, WEAK, 5000)).not.toBeNull();
    expect(tracker.onKill(JACKPOT_DROP_COOLDOWN / 2, WEAK, 5000)).toBeNull();
    expect(tracker.onKill(JACKPOT_DROP_COOLDOWN + 1, WEAK, 5000)).not.toBeNull();
    expect(tracker.onKill(100, WEAK, 5000)).toBeNull();
  });

  it('ボスは上限に関係なく金の宝箱を落とす', () => {
    const tracker = new JackpotDropTracker(0, () => 0.999);
    expect(tracker.onKill(0, { cost: 1000, isBoss: true }, 5000)).toBe(2);
  });

  it('予算に対して高コストの敵は宝箱の格が上がる', () => {
    const tracker = new JackpotDropTracker(3, () => 0);
    expect(tracker.onKill(0, { cost: 1500, isBoss: false }, 5000)).toBe(1);
  });

  it('HP倍率は8割以上で最小、減るほど上がる', () => {
    expect(jackpotHpDropScale(1)).toBeCloseTo(0.05);
    expect(jackpotHpDropScale(0.8)).toBeCloseTo(0.05);
    expect(jackpotHpDropScale(0.4)).toBeCloseTo(0.85);
    expect(jackpotHpDropScale(0)).toBeCloseTo(1.65);
  });

  it('自軍HPが8割以上あるうちはほぼ出ない', () => {
    const tracker = new JackpotDropTracker(3, () => 0.5);
    for (let i = 0; i < 30; i++) {
      expect(tracker.onKill(i * 10, WEAK, 5000, 1)).toBeNull();
    }
  });

  it('自軍HPが減ると同じ乱数でも出るようになる', () => {
    const rng = () => 0.3;
    const healthy = new JackpotDropTracker(3, rng);
    expect(healthy.onKill(0, WEAK, 5000, 1)).toBeNull();
    const pinch = new JackpotDropTracker(3, rng);
    expect(pinch.onKill(0, WEAK, 5000, 0)).not.toBeNull();
  });

  it('ボスは自軍HPが満タンでも金の宝箱を落とす', () => {
    const tracker = new JackpotDropTracker(0, () => 0.999);
    expect(tracker.onKill(0, { cost: 1000, isBoss: true }, 5000, 1)).toBe(2);
  });
});

describe('ボーナス: 抽選', () => {
  const base = { battleActive: true };

  it('リールの数は宝箱の格で決まり、昇順で最後が一番豪華', () => {
    const rng = seeded(1);
    for (let i = 0; i < 300; i++) {
      const tier = (i % 3) as ChestTier;
      const rolled = rollJackpot(tier, { ...base, rng });
      expect(rolled.length).toBe(CHEST_REEL_COUNTS[tier]);
      expect(rolled[rolled.length - 1].rarity).toBeGreaterThanOrEqual(tier);
      for (let k = 1; k < rolled.length; k++) expect(rolled[k].rarity).toBeGreaterThanOrEqual(rolled[k - 1].rarity);
    }
  });

  it('決着の一撃ではランに残る報酬だけが出る', () => {
    const rng = seeded(2);
    for (let i = 0; i < 300; i++) {
      for (const r of rollJackpot(2, { rng, battleActive: false })) expect(r.scope).toBe('run');
    }
  });

  it('宝箱にライフ回復はない', () => {
    expect(JACKPOT_REWARDS.some((r) => r.detail.includes('ライフ'))).toBe(false);
  });
});

describe('ボーナス: 効果', () => {
  const setup = () => {
    const battle = new Battle();
    const ally = battle.spawnUnit('giant', 0, -5, 0);
    const enemy = battle.spawnUnit('giant', 1, 5, 0);
    return { battle, ally, enemy, run: new RogueliteRun(1) };
  };

  it('ゴールド・引き直しはランに残る', () => {
    const { battle, run } = setup();
    const gold = run.gold;
    const rerolls = run.rerollsLeft;
    applyJackpotReward(reward('budget_xl'), battle, run);
    applyJackpotReward(reward('reroll'), battle, run);
    expect(run.gold).toBe(gold + 250);
    expect(run.rerollsLeft).toBe(rerolls + 1);
  });

  it('予算系の報酬はすべてゴールドに置き換わっている', () => {
    for (const id of ['budget_s', 'budget_m', 'budget_l', 'budget_xl']) {
      expect(reward(id).effect.kind).toBe('gold');
      expect(reward(id).detail).toContain('ゴールド');
    }
  });

  it('強化と回復は味方だけに効く', () => {
    const { battle, ally, enemy, run } = setup();
    ally.hp = 10;
    applyJackpotReward(reward('heal_l'), battle, run);
    applyJackpotReward(reward('overdrive'), battle, run);
    expect(ally.hp).toBeCloseTo(ally.maxHp);
    expect(ally.permDamageMul).toBeCloseTo(1.5);
    expect(ally.permSpeedMul).toBeCloseTo(1.3);
    expect(enemy.permDamageMul).toBe(1);
  });

  it('全軍複製は味方を増やし、敵は増やさない', () => {
    const { battle, run } = setup();
    battle.spawnUnit('clubber', 0, -8, 3);
    applyJackpotReward(reward('army'), battle, run);
    expect(battle.units.filter((u) => u.team === 0).length).toBe(4);
    expect(battle.units.filter((u) => u.team === 1).length).toBe(1);
  });

  it('雷撃は敵全体にだけ、上限つきでダメージを与える', () => {
    const { battle, ally, enemy, run } = setup();
    const allyHp = ally.hp;
    const before = enemy.hp;
    applyJackpotReward(reward('smite'), battle, run);
    expect(ally.hp).toBe(allyHp);
    expect(enemy.hp).toBeLessThan(before);
    expect(before - enemy.hp).toBeLessThanOrEqual(300);
  });
});
