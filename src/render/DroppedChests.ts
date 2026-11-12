import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  type PerspectiveCamera,
  type Scene,
  Sprite,
  SpriteMaterial,
  Vector3,
} from 'three';
import type { ChestTier } from '../game/RogueJackpot';
import { BEAM_COLORS, BODY_H, D, TRIM_COLORS, VOXEL, W, bodyVoxels, buildMesh, lidVoxels } from './JackpotChest3D';

/** 宝箱の格ごとの大きさ */
const TIER_SCALE: readonly number[] = [0.42, 0.48, 0.56];
/** モデルの中心から底面までの距離（モデルの座標） */
const BOTTOM_OFFSET = (BODY_H / 2) * VOXEL + VOXEL / 2;
/** 本体とフタの境目の高さ（モデルの座標） */
const SEAM_Y = (BODY_H / 2) * VOXEL - VOXEL / 2;
const GRAVITY = 22;
const POP_SPEED = 7.5;
const POP_SPREAD = 1.4;
const SPIN_SPEED = 9;
/** 跳ね返りの速さの残り具合と、止まったとみなす速さ */
const BOUNCE = 0.35;
const STOP_SPEED = 1.2;
const COLLECT_TIME = 0.6;
/** タップしやすいよう、小さく映っていてもこの半径（ピクセル）は当たりにする */
const MIN_PICK_RADIUS = 34;
const RAY_COUNT = 6;

const _screen = new Vector3();
const _top = new Vector3();

export interface DroppedChest {
  readonly tier: ChestTier;
  readonly position: Vector3;
}

interface ChestState extends DroppedChest {
  readonly root: Group;
  readonly lid: Group;
  readonly meshes: readonly InstancedMesh[];
  readonly glow: MeshBasicMaterial;
  readonly halo: Sprite;
  readonly rays: Group;
  readonly facing: number;
  readonly scale: number;
  readonly restY: number;
  vx: number;
  vy: number;
  vz: number;
  spin: number;
  t: number;
  landed: boolean;
  collecting: number;
}

function createHaloTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  return new CanvasTexture(canvas);
}

/** 敵が戦場に落とすボクセルの宝箱。光を漏らして震え、クリックやタップで開けられる */
export class DroppedChests {
  private readonly chests: ChestState[] = [];
  private readonly seamGeometry = new BoxGeometry(W * VOXEL + 0.06, 0.14, D * VOXEL + 0.06);
  private readonly rayGeometry = new CylinderGeometry(0.55, 0.04, 3.2, 6, 1, true).translate(0, 1.6, 0);
  private readonly haloTexture = createHaloTexture();

  constructor(
    private readonly scene: Scene,
    private readonly camera: PerspectiveCamera,
    private readonly dom: HTMLElement,
    private readonly onLand: () => void,
  ) {}

  /** 回収の演出中のものを除いた、開けられる宝箱の数 */
  get count(): number {
    return this.chests.reduce((n, c) => n + (c.collecting < 0 ? 1 : 0), 0);
  }

  /** 倒した敵の位置から宝箱を跳ね上げる */
  spawn(pos: Vector3, tier: ChestTier): DroppedChest {
    const withTrim = (list: ReturnType<typeof bodyVoxels>) => list.map((v) => (v.trim ? { ...v, color: TRIM_COLORS[tier] } : v));
    const halfW = (W - 1) / 2;
    const halfD = (D - 1) / 2;
    const body = buildMesh(withTrim(bodyVoxels()), { x: -halfW, y: -BODY_H / 2, z: -halfD }).mesh;
    const lidMesh = buildMesh(withTrim(lidVoxels()), { x: -halfW, y: 0, z: 0 }).mesh;
    const lid = new Group();
    lid.add(lidMesh);
    lid.position.set(0, (BODY_H / 2) * VOXEL, -halfD * VOXEL);

    const color = BEAM_COLORS[tier];
    const glow = new MeshBasicMaterial({ color, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false });
    const seam = new Mesh(this.seamGeometry, glow);
    seam.position.y = SEAM_Y;
    const rays = new Group();
    rays.position.y = SEAM_Y;
    for (let i = 0; i < RAY_COUNT; i++) {
      const holder = new Group();
      holder.rotation.y = (i / RAY_COUNT) * Math.PI * 2;
      const ray = new Mesh(this.rayGeometry, glow);
      ray.rotation.z = -0.75 - (i % 2) * 0.4;
      holder.add(ray);
      rays.add(holder);
    }
    const halo = new Sprite(
      new SpriteMaterial({ map: this.haloTexture, color, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false }),
    );
    halo.position.y = SEAM_Y;

    const scale = TIER_SCALE[tier];
    const root = new Group();
    root.add(body, lid, seam, rays, halo);
    root.position.set(pos.x, Math.max(pos.y, 1), pos.z);
    root.scale.setScalar(scale);
    const facing = Math.atan2(this.camera.position.x - pos.x, this.camera.position.z - pos.z);
    root.rotation.y = facing;
    this.scene.add(root);

    const angle = Math.random() * Math.PI * 2;
    const state: ChestState = {
      tier,
      position: root.position,
      root,
      lid,
      meshes: [body, lidMesh],
      glow,
      halo,
      rays,
      facing,
      scale,
      restY: BOTTOM_OFFSET * scale,
      vx: Math.cos(angle) * POP_SPREAD,
      vy: POP_SPEED,
      vz: Math.sin(angle) * POP_SPREAD,
      spin: 0,
      t: 0,
      landed: false,
      collecting: -1,
    };
    this.chests.push(state);
    return state;
  }

  /** 画面座標にある宝箱を探す。重なっていたら一番近いものを返す */
  pick(clientX: number, clientY: number): DroppedChest | null {
    const rect = this.dom.getBoundingClientRect();
    const toScreen = (v: Vector3) => {
      v.project(this.camera);
      v.set(rect.left + ((v.x + 1) / 2) * rect.width, rect.top + ((1 - v.y) / 2) * rect.height, 0);
    };
    let best: ChestState | null = null;
    let bestDist = Infinity;
    for (const c of this.chests) {
      if (c.collecting >= 0) continue;
      _screen.copy(c.position);
      _top.copy(c.position);
      _top.y += c.scale * 1.8;
      toScreen(_screen);
      toScreen(_top);
      const radius = Math.max(MIN_PICK_RADIUS, _screen.distanceTo(_top) * 1.2);
      const dist = Math.hypot(clientX - _screen.x, clientY - _screen.y);
      if (dist <= radius && dist < bestDist) {
        best = c;
        bestDist = dist;
      }
    }
    return best;
  }

  /** 開封した宝箱を戦場から取り除く */
  remove(chest: DroppedChest): void {
    const index = this.chests.indexOf(chest as ChestState);
    if (index < 0) return;
    this.disposeChest(this.chests[index]);
    this.chests.splice(index, 1);
  }

  /** 残っている宝箱をすべて回収の演出に移し、その数を返す */
  collectAll(): number {
    let collected = 0;
    for (const c of this.chests) {
      if (c.collecting >= 0) continue;
      c.collecting = 0;
      collected++;
    }
    return collected;
  }

  clear(): void {
    for (const c of this.chests) this.disposeChest(c);
    this.chests.length = 0;
  }

  update(dt: number): void {
    for (let i = this.chests.length - 1; i >= 0; i--) {
      const c = this.chests[i];
      c.t += dt;
      if (c.collecting >= 0) {
        c.collecting += dt;
        if (c.collecting >= COLLECT_TIME) {
          this.disposeChest(c);
          this.chests.splice(i, 1);
          continue;
        }
        this.updateCollect(c, dt);
      } else if (!c.landed) {
        this.updateFlight(c, dt);
      } else {
        this.updateRattle(c, dt);
      }
    }
  }

  private updateFlight(c: ChestState, dt: number): void {
    c.vy -= GRAVITY * dt;
    c.root.position.x += c.vx * dt;
    c.root.position.y += c.vy * dt;
    c.root.position.z += c.vz * dt;
    c.spin += SPIN_SPEED * dt;
    c.root.rotation.y = c.facing + c.spin;
    if (c.root.position.y > c.restY || c.vy > 0) return;
    c.root.position.y = c.restY;
    c.vy *= -BOUNCE;
    c.vx *= 0.5;
    c.vz *= 0.5;
    if (Math.abs(c.vy) >= STOP_SPEED) return;
    c.landed = true;
    c.t = 0;
    this.onLand();
  }

  private updateRattle(c: ChestState, dt: number): void {
    // ガタガタと震える時間と、少し落ち着く時間を繰り返す
    const rattle = 0.3 + 0.7 * Math.max(0, Math.sin(c.t * 2.6));
    const ease = Math.min(1, c.t / 0.3);
    c.spin *= Math.exp(-12 * dt);
    c.root.rotation.set(
      Math.sin(c.t * 31) * 0.035 * rattle,
      c.facing + c.spin + Math.sin(c.t * 43) * 0.05 * rattle,
      Math.sin(c.t * 37) * 0.07 * rattle,
    );
    c.root.position.y = c.restY + Math.abs(Math.sin(c.t * 19)) * 0.05 * rattle;
    // フタが浮くたびに隙間の光が強まる
    const crack = Math.abs(Math.sin(c.t * 17)) * rattle;
    c.lid.rotation.x = -0.05 - 0.14 * crack;
    c.glow.opacity = ease * (0.3 + 0.55 * crack);
    c.rays.rotation.y = c.t * 0.8;
    const haloMaterial = c.halo.material;
    haloMaterial.opacity = ease * (0.35 + 0.4 * crack);
    c.halo.scale.setScalar(5.5 + 2 * crack);
  }

  private updateCollect(c: ChestState, dt: number): void {
    const p = c.collecting / COLLECT_TIME;
    c.root.position.y += (2 + p * 10) * dt;
    c.root.rotation.y += 12 * dt;
    c.root.scale.setScalar(c.scale * (1 - p * p));
    c.lid.rotation.x = -0.05 - p * 0.8;
    c.glow.opacity = 0.9 * (1 - p);
    c.halo.material.opacity = 0.9 * (1 - p);
  }

  private disposeChest(c: ChestState): void {
    this.scene.remove(c.root);
    for (const mesh of c.meshes) {
      mesh.geometry.dispose();
      (mesh.material as MeshBasicMaterial).dispose();
      mesh.dispose();
    }
    c.glow.dispose();
    c.halo.material.dispose();
  }
}
