import { boxCollides, moveBox, viewDir, type CameraPose } from '../openworld/OpenWorldSim';
import { B } from '../openworld/OpenWorldConfig';
import { blastTerrain } from './TagBlast';
import type { V3 } from '../openworld/VoxelWorld';
import { makeRng } from '../openworld/WorldGen';
import type { TagSnapshot } from '../net/tagProtocol';
import { floorBelow, generateGifuTown, groundAt, resetGifuTown, type GifuTown } from './GifuTown';
import {
  TAG_BLUE_DETOUR,
  TAG_BLUE_EAT_TIME,
  TAG_BLUE_FIRST,
  TAG_BLUE_GIVEUP,
  TAG_BLUE_HOVER,
  TAG_BLUE_IGNORE,
  TAG_BLUE_INTERVAL,
  TAG_BLUE_MAX,
  TAG_BLUE_MAX_RISE,
  TAG_BLUE_RADIUS,
  TAG_BLUE_SIGHT_RANGE,
  TAG_BLUE_SIZE,
  TAG_BLUE_SPEED,
  TAG_BLUE_SWITCH,
  TAG_BLUE_TOUCH,
  TAG_BLUE_WANDER_SPEED,
  TAG_CHASE_KEEP,
  TAG_FLING_BOUNCE,
  TAG_FLING_BOUNCE_MIN,
  TAG_FLING_DRAG,
  TAG_FLING_END_SPEED,
  TAG_FLING_FRICTION,
  TAG_FLING_GRAVITY,
  TAG_FLING_LAND_BOUNCE,
  TAG_FLING_LAND_KEEP,
  TAG_FLING_MAX,
  TAG_GRAVITY,
  TAG_HAYATO_CHASE_SPEED,
  TAG_HAYATO_HOVER,
  TAG_HAYATO_MAX,
  TAG_HAYATO_MAX_RISE,
  TAG_HAYATO_RADIUS,
  TAG_HAYATO_SIZE,
  TAG_HAYATO_SPAWN_INTERVAL,
  TAG_HAYATO_SPAWN_MIN_DIST,
  TAG_HAYATO_SPEEDUP_MAX,
  TAG_HAYATO_SPEEDUP_PER_MIN,
  TAG_HAYATO_START,
  TAG_HAYATO_WANDER_SPEED,
  TAG_INVULN_TIME,
  TAG_JUMP_SPEED,
  TAG_KNOCKBACK,
  TAG_KNOCKBACK_UP,
  TAG_LASER_CHARGE,
  TAG_LASER_COOLDOWN,
  TAG_LASER_LEAD,
  TAG_LASER_RADIUS,
  TAG_LASER_RANGE,
  TAG_LASER_SPEED,
  TAG_MAX_HP,
  TAG_PLAYER_HALF,
  TAG_PLAYER_HEIGHT,
  TAG_PUNCH_COOLDOWN,
  TAG_PUNCH_HEIGHT,
  TAG_PUNCH_KNOCK,
  TAG_PUNCH_KNOCK_UP,
  TAG_PUNCH_RANGE,
  TAG_PUNCH_STUN,
  TAG_ROCKET_BLAST,
  TAG_ROCKET_COOLDOWN,
  TAG_ROCKET_HAYATO_STUN,
  TAG_ROCKET_HIT_RADIUS,
  TAG_ROCKET_KNOCK,
  TAG_ROCKET_MAX,
  TAG_ROCKET_PICK_RADIUS,
  TAG_ROCKET_PICKUPS,
  TAG_ROCKET_RANGE,
  TAG_ROCKET_RESPAWN,
  TAG_ROCKET_SPEED,
  TAG_ROCKET_STUN,
  TAG_ROCKET_STUN_RADIUS,
  TAG_SEARCH_TIME,
  TAG_SENSE_RANGE,
  TAG_SIGHT_COS,
  TAG_SIGHT_RANGE,
  TAG_SPRINT_SPEED,
  TAG_STAMINA_MAX,
  TAG_STAMINA_RECOVER,
  TAG_STAMINA_REGEN,
  TAG_WALK_SPEED,
} from './TagConfig';

/**
 * 鬼ごっこのシミュレーション（Three.js 非依存）。
 *
 * - ソロとオンラインのホストは「権限あり」（authority）: ハヤトの動き・レーザー・当たり・決着をここで決める。
 * - オンラインのゲストは権限なし: 自分のかぶくんだけを動かし、ハヤトとレーザーはホストの様子（snapshot）を写す。
 * - どの端末も、自分のかぶくんの動きは自分で計算する（ほかの人の位置は届いた値へなめらかに寄せる）。
 */

/** 1 ステップの操作 */
export interface TagInput {
  /** 左右（右が +1） */
  moveX: number;
  /** 前後（前が +1） */
  moveZ: number;
  /** カメラの向き（移動の基準） */
  yaw: number;
  jump: boolean;
  sprint: boolean;
}

export function emptyTagInput(): TagInput {
  return { moveX: 0, moveZ: 0, yaw: 0, jump: false, sprint: false };
}

export interface TagPlayer {
  id: number;
  name: string;
  /** 足もとの中心 */
  pos: V3;
  vel: V3;
  /** 体の向き */
  yaw: number;
  onGround: boolean;
  hp: number;
  alive: boolean;
  /** 無敵の残り秒 */
  invuln: number;
  /** 息（ダッシュの残り秒） */
  stamina: number;
  /** 息切れ中（回復するまで走れない） */
  exhausted: boolean;
  /** 逃げ切った秒数（アウトになった時刻。生きている間は今の時刻） */
  survived: number;
  /** 歩いているか（描画用） */
  moving: boolean;
  /** 届いた位置（この端末で動かさない人） */
  net: { x: number; y: number; z: number; yaw: number } | null;
  /** 回線が切れて抜けた */
  left: boolean;
  /** 動けない残り秒（パンチ・爆風） */
  stun: number;
  /** 持っているロケットの数 */
  rockets: number;
  /** パンチ・ロケットを次に使えるまで（秒） */
  punchCooldown: number;
  rocketCooldown: number;
  /** ふっとんでいる残り秒（0 なら操作できる。物理で飛び、壁で跳ね返る） */
  fling: number;
}

/** eat は青鬼が食べている間 */
export type HayatoState = 'wander' | 'chase' | 'aim' | 'search' | 'stun' | 'eat';
const HAYATO_STATES: readonly HayatoState[] = ['wander', 'chase', 'aim', 'search', 'stun', 'eat'];

/** red = ふつうのハヤト（レーザー）、blue = 青鬼（でかい・触れたら食べる） */
export type HayatoKind = 'red' | 'blue';

export interface Hayato {
  id: number;
  kind: HayatoKind;
  /** 顔の中心 */
  pos: V3;
  yaw: number;
  state: HayatoState;
  /** 狙っているプレイヤー（いなければ -1） */
  target: number;
  /** ための経過（秒） */
  charge: number;
  /** 次のためを始められるまで（秒） */
  cooldown: number;
  lastSeen: V3 | null;
  searchTimer: number;
  goal: { x: number; z: number } | null;
  /** 進めなかった時間（目的地を変える） */
  stuck: number;
  /** 壁を越えるために浮き上がっている量 */
  climb: number;
  /** 届いた位置（権限のない端末） */
  net: { x: number; y: number; z: number; yaw: number } | null;
  /** 爆風で止まっている残り秒 */
  stun: number;
  /** 青鬼: 食べている残り秒 */
  eat: number;
  /** 青鬼: 相手に近づけていない時間（長いとあきらめる）と、いちばん近づいた距離 */
  giveup: number;
  best: number;
  /** 青鬼: 壁を回り込んでいる残り秒と向き（+1 左 / -1 右） */
  detour: number;
  detourSign: number;
  /** 青鬼: あきらめた相手と、また狙うまでの残り秒 */
  ignore: number;
  ignoreTimer: number;
}

/** ハヤトの作りたての値（種類と位置だけ決める） */
function newHayato(id: number, kind: HayatoKind, pos: V3, yaw: number): Hayato {
  return {
    id,
    kind,
    pos,
    yaw,
    state: 'wander',
    target: -1,
    charge: 0,
    cooldown: 1.5,
    lastSeen: null,
    searchTimer: 0,
    goal: null,
    stuck: 0,
    climb: 0,
    net: null,
    stun: 0,
    eat: 0,
    giveup: 0,
    best: Infinity,
    detour: 0,
    detourSign: 1,
    ignore: -1,
    ignoreTimer: 0,
  };
}

/** ハヤトの顔の大きさ（高さ） */
export function hayatoSize(h: Hayato): number {
  return h.kind === 'blue' ? TAG_BLUE_SIZE : TAG_HAYATO_SIZE;
}

/** ハヤトの壁との当たり判定の半径 */
export function hayatoRadius(h: Hayato): number {
  return h.kind === 'blue' ? TAG_BLUE_RADIUS : TAG_HAYATO_RADIUS;
}

export interface Bolt {
  id: number;
  owner: number;
  pos: V3;
  dir: V3;
  traveled: number;
}

/** 飛んでいるロケット */
export interface Rocket {
  id: number;
  owner: number;
  pos: V3;
  dir: V3;
  traveled: number;
}

/** 町に落ちているロケット（拾う物） */
export interface RocketPickup {
  id: number;
  pos: V3;
  /** 拾える状態か */
  active: boolean;
  /** 拾われてから戻るまでの残り秒 */
  respawn: number;
}

export type TagEvent =
  | { kind: 'spawn'; hayato: number; pos: V3; blue: boolean }
  /** 青鬼に食べられた（アウト） */
  | { kind: 'eaten'; hayato: number; player: number }
  | { kind: 'spot'; hayato: number; target: number }
  | { kind: 'fire'; bolt: number; hayato: number; from: V3; dir: V3 }
  | { kind: 'bolt_end'; bolt: number; pos: V3 }
  | { kind: 'hit'; player: number; hp: number; bolt: number; dir: V3 }
  | { kind: 'out'; player: number; time: number }
  | { kind: 'over'; winner: number }
  | { kind: 'punch'; attacker: number; victim: number }
  | { kind: 'stun'; player: number; time: number; by: 'punch' | 'blast' }
  | { kind: 'rocket_fire'; rocket: number; owner: number; from: V3; dir: V3 }
  | { kind: 'explode'; rocket: number; pos: V3; broken: number }
  | { kind: 'pickup'; pickup: number; player: number }
  | { kind: 'pickup_back'; pickup: number };

export type { TagSnapshot };

export type TagPhase = 'playing' | 'over';

const PLAYER_CENTER = TAG_PLAYER_HEIGHT * 0.5;
const r2 = (v: number): number => Math.round(v * 100) / 100;

export class TagSim {
  readonly town: GifuTown;
  readonly players: TagPlayer[] = [];
  readonly hayatos: Hayato[] = [];
  readonly bolts: Bolt[] = [];
  readonly rockets: Rocket[] = [];
  readonly pickups: RocketPickup[] = [];
  private nextRocketId = 1;
  readonly events: TagEvent[] = [];
  time = 0;
  /** 次にハヤトが増える時刻 */
  nextSpawn = TAG_HAYATO_SPAWN_INTERVAL;
  /** 次に青鬼が出る時刻 */
  nextBlue = TAG_BLUE_FIRST;
  phase: TagPhase = 'playing';
  /** 勝者（オンライン）。ソロ・全員同時アウトで決まらないときは -1 */
  winner = -1;
  /** ソロか（1 人で始めた） */
  readonly solo: boolean;
  private nextHayatoId = 1;
  private nextBoltId = 1;
  private readonly rng: () => number;
  /** ゲストに送る出来事（snapshot で送ったら空にする） */
  private readonly outbox: (string | number)[][] = [];

  constructor(
    readonly seed: number,
    roster: readonly { id: number; name: string }[],
    /** この端末で動かすプレイヤー（観戦なら null） */
    readonly localId: number | null,
    public authority: boolean,
    town?: GifuTown,
  ) {
    this.town = town ?? generateGifuTown(1);
    // 前の鬼ごっこでロケットに壊された町を元に戻す
    resetGifuTown(this.town);
    this.rng = makeRng(seed);
    this.solo = roster.length <= 1;
    roster.forEach((r, k) => {
      const sp = this.town.playerSpawns[k % this.town.playerSpawns.length];
      this.players.push({
        id: r.id,
        name: r.name,
        pos: { x: sp.x, y: sp.y, z: sp.z },
        vel: { x: 0, y: 0, z: 0 },
        yaw: Math.PI,
        onGround: true,
        hp: TAG_MAX_HP,
        alive: true,
        invuln: 0,
        stamina: TAG_STAMINA_MAX,
        exhausted: false,
        survived: 0,
        moving: false,
        net: null,
        left: false,
        stun: 0,
        rockets: 0,
        punchCooldown: 0,
        rocketCooldown: 0,
        fling: 0,
      });
    });
    // 落ちているロケット（全員が同じ場所になるよう、種から決める）
    const prng = makeRng(seed ^ 0x5bd1e995);
    const nav = this.town.navPoints;
    for (let k = 0; k < TAG_ROCKET_PICKUPS && nav.length > 0; k++) {
      const n = nav[Math.floor(prng() * nav.length)];
      const y = groundAt(this.town.world, n.x, n.z);
      if (y < 0) continue;
      this.pickups.push({ id: this.pickups.length, pos: { x: n.x, y, z: n.z }, active: true, respawn: 0 });
    }
    if (authority) for (let k = 0; k < TAG_HAYATO_START; k++) this.spawnHayato();
  }

  get world() {
    return this.town.world;
  }

  player(id: number): TagPlayer | undefined {
    return this.players.find((p) => p.id === id);
  }

  get local(): TagPlayer | undefined {
    return this.localId === null ? undefined : this.player(this.localId);
  }

  aliveCount(): number {
    return this.players.filter((p) => p.alive).length;
  }

  /** ハヤトが速くなる倍率（時間とともに上がる） */
  speedMul(): number {
    return Math.min(TAG_HAYATO_SPEEDUP_MAX, 1 + (this.time / 60) * TAG_HAYATO_SPEEDUP_PER_MIN);
  }

  // ---- 1 ステップ ----

  step(dt: number, input: TagInput | null): void {
    if (this.phase === 'playing') this.time += dt;
    for (const p of this.players) {
      if (p.alive) p.survived = this.time;
      if (p.id === this.localId) {
        // パンチや爆風で動けない間は操作を受け付けない
        if (p.alive && input && this.phase === 'playing' && p.stun <= 0) this.movePlayer(p, input, dt);
        else this.movePlayer(p, emptyTagInput(), dt);
      } else if (p.net) {
        // 届いた位置へなめらかに寄せる
        const k = Math.min(1, dt * 12);
        const dx = p.net.x - p.pos.x;
        const dz = p.net.z - p.pos.z;
        p.moving = Math.hypot(dx, dz) > 0.05;
        p.pos.x += dx * k;
        p.pos.y += (p.net.y - p.pos.y) * k;
        p.pos.z += dz * k;
        p.yaw = lerpAngle(p.yaw, p.net.yaw, k);
      }
      p.invuln = Math.max(0, p.invuln - dt);
      // 動けない時間は、ふっとび終わって着地してから数える
      if (p.fling <= 0) p.stun = Math.max(0, p.stun - dt);
      // ほかの端末の人のふっとびは見た目だけ（回転の演出）なので時間で終える
      if (p.id !== this.localId) p.fling = Math.max(0, p.fling - dt * 2);
      p.punchCooldown = Math.max(0, p.punchCooldown - dt);
      p.rocketCooldown = Math.max(0, p.rocketCooldown - dt);
    }
    if (this.authority) {
      if (this.phase === 'playing') {
        this.updateSpawns();
        for (const h of this.hayatos) {
          if (h.kind === 'blue') this.updateBlue(h, dt);
          else this.updateHayato(h, dt);
        }
      }
      this.updateBolts(dt, true);
      this.updateRockets(dt, true);
      if (this.phase === 'playing') this.updatePickups(dt);
      if (this.phase === 'playing') this.checkOver();
    } else {
      for (const h of this.hayatos) {
        if (!h.net) continue;
        const k = Math.min(1, dt * 10);
        h.pos.x += (h.net.x - h.pos.x) * k;
        h.pos.y += (h.net.y - h.pos.y) * k;
        h.pos.z += (h.net.z - h.pos.z) * k;
        h.yaw = lerpAngle(h.yaw, h.net.yaw, k);
        if (h.state === 'aim') h.charge += dt;
        if (h.state === 'eat') h.eat = Math.max(0, h.eat - dt);
      }
      this.updateBolts(dt, false);
      this.updateRockets(dt, false);
    }
  }

  // ---- かぶくん ----

  private movePlayer(p: TagPlayer, input: TagInput, dt: number): void {
    if (p.fling > 0) {
      this.flingPlayer(p, dt);
      return;
    }
    const fx = Math.sin(input.yaw);
    const fz = Math.cos(input.yaw);
    // 右 = 前 × 上
    let mx = fx * input.moveZ - fz * input.moveX;
    let mz = fz * input.moveZ + fx * input.moveX;
    const len = Math.hypot(mx, mz);
    if (len > 1) {
      mx /= len;
      mz /= len;
    }
    const moving = len > 0.01;
    // 息
    const wantSprint = input.sprint && moving && !p.exhausted;
    if (wantSprint) {
      p.stamina = Math.max(0, p.stamina - dt);
      if (p.stamina <= 0) p.exhausted = true;
    } else {
      p.stamina = Math.min(TAG_STAMINA_MAX, p.stamina + TAG_STAMINA_REGEN * dt);
      if (p.exhausted && p.stamina >= TAG_STAMINA_RECOVER) p.exhausted = false;
    }
    const inWater = this.world.get(Math.floor(p.pos.x), Math.floor(p.pos.y + 0.3), Math.floor(p.pos.z)) === B.WATER;
    const speed = (wantSprint ? TAG_SPRINT_SPEED : TAG_WALK_SPEED) * (inWater ? 0.55 : 1);
    const accel = p.onGround ? 40 : 14;
    const tx = mx * speed;
    const tz = mz * speed;
    p.vel.x += clampAbs(tx - p.vel.x, accel * dt);
    p.vel.z += clampAbs(tz - p.vel.z, accel * dt);
    if (input.jump && p.onGround) {
      p.vel.y = TAG_JUMP_SPEED;
      p.onGround = false;
    }
    p.vel.y -= TAG_GRAVITY * (inWater ? 0.5 : 1) * dt;
    if (inWater) p.vel.y = Math.max(p.vel.y, input.jump ? 3 : -3);
    p.onGround = moveBox(this.world, p.pos, p.vel, TAG_PLAYER_HALF, TAG_PLAYER_HEIGHT, dt, true, p.onGround);
    if (moving) p.yaw = lerpAngle(p.yaw, Math.atan2(mx, mz), Math.min(1, dt * 14));
    p.moving = moving && Math.hypot(p.vel.x, p.vel.z) > 0.5;
  }

  /**
   * ふっとんでいる間の動き（操作は効かない）。重力・空気抵抗・地面の摩擦で減速し、
   * 壁に当たると跳ね返り、強く落ちると地面で弾む。遅くなって着地したら終わる。
   */
  private flingPlayer(p: TagPlayer, dt: number): void {
    p.fling = Math.max(0, p.fling - dt);
    const drag = Math.max(0, 1 - TAG_FLING_DRAG * dt);
    p.vel.x *= drag;
    p.vel.z *= drag;
    if (p.onGround) {
      // 地面をすべって減速する
      const hs = Math.hypot(p.vel.x, p.vel.z);
      if (hs > 0) {
        const k = Math.max(0, hs - TAG_FLING_FRICTION * dt) / hs;
        p.vel.x *= k;
        p.vel.z *= k;
      }
    }
    const inWater = this.world.get(Math.floor(p.pos.x), Math.floor(p.pos.y + 0.3), Math.floor(p.pos.z)) === B.WATER;
    if (inWater) {
      // 水に落ちたら勢いが消える
      p.vel.x *= 0.9;
      p.vel.z *= 0.9;
    }
    p.vel.y -= TAG_GRAVITY * TAG_FLING_GRAVITY * (inWater ? 0.5 : 1) * dt;
    const before = { x: p.vel.x, y: p.vel.y, z: p.vel.z };
    const wasGround = p.onGround;
    p.onGround = moveBox(this.world, p.pos, p.vel, TAG_PLAYER_HALF, TAG_PLAYER_HEIGHT, dt, false, false);
    // 壁に当たった向きは跳ね返す
    if (before.x !== 0 && p.vel.x === 0) p.vel.x = -before.x * TAG_FLING_BOUNCE;
    if (before.z !== 0 && p.vel.z === 0) p.vel.z = -before.z * TAG_FLING_BOUNCE;
    // 町の端も壁と同じに跳ね返す
    const w = this.world;
    if ((p.pos.x <= 0.5 && p.vel.x < 0) || (p.pos.x >= w.sizeX - 0.5 && p.vel.x > 0)) p.vel.x = -p.vel.x * TAG_FLING_BOUNCE;
    if ((p.pos.z <= 0.5 && p.vel.z < 0) || (p.pos.z >= w.sizeZ - 0.5 && p.vel.z > 0)) p.vel.z = -p.vel.z * TAG_FLING_BOUNCE;
    // 天井（高架・アーケードの屋根など）に当たったら下へ跳ね返す
    if (before.y > 0 && p.vel.y === 0 && !p.onGround) p.vel.y = -before.y * TAG_FLING_BOUNCE;
    // 強く落ちたら弾む（横の勢いは少しだけ減る）
    if (p.onGround && !wasGround && before.y < -TAG_FLING_BOUNCE_MIN) {
      p.vel.y = -before.y * TAG_FLING_LAND_BOUNCE;
      p.vel.x *= TAG_FLING_LAND_KEEP;
      p.vel.z *= TAG_FLING_LAND_KEEP;
      p.onGround = false;
    }
    p.moving = false;
    if (p.fling <= 0 || (p.onGround && Math.hypot(p.vel.x, p.vel.z) < TAG_FLING_END_SPEED)) p.fling = 0;
  }

  /** ふっとばす（この端末で動かす人だけ速さを与える。ほかの人は見た目の回転だけ） */
  private fling(p: TagPlayer, dir: V3, speed: number, up: number): void {
    if (p.id === this.localId) {
      p.vel.x = dir.x * speed;
      p.vel.z = dir.z * speed;
      p.vel.y = up;
      p.onGround = false;
      p.fling = TAG_FLING_MAX;
    } else {
      // ほかの端末の人は届く位置で飛んで見えるので、回転の演出だけ（長めに）
      p.fling = 2.5;
    }
  }

  /** ほかの端末から届いたプレイヤーの位置 */
  setRemotePlayer(id: number, x: number, y: number, z: number, yaw: number): void {
    const p = this.player(id);
    if (!p || p.id === this.localId) return;
    if (!p.net) {
      p.pos.x = x;
      p.pos.y = y;
      p.pos.z = z;
    }
    p.net = { x, y, z, yaw };
  }

  /** 回線が切れて抜けた人（アウト扱い。勝者にはならない） */
  removePlayer(id: number): void {
    const p = this.player(id);
    if (!p || p.left) return;
    p.left = true;
    if (p.alive) {
      p.alive = false;
      p.survived = this.time;
      this.events.push({ kind: 'out', player: id, time: this.time });
    }
    if (this.authority && this.phase === 'playing') this.checkOver();
  }

  // ---- ハヤト ----

  private spawnHayato(kind: HayatoKind = 'red'): void {
    const alive = this.players.filter((p) => p.alive);
    const nav = this.town.navPoints;
    let best = nav[0];
    let bestD = -1;
    for (let k = 0; k < (kind === 'blue' ? 80 : 40); k++) {
      const c = nav[Math.floor(this.rng() * nav.length)];
      // 青鬼は体が入りきる広い所にだけ出す
      if (kind === 'blue') {
        const f = floorBelow(this.world, c.x, this.world.sizeY - 1, c.z);
        if (boxCollides(this.world, c.x, f + TAG_BLUE_HOVER, c.z, TAG_BLUE_RADIUS, TAG_BLUE_SIZE)) continue;
      }
      const d = alive.length ? Math.min(...alive.map((p) => Math.hypot(p.pos.x - c.x, p.pos.z - c.z))) : 999;
      if (d >= TAG_HAYATO_SPAWN_MIN_DIST) {
        best = c;
        bestD = d;
        break;
      }
      if (d > bestD) {
        best = c;
        bestD = d;
      }
    }
    const floor = floorBelow(this.world, best.x, this.world.sizeY - 1, best.z);
    const y = kind === 'blue' ? floor + TAG_BLUE_HOVER + TAG_BLUE_SIZE / 2 : floor + TAG_HAYATO_HOVER;
    const h = newHayato(this.nextHayatoId++, kind, { x: best.x, y, z: best.z }, this.rng() * Math.PI * 2);
    this.hayatos.push(h);
    this.events.push({ kind: 'spawn', hayato: h.id, pos: { ...h.pos }, blue: kind === 'blue' });
  }

  /** 増やしたい青鬼を今すぐ出す（テスト・演出用） */
  spawnBlue(): Hayato | undefined {
    if (!this.authority) return undefined;
    this.spawnHayato('blue');
    return this.hayatos[this.hayatos.length - 1];
  }

  private updateSpawns(): void {
    while (this.time >= this.nextSpawn) {
      this.nextSpawn += TAG_HAYATO_SPAWN_INTERVAL;
      if (this.hayatos.filter((h) => h.kind === 'red').length < TAG_HAYATO_MAX) this.spawnHayato();
    }
    while (this.time >= this.nextBlue) {
      this.nextBlue += TAG_BLUE_INTERVAL;
      if (this.hayatos.filter((h) => h.kind === 'blue').length < TAG_BLUE_MAX) this.spawnHayato('blue');
    }
  }

  /** ハヤトから見えるか（距離・視野・さえぎるブロック） */
  canSee(h: Hayato, p: TagPlayer): boolean {
    if (!p.alive) return false;
    const cx = p.pos.x - h.pos.x;
    const cy = p.pos.y + PLAYER_CENTER - h.pos.y;
    const cz = p.pos.z - h.pos.z;
    const d = Math.hypot(cx, cy, cz);
    if (d > TAG_SIGHT_RANGE) return false;
    if (d > TAG_SENSE_RANGE) {
      const fx = Math.sin(h.yaw);
      const fz = Math.cos(h.yaw);
      const hd = Math.hypot(cx, cz) || 1;
      if ((cx * fx + cz * fz) / hd < TAG_SIGHT_COS) return false;
    }
    return this.lineClear(h.pos, { x: p.pos.x, y: p.pos.y + PLAYER_CENTER, z: p.pos.z });
  }

  /** 2 点の間をブロックがさえぎっていないか */
  lineClear(a: V3, b: V3): boolean {
    const dir = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
    const d = Math.hypot(dir.x, dir.y, dir.z);
    if (d < 0.01) return true;
    const hit = this.world.raycast(a, dir, d);
    return !hit || hit.dist >= d - 0.5;
  }

  private updateHayato(h: Hayato, dt: number): void {
    h.cooldown = Math.max(0, h.cooldown - dt);
    // 爆風でくらくらしている間は、その場でゆっくり沈むだけ
    if (h.stun > 0) {
      h.stun -= dt;
      h.state = h.stun > 0 ? 'stun' : 'search';
      h.charge = 0;
      h.yaw += dt * 6;
      if (h.stun <= 0) h.searchTimer = TAG_SEARCH_TIME;
      return;
    }
    const mul = this.speedMul();
    // いちばん近い、見えているプレイヤー
    let seen: TagPlayer | null = null;
    let seenD = Infinity;
    for (const p of this.players) {
      if (!p.alive) continue;
      const d = Math.hypot(p.pos.x - h.pos.x, p.pos.z - h.pos.z);
      // 狙っている相手は少しだけ優先する
      const score = p.id === h.target ? d - 4 : d;
      if (score < seenD && this.canSee(h, p)) {
        seen = p;
        seenD = score;
      }
    }

    if (seen) {
      if (h.state === 'wander' || h.state === 'search' || h.target !== seen.id) {
        this.events.push({ kind: 'spot', hayato: h.id, target: seen.id });
        this.send(['s', h.id, seen.id]);
      }
      if (h.target !== seen.id && h.state === 'aim') h.charge = 0;
      h.target = seen.id;
      h.lastSeen = { x: seen.pos.x, y: seen.pos.y, z: seen.pos.z };
      h.searchTimer = TAG_SEARCH_TIME;
      const tx = seen.pos.x - h.pos.x;
      const tz = seen.pos.z - h.pos.z;
      const face = Math.atan2(tx, tz);
      if (h.state !== 'aim' && h.cooldown <= 0) {
        h.state = 'aim';
        h.charge = 0;
      } else if (h.state !== 'aim') {
        h.state = 'chase';
      }
      if (h.state === 'aim') {
        h.yaw = lerpAngle(h.yaw, face, Math.min(1, dt * 10));
        h.charge += dt;
        // ためている間はゆっくり寄るだけ
        this.flyToward(h, seen.pos.x, seen.pos.z, TAG_HAYATO_WANDER_SPEED * 0.3 * mul, dt, TAG_CHASE_KEEP);
        if (h.charge >= TAG_LASER_CHARGE) this.fire(h, seen);
      } else {
        h.yaw = lerpAngle(h.yaw, face, Math.min(1, dt * 6));
        this.flyToward(h, seen.pos.x, seen.pos.z, TAG_HAYATO_CHASE_SPEED * mul, dt, TAG_CHASE_KEEP);
      }
      return;
    }

    // 見失った: 最後に見た場所を探す
    if (h.state === 'aim') h.charge = 0;
    if (h.lastSeen && h.searchTimer > 0) {
      h.state = 'search';
      h.searchTimer -= dt;
      const arrived = this.flyToward(h, h.lastSeen.x, h.lastSeen.z, TAG_HAYATO_CHASE_SPEED * mul, dt, 0.8, true);
      // 着いたら見回す
      if (arrived) h.yaw += dt * 2.4;
      if (h.searchTimer <= 0) {
        h.lastSeen = null;
        h.target = -1;
        h.state = 'wander';
      }
      return;
    }
    h.state = 'wander';
    h.target = -1;
    const nav = this.town.navPoints;
    if (!h.goal || h.stuck > 3.5) {
      h.goal = nav[Math.floor(this.rng() * nav.length)];
      h.stuck = 0;
    }
    const arrived = this.flyToward(h, h.goal.x, h.goal.z, TAG_HAYATO_WANDER_SPEED * mul, dt, 1.5, true);
    if (arrived) h.goal = null;
  }

  // ---- 青鬼ハヤト ----

  /** 青鬼が気づけるか（まわり全部が見える。建物の陰は見えない） */
  blueSees(h: Hayato, p: TagPlayer): boolean {
    if (!p.alive) return false;
    const c = { x: p.pos.x, y: p.pos.y + PLAYER_CENTER, z: p.pos.z };
    if (Math.hypot(c.x - h.pos.x, c.y - h.pos.y, c.z - h.pos.z) > TAG_BLUE_SIGHT_RANGE) return false;
    return this.lineClear(h.pos, c);
  }

  /** 青鬼の体にふれているか */
  blueTouches(h: Hayato, p: TagPlayer): boolean {
    if (!p.alive) return false;
    const d = Math.hypot(p.pos.x - h.pos.x, p.pos.z - h.pos.z);
    if (d > TAG_BLUE_RADIUS + TAG_PLAYER_HALF + TAG_BLUE_TOUCH) return false;
    const half = TAG_BLUE_SIZE / 2;
    return p.pos.y + TAG_PLAYER_HEIGHT > h.pos.y - half - 0.3 && p.pos.y < h.pos.y + half;
  }

  /**
   * 青鬼: 一度見つけたら、見えなくなっても居場所を知って、ダッシュと同じ速さで追い続ける。
   * 建物は越えられず、幅 2 ブロックの路地には体が入らない。近づけないまま時間がたつとあきらめる。
   * もっと近いほかのプレイヤーがいれば、そちらへ狙いを移す。
   */
  private updateBlue(h: Hayato, dt: number): void {
    h.charge = 0;
    // 爆風でくらくらしている間は止まる
    if (h.stun > 0) {
      h.stun -= dt;
      h.state = h.stun > 0 ? 'stun' : 'chase';
      h.eat = 0;
      this.walkBlue(h, 0, 0, 0, dt);
      return;
    }
    if (h.eat > 0) {
      h.eat -= dt;
      h.state = 'eat';
      if (h.eat <= 0) {
        h.state = 'wander';
        h.target = -1;
        h.best = Infinity;
        h.giveup = 0;
      }
      return;
    }
    h.ignoreTimer = Math.max(0, h.ignoreTimer - dt);
    if (h.ignoreTimer <= 0) h.ignore = -1;
    // ふれた人を食べる
    for (const p of this.players) {
      if (this.blueTouches(h, p)) {
        this.eatPlayer(h, p);
        return;
      }
    }
    const candidates = this.players.filter((p) => p.alive && p.id !== h.ignore);
    const dist = (p: TagPlayer): number => Math.hypot(p.pos.x - h.pos.x, p.pos.z - h.pos.z);
    let target = candidates.find((p) => p.id === h.target);
    if (!target) {
      // まだ誰も追っていない: 気づいた中でいちばん近い人
      let bestD = Infinity;
      for (const p of candidates) {
        const d = dist(p);
        if (d < bestD && this.blueSees(h, p)) {
          target = p;
          bestD = d;
        }
      }
      if (target) this.blueRetarget(h, target);
    } else {
      // もっと近い人がいれば、そちらへ移る（ほかの人に押しつけられる）
      const dt0 = dist(target);
      for (const p of candidates) {
        if (p.id !== target.id && dist(p) < dt0 - TAG_BLUE_SWITCH && this.blueSees(h, p)) {
          target = p;
          this.blueRetarget(h, p);
          break;
        }
      }
    }

    if (!target) {
      h.state = 'wander';
      h.target = -1;
      const nav = this.town.navPoints;
      if (!h.goal || h.stuck > 3) {
        h.goal = nav[Math.floor(this.rng() * nav.length)];
        h.stuck = 0;
      }
      const dx = h.goal.x - h.pos.x;
      const dz = h.goal.z - h.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 2) {
        h.goal = null;
        this.walkBlue(h, 0, 0, 0, dt);
        return;
      }
      this.walkBlue(h, dx / d, dz / d, TAG_BLUE_WANDER_SPEED, dt);
      return;
    }

    h.state = 'chase';
    h.target = target.id;
    h.lastSeen = { x: target.pos.x, y: target.pos.y, z: target.pos.z };
    const dx = target.pos.x - h.pos.x;
    const dz = target.pos.z - h.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    // 近づけているか（路地の奥にいる相手には近づけない）
    if (d < h.best - 0.5) {
      h.best = d;
      h.giveup = 0;
    } else {
      h.giveup += dt;
    }
    if (h.giveup >= TAG_BLUE_GIVEUP) {
      // あきらめる: しばらくこの相手は狙わない
      h.ignore = target.id;
      h.ignoreTimer = TAG_BLUE_IGNORE;
      h.target = -1;
      h.state = 'wander';
      h.goal = null;
      h.best = Infinity;
      h.giveup = 0;
      return;
    }
    let mx = dx / d;
    let mz = dz / d;
    if (h.detour > 0) {
      // 壁を回り込む: 進みたい向きを横へ 80° ずらす
      h.detour -= dt;
      const a = h.detourSign * 1.4;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      const rx = mx * c - mz * sn;
      const rz = mx * sn + mz * c;
      mx = rx;
      mz = rz;
    }
    const blocked = this.walkBlue(h, mx, mz, TAG_BLUE_SPEED, dt);
    if (blocked) {
      h.stuck += dt;
      if (h.stuck > 0.25 && h.detour <= 0) {
        h.detour = TAG_BLUE_DETOUR;
        h.detourSign = this.freerSide(h, dx / d, dz / d);
        h.stuck = 0;
      }
    } else {
      h.stuck = Math.max(0, h.stuck - dt);
    }
  }

  /** 狙いを決めた・移した */
  private blueRetarget(h: Hayato, p: TagPlayer): void {
    h.target = p.id;
    h.best = Math.hypot(p.pos.x - h.pos.x, p.pos.z - h.pos.z);
    h.giveup = 0;
    h.detour = 0;
    this.events.push({ kind: 'spot', hayato: h.id, target: p.id });
    this.send(['s', h.id, p.id]);
  }

  /** 壁につかえたとき、左右どちらへ回り込むか（空いている方。両方空いていれば交互） */
  private freerSide(h: Hayato, fx: number, fz: number): number {
    const bottom = h.pos.y - TAG_BLUE_SIZE / 2;
    const free = (sign: number): boolean => {
      const a = sign * 1.4;
      const x = h.pos.x + (fx * Math.cos(a) - fz * Math.sin(a)) * 1.5;
      const z = h.pos.z + (fx * Math.sin(a) + fz * Math.cos(a)) * 1.5;
      return !boxCollides(this.world, x, bottom + 0.5, z, TAG_BLUE_RADIUS, TAG_BLUE_SIZE - 0.5);
    };
    const l = free(1);
    const r = free(-1);
    if (l && !r) return 1;
    if (r && !l) return -1;
    return -h.detourSign;
  }

  /** 青鬼を地面に沿って歩かせる（段差は少しだけ乗り越える）。進めなかったら true */
  private walkBlue(h: Hayato, mx: number, mz: number, speed: number, dt: number): boolean {
    const half = TAG_BLUE_SIZE / 2;
    const floor = floorBelow(this.world, h.pos.x, h.pos.y - half + 0.2, h.pos.z);
    const vx = mx * speed;
    const vz = mz * speed;
    if (speed > 0) h.yaw = lerpAngle(h.yaw, Math.atan2(mx, mz), Math.min(1, dt * 8));
    const wantY = floor + TAG_BLUE_HOVER + half + h.climb;
    const vel = { x: vx, y: clampAbs((wantY - h.pos.y) * 4, 8), z: vz };
    const bottom = { x: h.pos.x, y: h.pos.y - half, z: h.pos.z };
    const before = { x: bottom.x, z: bottom.z };
    moveBox(this.world, bottom, vel, TAG_BLUE_RADIUS, TAG_BLUE_SIZE, dt, false, false);
    const moved = Math.hypot(bottom.x - before.x, bottom.z - before.z);
    const intended = Math.hypot(vx, vz) * dt;
    const blocked = intended > 0 && moved < intended * 0.35;
    if (blocked) h.climb = Math.min(TAG_BLUE_MAX_RISE, h.climb + dt * 5);
    else h.climb = Math.max(0, h.climb - dt * 2);
    h.pos.x = bottom.x;
    h.pos.y = bottom.y + half;
    h.pos.z = bottom.z;
    return blocked;
  }

  /** 青鬼が食べる（権限のある端末で決める） */
  private eatPlayer(h: Hayato, p: TagPlayer): void {
    h.eat = TAG_BLUE_EAT_TIME;
    h.state = 'eat';
    h.target = p.id;
    h.yaw = Math.atan2(p.pos.x - h.pos.x, p.pos.z - h.pos.z);
    this.applyEaten(h.id, p.id);
    this.send(['E', h.id, p.id]);
  }

  /** 食べられた（ゲストはホストの知らせをそのまま写す） */
  applyEaten(hayato: number, id: number): void {
    const p = this.player(id);
    if (!p || !p.alive) return;
    p.hp = 0;
    p.alive = false;
    p.fling = 0;
    p.survived = this.time;
    const h = this.hayatos.find((e) => e.id === hayato);
    if (h) {
      h.state = 'eat';
      h.target = id;
      h.eat = Math.max(h.eat, TAG_BLUE_EAT_TIME);
    }
    this.events.push({ kind: 'eaten', hayato, player: id });
    this.events.push({ kind: 'out', player: id, time: this.time });
  }

  /** 目的地へ飛ぶ。keep より近ければ止まる。着いていれば true */
  private flyToward(h: Hayato, gx: number, gz: number, speed: number, dt: number, keep: number, turn = false): boolean {
    const dx = gx - h.pos.x;
    const dz = gz - h.pos.z;
    const d = Math.hypot(dx, dz);
    const half = TAG_HAYATO_SIZE / 2;
    const floor = floorBelow(this.world, h.pos.x, h.pos.y - half + 0.2, h.pos.z);
    let vx = 0;
    let vz = 0;
    if (d > keep) {
      vx = (dx / d) * speed;
      vz = (dz / d) * speed;
      if (turn) h.yaw = lerpAngle(h.yaw, Math.atan2(dx, dz), Math.min(1, dt * 5));
    }
    const wantY = floor + TAG_HAYATO_HOVER + h.climb;
    const vel = { x: vx, y: clampAbs((wantY - h.pos.y) * 3, 5), z: vz };
    const bottom = { x: h.pos.x, y: h.pos.y - half, z: h.pos.z };
    const before = { x: bottom.x, z: bottom.z };
    moveBox(this.world, bottom, vel, TAG_HAYATO_RADIUS, TAG_HAYATO_SIZE, dt, false, false);
    const moved = Math.hypot(bottom.x - before.x, bottom.z - before.z);
    const intended = Math.hypot(vx, vz) * dt;
    if (intended > 0 && moved < intended * 0.35) {
      // 壁に当たった: 浮き上がって越えようとする
      h.climb = Math.min(TAG_HAYATO_MAX_RISE, h.climb + dt * 4);
      h.stuck += dt;
    } else {
      h.climb = Math.max(0, h.climb - dt * 1.2);
      if (intended > 0) h.stuck = Math.max(0, h.stuck - dt);
    }
    h.pos.x = bottom.x;
    h.pos.y = bottom.y + half;
    h.pos.z = bottom.z;
    return d <= keep + 0.3;
  }

  /** 口からレーザーを撃つ（相手の動きを少し先読みする） */
  private fire(h: Hayato, target: TagPlayer): void {
    const from = this.mouthPos(h);
    const tc = { x: target.pos.x, y: target.pos.y + PLAYER_CENTER, z: target.pos.z };
    const dist = Math.hypot(tc.x - from.x, tc.y - from.y, tc.z - from.z);
    const vel = target.net ? { x: 0, y: 0, z: 0 } : target.vel;
    const t = (dist / TAG_LASER_SPEED) * TAG_LASER_LEAD;
    const aim = { x: tc.x + vel.x * t - from.x, y: tc.y - from.y, z: tc.z + vel.z * t - from.z };
    const len = Math.hypot(aim.x, aim.y, aim.z) || 1;
    const dir = { x: aim.x / len, y: aim.y / len, z: aim.z / len };
    const bolt: Bolt = { id: this.nextBoltId++, owner: h.id, pos: from, dir, traveled: 0 };
    this.bolts.push(bolt);
    this.events.push({ kind: 'fire', bolt: bolt.id, hayato: h.id, from: { ...from }, dir: { ...dir } });
    this.send(['f', bolt.id, h.id, r2(from.x), r2(from.y), r2(from.z), r2(dir.x), r2(dir.y), r2(dir.z)]);
    h.cooldown = TAG_LASER_COOLDOWN;
    h.charge = 0;
    h.state = 'chase';
  }

  /** 口の位置（顔の中心から前へ・少し下） */
  mouthPos(h: Hayato): V3 {
    const s = hayatoSize(h);
    return { x: h.pos.x + Math.sin(h.yaw) * 0.42 * s, y: h.pos.y - 0.29 * s, z: h.pos.z + Math.cos(h.yaw) * 0.42 * s };
  }

  private updateBolts(dt: number, judge: boolean): void {
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      let remaining = TAG_LASER_SPEED * dt;
      let ended = false;
      while (remaining > 0 && !ended) {
        const stepLen = Math.min(0.5, remaining);
        remaining -= stepLen;
        b.pos.x += b.dir.x * stepLen;
        b.pos.y += b.dir.y * stepLen;
        b.pos.z += b.dir.z * stepLen;
        b.traveled += stepLen;
        if (this.world.solidAtPoint(b.pos.x, b.pos.y, b.pos.z) || b.traveled >= TAG_LASER_RANGE) {
          ended = true;
          break;
        }
        if (!judge) continue;
        for (const p of this.players) {
          if (!p.alive || p.invuln > 0) continue;
          const dx = b.pos.x - p.pos.x;
          const dz = b.pos.z - p.pos.z;
          const dy = b.pos.y - (p.pos.y + PLAYER_CENTER);
          if (Math.hypot(dx, dz) < TAG_LASER_RADIUS + TAG_PLAYER_HALF + 0.1 && Math.abs(dy) < PLAYER_CENTER + TAG_LASER_RADIUS) {
            this.hitPlayer(p, b);
            ended = true;
            break;
          }
        }
      }
      if (ended) {
        this.bolts.splice(i, 1);
        this.events.push({ kind: 'bolt_end', bolt: b.id, pos: { ...b.pos } });
      }
    }
  }

  private hitPlayer(p: TagPlayer, b: Bolt): void {
    const hd = Math.hypot(b.dir.x, b.dir.z) || 1;
    const dir = { x: b.dir.x / hd, y: 0, z: b.dir.z / hd };
    this.applyHit(p.id, p.hp - 1, b.id, dir);
    this.send(['h', p.id, p.hp, b.id, r2(dir.x), r2(dir.z)]);
  }

  /** 当たった（権限のある端末で決めた結果を、ゲストはそのまま写す） */
  applyHit(id: number, hp: number, bolt: number, dir: V3): void {
    const p = this.player(id);
    if (!p || !p.alive) return;
    p.hp = Math.max(0, hp);
    p.invuln = TAG_INVULN_TIME;
    // 大きくふっとぶ（ハヤトから離れられる）
    this.fling(p, dir, TAG_KNOCKBACK, TAG_KNOCKBACK_UP);
    this.events.push({ kind: 'hit', player: id, hp: p.hp, bolt, dir });
    // 当たった弾は消す（ゲストの見た目の弾も）
    const k = this.bolts.findIndex((x) => x.id === bolt);
    if (k >= 0 && !this.authority) {
      const [gone] = this.bolts.splice(k, 1);
      this.events.push({ kind: 'bolt_end', bolt: gone.id, pos: { ...gone.pos } });
    }
    if (p.hp <= 0) {
      p.alive = false;
      p.survived = this.time;
      this.events.push({ kind: 'out', player: id, time: this.time });
    }
  }

  /** ゲストへ送る出来事を積む（ソロでは送る相手がいないので積まない） */
  private send(ev: (string | number)[]): void {
    if (!this.solo) this.outbox.push(ev);
  }

  // ---- 決着 ----

  private checkOver(): void {
    const alive = this.players.filter((p) => p.alive);
    if (this.solo) {
      if (alive.length === 0) this.finish(-1);
      return;
    }
    if (alive.length > 1) return;
    if (alive.length === 1) {
      this.finish(alive[0].id);
      return;
    }
    // 全員が同時にアウト: いちばん長く逃げた人（抜けた人は除く）
    const ranked = this.players.filter((p) => !p.left).sort((a, c) => c.survived - a.survived);
    this.finish(ranked.length ? ranked[0].id : -1);
  }

  private finish(winner: number): void {
    if (this.phase === 'over') return;
    this.phase = 'over';
    this.winner = winner;
    this.events.push({ kind: 'over', winner });
    this.send(['o', winner]);
  }

  /** 逃げ切った順（勝者が先頭） */
  ranking(): TagPlayer[] {
    return [...this.players].sort((a, c) => {
      if (a.id === this.winner) return -1;
      if (c.id === this.winner) return 1;
      return c.survived - a.survived;
    });
  }

  // ---- 通信 ----

  /** ホスト → ゲストの様子（出来事は送ったぶんだけ消える） */
  snapshot(): TagSnapshot {
    const snap: TagSnapshot = {
      time: r2(this.time),
      next: r2(this.nextSpawn),
      hy: this.hayatos.map((h) => [h.id, r2(h.pos.x), r2(h.pos.y), r2(h.pos.z), r2(h.yaw), HAYATO_STATES.indexOf(h.state), h.target, r2(h.charge), h.kind === 'blue' ? 1 : 0]),
      pl: this.players.map((p) => [p.id, p.hp, p.alive ? 1 : 0, r2(p.survived), p.rockets, r2(p.stun)]),
      ev: this.outbox.splice(0),
    };
    return snap;
  }

  /** ホストの様子を写す（ゲスト） */
  applySnapshot(s: TagSnapshot): void {
    if (this.authority) return;
    this.time = s.time;
    this.nextSpawn = s.next;
    const seen = new Set<number>();
    for (const row of s.hy) {
      const [id, x, y, z, yaw, st, target, charge, blue] = row;
      seen.add(id);
      let h = this.hayatos.find((e) => e.id === id);
      if (!h) {
        h = newHayato(id, blue === 1 ? 'blue' : 'red', { x, y, z }, yaw);
        h.cooldown = 0;
        this.hayatos.push(h);
        this.nextHayatoId = Math.max(this.nextHayatoId, id + 1);
        this.events.push({ kind: 'spawn', hayato: id, pos: { x, y, z }, blue: h.kind === 'blue' });
      }
      h.net = { x, y, z, yaw };
      h.state = HAYATO_STATES[st] ?? 'wander';
      h.target = target;
      h.charge = charge;
    }
    for (let i = this.hayatos.length - 1; i >= 0; i--) if (!seen.has(this.hayatos[i].id)) this.hayatos.splice(i, 1);
    for (const ev of s.ev) this.applyEvent(ev);
    for (const [id, hp, alive, survived, rockets, stun] of s.pl) {
      const p = this.player(id);
      if (!p) continue;
      p.rockets = rockets ?? p.rockets;
      // 自分の「動けない」は出来事で受け取る（ずれて止まり続けないよう、ほかの人だけ写す）
      if (p.id !== this.localId) p.stun = stun ?? 0;
      if (p.alive && !alive && hp > 0) {
        // 抜けた人
        p.alive = false;
        this.events.push({ kind: 'out', player: id, time: survived });
      }
      if (!alive) p.alive = false;
      p.survived = survived;
      if (p.hp !== hp && alive) p.hp = hp;
    }
  }

  private applyEvent(ev: (string | number)[]): void {
    const n = (k: number): number => Number(ev[k]);
    switch (ev[0]) {
      case 'f': {
        const bolt: Bolt = { id: n(1), owner: n(2), pos: { x: n(3), y: n(4), z: n(5) }, dir: { x: n(6), y: n(7), z: n(8) }, traveled: 0 };
        this.bolts.push(bolt);
        this.nextBoltId = Math.max(this.nextBoltId, bolt.id + 1);
        this.events.push({ kind: 'fire', bolt: bolt.id, hayato: bolt.owner, from: { ...bolt.pos }, dir: { ...bolt.dir } });
        break;
      }
      case 'h':
        this.applyHit(n(1), n(2), n(3), { x: n(4), y: 0, z: n(5) });
        break;
      case 's':
        this.events.push({ kind: 'spot', hayato: n(1), target: n(2) });
        break;
      case 'E':
        this.applyEaten(n(1), n(2));
        break;
      case 'P':
        this.applyStun(n(1), n(2), TAG_PUNCH_STUN, { x: n(3), y: 0, z: n(4) }, TAG_PUNCH_KNOCK, 'punch');
        break;
      case 'B':
        this.applyStun(-1, n(1), n(2), { x: n(3), y: 0, z: n(4) }, TAG_ROCKET_KNOCK, 'blast');
        break;
      case 'R': {
        const r: Rocket = { id: n(1), owner: n(2), pos: { x: n(3), y: n(4), z: n(5) }, dir: { x: n(6), y: n(7), z: n(8) }, traveled: 0 };
        this.rockets.push(r);
        this.events.push({ kind: 'rocket_fire', rocket: r.id, owner: r.owner, from: { ...r.pos }, dir: { ...r.dir } });
        break;
      }
      case 'X': {
        const k = this.rockets.findIndex((r) => r.id === n(1));
        if (k >= 0) this.rockets.splice(k, 1);
        this.explodeAt(n(1), { x: n(2), y: n(3), z: n(4) });
        break;
      }
      case 'k': {
        const pk = this.pickups[n(1)];
        if (pk) {
          pk.active = false;
          this.events.push({ kind: 'pickup', pickup: pk.id, player: n(2) });
        }
        break;
      }
      case 'K': {
        const pk = this.pickups[n(1)];
        if (pk) {
          pk.active = true;
          this.events.push({ kind: 'pickup_back', pickup: pk.id });
        }
        break;
      }
      case 'o':
        this.phase = 'over';
        this.winner = n(1);
        this.events.push({ kind: 'over', winner: this.winner });
        break;
      default:
        break;
    }
  }

  /** ホストが抜けたので、この端末が権限を引き継ぐ（届いていた位置から続ける） */
  becomeAuthority(): void {
    if (this.authority) return;
    this.authority = true;
    for (const h of this.hayatos) {
      if (h.net) {
        h.pos.x = h.net.x;
        h.pos.y = h.net.y;
        h.pos.z = h.net.z;
        h.yaw = h.net.yaw;
      }
      h.net = null;
      if (h.state === 'aim') h.state = 'chase';
      if (h.state === 'stun') h.stun = 1;
      h.best = Infinity;
      h.giveup = 0;
      h.charge = 0;
      h.cooldown = 1;
    }
    // 見た目だけ飛ばしていたロケットは、ここから当たりを判定する
  }

  // ---- お邪魔の道具 ----

  /** パンチの届く所にいる、いちばん近いほかのプレイヤー（いなければ undefined） */
  punchTarget(id: number): TagPlayer | undefined {
    const me = this.player(id);
    if (!me || !me.alive) return undefined;
    let best: TagPlayer | undefined;
    let bestD = TAG_PUNCH_RANGE;
    for (const p of this.players) {
      if (p.id === id || !p.alive) continue;
      const d = Math.hypot(p.pos.x - me.pos.x, p.pos.z - me.pos.z);
      if (d <= bestD && Math.abs(p.pos.y - me.pos.y) <= TAG_PUNCH_HEIGHT) {
        best = p;
        bestD = d;
      }
    }
    return best;
  }

  /** パンチ（権限のある端末で決める）。当たったら true */
  requestPunch(id: number): boolean {
    if (!this.authority || this.phase !== 'playing') return false;
    const me = this.player(id);
    if (!me || !me.alive || me.punchCooldown > 0 || me.stun > 0) return false;
    const target = this.punchTarget(id);
    if (!target) return false;
    me.punchCooldown = TAG_PUNCH_COOLDOWN;
    const dx = target.pos.x - me.pos.x;
    const dz = target.pos.z - me.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const dir = { x: r2(dx / d), y: 0, z: r2(dz / d) };
    me.yaw = Math.atan2(dx, dz);
    this.applyStun(id, target.id, TAG_PUNCH_STUN, dir, TAG_PUNCH_KNOCK, 'punch');
    this.send(['P', id, target.id, dir.x, dir.z]);
    return true;
  }

  /** パンチ・爆風で動けなくする（attacker = -1 は爆風） */
  private applyStun(attacker: number, victim: number, time: number, dir: V3, knock: number, by: 'punch' | 'blast'): void {
    const p = this.player(victim);
    if (!p || !p.alive) return;
    p.stun = Math.max(p.stun, time);
    // パンチも爆風も物理でふっとぶ（パンチはレーザーと同じくらい大きく）
    this.fling(p, dir, knock, by === 'blast' ? 7 : TAG_PUNCH_KNOCK_UP);
    if (by === 'punch') {
      const a = this.player(attacker);
      if (a && a.id !== this.localId) a.yaw = Math.atan2(-dir.x, -dir.z) + Math.PI;
      this.events.push({ kind: 'punch', attacker, victim });
    }
    this.events.push({ kind: 'stun', player: victim, time, by });
  }

  /** ロケットを撃つ（権限のある端末で決める）。dir は狙う向き */
  requestRocket(id: number, dir: V3): boolean {
    if (!this.authority || this.phase !== 'playing') return false;
    const me = this.player(id);
    if (!me || !me.alive || me.rockets <= 0 || me.rocketCooldown > 0 || me.stun > 0) return false;
    const len = Math.hypot(dir.x, dir.y, dir.z);
    if (!(len > 0.01)) return false;
    const d = { x: r2(dir.x / len), y: r2(dir.y / len), z: r2(dir.z / len) };
    me.rockets--;
    me.rocketCooldown = TAG_ROCKET_COOLDOWN;
    const from = { x: r2(me.pos.x + d.x * 0.7), y: r2(me.pos.y + 0.9 + d.y * 0.7), z: r2(me.pos.z + d.z * 0.7) };
    const r: Rocket = { id: this.nextRocketId++, owner: id, pos: { ...from }, dir: d, traveled: 0 };
    this.rockets.push(r);
    this.events.push({ kind: 'rocket_fire', rocket: r.id, owner: id, from, dir: { ...d } });
    this.send(['R', r.id, id, from.x, from.y, from.z, d.x, d.y, d.z]);
    return true;
  }

  private updateRockets(dt: number, judge: boolean): void {
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      let remaining = TAG_ROCKET_SPEED * dt;
      let boom = false;
      while (remaining > 0 && !boom) {
        const stepLen = Math.min(0.5, remaining);
        remaining -= stepLen;
        r.pos.x += r.dir.x * stepLen;
        r.pos.y += r.dir.y * stepLen;
        r.pos.z += r.dir.z * stepLen;
        r.traveled += stepLen;
        if (this.world.solidAtPoint(r.pos.x, r.pos.y, r.pos.z) || r.traveled >= TAG_ROCKET_RANGE || r.pos.y < 1) {
          boom = true;
          break;
        }
        if (!judge) continue;
        for (const p of this.players) {
          if (p.id === r.owner || !p.alive) continue;
          if (Math.hypot(r.pos.x - p.pos.x, r.pos.y - (p.pos.y + PLAYER_CENTER), r.pos.z - p.pos.z) < TAG_ROCKET_HIT_RADIUS + 0.4) boom = true;
        }
        for (const h of this.hayatos) {
          if (Math.hypot(r.pos.x - h.pos.x, r.pos.y - h.pos.y, r.pos.z - h.pos.z) < TAG_ROCKET_HIT_RADIUS + hayatoRadius(h)) boom = true;
        }
      }
      if (!boom) continue;
      if (!judge) {
        // ゲストはホストの知らせ（X）で爆発させる。壁に着いたら止めて待つ
        r.traveled = TAG_ROCKET_RANGE;
        r.dir = { x: 0, y: 0, z: 0 };
        continue;
      }
      this.rockets.splice(i, 1);
      const at = { x: r2(r.pos.x - r.dir.x * 0.3), y: r2(r.pos.y - r.dir.y * 0.3), z: r2(r.pos.z - r.dir.z * 0.3) };
      this.send(['X', r.id, at.x, at.y, at.z]);
      this.explodeAt(r.id, at);
      // 爆風: プレイヤーとハヤトをひるませる（撃った本人は平気）
      for (const p of this.players) {
        if (!p.alive || p.id === r.owner) continue;
        const dx = p.pos.x - at.x;
        const dz = p.pos.z - at.z;
        const d = Math.hypot(dx, p.pos.y + PLAYER_CENTER - at.y, dz);
        if (d > TAG_ROCKET_STUN_RADIUS) continue;
        const hd = Math.hypot(dx, dz) || 1;
        const dir = { x: r2(dx / hd), y: 0, z: r2(dz / hd) };
        this.applyStun(-1, p.id, TAG_ROCKET_STUN, dir, TAG_ROCKET_KNOCK, 'blast');
        this.send(['B', p.id, TAG_ROCKET_STUN, dir.x, dir.z]);
      }
      for (const h of this.hayatos) {
        const d = Math.hypot(h.pos.x - at.x, h.pos.y - at.y, h.pos.z - at.z) - (hayatoRadius(h) - TAG_HAYATO_RADIUS);
        if (d > TAG_ROCKET_STUN_RADIUS || h.state === 'eat') continue;
        h.stun = TAG_ROCKET_HAYATO_STUN;
        h.state = 'stun';
        h.charge = 0;
      }
    }
  }

  /** 爆発（地形を壊す）。ホストもゲストも同じ座標で呼ぶので、同じ壊れ方になる */
  private explodeAt(rocket: number, pos: V3): void {
    const broken = blastTerrain(this.world, pos, TAG_ROCKET_BLAST);
    this.events.push({ kind: 'explode', rocket, pos: { ...pos }, broken });
  }

  private updatePickups(dt: number): void {
    for (const pk of this.pickups) {
      if (!pk.active) {
        pk.respawn -= dt;
        if (pk.respawn <= 0) {
          pk.active = true;
          // 地形が壊れていたら、その下の床に置き直す
          pk.pos.y = floorBelow(this.world, pk.pos.x, pk.pos.y + 0.5, pk.pos.z);
          this.events.push({ kind: 'pickup_back', pickup: pk.id });
          this.send(['K', pk.id]);
        }
        continue;
      }
      for (const p of this.players) {
        if (!p.alive || p.rockets >= TAG_ROCKET_MAX) continue;
        if (Math.hypot(p.pos.x - pk.pos.x, p.pos.z - pk.pos.z) > TAG_ROCKET_PICK_RADIUS || Math.abs(p.pos.y - pk.pos.y) > 1.5) continue;
        pk.active = false;
        pk.respawn = TAG_ROCKET_RESPAWN;
        p.rockets++;
        this.events.push({ kind: 'pickup', pickup: pk.id, player: p.id });
        this.send(['k', pk.id, p.id]);
        break;
      }
    }
  }

  // ---- カメラ ----

  /** かぶくんの後ろから見る 3 人称カメラ（壁に埋まらないよう縮める） */
  camera(yaw: number, pitch: number, focus: V3): CameraPose {
    const target = { x: focus.x, y: focus.y + 1.5, z: focus.z };
    const dir = viewDir(yaw, pitch);
    const back = { x: -dir.x, y: -dir.y, z: -dir.z };
    const dist = 5.5;
    const hit = this.world.raycast(target, back, dist);
    const d = hit ? Math.max(0.8, hit.dist - 0.3) : dist;
    return { pos: { x: target.x + back.x * d, y: target.y + back.y * d, z: target.z + back.z * d }, target, dir };
  }
}

function clampAbs(v: number, max: number): number {
  return v > max ? max : v < -max ? -max : v;
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
