import {
  AmbientLight,
  Box3,
  DirectionalLight,
  Mesh,
  type Object3D,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { Unit } from '../units/Unit';
import { UNIT_TYPES, type UnitTypeId } from '../units/UnitTypes';
import { createRewardPropMesh } from './RewardVoxelModels';
import { VoxelCharacterVisual } from './VoxelModel';

/** 物理の刻み（秒） */
const STEP = 1 / 60;
/** カードの更新間隔（秒） */
const FRAME = 1 / 30;
/** 共有レンダラーの描画サイズ（px）。各カードへはこの絵を縮小して写す */
const RENDER_PX = 384;
const FOV = 24;
/** 正面やや右上から見下ろす向き */
const VIEW_DIR = new Vector3(0.58, 0.3, 0.76).normalize();
/** 歩く速さの上限（速い兵種が足踏みだけで暴れないように） */
const MAX_WALK_SPEED = 1.8;
const SETTLE_STEPS = 45;
/** 普段の体の向き。マウスを乗せるとカメラの方へ振り向く */
const IDLE_FACING = -0.3;
const CAMERA_FACING = Math.atan2(VIEW_DIR.x, VIEW_DIR.z);
/** 振り向きの速さ（1秒あたりの追従率） */
const TURN_RATE = 9;

/** ゴールドやレリックの揺れの速さと振れ幅、触れたときの回転の速さ（ラジアン毎秒） */
const PROP_SWAY_SPEED = 0.9;
const PROP_SWAY_ANGLE = 0.4;
const PROP_SPIN_SPEED = 9;

/** モデルの表示先。兵種は data-unit-preview、ゴールドやレリックは data-prop-preview */
const PREVIEW_SELECTOR = '[data-unit-preview], [data-prop-preview]';

function previewKey(host: HTMLElement): string {
  return host.dataset.unitPreview ?? host.dataset.propPreview ?? '';
}

const _center = new Vector3();

/** 1体ぶんの、カード上で動き続けるモデル（描画なしで動かせる） */
export class UnitPreviewActor {
  readonly unit: Unit;
  readonly world = new PhysicsWorld();
  private swingTimer: number;
  private accumulator = 0;
  private looking = false;

  constructor(
    readonly id: UnitTypeId,
    private readonly still = false,
  ) {
    this.unit = new Unit(this.world, UNIT_TYPES[id], 0, new Vector3(0, 0, 0), IDLE_FACING);
    this.swingTimer = 1.5 + Math.random() * 3.5;
    for (let i = 0; i < SETTLE_STEPS; i++) this.step(STEP);
  }

  private get walkSpeed(): number {
    return this.still || this.looking ? 0 : Math.min(MAX_WALK_SPEED, UNIT_TYPES[this.id].speed * 0.5) * Math.max(0.6, this.unit.scale * 0.6);
  }

  /** 攻撃の構えから振り抜きまでを1回行う */
  swing(): void {
    if (this.still || this.unit.attackPhase !== 'none') return;
    this.unit.attackPhase = 'windup';
    this.unit.phaseTime = 0;
  }

  /** true の間は足を止めてカメラの方を向く */
  setLooking(looking: boolean): void {
    this.looking = looking;
  }

  private updateFacing(dt: number): void {
    const target = this.looking ? CAMERA_FACING : IDLE_FACING;
    this.unit.facing += (target - this.unit.facing) * (1 - Math.exp(-TURN_RATE * dt));
  }

  private updateAttack(dt: number): void {
    const u = this.unit;
    if (u.attackPhase === 'none') {
      if (this.looking) return;
      this.swingTimer -= dt;
      if (this.swingTimer <= 0) {
        this.swingTimer = 2.5 + Math.random() * 4;
        this.swing();
      }
      return;
    }
    u.phaseTime += dt;
    if (u.attackPhase === 'windup' && u.phaseTime >= Math.min(0.5, u.type.windup)) {
      u.attackPhase = 'strike';
      u.phaseTime = 0;
    } else if (u.attackPhase === 'strike' && u.phaseTime >= 0.28) {
      u.attackPhase = 'none';
      u.phaseTime = 0;
    }
  }

  private step(dt: number): void {
    this.updateFacing(dt);
    this.updateAttack(dt);
    this.unit.previewStep(dt, this.walkSpeed);
    this.world.step(dt);
    // 歩いても画面から外れないよう、全身をランニングマシンのように原点へ戻す
    const { x, z } = this.unit.pelvis.pos;
    for (const p of this.world.particles) {
      p.pos.x -= x;
      p.pos.z -= z;
      p.prev.x -= x;
      p.prev.z -= z;
    }
    // 床を抜けて落ち続けると絵が空になるので、落ちたら地面の高さへ戻して落下を止める
    if (this.unit.pelvis.pos.y < -0.5) {
      const lowest = Math.min(...this.world.particles.map((p) => p.pos.y));
      for (const p of this.world.particles) {
        p.pos.y -= lowest;
        p.prev.y = p.pos.y;
      }
    }
  }

  advance(dt: number): void {
    this.accumulator = Math.min(this.accumulator + dt, STEP * 4);
    while (this.accumulator >= STEP) {
      this.step(STEP);
      this.accumulator -= STEP;
    }
  }
}

interface PreviewModel {
  object: Object3D;
  center: Vector3;
  distance: number;
  advance(dt: number): void;
  kick(): void;
  setHovered(hovered: boolean): void;
}

interface PreviewSlot {
  id: string;
  host: HTMLElement;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  placements: SquadPlacement[];
}

/** 部隊の1体を描く位置（キャンバスの座標） */
export interface SquadPlacement {
  x: number;
  y: number;
  size: number;
}

/** 隣の個体と重ねてよい下限の間隔（1体の大きさに対する比） */
const MIN_STEP_X = 0.62;
const MIN_STEP_Y = 0.4;
/** 場所に余裕があるときの間隔の上限 */
const MAX_STEP_X = 0.9;
const MAX_STEP_Y = 0.6;
const MAX_SQUAD_ROWS = 4;

/**
 * count 体を幅 w・高さ h に並べる。1体が最も大きくなる列数を選ぶ。
 * 奥の列から順に返すので、この順に描けば手前の個体が上に重なる。
 */
export function layoutSquad(count: number, w: number, h: number): SquadPlacement[] {
  const n = Math.max(1, Math.floor(count));
  let rows = 1;
  let size = 0;
  for (let r = 1; r <= Math.min(n, MAX_SQUAD_ROWS); r++) {
    const cols = Math.ceil(n / r);
    const s = Math.min(w / (1 + (cols - 1) * MIN_STEP_X), h / (1 + (r - 1) * MIN_STEP_Y));
    if (s > size) {
      size = s;
      rows = r;
    }
  }
  const cols = Math.ceil(n / rows);
  const stepX = cols > 1 ? Math.min(size * MAX_STEP_X, (w - size) / (cols - 1)) : 0;
  const stepY = rows > 1 ? Math.min(size * MAX_STEP_Y, (h - size) / (rows - 1)) : 0;
  const top = (h - size - (rows - 1) * stepY) / 2;
  const placements: SquadPlacement[] = [];
  for (let r = 0; r < rows; r++) {
    // 端数は手前の列に回す
    const inRow = Math.floor(n / rows) + (r >= rows - (n % rows) ? 1 : 0);
    const left = (w - size - (inRow - 1) * stepX) / 2;
    for (let i = 0; i < inRow; i++) placements.push({ x: left + i * stepX, y: top + r * stepY, size });
  }
  return placements;
}

/**
 * カードの中でボクセルモデルを動かす。
 * WebGL は1つのレンダラーを共有し、描いた絵を各カードの 2D キャンバスへ写す。
 * 画面が作り直されてもモデルは兵種ごとに保持するので、動きは途切れない。
 */
export class UnitPreviews {
  private renderer: WebGLRenderer | null = null;
  private failed = false;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(FOV, 1, 0.1, 300);
  private readonly models = new Map<string, PreviewModel>();
  private readonly still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  private slots: PreviewSlot[] = [];
  private root: HTMLElement | null = null;
  private frameTimer = 0;
  private hoveredId: string | null = null;

  constructor() {
    this.scene.add(new AmbientLight(0xffffff, 1.5));
    const sun = new DirectionalLight(0xfff2d8, 2.4);
    sun.position.set(4, 9, 8);
    this.scene.add(sun);
  }

  private ensureRenderer(): WebGLRenderer | null {
    if (this.renderer || this.failed) return this.renderer;
    try {
      const renderer = new WebGLRenderer({ antialias: true, alpha: true });
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = SRGBColorSpace;
      renderer.setPixelRatio(1);
      renderer.setSize(RENDER_PX, RENDER_PX, false);
      this.renderer = renderer;
    } catch {
      // WebGL が使えない環境では、下に敷いたアイコンのまま表示する
      this.failed = true;
    }
    return this.renderer;
  }

  /** root の中の [data-unit-preview] をモデルの表示先にする */
  bind(root: HTMLElement): void {
    this.root = root;
    this.setHovered(null);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.slots = [];
    for (const host of root.querySelectorAll<HTMLElement>(PREVIEW_SELECTOR)) {
      const canvas = host.querySelector('canvas');
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) continue;
      const cssW = Math.max(1, host.clientWidth);
      const cssH = Math.max(1, host.clientHeight);
      const count = Number(host.dataset.unitCount) || 1;
      // 1体だけなら元の絵より細かくしても意味がない
      const scale = count > 1 ? dpr : Math.min(dpr, RENDER_PX / Math.max(cssW, cssH));
      canvas.width = Math.round(cssW * scale);
      canvas.height = Math.round(cssH * scale);
      const placements = layoutSquad(count, canvas.width, canvas.height);
      const id = previewKey(host);
      this.slots.push({ id, host, canvas, ctx, placements });
      if (this.models.has(id)) host.classList.add('ready');
    }
    root.onpointerover = (e) => {
      const host = (e.target as HTMLElement).closest<HTMLElement>(PREVIEW_SELECTOR);
      if (host && !host.contains(e.relatedTarget as Node | null)) this.setHovered(previewKey(host));
    };
    root.onpointerout = (e) => {
      const host = (e.target as HTMLElement).closest<HTMLElement>(PREVIEW_SELECTOR);
      if (host && !host.contains(e.relatedTarget as Node | null)) this.setHovered(null);
    };
    // 開いた瞬間に絵が出るよう、すでに作ってあるモデルはすぐ描く
    this.frameTimer = FRAME;
  }

  unbind(): void {
    this.setHovered(null);
    if (this.root) {
      this.root.onpointerover = null;
      this.root.onpointerout = null;
    }
    this.root = null;
    this.slots = [];
  }

  /** モデルに反応させる（ゴールドなどの回転） */
  kick(id: string): void {
    this.models.get(id)?.kick();
  }

  private setHovered(id: string | null): void {
    if (id === this.hoveredId) return;
    if (this.hoveredId) this.models.get(this.hoveredId)?.setHovered(false);
    this.hoveredId = id;
    if (id) this.models.get(id)?.setHovered(true);
  }

  /** 枠に収まる距離を、実際に見えている形から決める */
  private frame(object: Object3D): Pick<PreviewModel, 'center' | 'distance'> {
    object.updateMatrixWorld(true);
    const box = new Box3();
    object.traverseVisible((o) => {
      if (o instanceof Mesh) box.expandByObject(o);
    });
    object.visible = false;
    const center = box.getCenter(new Vector3());
    const radius = Math.max(0.6, box.getSize(_center).length() / 2);
    return { center, distance: (radius * 1.12) / Math.sin((FOV / 2) * (Math.PI / 180)) };
  }

  private createUnitModel(id: UnitTypeId): PreviewModel {
    const actor = new UnitPreviewActor(id, this.still);
    const visual = new VoxelCharacterVisual(actor.unit);
    visual.sync();
    this.scene.add(visual.group);
    return {
      object: visual.group,
      ...this.frame(visual.group),
      advance: (dt) => {
        actor.advance(dt);
        visual.sync();
      },
      kick: () => actor.swing(),
      setHovered: (hovered) => actor.setLooking(hovered),
    };
  }

  /** ゴールドやレリックのモデル。正面をカメラへ向けて左右にゆっくり揺らし、触れると1回転する */
  private createPropModel(key: string): PreviewModel {
    const mesh = createRewardPropMesh(key);
    this.scene.add(mesh);
    const framing = this.frame(mesh);
    const facing = Math.atan2(VIEW_DIR.x, VIEW_DIR.z);
    let time = Math.random() * 6;
    let spin = 0;
    const kick = () => {
      if (!this.still && spin === 0) spin = Math.PI * 2;
    };
    const pose = () => {
      mesh.rotation.y = facing + (this.still ? 0 : Math.sin(time * PROP_SWAY_SPEED) * PROP_SWAY_ANGLE) + spin;
    };
    pose();
    return {
      object: mesh,
      ...framing,
      advance: (dt) => {
        time += dt;
        if (spin > 0) spin = Math.max(0, spin - dt * PROP_SPIN_SPEED);
        pose();
      },
      kick,
      setHovered: (hovered) => {
        if (hovered) kick();
      },
    };
  }

  private createModel(id: string): PreviewModel {
    return id in UNIT_TYPES ? this.createUnitModel(id as UnitTypeId) : this.createPropModel(id);
  }

  /** 毎フレーム呼ぶ */
  update(realDt: number): void {
    if (this.slots.length === 0) return;
    this.frameTimer += realDt;
    if (this.frameTimer < FRAME) return;
    const dt = Math.min(0.1, this.frameTimer);
    this.frameTimer = 0;
    const renderer = this.ensureRenderer();
    if (!renderer) return;

    // モデルの生成は重いので1フレームに1体まで
    const missing = this.slots.find((s) => !this.models.has(s.id));
    if (missing) {
      this.models.set(missing.id, this.createModel(missing.id));
      for (const s of this.slots) if (s.id === missing.id) s.host.classList.add('ready');
    }

    const view = this.root?.querySelector('.rogue-modal-inner')?.getBoundingClientRect();
    const drawn = new Set<string>();
    for (const slot of this.slots) {
      const model = this.models.get(slot.id);
      if (!model) continue;
      const rect = slot.host.getBoundingClientRect();
      if (view && (rect.bottom < view.top || rect.top > view.bottom)) continue;
      if (!drawn.has(slot.id)) {
        drawn.add(slot.id);
        model.advance(dt);
        model.object.visible = true;
        this.camera.position.copy(model.center).addScaledVector(VIEW_DIR, model.distance);
        this.camera.lookAt(model.center);
        renderer.render(this.scene, this.camera);
        model.object.visible = false;
        // 同じ兵種のカードが複数あれば同じ絵を写す
        for (const s of this.slots) {
          if (s.id !== slot.id) continue;
          s.ctx.clearRect(0, 0, s.canvas.width, s.canvas.height);
          for (const p of s.placements) s.ctx.drawImage(renderer.domElement, p.x, p.y, p.size, p.size);
        }
      }
    }
  }
}
