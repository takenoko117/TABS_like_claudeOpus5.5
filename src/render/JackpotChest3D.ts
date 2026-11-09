import {
  AdditiveBlending,
  AmbientLight,
  BoxGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  PerspectiveCamera,
  PointLight,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { JackpotReward } from '../game/RogueJackpot';
import { JackpotReels3D } from './JackpotReels3D';

/** リール1本の絵柄の並びと、止まる位置 */
export interface ReelStrip {
  symbols: readonly JackpotReward[];
  winIndex: number;
}

/** リールの正面が来る奥行き（宝箱より手前） */
const REEL_PLANE_Z = 3.4;
const _ray = new Vector3();

const VOXEL = 0.2;
const W = 16;
const D = 11;
const BODY_H = 8;
const LID_H = 5;
const CAMERA_Z = 11;
const FOV = 36;
const MAX_LOOT = 520;
const APPEAR_TIME = 0.5;
const OPEN_TIME = 0.28;
const SETTLE_TIME = 0.4;
const OPEN_ANGLE = -2.0;
/** 開いた宝箱が落ち着く位置（リールの下から光が伸びて見える） */
const SETTLED_Y = -2.95;

const WOOD = [0x7a4a22, 0x8b5628, 0x6c3f1c];
const TRIM_COLORS = [0xc8803a, 0xe4edf7, 0xffcf33];
const BEAM_COLORS = [0xffb066, 0xbfe0ff, 0xfff0a0];
const GEM_COLORS = [0xff4d6d, 0x4dabf7, 0xb197fc, 0x69db7c, 0xffffff];
const GOLD = 0xffcf33;

interface Voxel {
  x: number;
  y: number;
  z: number;
  color: number;
  trim?: boolean;
}

interface Loot {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rotX: number;
  rotY: number;
  spin: number;
  life: number;
  coin: boolean;
}

const _dummy = new Object3D();
const _color = new Color();
const _zero = new Matrix4().makeScale(0, 0, 0);

function shade(color: number, seed: number): number {
  const k = 0.9 + ((seed * 7919) % 21) / 100;
  return _color.setHex(color).multiplyScalar(k).getHex();
}

function isBand(x: number): boolean {
  return x === 3 || x === 4 || x === W - 5 || x === W - 4;
}

function bodyVoxels(): Voxel[] {
  const list: Voxel[] = [];
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < BODY_H; y++) {
      for (let z = 0; z < D; z++) {
        const shell = x === 0 || x === W - 1 || z === 0 || z === D - 1 || y === 0;
        if (shell) {
          const corner = (x === 0 || x === W - 1) && (z === 0 || z === D - 1);
          const trim = corner || isBand(x) || y === BODY_H - 1 || y === 0;
          list.push({ x, y, z, trim, color: trim ? TRIM_COLORS[0] : shade(WOOD[y % WOOD.length], x * 3 + y * 5 + z) });
        } else if (y === BODY_H - 3 + ((x * 5 + z * 3) % 3)) {
          // 中に詰まった財宝
          list.push({ x, y, z, color: (x * 7 + z * 11) % 13 === 0 ? GEM_COLORS[(x + z) % GEM_COLORS.length] : shade(GOLD, x + z) });
        }
      }
    }
  }
  // 正面の錠前と宝石
  for (let x = 6; x <= 9; x++) {
    for (let y = BODY_H - 4; y < BODY_H; y++) {
      const center = (x === 7 || x === 8) && (y === BODY_H - 3 || y === BODY_H - 2);
      list.push({ x, y, z: D, trim: !center, color: center ? 0xff2d55 : TRIM_COLORS[0] });
    }
  }
  return list;
}

function lidHeight(z: number): number {
  const c = (D - 1) / 2;
  return Math.max(1, Math.round(LID_H * Math.sqrt(Math.max(0, 1 - ((z - c) / (c + 0.6)) ** 2))));
}

/** フタは蝶番（奥の上端）を原点にした座標で作る */
function lidVoxels(): Voxel[] {
  const list: Voxel[] = [];
  for (let x = 0; x < W; x++) {
    for (let z = 0; z < D; z++) {
      const h = lidHeight(z);
      for (let y = 0; y < h; y++) {
        const prevLower = z === 0 || z === D - 1 || lidHeight(z - 1) < h || lidHeight(z + 1) < h;
        const surface = y === h - 1 || x === 0 || x === W - 1 || ((z === 0 || z === D - 1) && y < h) || (prevLower && y >= Math.min(lidHeight(z - 1), lidHeight(z + 1)) - 1);
        if (!surface) continue;
        const trim = isBand(x) || x === 0 || x === W - 1 || y === 0;
        list.push({ x, y, z, trim, color: trim ? TRIM_COLORS[0] : shade(WOOD[z % WOOD.length], x * 3 + z * 5 + y) });
      }
    }
  }
  return list;
}

function buildMesh(voxels: readonly Voxel[], offset: { x: number; y: number; z: number }): { mesh: InstancedMesh; trim: number[] } {
  const geo = new BoxGeometry(VOXEL * 0.97, VOXEL * 0.97, VOXEL * 0.97);
  const mesh = new InstancedMesh(geo, new MeshLambertMaterial(), voxels.length);
  const trim: number[] = [];
  voxels.forEach((v, i) => {
    _dummy.position.set((v.x + offset.x) * VOXEL, (v.y + offset.y) * VOXEL, (v.z + offset.z) * VOXEL);
    _dummy.rotation.set(0, 0, 0);
    _dummy.scale.setScalar(1);
    _dummy.updateMatrix();
    mesh.setMatrixAt(i, _dummy.matrix);
    mesh.setColorAt(i, _color.setHex(v.color));
    if (v.trim) trim.push(i);
  });
  return { mesh, trim };
}

/**
 * ボーナス演出のボクセル宝箱と、飛び散る金貨・宝石を描く専用の 3D シーン。
 * 戦闘の描画とは別の canvas に描き、演出の間だけ動かす。
 */
export class JackpotChest3D {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(FOV, 1, 0.1, 60);
  private readonly chest = new Group();
  private readonly lid = new Group();
  private readonly body: InstancedMesh;
  private readonly lidMesh: InstancedMesh;
  private readonly bodyTrim: number[];
  private readonly lidTrim: number[];
  private readonly glow = new PointLight(0xffd070, 0, 16, 1.4);
  private readonly beams = new Group();
  private readonly beamMaterials: MeshBasicMaterial[] = [];
  private readonly lootMesh: InstancedMesh;
  private readonly loot: Array<Loot | null> = new Array(MAX_LOOT).fill(null);
  private lootCursor = 0;

  private t = 0;
  private originX = 0;
  private originY = 0;
  private pop = 0;
  private shakeLevel = 0;
  private openAt = -1;
  private settleAt = -1;
  private cameraShake = 0;
  readonly reels = new JackpotReels3D();

  constructor() {
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setClearColor(0x000000, 0);
    this.canvas = this.renderer.domElement;
    this.camera.position.set(0, 2.1, CAMERA_Z);
    this.camera.lookAt(0, 0, 0);

    this.scene.add(new AmbientLight(0xffffff, 1.5));
    const sun = new DirectionalLight(0xfff2d8, 2.6);
    sun.position.set(-3, 7, 8);
    this.scene.add(sun);
    this.glow.position.set(0, 1.4, 0);

    // 宝箱の中心が原点に来るよう、本体とフタをずらす
    const halfW = (W - 1) / 2;
    const halfD = (D - 1) / 2;
    const bodyParts = buildMesh(bodyVoxels(), { x: -halfW, y: -BODY_H / 2, z: -halfD });
    this.body = bodyParts.mesh;
    this.bodyTrim = bodyParts.trim;
    const lidParts = buildMesh(lidVoxels(), { x: -halfW, y: 0, z: 0 });
    this.lidMesh = lidParts.mesh;
    this.lidTrim = lidParts.trim;
    this.lid.add(this.lidMesh);
    this.lid.position.set(0, (BODY_H / 2) * VOXEL, -halfD * VOXEL);

    const beamGeo = new CylinderGeometry(1.15, 0.12, 13, 10, 1, true);
    beamGeo.translate(0, 6.5, 0);
    for (let i = 0; i < 7; i++) {
      const material = new MeshBasicMaterial({ transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false });
      this.beamMaterials.push(material);
      const beam = new Mesh(beamGeo, material);
      beam.rotation.z = (i - 3) * 0.3;
      this.beams.add(beam);
    }
    this.beams.position.y = (BODY_H / 2) * VOXEL;
    this.beams.visible = false;

    this.chest.add(this.body, this.lid, this.glow, this.beams);
    this.scene.add(this.chest);

    this.lootMesh = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshLambertMaterial(), MAX_LOOT);
    this.lootMesh.frustumCulled = false;
    for (let i = 0; i < MAX_LOOT; i++) {
      this.lootMesh.setMatrixAt(i, _zero);
      this.lootMesh.setColorAt(i, _color.setHex(GOLD));
    }
    this.scene.add(this.lootMesh, this.reels.root);
  }

  private halfHeight(): number {
    return Math.tan((FOV * Math.PI) / 360) * CAMERA_Z;
  }

  /** 画面座標を、奥行き z の平面上の座標へ変換する */
  private screenToWorld(px: number, py: number, z = 0): { x: number; y: number } {
    _ray.set((px / window.innerWidth) * 2 - 1, 1 - (py / window.innerHeight) * 2, 0.5).unproject(this.camera);
    _ray.sub(this.camera.position);
    const s = (z - this.camera.position.z) / _ray.z;
    return { x: this.camera.position.x + _ray.x * s, y: this.camera.position.y + _ray.y * s };
  }

  /** DOM のリール枠の位置に合わせて 3D のリールを並べる */
  layoutReels(rects: readonly DOMRect[], strips: readonly ReelStrip[], tier: number): void {
    const slots = rects.map((rect, i) => {
      const center = this.screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2, REEL_PLANE_Z);
      const left = this.screenToWorld(rect.left, rect.top + rect.height / 2, REEL_PLANE_Z);
      const top = this.screenToWorld(rect.left, rect.top, REEL_PLANE_Z);
      const bottom = this.screenToWorld(rect.left, rect.bottom, REEL_PLANE_Z);
      return {
        x: center.x,
        y: center.y,
        z: REEL_PLANE_Z,
        width: (center.x - left.x) * 2,
        rowHeight: (top.y - bottom.y) / 3,
        symbols: strips[i].symbols,
        winIndex: strips[i].winIndex,
      };
    });
    this.reels.layout(slots, TRIM_COLORS[tier], this.camera.position);
  }

  /** 3D の画面全体を揺らす */
  addShake(amount: number): void {
    this.cameraShake = Math.max(this.cameraShake, amount);
  }

  /** 演出の開始。撃破した敵の画面位置から飛んでくる */
  begin(originPx: number, originPy: number): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    this.reels.hide();
    this.cameraShake = 0;

    const origin = this.screenToWorld(originPx, originPy);
    this.originX = origin.x;
    this.originY = origin.y;
    this.t = 0;
    this.pop = 0;
    this.shakeLevel = 0.4;
    this.openAt = -1;
    this.settleAt = -1;
    this.chest.visible = true;
    this.lid.rotation.x = 0;
    this.glow.intensity = 0;
    this.beams.visible = false;
    this.loot.fill(null);
    for (let i = 0; i < MAX_LOOT; i++) this.lootMesh.setMatrixAt(i, _zero);
    this.setTier(0, false);
  }

  /** 宝箱の金具の色を格に合わせ、格上げのときは膨らませて破片を散らす */
  setTier(tier: number, withPop: boolean): void {
    _color.setHex(TRIM_COLORS[tier]);
    for (const i of this.bodyTrim) this.body.setColorAt(i, _color);
    for (const i of this.lidTrim) this.lidMesh.setColorAt(i, _color);
    if (this.body.instanceColor) this.body.instanceColor.needsUpdate = true;
    if (this.lidMesh.instanceColor) this.lidMesh.instanceColor.needsUpdate = true;
    for (const m of this.beamMaterials) m.color.setHex(BEAM_COLORS[tier]);
    this.glow.color.setHex(BEAM_COLORS[tier]);
    if (!withPop) return;
    this.pop = 1;
    this.shakeLevel = 0.4 + tier * 0.55;
    this.spawnFromChest(30 + tier * 26, 8);
  }

  /** フタを開け、光と財宝を噴き出させる */
  open(tier: number): void {
    if (this.openAt >= 0) return;
    this.openAt = this.t;
    this.settleAt = this.t + OPEN_TIME + 0.42;
    this.shakeLevel = 0;
    this.beams.visible = true;
    this.spawnFromChest(150 + tier * 90, 15);
  }

  /** 途中を飛ばして、開いて落ち着いた状態にする */
  snapOpen(): void {
    if (this.openAt < 0) {
      this.openAt = this.t;
      this.beams.visible = true;
    }
    this.openAt = this.t - OPEN_TIME;
    this.settleAt = this.t - SETTLE_TIME;
    this.shakeLevel = 0;
  }

  /** 画面上の位置から財宝を弾けさせる（リールが止まったときなど） */
  burstAt(px: number, py: number, count: number, power: number): void {
    const p = this.screenToWorld(px, py);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (4 + Math.random() * 10) * power;
      this.spawnLoot(p.x, p.y, 1.5, Math.cos(angle) * speed, Math.sin(angle) * speed + 4, 1 + Math.random() * 5);
    }
  }

  /** 画面の上から金貨を降らせる */
  rain(count: number): void {
    const h = this.halfHeight();
    const w = h * (window.innerWidth / window.innerHeight);
    for (let i = 0; i < count; i++) {
      this.spawnLoot((Math.random() * 2 - 1) * w * 1.1, h + 1, Math.random() * 3 - 1, (Math.random() - 0.5) * 2, -2 - Math.random() * 6, 0);
    }
  }

  private spawnFromChest(count: number, power: number): void {
    const top = this.chest.position.y + (BODY_H / 2) * VOXEL * this.chest.scale.y;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spread = Math.random() * 0.55 * power;
      this.spawnLoot(
        this.chest.position.x + (Math.random() - 0.5) * 1.6,
        top,
        this.chest.position.z + (Math.random() - 0.5),
        Math.cos(angle) * spread,
        (0.55 + Math.random() * 0.6) * power,
        Math.sin(angle) * spread + 1.5,
      );
    }
  }

  private spawnLoot(x: number, y: number, z: number, vx: number, vy: number, vz: number): void {
    const coin = Math.random() < 0.78;
    const index = this.lootCursor;
    this.lootCursor = (this.lootCursor + 1) % MAX_LOOT;
    this.loot[index] = {
      x,
      y,
      z,
      vx,
      vy,
      vz,
      coin,
      rotX: Math.random() * Math.PI,
      rotY: Math.random() * Math.PI,
      spin: 5 + Math.random() * 10,
      life: 2.2 + Math.random() * 1.4,
    };
    const color = coin ? shade(GOLD, index) : GEM_COLORS[Math.floor(Math.random() * GEM_COLORS.length)];
    this.lootMesh.setColorAt(index, _color.setHex(color));
    if (this.lootMesh.instanceColor) this.lootMesh.instanceColor.needsUpdate = true;
  }

  update(dt: number): void {
    this.t += dt;
    this.updateChest(dt);
    this.updateLoot(dt);
    this.reels.update(dt);
    this.cameraShake = Math.max(0, this.cameraShake - dt * 2.2);
    const baseX = this.camera.position.x;
    const baseY = this.camera.position.y;
    this.camera.position.x += (Math.random() - 0.5) * this.cameraShake;
    this.camera.position.y += (Math.random() - 0.5) * this.cameraShake;
    this.renderer.render(this.scene, this.camera);
    this.camera.position.set(baseX, baseY, CAMERA_Z);
  }

  private updateChest(dt: number): void {
    const appear = Math.min(1, this.t / APPEAR_TIME);
    const eased = 1 - Math.pow(1 - appear, 3);
    this.pop = Math.max(0, this.pop - dt * 3.4);

    const settle = this.settleAt >= 0 ? Math.min(1, Math.max(0, (this.t - this.settleAt) / SETTLE_TIME)) : 0;
    const settleEased = settle * settle * (3 - 2 * settle);
    const landing = appear < 1 ? 0 : Math.sin(Math.min(1, (this.t - APPEAR_TIME) / 0.22) * Math.PI) * 0.16 * (this.openAt < 0 ? 1 : 0);
    const jitter = this.shakeLevel * 0.05;
    this.chest.position.set(
      this.originX * (1 - eased) + (Math.random() - 0.5) * jitter,
      this.originY * (1 - eased) - 0.1 + SETTLED_Y * settleEased - landing + (Math.random() - 0.5) * jitter,
      0,
    );
    this.chest.scale.setScalar((0.15 + 0.95 * eased) * (1 + 0.28 * this.pop) * (1 + 0.1 * settleEased));
    const idle = -0.42 + Math.sin(this.t * 1.5) * 0.12;
    this.chest.rotation.set(0.04, idle * eased + (1 - eased) * Math.PI * 3 + (Math.random() - 0.5) * jitter, (Math.random() - 0.5) * jitter * 0.8);

    if (this.openAt < 0) return;
    const opening = Math.min(1, (this.t - this.openAt) / OPEN_TIME);
    // 勢いよく開いて少し跳ね返る
    const overshoot = opening < 1 ? 1 - Math.pow(1 - opening, 3) : 1 + Math.sin(Math.min(1, (this.t - this.openAt - OPEN_TIME) / 0.3) * Math.PI) * 0.08;
    this.lid.rotation.x = OPEN_ANGLE * overshoot;
    this.glow.intensity = 60 * opening * (0.85 + Math.sin(this.t * 12) * 0.15);
    this.beams.rotation.y = this.t * 0.9;
    this.beamMaterials.forEach((m, i) => {
      m.opacity = opening * (0.2 + Math.sin(this.t * 5 + i * 1.7) * 0.07);
    });
    // 開いている間は財宝が湧き続ける
    if (this.t - this.openAt > OPEN_TIME && Math.random() < dt * 34) this.spawnFromChest(1, 12);
  }

  private updateLoot(dt: number): void {
    for (let i = 0; i < MAX_LOOT; i++) {
      const p = this.loot[i];
      if (!p) continue;
      p.life -= dt;
      if (p.life <= 0 || p.y < -this.halfHeight() - 2) {
        this.loot[i] = null;
        this.lootMesh.setMatrixAt(i, _zero);
        continue;
      }
      p.vy -= 17 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.rotX += p.spin * dt;
      p.rotY += p.spin * 0.7 * dt;
      _dummy.position.set(p.x, p.y, p.z);
      _dummy.rotation.set(p.rotX, p.rotY, 0);
      if (p.coin) _dummy.scale.set(0.3, 0.3, 0.08);
      else _dummy.scale.setScalar(0.2);
      _dummy.updateMatrix();
      this.lootMesh.setMatrixAt(i, _dummy.matrix);
    }
    this.lootMesh.instanceMatrix.needsUpdate = true;
  }
}
