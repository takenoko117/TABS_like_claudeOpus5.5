import {
  B,
  BLOCK_DEFS,
  OW_BUILD_PALETTE,
  OW_CAR_EXPLOSION_RADIUS,
  OW_DAY_LENGTH,
  OW_FLY_SPEED,
  OW_GRAVITY,
  OW_GRENADE_FUSE,
  OW_GRENADE_SPEED,
  OW_JUMP_SPEED,
  OW_KNOCK_TIME,
  OW_METEOR_DELAY,
  OW_METEOR_HEIGHT,
  OW_PED_RUN,
  OW_PED_WALK,
  OW_PEDESTRIAN_COUNT,
  OW_PLAYER_HALF,
  OW_PLAYER_HEIGHT,
  OW_ROAD_COUNT,
  OW_ROAD_WIDTH,
  OW_ROCKET_SPEED,
  OW_SHELL_COOLDOWN,
  OW_SHELL_RADIUS,
  OW_SHELL_SPEED,
  OW_SPRINT_SPEED,
  OW_TOOLS,
  OW_TRAFFIC_COUNT,
  OW_TRAFFIC_SPEED,
  OW_VEHICLES,
  OW_WALK_SPEED,
  OW_WRECK_CLEAR_TIME,
  isSolid,
  type ToolId,
  type VehicleKind,
  type VehicleSpec,
} from './OpenWorldConfig';
import { DestructionSystem, type DestructionEvent } from './Destruction';
import { ROAD_ORIGINS, SIDEWALK_LINES, generateOpenWorld, laneCoord, makeRng, type OpenWorldLayout } from './WorldGen';
import type { V3, VoxelWorld } from './VoxelWorld';

// ---------------------------------------------------------------------------
// 入力
// ---------------------------------------------------------------------------

/** 1 ステップぶんの操作。押した瞬間のもの（～Pressed）は最初のステップだけ true にする */
export interface OWInput {
  /** 右が正 */
  moveX: number;
  /** 前が正 */
  moveZ: number;
  jump: boolean;
  sprint: boolean;
  descend: boolean;
  /** カメラの向き（yaw = 0 で +z を向く。左に回すと増える） */
  yaw: number;
  pitch: number;
  fire: boolean;
  firePressed: boolean;
  altPressed: boolean;
  interactPressed: boolean;
  toggleFlyPressed: boolean;
  tool: number;
  blockIndex: number;
  /** 照準の光線（カメラの位置と向き） */
  aimOrigin: V3;
  aimDir: V3;
}

export function emptyInput(): OWInput {
  return {
    moveX: 0,
    moveZ: 0,
    jump: false,
    sprint: false,
    descend: false,
    yaw: 0,
    pitch: 0,
    fire: false,
    firePressed: false,
    altPressed: false,
    interactPressed: false,
    toggleFlyPressed: false,
    tool: 0,
    blockIndex: 0,
    aimOrigin: { x: 0, y: 0, z: 0 },
    aimDir: { x: 0, y: 0, z: 1 },
  };
}

// ---------------------------------------------------------------------------
// 登場するもの
// ---------------------------------------------------------------------------

export interface Player {
  pos: V3;
  vel: V3;
  yaw: number;
  onGround: boolean;
  flying: boolean;
  swimming: boolean;
  /** 吹き飛ばされて操作できない残り時間 */
  knock: number;
  /** 吹き飛ばされて回っている角度（描画用） */
  tumble: number;
  vehicle: Vehicle | null;
  /** 歩きの揺れ（描画用） */
  walkPhase: number;
  /** 直前に道具を使ってからの時間（描画の腕の動き） */
  actionTimer: number;
}

/** 街を走る車の運転（道路の格子をたどる） */
export interface TrafficAI {
  axis: 'x' | 'z';
  dir: number;
  /** いま走っている道路の番号 */
  road: number;
  /** 最後に曲がるか決めた交差道路の番号 */
  lastCross: number;
  blocked: number;
}

export interface Vehicle {
  id: number;
  kind: VehicleKind;
  spec: VehicleSpec;
  pos: V3;
  yaw: number;
  speed: number;
  vy: number;
  /** 爆風で押された速さ（だんだん弱まる） */
  push: V3;
  hp: number;
  wrecked: boolean;
  wreckTimer: number;
  ai: TrafficAI | null;
  color: number;
  turretYaw: number;
  fireCooldown: number;
  onGround: boolean;
  /** 傾き（描画用） */
  roll: number;
}

export type PedState = 'walk' | 'flee' | 'knocked';

export interface Pedestrian {
  id: number;
  pos: V3;
  vel: V3;
  yaw: number;
  state: PedState;
  timer: number;
  /** 歩いて向かう歩道の交点（SIDEWALK_LINES の添字） */
  nodeA: number;
  nodeB: number;
  prevA: number;
  prevB: number;
  stuck: number;
  onGround: boolean;
  tumble: number;
  tumbleSpeed: number;
  walkPhase: number;
  shirt: number;
  pants: number;
  skin: number;
  hair: number;
}

export type ProjectileKind = 'rocket' | 'grenade' | 'shell' | 'meteor';
export interface Projectile {
  id: number;
  kind: ProjectileKind;
  pos: V3;
  vel: V3;
  life: number;
  radius: number;
  /** メテオの落下先（描画で警告の印を出す） */
  target?: V3;
}

interface PendingExplosion {
  pos: V3;
  radius: number;
  timer: number;
}

export type SimEvent =
  | DestructionEvent
  | { kind: 'shot'; from: V3; to: V3 }
  | { kind: 'fire'; tool: ToolId | 'shell'; pos: V3 }
  | { kind: 'punch'; pos: V3; hit: boolean }
  | { kind: 'place'; pos: V3 }
  | { kind: 'enter'; vehicle: number }
  | { kind: 'exit'; vehicle: number }
  | { kind: 'wreck'; vehicle: number; pos: V3 }
  | { kind: 'crash'; pos: V3; power: number }
  | { kind: 'horn'; pos: V3 }
  | { kind: 'ped_hit'; pos: V3 };

export interface OWStats {
  wrecks: number;
  pedsKnocked: number;
  distance: number;
}

const fwdOf = (yaw: number): V3 => ({ x: Math.sin(yaw), y: 0, z: Math.cos(yaw) });
/** yaw の向きの右（yaw = 0 なら -x） */
const rightOf = (yaw: number): V3 => ({ x: -Math.cos(yaw), y: 0, z: Math.sin(yaw) });
const dist3 = (a: V3, b: V3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

const CAR_COLORS = [0xd23c3c, 0x2f6fd0, 0xf0c03a, 0xeeeeee, 0x2b2b2b, 0x3aa35a, 0xe07a2a, 0x8a4fc4, 0x40b8c8];
const SHIRT_COLORS = [0xd94b4b, 0x3f7fd9, 0x46a85a, 0xe8c547, 0xf08a3c, 0x9b59b6, 0xeeeeee, 0x333333, 0xe66fa8];
const PANTS_COLORS = [0x2c3e66, 0x333333, 0x6b4a2f, 0x556b2f, 0x777777];
const SKIN_COLORS = [0xf2c9a0, 0xd9a577, 0xa8714a, 0x7a4e30];
const HAIR_COLORS = [0x2b1d14, 0x5a3a1e, 0xd9b45a, 0x1a1a1a, 0x8a8a8a, 0xb5482d];

// ---------------------------------------------------------------------------
// 箱の移動（プレイヤーと歩行者）
// ---------------------------------------------------------------------------

function boxCollides(world: VoxelWorld, x: number, y: number, z: number, half: number, height: number): boolean {
  const x0 = Math.floor(x - half);
  const x1 = Math.floor(x + half);
  const y0 = Math.floor(y);
  const y1 = Math.floor(y + height - 0.001);
  const z0 = Math.floor(z - half);
  const z1 = Math.floor(z + half);
  for (let yy = y0; yy <= y1; yy++) {
    for (let zz = z0; zz <= z1; zz++) {
      for (let xx = x0; xx <= x1; xx++) {
        if (world.solidAt(xx, yy, zz)) return true;
      }
    }
  }
  return false;
}

/**
 * 箱を速度で動かし、ブロックに当たったら止める。
 * step が true なら、地面にいるとき 1 ブロックの段差は自動で上る。地面にいれば true。
 */
export function moveBox(world: VoxelWorld, pos: V3, vel: V3, half: number, height: number, dt: number, step: boolean, wasOnGround: boolean): boolean {
  // 横方向
  for (const axis of ['x', 'z'] as const) {
    const delta = vel[axis] * dt;
    if (delta === 0) continue;
    const nx = axis === 'x' ? pos.x + delta : pos.x;
    const nz = axis === 'z' ? pos.z + delta : pos.z;
    if (!boxCollides(world, nx, pos.y, nz, half, height)) {
      pos[axis] += delta;
    } else if (step && wasOnGround && !boxCollides(world, nx, pos.y + 1.01, nz, half, height) && !boxCollides(world, pos.x, pos.y + 1.01, pos.z, half, height)) {
      // 段差を上る
      pos.y = Math.floor(pos.y + 1.01);
      pos[axis] += delta;
    } else {
      vel[axis] = 0;
    }
  }
  // 縦方向
  const dy = vel.y * dt;
  let onGround = false;
  if (!boxCollides(world, pos.x, pos.y + dy, pos.z, half, height)) {
    pos.y += dy;
  } else if (dy < 0) {
    pos.y = Math.floor(pos.y + dy) + 1;
    // 一度で戻りきらないとき（深くめり込んだ）は上へ押し出す
    let guard = 0;
    while (boxCollides(world, pos.x, pos.y, pos.z, half, height) && guard++ < 4) pos.y += 1;
    vel.y = 0;
    onGround = true;
  } else {
    vel.y = 0;
  }
  if (!onGround && vel.y <= 0 && boxCollides(world, pos.x, pos.y - 0.05, pos.z, half, height)) onGround = true;
  // 世界の端
  pos.x = clamp(pos.x, 0.5, world.sizeX - 0.5);
  pos.z = clamp(pos.z, 0.5, world.sizeZ - 0.5);
  if (pos.y < 1) {
    pos.y = 1;
    vel.y = Math.max(0, vel.y);
    onGround = true;
  }
  return onGround;
}

// ---------------------------------------------------------------------------
// カメラ
// ---------------------------------------------------------------------------

export interface CameraPose {
  pos: V3;
  target: V3;
  dir: V3;
}

/** 視線の向き（yaw・pitch から） */
export function viewDir(yaw: number, pitch: number): V3 {
  const c = Math.cos(pitch);
  return { x: Math.sin(yaw) * c, y: Math.sin(pitch), z: Math.cos(yaw) * c };
}

// ---------------------------------------------------------------------------
// シミュレーション本体
// ---------------------------------------------------------------------------

export class OpenWorldSim {
  readonly world: VoxelWorld;
  readonly destruction: DestructionSystem;
  readonly layout: OpenWorldLayout;
  readonly player: Player;
  readonly vehicles: Vehicle[] = [];
  readonly peds: Pedestrian[] = [];
  readonly projectiles: Projectile[] = [];
  readonly events: SimEvent[] = [];
  readonly stats: OWStats = { wrecks: 0, pedsKnocked: 0, distance: 0 };
  /** 1 日の中の時刻（0〜1。0.5 が正午） */
  timeOfDay = 0.38;
  /** 道具を使える残り時間 */
  private toolCooldown = 0;
  private readonly pending: PendingExplosion[] = [];
  private nextId = 1;
  private readonly rng: () => number;
  /** 最後に照準が当たった点（描画の照準の印） */
  aimPoint: V3 | null = null;
  aimBlock: { x: number; y: number; z: number; nx: number; ny: number; nz: number } | null = null;

  constructor(seed = 1) {
    this.rng = makeRng(seed * 7 + 3);
    this.layout = generateOpenWorld(seed);
    this.world = this.layout.world;
    this.destruction = new DestructionSystem(this.world, this.rng);
    const s = this.layout.spawn;
    this.player = {
      pos: { ...s },
      vel: { x: 0, y: 0, z: 0 },
      yaw: 0,
      onGround: false,
      flying: false,
      swimming: false,
      knock: 0,
      tumble: 0,
      vehicle: null,
      walkPhase: 0,
      actionTimer: 1,
    };
    for (const p of this.layout.parked) this.addVehicle(p.kind, p.x, p.z, p.yaw, null);
    for (let k = 0; k < OW_TRAFFIC_COUNT; k++) this.spawnTraffic();
    for (let k = 0; k < OW_PEDESTRIAN_COUNT; k++) this.spawnPed();
  }

  // ---- 生成 ----

  addVehicle(kind: VehicleKind, x: number, z: number, yaw: number, ai: TrafficAI | null): Vehicle {
    const spec = OW_VEHICLES[kind];
    const top = this.world.topSolidY(Math.floor(x), Math.floor(z));
    const v: Vehicle = {
      id: this.nextId++,
      kind,
      spec,
      pos: { x, y: top + 1, z },
      yaw,
      speed: 0,
      vy: 0,
      push: { x: 0, y: 0, z: 0 },
      hp: spec.hp,
      wrecked: false,
      wreckTimer: 0,
      ai,
      color: kind === 'tank' ? 0x5d6b3a : CAR_COLORS[Math.floor(this.rng() * CAR_COLORS.length)],
      turretYaw: yaw,
      fireCooldown: 0,
      onGround: true,
      roll: 0,
    };
    this.vehicles.push(v);
    return v;
  }

  /** 街の道路のどこかに車を出す（プレイヤーから見えにくい所を選ぶ） */
  private spawnTraffic(): Vehicle | null {
    for (let attempt = 0; attempt < 20; attempt++) {
      const axis: 'x' | 'z' = this.rng() < 0.5 ? 'x' : 'z';
      const road = Math.floor(this.rng() * OW_ROAD_COUNT);
      const dir = this.rng() < 0.5 ? 1 : -1;
      // 交差点と交差点の間
      const seg = Math.floor(this.rng() * (OW_ROAD_COUNT - 1));
      const along = ROAD_ORIGINS[seg] + OW_ROAD_WIDTH + 4 + this.rng() * 14;
      const lateral = laneCoord(road, axis, dir);
      const x = axis === 'x' ? along : lateral;
      const z = axis === 'x' ? lateral : along;
      if (Math.hypot(x - this.player.pos.x, z - this.player.pos.z) < 30 && this.vehicles.length > 0) continue;
      if (this.vehicles.some((v) => Math.hypot(v.pos.x - x, v.pos.z - z) < 6)) continue;
      const yaw = axis === 'x' ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : dir > 0 ? 0 : Math.PI;
      // 曲がる判定は「次の交差点」から始める
      const lastCross = dir > 0 ? seg : seg + 1;
      return this.addVehicle('car', x, z, yaw, { axis, dir, road, lastCross, blocked: 0 });
    }
    return null;
  }

  private spawnPed(): void {
    const n = SIDEWALK_LINES.length;
    const a = Math.floor(this.rng() * n);
    const b = Math.floor(this.rng() * n);
    const x = SIDEWALK_LINES[a];
    const z = SIDEWALK_LINES[b];
    const pick = (arr: number[]): number => arr[Math.floor(this.rng() * arr.length)];
    this.peds.push({
      id: this.nextId++,
      pos: { x, y: this.world.topSolidY(Math.floor(x), Math.floor(z)) + 1, z },
      vel: { x: 0, y: 0, z: 0 },
      yaw: 0,
      state: 'walk',
      timer: 0,
      nodeA: a,
      nodeB: b,
      prevA: a,
      prevB: b,
      stuck: 0,
      onGround: true,
      tumble: 0,
      tumbleSpeed: 0,
      walkPhase: this.rng() * 6,
      shirt: pick(SHIRT_COLORS),
      pants: pick(PANTS_COLORS),
      skin: pick(SKIN_COLORS),
      hair: pick(HAIR_COLORS),
    });
    this.pickNextNode(this.peds[this.peds.length - 1]);
  }

  // ---- カメラ ----

  /** 3 人称カメラ。壁にめり込まないよう、ブロックに当たる手前まで寄せる */
  computeCamera(yaw: number, pitch: number): CameraPose {
    const p = this.player;
    const v = p.vehicle;
    const target: V3 = v
      ? { x: v.pos.x, y: v.pos.y + v.spec.height + 0.8, z: v.pos.z }
      : { x: p.pos.x, y: p.pos.y + 1.6, z: p.pos.z };
    const dir = viewDir(yaw, pitch);
    const dist = v ? (v.kind === 'tank' ? 11 : 8.5) : 5;
    // 歩きのときは右肩越しに見る
    const right = rightOf(yaw);
    const shoulder = v ? 0 : 0.7;
    const pivot = { x: target.x + right.x * shoulder, y: target.y, z: target.z + right.z * shoulder };
    const back = { x: -dir.x, y: -dir.y, z: -dir.z };
    const hit = this.world.raycast(pivot, back, dist);
    const d = hit ? Math.max(0.6, hit.dist - 0.3) : dist;
    const pos = { x: pivot.x + back.x * d, y: pivot.y + back.y * d, z: pivot.z + back.z * d };
    return { pos, target: pivot, dir };
  }

  // ---- 毎ステップ ----

  step(dt: number, input: OWInput): void {
    this.timeOfDay = (this.timeOfDay + dt / OW_DAY_LENGTH) % 1;
    this.toolCooldown = Math.max(0, this.toolCooldown - dt);
    this.updateAim(input);
    if (input.interactPressed) this.toggleVehicle();
    if (this.player.vehicle) this.updateDriving(this.player.vehicle, input, dt);
    else this.updatePlayerOnFoot(input, dt);
    this.useTool(input);
    for (const v of this.vehicles) if (v !== this.player.vehicle) this.updateVehicle(v, dt);
    this.collideVehicles();
    for (const ped of this.peds) this.updatePed(ped, dt);
    this.updateProjectiles(dt);
    this.updatePending(dt);
    this.destruction.step(dt);
    this.crushUnderCollapse();
    this.cleanupWrecks(dt);
    // 破壊の出来事をこちらの出来事の列に移す
    for (const e of this.destruction.events) {
      this.events.push(e);
      if (e.kind === 'explosion') this.applyBlast(e.pos, e.radius);
    }
    this.destruction.events.length = 0;
  }

  private updateAim(input: OWInput): void {
    const hit = this.world.raycast(input.aimOrigin, input.aimDir, 260);
    if (hit) {
      const len = Math.hypot(input.aimDir.x, input.aimDir.y, input.aimDir.z) || 1;
      this.aimPoint = {
        x: input.aimOrigin.x + (input.aimDir.x / len) * hit.dist,
        y: input.aimOrigin.y + (input.aimDir.y / len) * hit.dist,
        z: input.aimOrigin.z + (input.aimDir.z / len) * hit.dist,
      };
      this.aimBlock = { x: hit.x, y: hit.y, z: hit.z, nx: hit.nx, ny: hit.ny, nz: hit.nz };
    } else {
      this.aimPoint = null;
      this.aimBlock = null;
    }
  }

  /** 照準の先の点（何も無ければ遠くの点） */
  private aimTarget(input: OWInput): V3 {
    if (this.aimPoint) return this.aimPoint;
    const len = Math.hypot(input.aimDir.x, input.aimDir.y, input.aimDir.z) || 1;
    return {
      x: input.aimOrigin.x + (input.aimDir.x / len) * 200,
      y: input.aimOrigin.y + (input.aimDir.y / len) * 200,
      z: input.aimOrigin.z + (input.aimDir.z / len) * 200,
    };
  }

  // ---- プレイヤー ----

  private updatePlayerOnFoot(input: OWInput, dt: number): void {
    const p = this.player;
    p.actionTimer += dt;
    if (input.toggleFlyPressed) {
      p.flying = !p.flying;
      p.vel.y = 0;
    }
    const fwd = fwdOf(input.yaw);
    const right = rightOf(input.yaw);
    let wx = fwd.x * input.moveZ + right.x * input.moveX;
    let wz = fwd.z * input.moveZ + right.z * input.moveX;
    const wl = Math.hypot(wx, wz);
    if (wl > 1) {
      wx /= wl;
      wz /= wl;
    }
    const feet = this.world.get(Math.floor(p.pos.x), Math.floor(p.pos.y + 0.4), Math.floor(p.pos.z));
    p.swimming = feet === B.WATER;
    const startX = p.pos.x;
    const startZ = p.pos.z;

    if (p.knock > 0) {
      // 吹き飛ばされ中は操作が効かない
      p.knock -= dt;
      p.tumble += dt * 9;
      p.vel.y -= OW_GRAVITY * dt;
      if (p.onGround) {
        p.vel.x *= 0.85;
        p.vel.z *= 0.85;
      }
    } else if (p.flying) {
      p.tumble = 0;
      const sp = OW_FLY_SPEED * (input.sprint ? 2 : 1);
      p.vel.x = wx * sp;
      p.vel.z = wz * sp;
      p.vel.y = (input.jump ? 1 : 0) * sp - (input.descend ? 1 : 0) * sp;
    } else {
      p.tumble = 0;
      const sp = p.swimming ? 3 : input.sprint ? OW_SPRINT_SPEED : OW_WALK_SPEED;
      // 地面では素早く、空中ではゆっくり向きを変える
      const accel = p.onGround || p.swimming ? 14 : 4;
      p.vel.x += (wx * sp - p.vel.x) * Math.min(1, accel * dt);
      p.vel.z += (wz * sp - p.vel.z) * Math.min(1, accel * dt);
      if (p.swimming) {
        p.vel.y -= OW_GRAVITY * 0.25 * dt;
        p.vel.y *= 0.92;
        if (input.jump) p.vel.y = 4;
      } else {
        p.vel.y -= OW_GRAVITY * dt;
        if (input.jump && p.onGround) p.vel.y = OW_JUMP_SPEED;
      }
    }
    p.vel.y = Math.max(p.vel.y, -45);
    p.onGround = moveBox(this.world, p.pos, p.vel, OW_PLAYER_HALF, OW_PLAYER_HEIGHT, dt, p.knock <= 0, p.onGround);
    if (wl > 0.1 && p.knock <= 0) p.yaw = Math.atan2(wx, wz);
    else if (p.knock <= 0 && (input.fire || p.actionTimer < 0.4)) p.yaw = input.yaw;
    const moved = Math.hypot(p.pos.x - startX, p.pos.z - startZ);
    p.walkPhase += moved * 2.2;
    this.stats.distance += moved;
  }

  knockPlayer(vx: number, vy: number, vz: number): void {
    const p = this.player;
    if (p.vehicle) return;
    p.vel.x = vx;
    p.vel.y = vy;
    p.vel.z = vz;
    p.onGround = false;
    p.knock = Math.max(p.knock, OW_KNOCK_TIME);
  }

  private toggleVehicle(): void {
    const p = this.player;
    if (p.vehicle) {
      const v = p.vehicle;
      // 左側に降りる。ふさがっていたら屋根の上へ
      const r = rightOf(v.yaw);
      const side = { x: v.pos.x - r.x * (v.spec.halfW + 0.8), y: v.pos.y, z: v.pos.z - r.z * (v.spec.halfW + 0.8) };
      if (boxCollides(this.world, side.x, side.y, side.z, OW_PLAYER_HALF, OW_PLAYER_HEIGHT)) {
        side.x = v.pos.x;
        side.z = v.pos.z;
        side.y = v.pos.y + v.spec.height + 0.1;
      }
      p.pos = side;
      p.vel = { x: 0, y: 0, z: 0 };
      p.vehicle = null;
      this.events.push({ kind: 'exit', vehicle: v.id });
      return;
    }
    let best: Vehicle | null = null;
    let bestD = 4.2;
    for (const v of this.vehicles) {
      if (v.wrecked) continue;
      const d = Math.hypot(v.pos.x - p.pos.x, v.pos.z - p.pos.z) - v.spec.halfW;
      if (d < bestD && Math.abs(v.pos.y - p.pos.y) < 3) {
        best = v;
        bestD = d;
      }
    }
    if (!best) return;
    best.ai = null;
    best.turretYaw = best.yaw;
    p.vehicle = best;
    p.flying = false;
    p.knock = 0;
    this.events.push({ kind: 'enter', vehicle: best.id });
  }

  // ---- 道具 ----

  /** 銃口の位置（右手の前） */
  private muzzle(): V3 {
    const p = this.player;
    const r = rightOf(p.yaw);
    const f = fwdOf(p.yaw);
    return { x: p.pos.x + r.x * 0.35 + f.x * 0.4, y: p.pos.y + 1.3, z: p.pos.z + r.z * 0.35 + f.z * 0.4 };
  }

  private useTool(input: OWInput): void {
    const p = this.player;
    if (p.vehicle) {
      this.useVehicleWeapon(p.vehicle, input);
      return;
    }
    if (p.knock > 0 || this.toolCooldown > 0) return;
    const tool = OW_TOOLS[clamp(input.tool, 0, OW_TOOLS.length - 1)];
    const auto = tool.id === 'rifle';
    const trigger = auto ? input.fire : input.firePressed || (input.fire && tool.id === 'punch');
    if (tool.id === 'build' && input.altPressed) {
      // 建築中の右クリックは壊す
      this.punchBlock(true);
      this.toolCooldown = tool.cooldown;
      return;
    }
    if (!trigger) return;
    this.toolCooldown = tool.cooldown;
    p.actionTimer = 0;
    p.yaw = input.yaw;
    const target = this.aimTarget(input);
    const from = this.muzzle();
    switch (tool.id) {
      case 'punch':
        this.punch();
        break;
      case 'rifle':
        this.fireRifle(from, target);
        break;
      case 'rocket': {
        const d = this.normalize({ x: target.x - from.x, y: target.y - from.y, z: target.z - from.z });
        this.projectiles.push({ id: this.nextId++, kind: 'rocket', pos: from, vel: this.scale(d, OW_ROCKET_SPEED), life: 6, radius: tool.radius });
        this.events.push({ kind: 'fire', tool: 'rocket', pos: from });
        break;
      }
      case 'grenade': {
        const d = viewDir(input.yaw, input.pitch + 0.25);
        this.projectiles.push({
          id: this.nextId++,
          kind: 'grenade',
          pos: from,
          vel: { x: d.x * OW_GRENADE_SPEED + p.vel.x * 0.5, y: d.y * OW_GRENADE_SPEED + 2, z: d.z * OW_GRENADE_SPEED + p.vel.z * 0.5 },
          life: OW_GRENADE_FUSE,
          radius: tool.radius,
        });
        this.events.push({ kind: 'fire', tool: 'grenade', pos: from });
        break;
      }
      case 'meteor': {
        if (!this.aimPoint) {
          this.toolCooldown = 0.2;
          break;
        }
        const t = { ...this.aimPoint };
        const start = { x: t.x - 18, y: t.y + OW_METEOR_HEIGHT, z: t.z - 10 };
        const vel = this.scale({ x: t.x - start.x, y: t.y - start.y, z: t.z - start.z }, 1 / OW_METEOR_DELAY);
        this.projectiles.push({ id: this.nextId++, kind: 'meteor', pos: start, vel, life: OW_METEOR_DELAY + 2, radius: tool.radius, target: t });
        this.events.push({ kind: 'fire', tool: 'meteor', pos: t });
        break;
      }
      case 'build':
        this.placeBlock(OW_BUILD_PALETTE[clamp(input.blockIndex, 0, OW_BUILD_PALETTE.length - 1)]);
        break;
    }
  }

  private normalize(v: V3): V3 {
    const l = Math.hypot(v.x, v.y, v.z) || 1;
    return { x: v.x / l, y: v.y / l, z: v.z / l };
  }

  private scale(v: V3, s: number): V3 {
    return { x: v.x * s, y: v.y * s, z: v.z * s };
  }

  /** パンチ: 目の前の歩行者を殴り飛ばすか、届く範囲のブロックを壊す */
  private punch(): void {
    const p = this.player;
    const f = fwdOf(p.yaw);
    const reach = { x: p.pos.x + f.x * 1.1, y: p.pos.y + 1, z: p.pos.z + f.z * 1.1 };
    for (const ped of this.peds) {
      if (dist3({ ...ped.pos, y: ped.pos.y + 1 }, reach) < 1.2) {
        this.knockPed(ped, { x: f.x * 14, y: 7, z: f.z * 14 });
        this.events.push({ kind: 'punch', pos: reach, hit: true });
        return;
      }
    }
    for (const v of this.vehicles) {
      if (this.pointInVehicle(v, reach, 0.3)) {
        v.push.x += f.x * (v.kind === 'tank' ? 0.5 : 6);
        v.push.z += f.z * (v.kind === 'tank' ? 0.5 : 6);
        this.damageVehicle(v, 4);
        this.events.push({ kind: 'punch', pos: reach, hit: true });
        return;
      }
    }
    this.punchBlock(false);
  }

  /** 照準の先のブロックを素手で壊す（届く範囲だけ） */
  private punchBlock(quiet: boolean): void {
    const b = this.aimBlock;
    const p = this.player;
    const reach = OW_TOOLS.find((t) => t.id === 'punch')!.range + 1.5;
    if (!b || Math.hypot(b.x + 0.5 - p.pos.x, b.y + 0.5 - (p.pos.y + 1.2), b.z + 0.5 - p.pos.z) > reach) {
      if (!quiet) this.events.push({ kind: 'punch', pos: this.muzzle(), hit: false });
      return;
    }
    const f = fwdOf(p.yaw);
    const ok = this.destruction.breakBlock(b.x, b.y, b.z, { debris: 5, push: { x: f.x * 3, y: 0, z: f.z * 3 } });
    this.events.push({ kind: 'punch', pos: { x: b.x + 0.5, y: b.y + 0.5, z: b.z + 0.5 }, hit: ok });
  }

  private placeBlock(id: number): void {
    const b = this.aimBlock;
    const p = this.player;
    if (!b) return;
    const x = b.x + b.nx;
    const y = b.y + b.ny;
    const z = b.z + b.nz;
    if (Math.hypot(x + 0.5 - p.pos.x, y + 0.5 - (p.pos.y + 1.2), z + 0.5 - p.pos.z) > OW_TOOLS[5].range + 1.5) return;
    if (!this.world.inBounds(x, y, z) || isSolid(this.world.get(x, y, z))) return;
    // 自分や車・歩行者のいる所には置かない
    const overlaps = (cx: number, cy: number, cz: number, half: number, h: number): boolean =>
      cx + half > x && cx - half < x + 1 && cz + half > z && cz - half < z + 1 && cy + h > y && cy < y + 1;
    if (overlaps(p.pos.x, p.pos.y, p.pos.z, OW_PLAYER_HALF, OW_PLAYER_HEIGHT)) return;
    if (this.peds.some((ped) => overlaps(ped.pos.x, ped.pos.y, ped.pos.z, 0.3, 1.8))) return;
    if (this.vehicles.some((v) => this.pointInVehicle(v, { x: x + 0.5, y: y + 0.5, z: z + 0.5 }, 0.5))) return;
    this.world.set(x, y, z, id);
    this.events.push({ kind: 'place', pos: { x: x + 0.5, y: y + 0.5, z: z + 0.5 } });
  }

  /** ライフル: 光線の途中の歩行者・車に当たればそれ、外れたらブロックを削る */
  private fireRifle(from: V3, target: V3): void {
    const dir = this.normalize({ x: target.x - from.x, y: target.y - from.y, z: target.z - from.z });
    const maxD = Math.min(OW_TOOLS[1].range, dist3(from, target) + 0.5);
    let bestT = maxD;
    let hitPed: Pedestrian | null = null;
    let hitVeh: Vehicle | null = null;
    for (const ped of this.peds) {
      const t = this.raySphere(from, dir, { x: ped.pos.x, y: ped.pos.y + 0.9, z: ped.pos.z }, 0.55);
      if (t !== null && t < bestT) {
        bestT = t;
        hitPed = ped;
        hitVeh = null;
      }
    }
    for (const v of this.vehicles) {
      const t = this.raySphere(from, dir, { x: v.pos.x, y: v.pos.y + v.spec.height / 2, z: v.pos.z }, v.spec.halfW + 0.3);
      if (t !== null && t < bestT) {
        bestT = t;
        hitVeh = v;
        hitPed = null;
      }
    }
    const end = { x: from.x + dir.x * bestT, y: from.y + dir.y * bestT, z: from.z + dir.z * bestT };
    this.events.push({ kind: 'shot', from, to: end });
    this.events.push({ kind: 'fire', tool: 'rifle', pos: from });
    if (hitPed) {
      this.knockPed(hitPed, { x: dir.x * 9, y: 5, z: dir.z * 9 });
      return;
    }
    if (hitVeh) {
      this.damageVehicle(hitVeh, 6);
      return;
    }
    const hit = this.world.raycast(from, dir, maxD + 0.5);
    if (hit) this.destruction.damageBlock(hit.x, hit.y, hit.z, 1, { x: dir.x * 4, y: 0, z: dir.z * 4 });
    this.scarePeds(end, 10);
  }

  private raySphere(o: V3, d: V3, c: V3, r: number): number | null {
    const ox = o.x - c.x;
    const oy = o.y - c.y;
    const oz = o.z - c.z;
    const b = ox * d.x + oy * d.y + oz * d.z;
    const cc = ox * ox + oy * oy + oz * oz - r * r;
    const disc = b * b - cc;
    if (disc < 0) return null;
    const t = -b - Math.sqrt(disc);
    return t >= 0 ? t : null;
  }

  private useVehicleWeapon(v: Vehicle, input: OWInput): void {
    v.fireCooldown = Math.max(0, v.fireCooldown);
    if (v.kind === 'tank') {
      if (!input.fire || v.fireCooldown > 0) return;
      v.fireCooldown = OW_SHELL_COOLDOWN;
      const target = this.aimTarget(input);
      const f = fwdOf(v.turretYaw);
      const from = { x: v.pos.x + f.x * 3.2, y: v.pos.y + v.spec.height - 0.3, z: v.pos.z + f.z * 3.2 };
      const d = this.normalize({ x: target.x - from.x, y: target.y - from.y, z: target.z - from.z });
      this.projectiles.push({ id: this.nextId++, kind: 'shell', pos: from, vel: this.scale(d, OW_SHELL_SPEED), life: 5, radius: OW_SHELL_RADIUS });
      this.events.push({ kind: 'fire', tool: 'shell', pos: from });
      v.push.x -= f.x * 1.5;
      v.push.z -= f.z * 1.5;
    } else if (input.firePressed) {
      // 車はクラクション。近くの歩行者が逃げる
      this.events.push({ kind: 'horn', pos: { ...v.pos } });
      this.scarePeds(v.pos, 14);
    }
  }

  // ---- 乗り物 ----

  private footprint(v: Vehicle, x: number, z: number, yaw: number): { x: number; z: number }[] {
    const f = fwdOf(yaw);
    const r = rightOf(yaw);
    const pts: { x: number; z: number }[] = [];
    const nu = Math.max(2, Math.ceil((v.spec.halfW * 2) / 0.9) + 1);
    const nv = Math.max(2, Math.ceil((v.spec.halfL * 2) / 0.9) + 1);
    for (let i = 0; i < nu; i++) {
      const u = -v.spec.halfW * 0.9 + (i / (nu - 1)) * v.spec.halfW * 1.8;
      for (let j = 0; j < nv; j++) {
        const w = -v.spec.halfL * 0.95 + (j / (nv - 1)) * v.spec.halfL * 1.9;
        pts.push({ x: x + r.x * u + f.x * w, z: z + r.z * u + f.z * w });
      }
    }
    return pts;
  }

  /** 足場の高さ。今の高さから 1 ブロックまでの段差は上る。足場が遠ければ -Infinity */
  private groundUnder(pts: { x: number; z: number }[], y: number): number {
    let best = -Infinity;
    for (const pt of pts) {
      const x = Math.floor(pt.x);
      const z = Math.floor(pt.z);
      for (let yy = Math.floor(y + 1.05); yy >= Math.max(0, Math.floor(y) - 8); yy--) {
        if (this.world.solidAt(x, yy, z)) {
          best = Math.max(best, yy + 1);
          break;
        }
      }
    }
    return best;
  }

  /** プレイヤーが運転する乗り物 */
  private updateDriving(v: Vehicle, input: OWInput, dt: number): void {
    const s = v.spec;
    v.fireCooldown -= dt;
    if (v.wrecked) {
      this.toggleVehicle();
      return;
    }
    const throttle = input.moveZ;
    const steer = -input.moveX;
    if (throttle > 0) v.speed = Math.min(s.maxSpeed * (input.sprint ? 1.15 : 1), v.speed + s.accel * throttle * dt * (v.speed < 0 ? 2.5 : 1));
    else if (throttle < 0) v.speed = Math.max(-s.reverseSpeed, v.speed + s.accel * throttle * dt * (v.speed > 0 ? 2.5 : 1));
    else v.speed *= Math.pow(0.4, dt);
    if (input.jump) v.speed *= Math.pow(0.02, dt);
    const turn = steer * s.turnRate * dt * Math.min(1, Math.abs(v.speed) / 4) * Math.sign(v.speed || 1);
    v.yaw += turn;
    v.roll += (-turn * 6 - v.roll) * Math.min(1, dt * 6);
    // 戦車の砲塔はカメラの向き
    if (v.kind === 'tank') v.turretYaw = input.yaw;
    this.moveVehicle(v, dt, true);
    this.stats.distance += Math.abs(v.speed) * dt;
  }

  /** プレイヤー以外の乗り物（街の車・止まっている車） */
  private updateVehicle(v: Vehicle, dt: number): void {
    v.fireCooldown -= dt;
    if (v.wrecked) {
      v.speed *= Math.pow(0.2, dt);
      this.moveVehicle(v, dt, false);
      return;
    }
    if (v.ai) this.driveTraffic(v, v.ai, dt);
    else {
      v.speed *= Math.pow(0.3, dt);
      this.moveVehicle(v, dt, false);
    }
  }

  /** 乗り物を進め、ブロック・段差・落下を処理する */
  private moveVehicle(v: Vehicle, dt: number, driven: boolean): void {
    const s = v.spec;
    const f = fwdOf(v.yaw);
    v.push.x *= Math.pow(0.15, dt);
    v.push.z *= Math.pow(0.15, dt);
    const dx = f.x * v.speed * dt + v.push.x * dt;
    const dz = f.z * v.speed * dt + v.push.z * dt;
    const nx = clamp(v.pos.x + dx, 2, this.world.sizeX - 2);
    const nz = clamp(v.pos.z + dz, 2, this.world.sizeZ - 2);
    const pts = this.footprint(v, nx, nz, v.yaw);
    const ground = this.groundUnder(pts, v.pos.y);
    const baseY = Math.max(v.pos.y, ground === -Infinity ? v.pos.y : ground);
    // 車体が当たるブロック
    const hits: [number, number, number][] = [];
    const seen = new Set<number>();
    for (const pt of pts) {
      const x = Math.floor(pt.x);
      const z = Math.floor(pt.z);
      for (let y = Math.floor(baseY + 0.05); y <= Math.floor(baseY + s.height - 0.05); y++) {
        if (!this.world.solidAt(x, y, z)) continue;
        const i = this.world.index(x, y, z);
        if (seen.has(i)) continue;
        seen.add(i);
        hits.push([x, y, z]);
      }
    }
    let canMove = hits.length === 0;
    if (!canMove) {
      const speed = Math.abs(v.speed) + Math.hypot(v.push.x, v.push.z);
      const unbreakable = hits.some(([x, y, z]) => this.world.hardnessAt(x, y, z) === 0);
      if (driven && !unbreakable && speed >= s.crushSpeed) {
        // 勢いでブロックを突き破る
        let hardSum = 0;
        for (const [x, y, z] of hits) {
          hardSum += this.world.hardnessAt(x, y, z);
          this.destruction.breakBlock(x, y, z, { debris: 2, check: false, push: { x: f.x * speed * 0.6, y: 2, z: f.z * speed * 0.6 } });
        }
        this.destruction.checkSupport(hits);
        const drag = hardSum * s.crushDrag;
        v.speed = Math.sign(v.speed) * Math.max(0, Math.abs(v.speed) - drag);
        if (v.kind === 'car') this.damageVehicle(v, hardSum * 0.7);
        this.events.push({ kind: 'crash', pos: { x: nx, y: baseY + 1, z: nz }, power: Math.min(3, hardSum / 6) });
        canMove = Math.abs(v.speed) > 0.5;
      } else {
        if (speed > 7) {
          this.damageVehicle(v, speed * 0.8);
          this.events.push({ kind: 'crash', pos: { x: nx, y: baseY + 1, z: nz }, power: Math.min(2, speed / 12) });
        }
        v.speed = -v.speed * 0.25;
        v.push.x = -v.push.x * 0.3;
        v.push.z = -v.push.z * 0.3;
      }
    }
    if (canMove) {
      v.pos.x = nx;
      v.pos.z = nz;
    }
    // 高さ
    const g = this.groundUnder(this.footprint(v, v.pos.x, v.pos.z, v.yaw), v.pos.y);
    if (g !== -Infinity && g >= v.pos.y - 0.05 && v.vy <= 0) {
      if (!v.onGround && v.vy < -16) this.damageVehicle(v, -v.vy);
      v.pos.y = g;
      v.vy = 0;
      v.onGround = true;
    } else {
      v.vy -= OW_GRAVITY * dt;
      v.vy = Math.max(v.vy, -45);
      v.pos.y += v.vy * dt;
      if (g !== -Infinity && v.pos.y < g) {
        if (v.vy < -16) this.damageVehicle(v, -v.vy);
        v.pos.y = g;
        v.vy = 0;
        v.onGround = true;
      } else v.onGround = false;
    }
    if (v.pos.y < 1) {
      v.pos.y = 1;
      v.vy = 0;
    }
    // 水に入ると進みにくい
    if (this.world.get(Math.floor(v.pos.x), Math.floor(v.pos.y + 0.5), Math.floor(v.pos.z)) === B.WATER) v.speed *= Math.pow(0.1, dt);
    // 人をはねる
    if (Math.abs(v.speed) > 2.5) {
      for (const ped of this.peds) {
        if (ped.state === 'knocked' && ped.timer > 2) continue;
        if (this.pointInVehicle(v, { x: ped.pos.x, y: ped.pos.y + 0.5, z: ped.pos.z }, 0.35)) {
          const sp = v.speed * 0.9;
          this.knockPed(ped, { x: f.x * sp + (this.rng() - 0.5) * 3, y: 4 + Math.abs(sp) * 0.3, z: f.z * sp + (this.rng() - 0.5) * 3 });
          v.speed *= 0.93;
        }
      }
      const p = this.player;
      if (v !== p.vehicle && !p.vehicle && p.knock <= 0 && this.pointInVehicle(v, { x: p.pos.x, y: p.pos.y + 0.5, z: p.pos.z }, 0.35)) {
        this.knockPlayer(f.x * v.speed * 0.8, 6, f.z * v.speed * 0.8);
      }
    }
    v.roll *= Math.pow(0.1, dt);
  }

  /** 点が乗り物の箱の中にあるか（margin だけ広げる） */
  pointInVehicle(v: Vehicle, pt: V3, margin: number): boolean {
    const dx = pt.x - v.pos.x;
    const dz = pt.z - v.pos.z;
    const f = fwdOf(v.yaw);
    const r = rightOf(v.yaw);
    const u = dx * r.x + dz * r.z;
    const w = dx * f.x + dz * f.z;
    return Math.abs(u) < v.spec.halfW + margin && Math.abs(w) < v.spec.halfL + margin && pt.y > v.pos.y - margin && pt.y < v.pos.y + v.spec.height + margin;
  }

  /** 街の車: 車線をたどり、交差点で曲がる。前がふさがっていたら止まり、長く止まったら U ターン */
  private driveTraffic(v: Vehicle, ai: TrafficAI, dt: number): void {
    const dirVec = ai.axis === 'x' ? { x: ai.dir, z: 0 } : { x: 0, z: ai.dir };
    // 前方の障害物
    let blocked = false;
    const lookAhead = 5.5;
    const ahead = (px: number, pz: number, rad: number): boolean => {
      const rx = px - v.pos.x;
      const rz = pz - v.pos.z;
      const along = rx * dirVec.x + rz * dirVec.z;
      const lat = Math.abs(rx * dirVec.z - rz * dirVec.x);
      return along > 0.5 && along < lookAhead + v.spec.halfL && lat < 1.3 + rad;
    };
    const p = this.player;
    if (!p.vehicle && ahead(p.pos.x, p.pos.z, 0.3) && Math.abs(p.pos.y - v.pos.y) < 2) blocked = true;
    for (const o of this.vehicles) if (o !== v && ahead(o.pos.x, o.pos.z, o.spec.halfW) && Math.abs(o.pos.y - v.pos.y) < 2.5) blocked = true;
    for (const ped of this.peds) if (ped.state !== 'knocked' && ahead(ped.pos.x, ped.pos.z, 0.3) && Math.abs(ped.pos.y - v.pos.y) < 2) blocked = true;
    for (let k = 1; k <= 4 && !blocked; k++) {
      const cx = Math.floor(v.pos.x + dirVec.x * (v.spec.halfL + k * 0.8));
      const cz = Math.floor(v.pos.z + dirVec.z * (v.spec.halfL + k * 0.8));
      const by = Math.floor(v.pos.y + 0.05);
      if (this.world.solidAt(cx, by + 1, cz) || (this.world.solidAt(cx, by, cz) && this.world.solidAt(cx, by + 1, cz))) blocked = true;
      // 地面が崩れて穴になっていたら止まる
      if (!this.world.solidAt(cx, by - 1, cz) && !this.world.solidAt(cx, by - 2, cz)) blocked = true;
    }
    const target = blocked ? 0 : OW_TRAFFIC_SPEED;
    v.speed += clamp(target - v.speed, -22 * dt, 8 * dt);
    if (blocked) {
      ai.blocked += dt;
      if (ai.blocked > 4) {
        ai.dir = -ai.dir;
        ai.blocked = 0;
        ai.lastCross = -1;
      }
    } else ai.blocked = Math.max(0, ai.blocked - dt);

    const prevAlong = ai.axis === 'x' ? v.pos.x : v.pos.z;
    const nextAlong = prevAlong + ai.dir * v.speed * dt;
    // 交差点の真ん中を越えたら、まっすぐ・左右を選ぶ
    for (let j = 0; j < OW_ROAD_COUNT; j++) {
      if (j === ai.lastCross) continue;
      const c = ROAD_ORIGINS[j] + OW_ROAD_WIDTH / 2;
      if ((prevAlong - c) * (nextAlong - c) > 0 || prevAlong === nextAlong) continue;
      ai.lastCross = j;
      const opts: { axis: 'x' | 'z'; dir: number; road: number; cross: number }[] = [];
      const straightOk = ai.dir > 0 ? j < OW_ROAD_COUNT - 1 : j > 0;
      if (straightOk) opts.push({ axis: ai.axis, dir: ai.dir, road: ai.road, cross: j }, { axis: ai.axis, dir: ai.dir, road: ai.road, cross: j });
      const other: 'x' | 'z' = ai.axis === 'x' ? 'z' : 'x';
      if (ai.road < OW_ROAD_COUNT - 1) opts.push({ axis: other, dir: 1, road: j, cross: ai.road });
      if (ai.road > 0) opts.push({ axis: other, dir: -1, road: j, cross: ai.road });
      if (opts.length === 0) opts.push({ axis: ai.axis, dir: -ai.dir, road: ai.road, cross: j });
      const choice = opts[Math.floor(this.rng() * opts.length)];
      ai.axis = choice.axis;
      ai.dir = choice.dir;
      ai.road = choice.road;
      ai.lastCross = choice.cross;
      break;
    }
    // 進む向きへ移動し、横は車線の中心へ寄せる
    const lane = laneCoord(ai.road, ai.axis, ai.dir);
    const move = v.speed * dt;
    if (ai.axis === 'x') {
      v.pos.x += ai.dir * move;
      v.pos.z += clamp(lane - v.pos.z, -4 * dt, 4 * dt);
    } else {
      v.pos.z += ai.dir * move;
      v.pos.x += clamp(lane - v.pos.x, -4 * dt, 4 * dt);
    }
    const targetYaw = ai.axis === 'x' ? (ai.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : ai.dir > 0 ? 0 : Math.PI;
    let dy = targetYaw - v.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    v.yaw += clamp(dy, -5 * dt, 5 * dt);
    // 高さと人の判定は共通の処理で（前後には動かさない）
    const keep = v.speed;
    v.speed = 0;
    this.moveVehicle(v, dt, false);
    v.speed = keep;
    // はねる判定のため、走っている間は前の人を押しのける
    if (keep > 2.5) {
      const f = fwdOf(v.yaw);
      for (const ped of this.peds) {
        if (ped.state !== 'knocked' && this.pointInVehicle(v, { x: ped.pos.x, y: ped.pos.y + 0.5, z: ped.pos.z }, 0.3)) {
          this.knockPed(ped, { x: f.x * keep, y: 5, z: f.z * keep });
        }
      }
    }
  }

  /** 乗り物どうしのぶつかり（円で近似して押し離す） */
  private collideVehicles(): void {
    const vs = this.vehicles;
    for (let i = 0; i < vs.length; i++) {
      for (let j = i + 1; j < vs.length; j++) {
        const a = vs[i];
        const b = vs[j];
        if (Math.abs(a.pos.y - b.pos.y) > 2.5) continue;
        const ra = (a.spec.halfW + a.spec.halfL) * 0.55;
        const rb = (b.spec.halfW + b.spec.halfL) * 0.55;
        const dx = b.pos.x - a.pos.x;
        const dz = b.pos.z - a.pos.z;
        const d = Math.hypot(dx, dz);
        if (d >= ra + rb || d === 0) continue;
        const nx = dx / d;
        const nz = dz / d;
        const overlap = ra + rb - d;
        const ma = a.spec.hp;
        const mb = b.spec.hp;
        const ta = mb / (ma + mb);
        a.pos.x -= nx * overlap * ta;
        a.pos.z -= nz * overlap * ta;
        b.pos.x += nx * overlap * (1 - ta);
        b.pos.z += nz * overlap * (1 - ta);
        const fa = fwdOf(a.yaw);
        const fb = fwdOf(b.yaw);
        const rel = (fa.x * a.speed - fb.x * b.speed) * nx + (fa.z * a.speed - fb.z * b.speed) * nz;
        if (rel > 6) {
          this.damageVehicle(a, rel * (mb / ma) * 0.6);
          this.damageVehicle(b, rel * (ma / mb) * 0.6);
          b.push.x += nx * rel * ta * 1.2;
          b.push.z += nz * rel * ta * 1.2;
          a.push.x -= nx * rel * (1 - ta) * 1.2;
          a.push.z -= nz * rel * (1 - ta) * 1.2;
          a.speed *= 0.4 + 0.5 * (1 - ta);
          this.events.push({ kind: 'crash', pos: { x: (a.pos.x + b.pos.x) / 2, y: a.pos.y + 1, z: (a.pos.z + b.pos.z) / 2 }, power: Math.min(2.5, rel / 10) });
        }
      }
    }
    // 歩きのプレイヤーは止まっている車を押しのけない（車がプレイヤーを押し出す）
    const p = this.player;
    if (!p.vehicle) {
      for (const v of vs) {
        if (!this.pointInVehicle(v, { x: p.pos.x, y: p.pos.y + 0.5, z: p.pos.z }, 0.3)) continue;
        const dx = p.pos.x - v.pos.x;
        const dz = p.pos.z - v.pos.z;
        const d = Math.hypot(dx, dz) || 1;
        // 屋根の上に乗っているなら押さない
        if (p.pos.y > v.pos.y + v.spec.height - 0.4) continue;
        p.pos.x += (dx / d) * 0.12;
        p.pos.z += (dz / d) * 0.12;
      }
    }
  }

  damageVehicle(v: Vehicle, amount: number): void {
    if (v.wrecked || amount <= 0) return;
    v.hp -= amount;
    if (v.hp > 0) return;
    v.hp = 0;
    v.wrecked = true;
    v.ai = null;
    v.wreckTimer = 0;
    this.stats.wrecks++;
    this.events.push({ kind: 'wreck', vehicle: v.id, pos: { ...v.pos } });
    // 少し遅れて爆発する（連鎖が見えるように）
    this.pending.push({ pos: { x: v.pos.x, y: v.pos.y + 1, z: v.pos.z }, radius: v.kind === 'tank' ? 5 : OW_CAR_EXPLOSION_RADIUS, timer: 0.25 + this.rng() * 0.3 });
    v.vy = 9;
    v.onGround = false;
  }

  /** 壊れた車をしばらくしたら片付け、街の車を補充する */
  private cleanupWrecks(dt: number): void {
    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      const v = this.vehicles[i];
      if (!v.wrecked || v === this.player.vehicle) continue;
      v.wreckTimer += dt;
      const far = Math.hypot(v.pos.x - this.player.pos.x, v.pos.z - this.player.pos.z) > 40;
      if (v.wreckTimer > OW_WRECK_CLEAR_TIME && far) {
        this.vehicles.splice(i, 1);
        if (v.kind === 'car') this.spawnTraffic();
      }
    }
  }

  // ---- 歩行者 ----

  private pickNextNode(ped: Pedestrian): void {
    const n = SIDEWALK_LINES.length;
    const opts: [number, number][] = [];
    for (const [da, db] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const a = ped.nodeA + da;
      const b = ped.nodeB + db;
      if (a < 0 || b < 0 || a >= n || b >= n) continue;
      if (a === ped.prevA && b === ped.prevB) continue;
      opts.push([a, b]);
    }
    if (opts.length === 0) opts.push([ped.prevA, ped.prevB]);
    const [a, b] = opts[Math.floor(this.rng() * opts.length)];
    ped.prevA = ped.nodeA;
    ped.prevB = ped.nodeB;
    ped.nodeA = a;
    ped.nodeB = b;
  }

  /** いちばん近い歩道の交点を目的地にする */
  private nearestNode(ped: Pedestrian): void {
    let ba = 0;
    let bb = 0;
    let bd = Infinity;
    SIDEWALK_LINES.forEach((x, a) => {
      const d = Math.abs(x - ped.pos.x);
      if (d < bd) {
        bd = d;
        ba = a;
      }
    });
    bd = Infinity;
    SIDEWALK_LINES.forEach((z, b) => {
      const d = Math.abs(z - ped.pos.z);
      if (d < bd) {
        bd = d;
        bb = b;
      }
    });
    // 近いほうの軸だけ合わせる（歩道の上をたどれるように）
    ped.nodeA = ba;
    ped.nodeB = bb;
    ped.prevA = ba;
    ped.prevB = bb;
  }

  knockPed(ped: Pedestrian, vel: V3): void {
    if (ped.state !== 'knocked') this.stats.pedsKnocked++;
    ped.state = 'knocked';
    ped.timer = 3 + this.rng() * 1.5;
    ped.vel = { ...vel };
    ped.onGround = false;
    ped.tumbleSpeed = 6 + Math.hypot(vel.x, vel.z) * 0.6;
    this.events.push({ kind: 'ped_hit', pos: { ...ped.pos } });
  }

  /** まわりの歩行者を逃げさせる */
  scarePeds(at: V3, radius: number): void {
    for (const ped of this.peds) {
      if (ped.state === 'knocked') continue;
      const d = Math.hypot(ped.pos.x - at.x, ped.pos.z - at.z);
      if (d > radius) continue;
      ped.state = 'flee';
      ped.timer = 4 + this.rng() * 3;
      const ang = Math.atan2(ped.pos.x - at.x, ped.pos.z - at.z) + (this.rng() - 0.5) * 0.8;
      ped.yaw = ang;
    }
  }

  private updatePed(ped: Pedestrian, dt: number): void {
    const w = this.world;
    if (ped.state === 'knocked') {
      ped.timer -= dt;
      ped.vel.y -= OW_GRAVITY * dt;
      if (ped.onGround) {
        ped.vel.x *= Math.pow(0.02, dt);
        ped.vel.z *= Math.pow(0.02, dt);
        ped.tumbleSpeed *= Math.pow(0.05, dt);
      }
      ped.tumble += ped.tumbleSpeed * dt;
      ped.onGround = moveBox(w, ped.pos, ped.vel, 0.3, 1.0, dt, false, ped.onGround);
      if (ped.timer <= 0 && ped.onGround) {
        // 起き上がって、近くの歩道へ戻る
        ped.state = 'walk';
        ped.tumble = 0;
        this.nearestNode(ped);
        // 起き上がる場所がブロックの中なら上へ
        let guard = 0;
        while (boxCollides(w, ped.pos.x, ped.pos.y, ped.pos.z, 0.3, 1.8) && guard++ < 6) ped.pos.y += 1;
      }
      return;
    }
    let wantX = 0;
    let wantZ = 0;
    let speed = OW_PED_WALK;
    if (ped.state === 'flee') {
      ped.timer -= dt;
      speed = OW_PED_RUN;
      wantX = Math.sin(ped.yaw);
      wantZ = Math.cos(ped.yaw);
      if (ped.timer <= 0) {
        ped.state = 'walk';
        this.nearestNode(ped);
      }
    } else {
      const tx = SIDEWALK_LINES[ped.nodeA];
      const tz = SIDEWALK_LINES[ped.nodeB];
      const dx = tx - ped.pos.x;
      const dz = tz - ped.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.35) {
        this.pickNextNode(ped);
        return;
      }
      wantX = dx / d;
      wantZ = dz / d;
    }
    ped.vel.x = wantX * speed;
    ped.vel.z = wantZ * speed;
    ped.vel.y -= OW_GRAVITY * dt;
    const bx = ped.pos.x;
    const bz = ped.pos.z;
    ped.onGround = moveBox(w, ped.pos, ped.vel, 0.3, 1.8, dt, true, ped.onGround);
    const moved = Math.hypot(ped.pos.x - bx, ped.pos.z - bz);
    ped.walkPhase += moved * 2.4;
    if (moved > 0.0001) ped.yaw = Math.atan2(ped.pos.x - bx, ped.pos.z - bz);
    if (moved < speed * dt * 0.3) {
      ped.stuck += dt;
      if (ped.stuck > 0.7) {
        ped.stuck = 0;
        if (ped.state === 'flee') ped.yaw += Math.PI / 2 + this.rng() * Math.PI;
        else {
          // ふさがっていたら来た道へ戻る
          const a = ped.prevA;
          const b = ped.prevB;
          ped.prevA = ped.nodeA;
          ped.prevB = ped.nodeB;
          ped.nodeA = a;
          ped.nodeB = b;
          if (ped.nodeA === ped.prevA && ped.nodeB === ped.prevB) this.pickNextNode(ped);
        }
      }
    } else ped.stuck = 0;
  }

  // ---- 弾 ----

  private updateProjectiles(dt: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      pr.life -= dt;
      let explodeAt: V3 | null = null;
      if (pr.kind === 'grenade') {
        pr.vel.y -= OW_GRAVITY * dt;
        for (const axis of ['x', 'y', 'z'] as const) {
          const np = { ...pr.pos };
          np[axis] += pr.vel[axis] * dt;
          if (this.world.solidAtPoint(np.x, np.y, np.z)) {
            pr.vel[axis] *= -0.4;
            pr.vel.x *= 0.8;
            pr.vel.z *= 0.8;
          } else pr.pos[axis] = np[axis];
        }
        if (pr.life <= 0) explodeAt = pr.pos;
      } else {
        const sp = Math.hypot(pr.vel.x, pr.vel.y, pr.vel.z);
        const step = sp * dt;
        const hit = this.world.raycast(pr.pos, pr.vel, step);
        // 途中の歩行者・車
        const dir = this.normalize(pr.vel);
        let entT = Infinity;
        if (pr.kind !== 'meteor') {
          for (const ped of this.peds) {
            const t = this.raySphere(pr.pos, dir, { x: ped.pos.x, y: ped.pos.y + 0.9, z: ped.pos.z }, 0.6);
            if (t !== null && t < step) entT = Math.min(entT, t);
          }
          for (const v of this.vehicles) {
            if (v === this.player.vehicle) continue;
            const t = this.raySphere(pr.pos, dir, { x: v.pos.x, y: v.pos.y + v.spec.height / 2, z: v.pos.z }, v.spec.halfW + 0.4);
            if (t !== null && t < step) entT = Math.min(entT, t);
          }
        }
        const blockT = hit ? hit.dist : Infinity;
        const t = Math.min(entT, blockT);
        if (t < Infinity) explodeAt = { x: pr.pos.x + dir.x * t, y: pr.pos.y + dir.y * t, z: pr.pos.z + dir.z * t };
        else {
          pr.pos.x += pr.vel.x * dt;
          pr.pos.y += pr.vel.y * dt;
          pr.pos.z += pr.vel.z * dt;
          if (pr.kind === 'shell') pr.vel.y -= 2 * dt;
          if (pr.life <= 0 || pr.pos.y < 0) explodeAt = pr.life <= 0 && pr.kind !== 'meteor' ? null : pr.pos;
          if (pr.life <= 0 && !explodeAt) {
            this.projectiles.splice(i, 1);
            continue;
          }
        }
      }
      if (explodeAt) {
        this.destruction.explode(explodeAt, pr.radius);
        this.projectiles.splice(i, 1);
      }
    }
  }

  private updatePending(dt: number): void {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const e = this.pending[i];
      e.timer -= dt;
      if (e.timer > 0) continue;
      this.pending.splice(i, 1);
      this.destruction.explode(e.pos, e.radius);
    }
  }

  /** 爆風: 人と車を吹き飛ばし、車を傷める */
  private applyBlast(pos: V3, radius: number): void {
    const reach = radius * 2;
    for (const ped of this.peds) {
      const d = dist3({ ...ped.pos, y: ped.pos.y + 0.8 }, pos);
      if (d > reach) continue;
      const k = 1 - d / reach;
      const dir = this.normalize({ x: ped.pos.x - pos.x, y: 0, z: ped.pos.z - pos.z });
      this.knockPed(ped, { x: dir.x * 22 * k, y: 7 + 12 * k, z: dir.z * 22 * k });
    }
    this.scarePeds(pos, radius * 6);
    for (const v of this.vehicles) {
      const d = dist3({ x: v.pos.x, y: v.pos.y + 1, z: v.pos.z }, pos);
      if (d > reach) continue;
      const k = 1 - d / reach;
      const dir = this.normalize({ x: v.pos.x - pos.x, y: 0, z: v.pos.z - pos.z });
      const light = v.kind === 'tank' ? 0.15 : 1;
      v.push.x += dir.x * 16 * k * light;
      v.push.z += dir.z * 16 * k * light;
      v.vy = Math.max(v.vy, 9 * k * light);
      v.onGround = false;
      this.damageVehicle(v, (v.kind === 'tank' ? 90 : 75) * k * (radius / 4));
    }
    const p = this.player;
    if (!p.vehicle) {
      const d = dist3({ ...p.pos, y: p.pos.y + 0.8 }, pos);
      if (d < reach) {
        const k = 1 - d / reach;
        const dir = this.normalize({ x: p.pos.x - pos.x, y: 0, z: p.pos.z - pos.z });
        this.knockPlayer(dir.x * 18 * k, 6 + 10 * k, dir.z * 18 * k);
      }
    }
  }

  /** 崩れ落ちる塊の下にいる人・車を押しつぶす */
  private crushUnderCollapse(): void {
    for (const e of this.destruction.events) {
      if (e.kind !== 'collapse_land') continue;
      const r = Math.min(12, 2 + Math.cbrt(e.blocks) * 0.8);
      for (const ped of this.peds) {
        if (Math.hypot(ped.pos.x - e.pos.x, ped.pos.z - e.pos.z) < r) this.knockPed(ped, { x: (this.rng() - 0.5) * 10, y: 6, z: (this.rng() - 0.5) * 10 });
      }
      for (const v of this.vehicles) if (Math.hypot(v.pos.x - e.pos.x, v.pos.z - e.pos.z) < r) this.damageVehicle(v, e.height * 6);
      this.scarePeds(e.pos, r * 4);
    }
  }

  /** 1 ブロックの色（ミニマップ・描画用） */
  static blockColor(id: number): number {
    return BLOCK_DEFS[id]?.color ?? 0xff00ff;
  }
}
