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
import type { TDDuelCommand, TDVersusClientMessage, TDVersusEndReason, TDVersusInputLog } from '../net/tdVersusProtocol';
import { TD_VS_MAX_COMMANDS } from '../net/tdVersusProtocol';
import type { Unit } from '../units/Unit';
import type { Team, UnitTypeId } from '../units/UnitTypes';
import type { Battle, BattleResult, BattleRules } from './Battle';
import { createSeededRng } from './ChallengeMode';
import { TD_DUEL_TIME_LIMIT, TDRun } from './RealtimeTDMode';
import type { RogueStarter } from './RogueliteMode';
import { withSimRandom } from './SimRandom';
import { TD_FIELD_WALLS } from './TDTerrain';

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
/** 観戦で、この数のターンより遅れていたら早送りで追いつく */
export const TD_SPECTATE_LAG_TURNS = 8;
/** 観戦の早送りで、1 フレームに使ってよい時間（ミリ秒） */
export const TD_SPECTATE_BUDGET_MS = 12;
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
    // 戦場の大きさは先に1回だけ決める（あとで設定し直すと、ホストのランが作った地形と城壁が外れてしまう）
    battle.setFieldWalls(TD_FIELD_WALLS);
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
    // 対戦の宝箱は倒した側に積む。持ち主が開けると操作として送られ、両端末で同じターンに開く（中身は陣営ごとの乱数）
    if (tier !== null) killer.dropDuelChest(tier, e.pos.x, e.pos.z);
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
      mix(side.pendingChests.length);
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
 * slot が null なら観戦: 何も送らず、両席の操作を受け取って進める（遅れていれば早送りで追いつく）。
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
  /** 観戦で、早送りして追いついている最中か */
  catchingUp = false;
  private backlog = 0;
  private sentUpTo = TD_DUEL_INPUT_DELAY - 1;
  private readonly pending: TDDuelCommand[] = [];
  private readonly inputs: [Map<number, TDDuelCommand[]>, Map<number, TDDuelCommand[]>] = [new Map(), new Map()];
  /** 席ごとに、届いた操作の最後のターン（観戦の遅れを測る） */
  private readonly knownUpTo: [number, number] = [TD_DUEL_INPUT_DELAY - 1, TD_DUEL_INPUT_DELAY - 1];
  private readonly localHashes = new Map<number, number>();
  private readonly remoteHashes = new Map<number, number>();

  constructor(
    readonly duel: TDDuel,
    readonly slot: 0 | 1 | null,
    private readonly send: (msg: TDVersusClientMessage) => void,
  ) {
    // 最初の数ターンは、両席とも操作なしと決めておく
    for (let t = 0; t < TD_DUEL_INPUT_DELAY; t++) {
      this.inputs[0].set(t, []);
      this.inputs[1].set(t, []);
    }
    if (slot === null) {
      // 観戦では画面から操作できないようにする（送らず、反映もしない）
      for (const side of duel.sides) side.commandSink = () => {};
    } else {
      // 自分の陣営の画面操作は、送ってから反映する
      duel.sides[slot].commandSink = (cmd) => this.pending.push(cmd);
    }
  }

  /** 観戦か */
  get spectator(): boolean {
    return this.slot === null;
  }

  /** 自分の陣営のラン（観戦では青〈ホスト〉） */
  get mine(): TDRun {
    return this.duel.sides[this.slot ?? 0];
  }

  get opponent(): TDRun {
    return this.duel.sides[1 - (this.slot ?? 0)];
  }

  get turn(): number {
    return Math.floor(this.steps / TD_DUEL_TURN_STEPS);
  }

  /** 観戦で、届いた操作に対して何ターン遅れているか */
  get lagTurns(): number {
    return Math.max(0, Math.min(this.knownUpTo[0], this.knownUpTo[1]) - this.turn);
  }

  /** 相手の操作が届いた（観戦では from にどちらの席の操作かが入る） */
  receiveInput(turn: number, cmds: readonly TDDuelCommand[], from?: number): void {
    const slot = this.slot === null ? (from === 1 ? 1 : 0) : 1 - this.slot;
    this.inputs[slot].set(turn, [...cmds]);
    if (turn > this.knownUpTo[slot]) this.knownUpTo[slot] = turn;
  }

  /** 観戦を始めたとき、それまでの操作の記録を読み込む（記録にないターンは空の操作） */
  loadLog(log: TDVersusInputLog): void {
    for (const slot of [0, 1] as const) {
      for (let t = TD_DUEL_INPUT_DELAY; t <= log.upTo[slot]; t++) if (!this.inputs[slot].has(t)) this.inputs[slot].set(t, []);
      if (log.upTo[slot] > this.knownUpTo[slot]) this.knownUpTo[slot] = log.upTo[slot];
    }
    for (const [slot, turn, cmds] of log.cmds) {
      if ((slot === 0 || slot === 1) && turn <= log.upTo[slot]) this.inputs[slot].set(turn, [...cmds]);
    }
  }

  /** 相手の戦況のハッシュが届いた */
  receiveHash(turn: number, h: number): void {
    if (this.spectator) return;
    this.remoteHashes.set(turn, h);
    this.compareHash(turn);
  }

  /**
   * 実時間 dt ぶん戦場を進める（相手の操作が届いていなければ待つ）。進めたステップ数を返す。
   * 観戦で遅れているときは、1 フレーム TD_SPECTATE_BUDGET_MS まで早送りする（now は経過時間を測る時計）
   */
  advance(battle: Battle, dt: number, now: () => number = () => performance.now()): number {
    if (this.finished) return 0;
    this.catchingUp = this.spectator && this.lagTurns > TD_SPECTATE_LAG_TURNS;
    if (this.catchingUp) return this.fastForward(battle, now);
    this.backlog = Math.min(this.backlog + dt, TD_DUEL_MAX_BACKLOG);
    let n = 0;
    while (this.backlog >= battle.fixedDt && n < TD_DUEL_MAX_STEPS_PER_FRAME) {
      if (!this.stepOnce(battle)) break;
      this.backlog -= battle.fixedDt;
      n++;
      if (this.finished) break;
    }
    if (this.stalled) this.stallTime += dt;
    return n;
  }

  /** 観戦の早送り。時間の予算を使い切るか、追いつくまで進める */
  private fastForward(battle: Battle, now: () => number): number {
    const start = now();
    this.backlog = 0;
    let n = 0;
    while (!this.finished && this.lagTurns > TD_DUEL_INPUT_DELAY) {
      if (!this.stepOnce(battle)) break;
      n++;
      if (n % TD_DUEL_TURN_STEPS === 0 && now() - start >= TD_SPECTATE_BUDGET_MS) break;
    }
    return n;
  }

  /** 固定ステップを 1 つ進める。ターンの始めに操作がそろっていなければ進めず false */
  private stepOnce(battle: Battle): boolean {
    if (this.steps % TD_DUEL_TURN_STEPS === 0 && !this.beginTurn(battle, this.turn)) return false;
    withSimRandom(this.duel.simRng, () => battle.step(battle.fixedDt));
    this.steps++;
    if (this.duel.outcome()) {
      this.finished = true;
      this.duel.finishSides();
    }
    return true;
  }

  /** ターンの始め。両席の操作がそろっていれば反映して true */
  private beginTurn(battle: Battle, turn: number): boolean {
    if (!this.spectator) this.flushLocal(turn + TD_DUEL_INPUT_DELAY);
    const a = this.inputs[0].get(turn);
    const b = this.inputs[1].get(turn);
    if (!a || !b) {
      this.stalled = true;
      return false;
    }
    this.stalled = false;
    this.stallTime = 0;
    if (!this.spectator && turn > 0 && turn % TD_DUEL_HASH_TURNS === 0) {
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
    const slot = this.slot;
    if (slot === null) return;
    while (this.sentUpTo < target) {
      this.sentUpTo++;
      const cmds = this.sentUpTo === target ? this.pending.splice(0, TD_VS_MAX_COMMANDS) : [];
      this.inputs[slot].set(this.sentUpTo, cmds);
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
