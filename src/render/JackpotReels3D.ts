import { BoxGeometry, Color, Group, InstancedMesh, Matrix4, MeshLambertMaterial, Object3D } from 'three';
import type { JackpotReward } from '../game/RogueJackpot';
import { JACKPOT_ICONS, JACKPOT_ICON_PALETTE, JACKPOT_ICON_SIZE } from './JackpotIcons';

/** ドラムの面の数 */
const FACES = 12;
const FACE_ANGLE = (Math.PI * 2) / FACES;
const MAX_INSTANCES = FACES * (JACKPOT_ICON_SIZE * JACKPOT_ICON_SIZE + 1);
const MAX_REELS = 5;
/** 枠の横幅をボクセル何個分に割るか */
const FRAME_COLUMNS = 15;
const FRAME_DEPTH = 3;
const PANEL_COLORS = [0x1b2230, 0x16385c, 0x3a2a70, 0x7a5a10];
const LAND_COLORS = [0xced4da, 0x4dabf7, 0xb197fc, 0xffcf33];
const REACH_COLOR = 0xff3b4e;

/** リール1本ぶんの配置（ワールド座標）と絵柄 */
export interface ReelSlot {
  x: number;
  y: number;
  z: number;
  width: number;
  /** 1コマの高さ */
  rowHeight: number;
  symbols: readonly JackpotReward[];
  winIndex: number;
}

interface ReelView {
  group: Group;
  drum: Group;
  faces: InstancedMesh;
  frame: InstancedMesh;
  baseX: number;
  intro: number;
  pop: number;
  reach: boolean;
  landed: number;
}

const _dummy = new Object3D();
const _face = new Matrix4();
const _cell = new Matrix4();
const _color = new Color();

/**
 * ボクセルの絵柄が付いた回転ドラムと、それを囲むボクセルの枠。
 * JackpotChest3D のシーンの中に置く。
 */
export class JackpotReels3D {
  readonly root = new Group();
  private readonly views: ReelView[] = [];
  private tierColor = LAND_COLORS[0];
  private t = 0;

  constructor() {
    const unit = new BoxGeometry(1, 1, 1);
    for (let i = 0; i < MAX_REELS; i++) {
      const faces = new InstancedMesh(unit, new MeshLambertMaterial(), MAX_INSTANCES);
      const frame = new InstancedMesh(unit, new MeshLambertMaterial(), 900);
      faces.frustumCulled = false;
      frame.frustumCulled = false;
      const drum = new Group();
      drum.add(faces);
      const group = new Group();
      group.add(drum, frame);
      group.visible = false;
      this.root.add(group);
      this.views.push({ group, drum, faces, frame, baseX: 0, intro: 0, pop: 0, reach: false, landed: -1 });
    }
  }

  hide(): void {
    for (const view of this.views) view.group.visible = false;
  }

  /** リールを配置し、止まる直前に見える絵柄をドラムの面に貼る */
  layout(slots: readonly ReelSlot[], tierColor: number, camera: { y: number; z: number }): void {
    this.tierColor = tierColor;
    this.views.forEach((view, i) => {
      const slot = slots[i];
      view.group.visible = Boolean(slot);
      if (!slot) return;
      view.baseX = slot.x;
      view.group.position.set(slot.x, slot.y, slot.z);
      // 見下ろすカメラに正対させ、ドラムが枠からはみ出さないようにする
      view.group.rotation.x = -Math.atan2(camera.y - slot.y, camera.z - slot.z);
      view.group.scale.setScalar(0.001);
      view.intro = 0;
      view.pop = 0;
      view.reach = false;
      view.landed = -1;
      const radius = slot.rowHeight / (2 * Math.tan(FACE_ANGLE / 2));
      view.drum.position.z = -radius;
      this.buildFaces(view, slot, radius);
      this.buildFrame(view, slot);
      this.setPosition(i, 0);
    });
  }

  private buildFaces(view: ReelView, slot: ReelSlot, radius: number): void {
    const panelWidth = (slot.width / FRAME_COLUMNS) * (FRAME_COLUMNS - 2) * 0.96;
    const voxel = (Math.min(panelWidth, slot.rowHeight) * 0.8) / JACKPOT_ICON_SIZE;
    let count = 0;
    // 止まる位置の前後が見えるので、最後の一周ぶんの絵柄を面に割り当てる
    for (let k = slot.symbols.length - FACES; k < slot.symbols.length; k++) {
      const reward = slot.symbols[k];
      const angle = (k % FACES) * FACE_ANGLE;
      _dummy.position.set(0, -Math.sin(angle) * radius, Math.cos(angle) * radius);
      _dummy.rotation.set(angle, 0, 0);
      _dummy.scale.setScalar(1);
      _dummy.updateMatrix();
      _face.copy(_dummy.matrix);

      _dummy.position.set(0, 0, 0);
      _dummy.rotation.set(0, 0, 0);
      _dummy.scale.set(panelWidth, slot.rowHeight * 0.97, 0.05);
      _dummy.updateMatrix();
      view.faces.setMatrixAt(count, _cell.multiplyMatrices(_face, _dummy.matrix));
      view.faces.setColorAt(count, _color.setHex(PANEL_COLORS[reward.rarity]));
      count++;

      const rows = JACKPOT_ICONS[reward.id];
      const filled = (r: number, c: number): boolean => (rows[r]?.[c] ?? '.') !== '.';
      for (let r = 0; r < rows.length; r++) {
        for (let c = 0; c < rows[r].length; c++) {
          if (!filled(r, c)) continue;
          // 内側ほど厚くして、ふっくらした立体にする
          const inner = filled(r - 1, c) && filled(r + 1, c) && filled(r, c - 1) && filled(r, c + 1);
          const depth = (inner ? 3 : 2) * voxel;
          const half = (JACKPOT_ICON_SIZE - 1) / 2;
          _dummy.position.set((c - half) * voxel, (half - r) * voxel, depth / 2);
          _dummy.scale.set(voxel * 0.97, voxel * 0.97, depth);
          _dummy.updateMatrix();
          view.faces.setMatrixAt(count, _cell.multiplyMatrices(_face, _dummy.matrix));
          view.faces.setColorAt(count, _color.setHex(JACKPOT_ICON_PALETTE[rows[r][c]] ?? 0xffffff));
          count++;
        }
      }
    }
    view.faces.count = count;
    view.faces.instanceMatrix.needsUpdate = true;
    if (view.faces.instanceColor) view.faces.instanceColor.needsUpdate = true;
  }

  private buildFrame(view: ReelView, slot: ReelSlot): void {
    const s = slot.width / FRAME_COLUMNS;
    const halfCols = (FRAME_COLUMNS - 1) / 2;
    const halfRows = Math.round((slot.rowHeight * 1.4) / s);
    let count = 0;
    const put = (col: number, row: number, layer: number): void => {
      _dummy.position.set(col * s, row * s, 0.14 - layer * s);
      _dummy.rotation.set(0, 0, 0);
      _dummy.scale.setScalar(s * 0.96);
      _dummy.updateMatrix();
      view.frame.setMatrixAt(count++, _dummy.matrix);
    };
    for (let layer = 0; layer < FRAME_DEPTH; layer++) {
      for (let col = -halfCols; col <= halfCols; col++) {
        put(col, halfRows, layer);
        put(col, -halfRows, layer);
      }
      for (let row = -halfRows + 1; row < halfRows; row++) {
        put(-halfCols, row, layer);
        put(halfCols, row, layer);
      }
    }
    // 当たりの段を示す左右の爪
    put(-halfCols + 1, 0, 0);
    put(halfCols - 1, 0, 0);
    view.frame.count = count;
    view.frame.instanceMatrix.needsUpdate = true;
    this.paintFrame(view, this.tierColor);
  }

  private paintFrame(view: ReelView, color: number): void {
    _color.setHex(color);
    this.fillFrame(view);
  }

  /** いまの _color で枠全体を塗る */
  private fillFrame(view: ReelView): void {
    for (let i = 0; i < view.frame.count; i++) view.frame.setColorAt(i, _color);
    if (view.frame.instanceColor) view.frame.instanceColor.needsUpdate = true;
  }

  /** ドラムを回す。pos は正面に来ている絵柄の番号 */
  setPosition(index: number, pos: number): void {
    const view = this.views[index];
    if (view) view.drum.rotation.x = -pos * FACE_ANGLE;
  }

  setReach(index: number, on: boolean): void {
    const view = this.views[index];
    if (!view) return;
    view.reach = on;
    this.paintFrame(view, on ? REACH_COLOR : this.tierColor);
  }

  /** リールが止まったときに跳ねさせ、枠をレア度の色にする */
  land(index: number, rarity: number): void {
    const view = this.views[index];
    if (!view) return;
    view.reach = false;
    view.landed = rarity;
    view.pop = 1;
    this.paintFrame(view, LAND_COLORS[rarity]);
  }

  /** ハズレで止まったように見せるときの小さな跳ね */
  nudge(index: number): void {
    const view = this.views[index];
    if (view) view.pop = 0.45;
  }

  update(dt: number): void {
    this.t += dt;
    for (const view of this.views) {
      if (!view.group.visible) continue;
      view.intro = Math.min(1, view.intro + dt / 0.28);
      view.pop = Math.max(0, view.pop - dt * 4.2);
      // 少し行き過ぎてから収まる
      const u = view.intro - 1;
      const appear = 1 + 2.4 * u * u * u + 1.4 * u * u;
      view.group.scale.setScalar(Math.max(0.001, appear) * (1 + 0.14 * view.pop));
      view.group.position.x = view.baseX + (view.reach ? (Math.random() - 0.5) * 0.05 : 0);
      if (view.landed === 3) {
        _color.setHSL((this.t * 1.6) % 1, 1, 0.62);
        this.fillFrame(view);
      }
    }
  }
}
