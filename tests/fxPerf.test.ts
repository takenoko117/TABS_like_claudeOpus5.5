import { describe, expect, it } from 'vitest';
import { Battle } from '../src/game/Battle';
import { ROGUE_STARTERS, type RogueStarter } from '../src/game/RogueliteMode';
import { withNativeRandom } from '../src/game/SimRandom';
import { TDDuel, TDLockstep } from '../src/game/TDDuel';
import { FX_EFFECT_CUES, FX_HEAVY_HIT_DAMAGE, FX_HEAVY_HIT_TIERS, type FxTier } from '../src/fx/FxCues';
import { FxDirector } from '../src/fx/FxDirector';
import { FrameProbe } from '../src/fx/FrameProbe';
import type { TDVersusClientMessage } from '../src/net/tdVersusProtocol';
import type { UnitTypeId } from '../src/units/UnitTypes';

/**
 * GameApp と同じ経路で、戦闘のイベントを演出の指揮役へ流す（描画の代わりに数を数える）。
 * 戻り値の fxMs は、演出の処理にかかった時間の合計（ミリ秒）
 */
function attachFx(battle: Battle, fx: FxDirector) {
  const stats = { fxMs: 0, emits: 0, unitFlashes: 0 };
  fx.sinks = {
    flash: () => undefined,
    unitFlash: () => stats.unitFlashes++,
    sound: () => undefined,
  };
  const timed = (f: () => void) =>
    withNativeRandom(() => {
      const t0 = performance.now();
      f();
      stats.fxMs += performance.now() - t0;
      stats.emits++;
    });
  battle.combat.onHit = (e) =>
    timed(() => {
      if (e.damage >= FX_HEAVY_HIT_DAMAGE) {
        const tier = FX_HEAVY_HIT_TIERS.filter((d) => e.damage >= d).length as FxTier;
        fx.emit('heavy_hit', { tier, dir: { x: e.point.x, z: e.point.z }, unitId: e.victim.id });
      } else fx.emit('unit_hit', { tier: 0, unitId: e.victim.id });
      if (e.killed) fx.emit('kill', { tier: 0, unitId: e.victim.id });
    });
  battle.combat.onEffect = (e) =>
    timed(() => {
      const cue = FX_EFFECT_CUES[e.kind];
      if (cue) fx.emit(cue.cue, { tier: cue.tier });
    });
  return stats;
}

/** 2 陣営を向かい合わせに並べる */
function lineUp(battle: Battle, perTeam: number, types: UnitTypeId[]): void {
  const cols = Math.ceil(Math.sqrt(perTeam));
  for (let team = 0 as 0 | 1; team <= 1; team = (team + 1) as 0 | 1) {
    for (let i = 0; i < perTeam; i++) {
      const row = Math.floor(i / cols);
      const col = i % cols;
      const x = (team === 0 ? -1 : 1) * (8 + row * 1.2);
      const z = (col - cols / 2) * 1.2;
      battle.spawnUnit(types[i % types.length], team, x, z);
    }
  }
  battle.aiEnabled = true;
}

/** 演出フルで seconds 秒ぶん戦わせ、1 フレーム（60fps）あたりの時間を測る */
function measure(perTeam: number, seconds: number) {
  const battle = new Battle();
  lineUp(battle, perTeam, ['swordsman', 'archer', 'spearman', 'bomber', 'giant']);
  const fx = new FxDirector('full');
  fx.allowBattleStop = true;
  const stats = attachFx(battle, fx);
  const frame = new FrameProbe();
  const frameDt = 1 / 60;
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    const t0 = performance.now();
    fx.update(frameDt);
    battle.advance(frameDt * fx.battleScale());
    frame.record(performance.now() - t0);
  }
  const frames = Math.round(seconds * 60);
  return { frame: frame.stats(), fxPerFrame: stats.fxMs / frames, emits: stats.emits, unitFlashes: stats.unitFlashes };
}

describe('演出の性能（決定事項 R5）', () => {
  it('チャレンジ最大（200 体）・TD 対戦（60 対 60）で、演出の処理は 1 フレームあたり 0.5ms 未満', () => {
    const cases = [
      { name: 'チャレンジ 200 体（100 対 100）', perTeam: 100 },
      { name: 'TD 60 対 60', perTeam: 60 },
    ];
    for (const c of cases) {
      const r = measure(c.perTeam, 6);
      // 目視ではなく数値で確認できるよう、計測結果を出しておく
      console.log(
        `[fx perf] ${c.name}: frame avg ${r.frame.avg.toFixed(2)}ms / p95 ${r.frame.p95.toFixed(2)}ms / max ${r.frame.max.toFixed(2)}ms, ` +
          `fx ${r.fxPerFrame.toFixed(4)}ms/frame, events ${r.emits}, unit flashes ${r.unitFlashes}`,
      );
      expect(r.emits).toBeGreaterThan(0);
      expect(r.fxPerFrame).toBeLessThan(0.5);
    }
  }, 120_000);
});

describe('演出を有効にしたオンライン対戦の同期', () => {
  const STARTERS: [RogueStarter, RogueStarter] = [ROGUE_STARTERS[0], ROGUE_STARTERS[1]];

  function makeClient(seed: number, slot: 0 | 1) {
    const battle = new Battle();
    battle.configureStage();
    const duel = new TDDuel(seed, STARTERS);
    duel.setup(battle);
    battle.beginCombat();
    const outbox: TDVersusClientMessage[] = [];
    const ls = new TDLockstep(duel, slot, (m) => outbox.push(m));
    return { battle, duel, ls, outbox };
  }
  type Client = ReturnType<typeof makeClient>;
  function deliver(from: Client, to: Client): void {
    for (const m of from.outbox.splice(0)) {
      if (m.t === 'input') to.ls.receiveInput(m.turn, m.cmds);
      else if (m.t === 'hash') to.ls.receiveHash(m.turn, m.h);
    }
  }

  it('片方の端末だけ演出フル（ヒットストップ・スローを含む）でも、戦場は止まらず両端末のハッシュが一致する', () => {
    const a = makeClient(77, 0);
    const b = makeClient(77, 1);
    const fx = new FxDirector('full');
    // 対戦中は戦場ストップを許さない（GameApp の isTDVersusLive と同じ）
    fx.allowBattleStop = false;
    attachFx(a.battle, fx);
    a.ls.mine.requestDeploy(a.battle, a.ls.mine.run.cards[0].id);
    b.ls.mine.requestDeploy(b.battle, b.ls.mine.run.cards[0].id);
    a.ls.mine.requestAuto(true);
    b.ls.mine.requestAuto(true);
    for (let frame = 0; frame < 60 * 12; frame++) {
      // 演出側からも定期的にヒットストップとスローを要求する
      if (frame % 30 === 0) fx.emit('castle_stage2', { tier: 3 });
      fx.update(1 / 60);
      expect(fx.battleScale()).toBe(1);
      a.ls.advance(a.battle, 1 / 60);
      b.ls.advance(b.battle, 1 / 60);
      deliver(a, b);
      deliver(b, a);
    }
    while (a.ls.steps !== b.ls.steps) {
      const slow = a.ls.steps < b.ls.steps ? a : b;
      const fast = slow === a ? b : a;
      slow.ls.advance(slow.battle, slow.battle.fixedDt);
      deliver(slow, fast);
      deliver(fast, slow);
    }
    expect(a.ls.steps).toBeGreaterThan(60 * 10);
    expect(a.duel.hash(a.battle)).toBe(b.duel.hash(b.battle));
    expect(a.ls.desyncTurn).toBeNull();
  }, 60_000);
});
