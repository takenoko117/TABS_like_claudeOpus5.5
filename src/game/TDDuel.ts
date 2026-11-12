/**
 * TD オンライン対戦（対面型）。1 つの戦場で、ホスト（席 0・青・左の城）とゲスト（席 1・赤・右の城）が
 * それぞれのカード・お金・強化で兵を出し、相手の城を攻める。
 *
 * 同期はロックステップ: 両端末が同じ種から同じ戦場を作り、同じターンに同じ操作を反映して、
 * 同じ固定ステップで進める。兵士の位置は送らず、送るのは各ターンの操作だけ。
 * 戦場を進める間は Math.random を共通の種の乱数に差し替える（SimRandom.ts）。
 * Three.js の描画には依存しないので、tests/ から 2 端末ぶんを並べて検証できる。
 */
import type { DamageEvent } from '../combat/CombatSystem';
import type { TDDuelCommand, TDVersusClientMessage, TDVersusEndReason } from '../net/tdVersusProtocol';
import { TD_VS_MAX_COMMANDS } from '../net/tdVersusProtocol';
import type { Unit } from '../units/Unit';
import type { Team, UnitTypeId } from '../units/UnitTypes';
import type { Battle, BattleResult, BattleRules } from './Battle';
import { createSeededRng } from './ChallengeMode';
import { TD_DUEL_TIME_LIMIT, TDRun } from './RealtimeTDMode';
import type { RogueStarter } from './RogueliteMode';
import { withSimRandom } from './SimRandom';

// ---------------------------------------------------------------
// 定数
// ---------------------------------------------------------------

/** 1 ターンの固定ステップ数（1/120 秒 × 12 = 0.1 秒） */
export const TD_DUEL_TURN_STEPS = 12;
/** 操作を反映するまでのターン数（0.3 秒。通信の往復がこれより遅いと待ちが出る） */
export const TD_DUEL_INPUT_DELAY = 3;
/** 戦況のハッシュを照合する間隔（ターン。2 秒ごと） */
export const TD_DUEL_HASH_TURNS = 20;
/** 遅れを取り戻すとき、1 フレームで進める最大のステップ数 */
export const TD_DUEL_MAX_STEPS_PER_FRAME = 24;
/** ためておける遅れの上限（秒）。これを超えたぶんは捨て、相手に待ってもらう */
const TD_DUEL_MAX_BACKLOG = 0.5;
/** 戦場の乱数を、陣営ごとの乱数と分けるための値 */
const TD_DUEL_SIM_SALT = 0x27d4eb2d;

// ---------------------------------------------------------------
// 2 陣営の戦場
// ---------------------------------------------------------------

/** 対戦の決着 */
export interface TDDuelOutcome {
  /** 勝った陣営（null は引き分け） */
  winner: Team | null;
  reason: TDVersusEndReason;
}

export class TDDuel {
  /** 席ごとのラン（0: ホスト・青、1: ゲスト・赤） */
  readonly sides: readonly [TDRun, TDRun];
  /** 戦場を進める間だけ Math.random の代わりに使う乱数（両端末で同じ並び） */
  readonly simRng: () => number;
  /** 通信で決まった決着（降参・切断）。戦場の計算で決まる決着より優先する */
  external: TDDuelOutcome | null = null;
  private battleRef: Battle | null = null;
  private readonly onDamageBound = (e: DamageEvent) => this.onDamage(e);

  constructor(
    readonly seed: number,
    starters: readonly [RogueStarter, RogueStarter],
  ) {
    this.sides = [new TDRun(seed, starters[0], undefined, { duel: { team: 0 } }), new TDRun(seed, starters[1], undefined, { duel: { team: 1 } })];
    this.simRng = createSeededRng(Math.imul(seed ^ TD_DUEL_SIM_SALT, 0x9e3779b1) | 0);
  }

  get time(): number {
    return this.sides[0].time;
  }

  /** 両陣営の城・砲台・レリックを置き、ルールを有効にする（battle.configureStage の後に呼ぶ） */
  setup(battle: Battle): void {
    this.battleRef = battle;
    withSimRandom(this.simRng, () => {
      this.sides[0].setup(battle);
      this.sides[1].setup(battle);
    });
    this.sides[0].linkOpponent(this.sides[1]);
    this.sides[1].linkOpponent(this.sides[0]);
    battle.rules = new TDDuelBattleRules(this);
    battle.combat.damageListeners.push(this.onDamageBound);
  }

  /** 戦場から外す（次の戦闘の前に呼ぶ） */
  dispose(): void {
    const listeners = this.battleRef?.combat.damageListeners;
    const i = listeners?.indexOf(this.onDamageBound) ?? -1;
    if (listeners && i >= 0) listeners.splice(i, 1);
    if (this.battleRef?.rules instanceof TDDuelBattleRules) this.battleRef.rules = null;
    this.battleRef = null;
  }

  /** ダメージのたびに呼ばれる（戦場を進めている最中）。シナジーの処理と、撃破した側の報酬 */
  private onDamage(e: DamageEvent): void {
    for (const side of this.sides) side.rules.onDamage(e);
    if (!e.killed) return;
    const victim = e.victim;
    if (victim.team !== 0 && victim.team !== 1) return;
    const killer = this.sides[1 - victim.team];
    const tier = killer.onEnemyKilled(victim);
    // 対戦の宝箱はその場で開ける（中身は陣営ごとの乱数。開封の演出は持ち主の画面で短く知らせるだけ）
    if (tier !== null && this.battleRef) killer.chestLog.push(killer.openChest(this.battleRef, tier));
  }

  /** 席の操作を反映する */
  execute(battle: Battle, slot: 0 | 1, cmd: TDDuelCommand): void {
    this.sides[slot].execute(battle, cmd);
  }

  /** 戦場の計算による決着（null なら続く） */
  outcome(): TDDuelOutcome | null {
    if (this.external) return this.external;
    const b0 = this.sides[0].playerBase;
    const b1 = this.sides[1].playerBase;
    const dead0 = !!b0 && !b0.alive;
    const dead1 = !!b1 && !b1.alive;
    if (dead0 || dead1) return { winner: dead0 && dead1 ? null : dead0 ? 1 : 0, reason: 'castle' };
    if (this.time >= TD_DUEL_TIME_LIMIT) {
      const r0 = b0 ? b0.hp / b0.maxHp : 0;
      const r1 = b1 ? b1.hp / b1.maxHp : 0;
      return { winner: Math.abs(r0 - r1) < 1e-9 ? null : r0 > r1 ? 0 : 1, reason: 'time' };
    }
    return null;
  }

  result(): BattleResult {
    const o = this.outcome();
    if (!o) return null;
    return o.winner === null ? 'draw' : o.winner;
  }

  /** 決着したら両陣営のランを終える */
  finishSides(): void {
    const o = this.outcome();
    if (!o) return;
    for (const side of this.sides) side.finish(o.winner === null ? 'defeat' : o.winner === side.team ? 'clear' : 'defeat');
  }

  /** 戦況のハッシュ（両端末で一致するはず。ユニットの通し番号は端末で違うので使わない） */
  hash(battle: Battle): number {
    let h = 0x811c9dc5;
    const mix = (v: number) => {
      h = Math.imul(h ^ (Math.round(v * 1000) | 0), 0x01000193);
    };
    mix(battle.units.length);
    for (const u of battle.units) {
      if (!u.alive) continue;
      mix(u.team);
      mix(u.pelvis.pos.x);
      mix(u.pelvis.pos.z);
      mix(u.hp);
    }
    for (const side of this.sides) {
      mix(side.money);
      mix(side.totalXp);
      mix(side.playerBase?.hp ?? 0);
    }
    return h | 0;
  }
}

/** 対面対戦の戦闘ルール。両陣営のシナジー・レリック・時間の進行を順に呼ぶ */
export class TDDuelBattleRules implements BattleRules {
  constructor(readonly duel: TDDuel) {}

  onStep(battle: Battle, dt: number): void {
    for (const side of this.duel.sides) {
      side.rules.onStep(battle, dt);
      side.step(battle, dt);
    }
  }

  onGatePassed(battle: Battle, unit: Unit): void {
    this.sideOf(unit.team)?.rules.onGatePassed(battle, unit);
  }

  onUnitDerived(battle: Battle, unit: Unit, parent: Unit): void {
    this.sideOf(unit.team)?.rules.onUnitDerived(battle, unit, parent);
  }

  onUnitDied(battle: Battle, unit: Unit): void {
    this.sideOf(unit.team)?.rules.onUnitDied(battle, unit);
  }

  onStepEnd(battle: Battle): void {
    for (const side of this.duel.sides) side.rules.onStepEnd(battle);
  }

  summonPoolFor(team: Team): readonly UnitTypeId[] | null {
    return this.sideOf(team)?.rules.summonPoolFor(team) ?? null;
  }

  resolveResult(): BattleResult {
    return this.duel.result();
  }

  private sideOf(team: Team): TDRun | undefined {
    return team === 0 || team === 1 ? this.duel.sides[team] : undefined;
  }
}

// ---------------------------------------------------------------
// ロックステップ
// ---------------------------------------------------------------

/**
 * ターンごとに両席の操作がそろってから戦場を進める。
 * 自分の操作は TD_DUEL_INPUT_DELAY ターン先に予約して送る（何もしないターンも空で送る）。
 * 相手の操作が届いていなければ待つ（stalled）。
 */
export class TDLockstep {
  /** 進めた固定ステップの数 */
  steps = 0;
  /** 相手の操作を待っていて進めないか */
  stalled = false;
  /** 待っている時間（秒） */
  stallTime = 0;
  /** 決着して止めたか */
  finished = false;
  /** 戦況のずれを最初に見つけたターン（null ならずれていない） */
  desyncTurn: number | null = null;
  private backlog = 0;
  private sentUpTo = TD_DUEL_INPUT_DELAY - 1;
  private readonly pending: TDDuelCommand[] = [];
  private readonly inputs: [Map<number, TDDuelCommand[]>, Map<number, TDDuelCommand[]>] = [new Map(), new Map()];
  private readonly localHashes = new Map<number, number>();
  private readonly remoteHashes = new Map<number, number>();

  constructor(
    readonly duel: TDDuel,
    readonly slot: 0 | 1,
    private readonly send: (msg: TDVersusClientMessage) => void,
  ) {
    // 最初の数ターンは、両席とも操作なしと決めておく
    for (let t = 0; t < TD_DUEL_INPUT_DELAY; t++) {
      this.inputs[0].set(t, []);
      this.inputs[1].set(t, []);
    }
    // 自分の陣営の画面操作は、送ってから反映する
    duel.sides[slot].commandSink = (cmd) => this.pending.push(cmd);
  }

  /** 自分の陣営のラン */
  get mine(): TDRun {
    return this.duel.sides[this.slot];
  }

  get opponent(): TDRun {
    return this.duel.sides[1 - this.slot];
  }

  get turn(): number {
    return Math.floor(this.steps / TD_DUEL_TURN_STEPS);
  }

  /** 相手の操作が届いた */
  receiveInput(turn: number, cmds: readonly TDDuelCommand[]): void {
    this.inputs[1 - this.slot].set(turn, [...cmds]);
  }

  /** 相手の戦況のハッシュが届いた */
  receiveHash(turn: number, h: number): void {
    this.remoteHashes.set(turn, h);
    this.compareHash(turn);
  }

  /** 実時間 dt ぶん戦場を進める（相手の操作が届いていなければ待つ）。進めたステップ数を返す */
  advance(battle: Battle, dt: number): number {
    if (this.finished) return 0;
    this.backlog = Math.min(this.backlog + dt, TD_DUEL_MAX_BACKLOG);
    let n = 0;
    while (this.backlog >= battle.fixedDt && n < TD_DUEL_MAX_STEPS_PER_FRAME) {
      if (this.steps % TD_DUEL_TURN_STEPS === 0 && !this.beginTurn(battle, this.turn)) break;
      withSimRandom(this.duel.simRng, () => battle.step(battle.fixedDt));
      this.steps++;
      this.backlog -= battle.fixedDt;
      n++;
      if (this.duel.outcome()) {
        this.finished = true;
        this.duel.finishSides();
        break;
      }
    }
    if (this.stalled) this.stallTime += dt;
    return n;
  }

  /** ターンの始め。両席の操作がそろっていれば反映して true */
  private beginTurn(battle: Battle, turn: number): boolean {
    this.flushLocal(turn + TD_DUEL_INPUT_DELAY);
    const a = this.inputs[0].get(turn);
    const b = this.inputs[1].get(turn);
    if (!a || !b) {
      this.stalled = true;
      return false;
    }
    this.stalled = false;
    this.stallTime = 0;
    if (turn > 0 && turn % TD_DUEL_HASH_TURNS === 0) {
      const h = this.duel.hash(battle);
      this.localHashes.set(turn, h);
      this.send({ t: 'hash', turn, h });
      this.compareHash(turn);
    }
    withSimRandom(this.duel.simRng, () => {
      for (const cmd of a) this.duel.execute(battle, 0, cmd);
      for (const cmd of b) this.duel.execute(battle, 1, cmd);
    });
    this.inputs[0].delete(turn);
    this.inputs[1].delete(turn);
    return true;
  }

  /** target ターンまでの自分の操作を予約して送る */
  private flushLocal(target: number): void {
    while (this.sentUpTo < target) {
      this.sentUpTo++;
      const cmds = this.sentUpTo === target ? this.pending.splice(0, TD_VS_MAX_COMMANDS) : [];
      this.inputs[this.slot].set(this.sentUpTo, cmds);
      this.send({ t: 'input', turn: this.sentUpTo, cmds });
    }
  }

  private compareHash(turn: number): void {
    const mine = this.localHashes.get(turn);
    const theirs = this.remoteHashes.get(turn);
    if (mine === undefined || theirs === undefined) return;
    this.localHashes.delete(turn);
    this.remoteHashes.delete(turn);
    if (mine !== theirs && this.desyncTurn === null) this.desyncTurn = turn;
  }
}
