import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Mesh,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
} from 'three';
import type { ProjectileKind } from '../combat/CombatSystem';
import type { FacilityTypeId } from '../facilities/FacilityTypes';
import type { Particle } from '../physics/Particle';
import { J } from '../units/Skeleton';
import type { Unit } from '../units/Unit';
import { TEAM_COLORS, type Team, type UnitType, type UnitTypeId, type WeaponKind } from '../units/UnitTypes';

/** 損壊によって剥がれ落ちる不透明ボクセル 1 個分の初期データ */
export interface DroppedVoxelSeed {
  pos: Vector3;
  color: number;
  size: number;
}

/**
 * 3D ボクセルグリッドから頂点カラー付きの単一 BufferGeometry を生成するビルダー。
 * 隣接セルに隠れる内側の面をカリングすることで軽量なボクセルメッシュを作る。
 */
export class VoxelGrid {
  readonly data: Int32Array;

  constructor(
    readonly sx: number,
    readonly sy: number,
    readonly sz: number,
    source?: Int32Array,
  ) {
    this.data = source ? new Int32Array(source) : new Int32Array(sx * sy * sz);
  }

  /** グリッドのディープコピーを返す（部位破壊・欠損で個別編集するため） */
  clone(): VoxelGrid {
    return new VoxelGrid(this.sx, this.sy, this.sz, this.data);
  }

  private idx(x: number, y: number, z: number): number {
    return x + this.sx * (y + this.sy * z);
  }

  set(x: number, y: number, z: number, color: number): void {
    if (x < 0 || x >= this.sx || y < 0 || y >= this.sy || z < 0 || z >= this.sz) return;
    this.data[this.idx(x, y, z)] = color;
  }

  get(x: number, y: number, z: number): number {
    if (x < 0 || x >= this.sx || y < 0 || y >= this.sy || z < 0 || z >= this.sz) return 0;
    return this.data[this.idx(x, y, z)];
  }

  /** 直方体領域を塗りつぶす（x1, y1, z1 を含む） */
  fillBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: number): void {
    for (let z = z0; z <= z1; z++) {
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          this.set(x, y, z, color);
        }
      }
    }
  }

  /** 残存している非空ボクセルの総数を返す */
  countFilled(): number {
    let n = 0;
    for (let i = 0; i < this.data.length; i++) {
      if (this.data[i] !== 0) n++;
    }
    return n;
  }

  /**
   * ボクセルデータを BufferGeometry に変換する。
   * @param voxelSize 1 ボクセルのワールド寸法
   * @param pivot グリッド内の原点位置（省略時は底面中央 [sx/2, 0, sz/2]）
   */
  toGeometry(voxelSize: number, pivot?: readonly [number, number, number]): BufferGeometry {
    const px = pivot ? pivot[0] : this.sx / 2;
    const py = pivot ? pivot[1] : 0;
    const pz = pivot ? pivot[2] : this.sz / 2;

    const positions: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const col = new Color();

    // 6 方向の面定義: [法線, 4頂点のオフセット, 面ごとの明暗シェード]
    const faces: ReadonlyArray<{
      dir: readonly [number, number, number];
      corners: ReadonlyArray<readonly [number, number, number]>;
      shade: number;
    }> = [
      { dir: [1, 0, 0], corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], shade: 0.92 },
      { dir: [-1, 0, 0], corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], shade: 0.86 },
      { dir: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], shade: 1.0 },
      { dir: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], shade: 0.72 },
      { dir: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], shade: 0.96 },
      { dir: [0, 0, -1], corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], shade: 0.82 },
    ];

    for (let z = 0; z < this.sz; z++) {
      for (let y = 0; y < this.sy; y++) {
        for (let x = 0; x < this.sx; x++) {
          const c = this.get(x, y, z);
          if (c === 0) continue;
          col.setHex(c);
          // ボクセルごとに微妙な色ムラを入れて立体感を出す
          const jitter = 0.96 + (((x * 73 + y * 151 + z * 283) & 15) / 15) * 0.08;
          for (const f of faces) {
            if (this.get(x + f.dir[0], y + f.dir[1], z + f.dir[2]) !== 0) continue;
            const base = positions.length / 3;
            const s = f.shade * jitter;
            for (const corner of f.corners) {
              positions.push(
                (x + corner[0] - px) * voxelSize,
                (y + corner[1] - py) * voxelSize,
                (z + corner[2] - pz) * voxelSize,
              );
              normals.push(f.dir[0], f.dir[1], f.dir[2]);
              colors.push(col.r * s, col.g * s, col.b * s);
            }
            indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
          }
        }
      }
    }

    const geom = new BufferGeometry();
    geom.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    geom.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
    geom.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
    geom.setIndex(indices);
    return geom;
  }
}

// ---------------------------------------------------------------
// 部位ごとのボクセルテンプレートとキャッシュ
// ---------------------------------------------------------------

interface VoxelPartTemplate {
  grid: VoxelGrid;
  voxelSize: number;
  pivot: readonly [number, number, number];
  geometry: BufferGeometry;
}

interface UnitTemplateSet {
  head: VoxelPartTemplate;
  torso: VoxelPartTemplate;
  upperArm: VoxelPartTemplate;
  forearm: VoxelPartTemplate;
  thigh: VoxelPartTemplate;
  shin: VoxelPartTemplate;
  weapon: BufferGeometry | null;
  bow: BufferGeometry | null;
}

const templateCache = new Map<string, UnitTemplateSet>();

function makeTemplate(
  grid: VoxelGrid,
  voxelSize: number,
  pivot: readonly [number, number, number],
): VoxelPartTemplate {
  return {
    grid,
    voxelSize,
    pivot,
    geometry: grid.toGeometry(voxelSize, pivot),
  };
}

function buildHeadTemplate(type: UnitType, team: Team): VoxelPartTemplate {
  const look = type.look;
  const tc = TEAM_COLORS[team];
  const eyeWhite = 0xffffff;
  const pupil = 0x181820;

  if (type.id === 'sezain') {
    // セザイン: 黒バイカーヘルメット＋偏光スモークシールド＋チームカラーレーシングライン
    const g = new VoxelGrid(10, 10, 10);
    g.fillBox(1, 1, 1, 8, 9, 8, 0x212529);
    g.fillBox(4, 3, 0, 5, 9, 1, tc.shirt);
    g.fillBox(4, 9, 1, 5, 9, 8, tc.shirt);
    g.fillBox(2, 3, 8, 7, 6, 9, 0x0f172a);
    g.fillBox(3, 4, 9, 6, 5, 9, 0x38bdf8);
    g.fillBox(2, 1, 7, 7, 2, 9, 0x18181b);
    g.fillBox(4, 1, 9, 5, 2, 9, 0x475569);
    return makeTemplate(g, 0.042, [4.5, 4.0, 4.5]);
  }

  if (type.id === 'yamamuron') {
    // ヤマムロン: 山頂に漂う噴煙と霊峰の白雲
    const g = new VoxelGrid(12, 8, 12);
    g.fillBox(2, 0, 2, 9, 4, 9, 0xd1d5db);
    g.fillBox(3, 2, 3, 8, 6, 8, 0xffffff);
    g.fillBox(4, 4, 4, 7, 7, 7, 0xf3f4f6);
    return makeTemplate(g, 0.065, [6, 2, 6]);
  }

  if (type.id === 'hongon') {
    // ホンゴン: クラシック音楽の巨匠（豊かな銀白ウェーブヘア＋真剣なまなざし）
    const g = new VoxelGrid(10, 10, 10);
    const skin = type.look.skin;
    const maestroHair = 0xd0d5dd;
    const maestroHairHighlight = 0xf1f5f9;
    g.fillBox(2, 1, 2, 7, 7, 7, skin);
    g.fillBox(2, 4, 8, 7, 4, 8, 0x334155);
    g.set(3, 4, 8, 0x1e293b);
    g.set(6, 4, 8, 0x1e293b);
    g.set(3, 3, 8, 0x0f172a);
    g.set(6, 3, 8, 0x0f172a);
    g.fillBox(1, 2, 1, 1, 8, 7, maestroHair);
    g.fillBox(8, 2, 1, 8, 8, 7, maestroHair);
    g.fillBox(2, 1, 1, 7, 8, 1, maestroHair);
    g.fillBox(1, 7, 1, 8, 9, 8, maestroHairHighlight);
    g.fillBox(2, 6, 8, 7, 8, 8, maestroHair);
    return makeTemplate(g, 0.045, [4.5, 4.0, 4.5]);
  }

  // 1. 鎧戦象の頭部（大きな耳・兜・長い鼻）
  if (type.id === 'warelephant') {
    const g = new VoxelGrid(13, 11, 12);
    // 頭部本体
    g.fillBox(3, 2, 2, 9, 8, 8, look.skin);
    // 左右の大きな象の耳
    g.fillBox(0, 2, 3, 2, 7, 5, 0x686d76);
    g.fillBox(10, 2, 3, 12, 7, 5, 0x686d76);
    // 黄金の戦兜・額当て
    g.fillBox(3, 8, 2, 9, 9, 8, 0xd4af37);
    g.fillBox(5, 5, 8, 7, 8, 9, 0xd4af37);
    g.fillBox(5, 9, 4, 7, 10, 7, tc.shirt);
    // 垂れ下がる鼻と左右の牙の根元
    g.fillBox(5, 0, 8, 7, 5, 11, look.skin);
    g.fillBox(3, 1, 8, 4, 2, 11, 0xfaf8f0);
    g.fillBox(8, 1, 8, 9, 2, 11, 0xfaf8f0);
    // 目
    g.fillBox(3, 5, 8, 4, 6, 8, eyeWhite);
    g.fillBox(8, 5, 8, 9, 6, 8, eyeWhite);
    g.set(3, 5, 8, pupil);
    g.set(9, 5, 8, pupil);
    return makeTemplate(g, 0.038, [6.5, 4.5, 5]);
  }

  // 2. 大鷲の頭部（白い羽毛と黄色い鉤クチバシ）
  if (type.id === 'giant_eagle') {
    const g = new VoxelGrid(9, 9, 11);
    g.fillBox(2, 2, 1, 6, 7, 7, 0xf4f4f6);
    // 鋭い鉤クチバシ
    g.fillBox(3, 3, 7, 5, 5, 10, 0xf5b82e);
    g.fillBox(3, 2, 9, 5, 3, 10, 0xe09f1f);
    // 凛々しい目
    g.fillBox(2, 5, 6, 2, 6, 7, 0xffd43b);
    g.fillBox(6, 5, 6, 6, 6, 7, 0xffd43b);
    g.set(2, 5, 7, pupil);
    g.set(6, 5, 7, pupil);
    return makeTemplate(g, 0.036, [4.5, 4.5, 4.5]);
  }

  // 3. ドラゴンの頭部（2本角・顎・発光する口内・チームカラー）
  if (type.id === 'dragon') {
    const g = new VoxelGrid(11, 11, 12);
    const dragonSkin = tc.shirt;
    g.fillBox(2, 2, 2, 8, 7, 8, dragonSkin);
    // 前に突き出た顎と口内の灼熱色
    g.fillBox(3, 4, 8, 7, 6, 11, dragonSkin);
    g.fillBox(3, 2, 8, 7, 2, 11, 0xe6a122);
    g.fillBox(4, 3, 8, 6, 3, 10, 0xff7b1c);
    // 後方へ伸びる2本の黄金角
    g.fillBox(2, 7, 1, 3, 9, 4, 0xe6a122);
    g.fillBox(7, 7, 1, 8, 9, 4, 0xe6a122);
    g.fillBox(2, 9, 0, 3, 10, 2, 0xffd43b);
    g.fillBox(7, 9, 0, 8, 10, 2, 0xffd43b);
    // 黄色く光る竜の目
    g.fillBox(2, 5, 7, 3, 6, 8, 0xffe042);
    g.fillBox(7, 5, 7, 8, 6, 8, 0xffe042);
    g.set(2, 5, 8, pupil);
    g.set(8, 5, 8, pupil);
    return makeTemplate(g, 0.038, [5.5, 4.5, 5]);
  }

  // 4. 暴走バギーの頭部（ルーフ・ロールケージ・イエロー大型フォグランプ）
  if (type.id === 'buggy') {
    const g = new VoxelGrid(10, 8, 8);
    // ロールケージ（パイプフレーム）
    g.fillBox(1, 0, 1, 2, 5, 2, 0x495057);
    g.fillBox(7, 0, 1, 8, 5, 2, 0x495057);
    g.fillBox(1, 0, 5, 2, 5, 6, 0x495057);
    g.fillBox(7, 0, 5, 8, 5, 6, 0x495057);
    // ルーフ天板
    g.fillBox(1, 5, 1, 8, 6, 6, tc.shirt);
    // 前面オフロード・フォグランプ（左右に光るイエローライト）
    g.fillBox(2, 6, 5, 3, 7, 6, 0xffe066);
    g.fillBox(6, 6, 5, 7, 7, 6, 0xffe066);
    return makeTemplate(g, 0.042, [4.5, 1.0, 3.5]);
  }

  // 5. 巨大アナコンダの頭部（三角形の蛇頭・大口と毒牙・二又舌・鋭い蛇眼）
  if (type.id === 'anaconda') {
    const g = new VoxelGrid(11, 8, 14);
    // 扁平な三角頭部
    g.fillBox(2, 2, 1, 8, 5, 8, look.skin);
    // 上顎と鼻先
    g.fillBox(3, 3, 8, 7, 5, 12, look.skin);
    g.fillBox(4, 3, 12, 6, 4, 13, look.skin);
    // 下顎
    g.fillBox(3, 1, 7, 7, 2, 12, 0x1b4332);
    // 口内の赤
    g.fillBox(4, 2, 8, 6, 3, 11, 0x991b1b);
    // 鋭い2本の白い毒牙
    g.fillBox(3, 2, 11, 3, 3, 11, 0xf8f9fa);
    g.fillBox(7, 2, 11, 7, 3, 11, 0xf8f9fa);
    // 赤く突き出た二又の舌
    g.fillBox(4, 2, 12, 6, 2, 13, 0xe03131);
    g.set(3, 2, 14, 0xe03131);
    g.set(7, 2, 14, 0xe03131);
    // 鋭い黄色い蛇眼
    g.fillBox(2, 4, 7, 2, 5, 8, 0xffd43b);
    g.fillBox(8, 4, 7, 8, 5, 8, 0xffd43b);
    g.set(2, 4, 8, pupil);
    g.set(8, 4, 8, pupil);
    return makeTemplate(g, 0.038, [5.5, 2.5, 5.5]);
  }

  // 6. おとりの頭部（つば広麦わら帽子・麻袋ヘッド・つぎはぎボタン目）
  if (type.id === 'decoy') {
    const g = new VoxelGrid(10, 10, 10);
    // 麻袋の頭
    g.fillBox(2, 1, 2, 7, 6, 7, look.skin);
    // 麦わら帽子のつば
    g.fillBox(0, 6, 0, 9, 6, 9, 0xb08968);
    // 帽子のクラウン（山）
    g.fillBox(2, 7, 2, 7, 9, 7, 0xb08968);
    // 帽子リボン（チームカラー）
    g.fillBox(2, 7, 1, 7, 7, 1, tc.shirt);
    g.fillBox(2, 7, 8, 7, 7, 8, tc.shirt);
    g.fillBox(1, 7, 2, 1, 7, 7, tc.shirt);
    g.fillBox(8, 7, 2, 8, 7, 7, tc.shirt);
    // ボタンの目（黒の×印風）
    g.set(3, 4, 8, 0x212529);
    g.set(6, 4, 8, 0x212529);
    // 麻紐の縫い目（口）
    g.set(4, 2, 8, 0x7f5539);
    g.set(5, 2, 8, 0x7f5539);
    return makeTemplate(g, 0.038, [4.5, 2.0, 4.5]);
  }

  // 7. 分裂キングスライムの頭部（王冠とゼリー上部）
  if (type.id === 'slime') {
    const g = new VoxelGrid(11, 10, 11);
    const jelly = team === 0 ? 0x4cd97b : 0x38d996;
    g.fillBox(1, 0, 1, 9, 6, 9, jelly);
    // ぎょろ目
    g.fillBox(2, 3, 8, 4, 5, 9, eyeWhite);
    g.fillBox(6, 3, 8, 8, 5, 9, eyeWhite);
    g.set(3, 4, 9, pupil);
    g.set(7, 4, 9, pupil);
    // 黄金のキング王冠
    g.fillBox(3, 7, 3, 7, 7, 7, 0xffd43b);
    g.set(3, 8, 3, 0xffd43b);
    g.set(5, 8, 3, 0xffd43b);
    g.set(7, 8, 3, 0xffd43b);
    g.set(3, 8, 7, 0xffd43b);
    g.set(7, 8, 7, 0xffd43b);
    g.set(5, 8, 7, tc.shirt);
    return makeTemplate(g, 0.04, [5.5, 4.5, 5.5]);
  }

  // 8. 戦車（超巨大）の旋回砲塔・長大主砲・コマンダーハッチ
  if (type.id === 'giant_tank') {
    const g = new VoxelGrid(14, 10, 28);
    const armorCol = 0x3d4a3e;
    const darkArmor = 0x283329;
    // 砲塔本体
    g.fillBox(2, 0, 4, 11, 5, 16, armorCol);
    g.fillBox(3, 5, 5, 10, 6, 15, armorCol);
    // 天面コマンダーキューポラ・ハッチ（チームカラー）
    g.fillBox(7, 6, 8, 10, 7, 12, darkArmor);
    g.fillBox(8, 7, 9, 9, 8, 11, tc.shirt);
    // 長大な主砲バレル（砲身・マズルブレーキ）
    g.fillBox(5, 2, 16, 8, 4, 25, darkArmor);
    g.fillBox(4, 1, 25, 9, 5, 27, 0x1f2420); // 先端マズルブレーキ
    // 同軸機銃マズル
    g.fillBox(3, 3, 16, 4, 3, 18, 0x111412);
    // 砲塔左右のスモークディスチャージャー（発煙弾発射筒）
    g.fillBox(1, 3, 9, 1, 5, 12, darkArmor);
    g.fillBox(12, 3, 9, 12, 5, 12, darkArmor);
    return makeTemplate(g, 0.046, [6.5, 1.0, 10.0]);
  }

  // 9. ロケットランチャー兵士のコンバットヘルメット＆タクティカルゴーグル
  if (type.id === 'rocket_soldier') {
    const g = new VoxelGrid(11, 12, 11);
    g.fillBox(2, 1, 2, 8, 7, 8, look.skin);
    g.fillBox(3, 4, 8, 4, 5, 9, eyeWhite);
    g.fillBox(6, 4, 8, 7, 5, 9, eyeWhite);
    g.set(3, 4, 9, pupil);
    g.set(7, 4, 9, pupil);
    // コンバットヘルメット
    g.fillBox(1, 6, 1, 9, 9, 9, 0x3b443b);
    g.fillBox(1, 3, 1, 2, 6, 8, 0x3b443b);
    g.fillBox(8, 3, 1, 9, 6, 8, 0x3b443b);
    // タクティカルゴーグル（額の上に装着）
    g.fillBox(2, 7, 9, 8, 8, 9, 0x212529);
    g.fillBox(3, 7, 10, 4, 8, 10, 0xff922b);
    g.fillBox(6, 7, 10, 7, 8, 10, 0xff922b);
    // ヘルメットのチームカラー帯
    g.fillBox(2, 6, 1, 8, 6, 1, tc.shirt);
    return makeTemplate(g, 0.038, [5, 4, 5]);
  }

  // 巨大ロボットのメカニカルヘッド（V字ブレードアンテナ・発光ツインアイ・チタン装甲）
  if (type.id === 'giant_robot') {
    const g = new VoxelGrid(13, 14, 13);
    const darkSteel = 0x212529;
    const armorPlate = 0x495057;
    const lightPlate = 0x6c757d;
    // 頭部本体ブロック
    g.fillBox(3, 1, 3, 9, 7, 9, armorPlate);
    // フェイスマスク・顎ガード
    g.fillBox(4, 1, 9, 8, 3, 10, darkSteel);
    g.set(6, 2, 10, 0xadb5bd); // ダクト
    // 発光ツインアイ（シアン/エメラルド発光）
    g.fillBox(4, 4, 9, 5, 5, 9, 0x38d9a9);
    g.fillBox(7, 4, 9, 8, 5, 9, 0x38d9a9);
    g.set(4, 4, 10, 0xffffff);
    g.set(7, 4, 10, 0xffffff);
    // 側頭部バルカン/インテーク
    g.fillBox(2, 2, 4, 2, 6, 8, darkSteel);
    g.fillBox(10, 2, 4, 10, 6, 8, darkSteel);
    g.set(2, 4, 8, 0xff922b);
    g.set(10, 4, 8, 0xff922b);
    // ヘルメット天頂・ひさし装甲（チームカラー）
    g.fillBox(3, 7, 3, 9, 8, 9, tc.shirt);
    g.fillBox(4, 6, 9, 8, 7, 10, tc.shirt);
    // 頭頂部V字ブレードアンテナ
    g.fillBox(5, 8, 9, 7, 9, 9, tc.accent); // アンテナ基部
    g.fillBox(3, 10, 9, 4, 11, 9, tc.accent); // 左翼ブレード
    g.fillBox(1, 12, 9, 2, 13, 9, tc.accent);
    g.fillBox(8, 10, 9, 9, 11, 9, tc.accent); // 右翼ブレード
    g.fillBox(10, 12, 9, 11, 13, 9, tc.accent);
    // 後頭部ダクト
    g.fillBox(4, 3, 2, 8, 6, 2, lightPlate);
    return makeTemplate(g, 0.042, [6, 4, 6]);
  }

  // 11. 幾何神ラミエル: 正八面体上部ピラミッドの頂点部
  if (type.id === 'angel_ramiel') {
    const g = new VoxelGrid(7, 7, 7);
    const crystal = 0x339af0;
    const highlight = 0xa5d8ff;
    g.fillBox(2, 2, 2, 4, 4, 4, crystal);
    g.set(3, 3, 5, highlight);
    g.set(3, 5, 3, highlight);
    return makeTemplate(g, 0.035, [3, 3, 3]);
  }

  // 12. 使徒神サキエル: 白い嘴状仮面と漆黒の後頭部
  if (type.id === 'angel_sachiel') {
    const g = new VoxelGrid(11, 13, 13);
    const black = 0x141517;
    const mask = 0xf8f9fa;
    const maskShadow = 0xced4da;
    g.fillBox(2, 2, 1, 8, 8, 7, black);
    g.fillBox(2, 2, 7, 8, 8, 8, mask);
    g.fillBox(3, 1, 8, 7, 7, 10, mask);
    g.fillBox(4, 0, 10, 6, 5, 12, mask);
    g.fillBox(4, 0, 9, 6, 1, 10, maskShadow);
    g.fillBox(3, 5, 8, 4, 6, 9, black);
    g.fillBox(6, 5, 8, 7, 6, 9, black);
    g.set(3, 6, 8, 0xd90429);
    g.set(7, 6, 8, 0xd90429);
    g.fillBox(4, 8, 2, 6, 10, 5, black);
    return makeTemplate(g, 0.04, [5, 4, 6]);
  }

  // 13. 拒絶神ゼルエル: ドクロ状の白い仮面と赤い眼光
  if (type.id === 'angel_zeruel') {
    const g = new VoxelGrid(13, 13, 13);
    const bone = 0xf1f3f5;
    const dark = 0x1f1f23;
    g.fillBox(2, 2, 1, 10, 9, 7, dark);
    g.fillBox(3, 2, 7, 9, 9, 9, bone);
    g.fillBox(4, 1, 8, 8, 3, 10, bone);
    g.fillBox(4, 5, 9, 5, 6, 10, dark);
    g.fillBox(7, 5, 9, 8, 6, 10, dark);
    g.set(4, 5, 9, 0xff1744);
    g.set(8, 5, 9, 0xff1744);
    g.fillBox(1, 4, 3, 2, 7, 7, dark);
    g.fillBox(10, 4, 3, 11, 7, 7, dark);
    return makeTemplate(g, 0.042, [6, 4, 6]);
  }

  // 14. 天落神サハクィエル: 巨大な使徒の瞳孔と幾何学翼頭部
  if (type.id === 'angel_sahaquiel') {
    const g = new VoxelGrid(15, 11, 13);
    const orange = 0xf76707;
    const yellow = 0xffd43b;
    const dark = 0x141517;
    g.fillBox(2, 2, 1, 12, 8, 8, orange);
    g.fillBox(1, 3, 2, 13, 7, 7, yellow);
    g.fillBox(3, 2, 8, 11, 8, 9, 0xffffff);
    g.fillBox(4, 3, 9, 10, 7, 10, 0x1971c2);
    g.fillBox(6, 4, 10, 8, 6, 11, dark);
    g.set(7, 5, 11, 0xff0000);
    g.fillBox(6, 8, 3, 8, 10, 6, yellow);
    return makeTemplate(g, 0.045, [7, 5, 6]);
  }

  // 10. 衛星攻撃兵士のハイテク通信バイザーヘルメット
  if (type.id === 'satellite_soldier') {
    const g = new VoxelGrid(11, 13, 11);
    g.fillBox(2, 1, 2, 8, 7, 8, look.skin);
    // フルフェイス・バイザーヘルメット
    g.fillBox(1, 3, 1, 9, 9, 9, 0x1f2937);
    // シアン色に輝くホログラフィック・アイバイザー
    g.fillBox(2, 4, 8, 8, 5, 9, 0x38d9a9);
    g.set(3, 4, 9, 0xffffff);
    g.set(7, 4, 9, 0xffffff);
    // 頭部右側の通信アンテナロッド
    g.fillBox(9, 6, 4, 9, 12, 4, 0x9ca3af);
    g.set(9, 12, 4, tc.accent);
    // チームカラーのヘッドライン
    g.fillBox(4, 9, 2, 6, 10, 8, tc.shirt);
    return makeTemplate(g, 0.038, [5, 4, 5]);
  }

  const g = new VoxelGrid(11, 12, 11);
  // 頭部本体（7×7×7, 中心を x=2..8, y=1..7, z=2..8 に配置）
  g.fillBox(2, 1, 2, 8, 7, 8, look.skin);

  // TABS 風のぎょろ目（白目 + 黒目）
  g.fillBox(3, 4, 8, 4, 5, 9, eyeWhite);
  g.fillBox(6, 4, 8, 7, 5, 9, eyeWhite);
  g.set(3, 4, 9, pupil);
  g.set(7, 4, 9, pupil);

  // 髪
  if (look.hair !== null) {
    g.fillBox(2, 7, 2, 8, 8, 8, look.hair);
    g.fillBox(2, 4, 1, 8, 7, 2, look.hair);
    g.fillBox(2, 6, 2, 8, 6, 9, tc.shirt);
  }

  // 兜
  if (look.helmet !== null && type.id !== 'samurai' && type.id !== 'minigunner' && type.id !== 'sniper') {
    g.fillBox(1, 5, 1, 9, 8, 9, look.helmet);
    g.fillBox(1, 2, 1, 9, 5, 3, look.helmet);
    g.fillBox(1, 2, 1, 2, 5, 7, look.helmet);
    g.fillBox(8, 2, 1, 9, 5, 7, look.helmet);
    g.fillBox(5, 3, 8, 5, 6, 9, look.helmet);
    g.fillBox(5, 8, 2, 5, 8, 8, tc.shirt);
  }

  // フード
  if (look.hood !== null) {
    g.fillBox(1, 5, 1, 9, 8, 9, look.hood);
    g.fillBox(1, 1, 1, 9, 5, 3, look.hood);
    g.fillBox(1, 1, 1, 2, 5, 8, look.hood);
    g.fillBox(8, 1, 1, 9, 5, 8, look.hood);
    g.fillBox(4, 8, 2, 6, 8, 7, tc.shirt);
  }

  // 髭
  if (look.beard !== null) {
    g.fillBox(2, 0, 7, 8, 3, 9, look.beard);
    g.fillBox(3, 0, 9, 7, 2, 9, look.beard);
  }

  // 兵種固有の頭部装飾
  if (type.id === 'archmage') {
    // とんがり魔法帽
    g.fillBox(0, 6, 0, 10, 6, 10, 0x4b2e83);
    g.fillBox(2, 7, 2, 8, 8, 8, 0xd4af37);
    g.fillBox(3, 9, 3, 7, 10, 7, 0x4b2e83);
    g.fillBox(4, 11, 4, 6, 11, 6, tc.shirt);
  } else if (type.id === 'gravimancer') {
    // 黄金の星冠と紫に輝く目
    g.fillBox(3, 4, 9, 4, 5, 9, 0xc066ff);
    g.fillBox(6, 4, 9, 7, 5, 9, 0xc066ff);
    g.fillBox(2, 8, 2, 8, 9, 8, 0xd4af37);
  } else if (type.id === 'sniper') {
    // 暗視スコープゴーグルとギリーフード
    g.fillBox(2, 4, 8, 8, 5, 9, 0x1a2026);
    g.fillBox(3, 4, 9, 4, 5, 9, 0x38d9a9);
    g.fillBox(6, 4, 9, 7, 5, 9, 0x38d9a9);
  } else if (type.id === 'minigunner') {
    // 重装甲フルフェイスヘルメット＋オレンジのスリットバイザー
    g.fillBox(1, 1, 1, 9, 8, 9, 0x424852);
    g.fillBox(2, 4, 9, 8, 5, 9, 0xff922b);
    g.fillBox(4, 8, 2, 6, 9, 8, tc.shirt);
  } else if (type.id === 'samurai') {
    // 陣笠（浪人笠）と前立て
    g.fillBox(0, 6, 0, 10, 7, 10, 0x2b2b36);
    g.fillBox(2, 8, 2, 8, 8, 8, 0x2b2b36);
    g.fillBox(4, 7, 9, 6, 9, 10, 0xd4af37);
  } else if (type.id === 'ninja') {
    // 忍び覆面と額当て
    g.fillBox(2, 1, 7, 8, 3, 9, 0x1e2029);
    g.fillBox(3, 6, 8, 7, 7, 9, 0x9aa0a8);
    // なびく陣営カラーのマフラー端
    g.fillBox(4, 0, 0, 6, 2, 2, tc.shirt);
  } else if (type.id === 'charger') {
    // バイキング風の2本角兜
    g.fillBox(0, 7, 4, 1, 9, 6, 0xfaf8f0);
    g.fillBox(9, 7, 4, 10, 9, 6, 0xfaf8f0);
    g.set(0, 10, 5, 0xd4af37);
    g.set(10, 10, 5, 0xd4af37);
  } else if (type.id === 'bomber') {
    // ゴーグル付きの爆撃兵ヘルメット
    g.fillBox(2, 5, 8, 8, 6, 9, 0xd4af37);
    g.set(3, 5, 9, 0xff6b1a);
    g.set(7, 5, 9, 0xff6b1a);
  }

  return makeTemplate(g, 0.036, [5.5, 4.5, 5.5]);
}

function buildTorsoTemplate(type: UnitType, team: Team): VoxelPartTemplate {
  const look = type.look;
  const tc = TEAM_COLORS[team];

  if (type.id === 'sezain') {
    // セザイン: 大型2輪バイク（チョッパー/バトルバイク）＋ライダースジャケットのバイカー
    const g = new VoxelGrid(14, 20, 28);
    const bikeBlack = 0x18181b;
    const metalChrome = 0xd1d5db;
    const darkMetal = 0x374151;
    const tireRubber = 0x111827;

    // 前輪大型タイヤ
    g.fillBox(5, 0, 20, 8, 8, 26, tireRubber);
    g.fillBox(5, 2, 22, 8, 6, 24, metalChrome);
    g.fillBox(4, 4, 18, 4, 13, 22, metalChrome);
    g.fillBox(9, 4, 18, 9, 13, 22, metalChrome);
    g.fillBox(2, 13, 17, 11, 14, 18, metalChrome);
    g.fillBox(5, 11, 22, 8, 13, 23, 0xfef08a); // ヘッドライト

    // 後輪大型タイヤ
    g.fillBox(4, 0, 1, 9, 8, 7, tireRubber);
    g.fillBox(4, 2, 3, 9, 6, 5, metalChrome);

    // フレーム＆Vツインエンジン
    g.fillBox(4, 2, 7, 9, 8, 19, bikeBlack);
    g.fillBox(3, 3, 9, 10, 7, 16, darkMetal);
    g.fillBox(2, 2, 2, 3, 4, 16, metalChrome);
    g.fillBox(10, 2, 2, 11, 4, 16, metalChrome);

    // 燃料タンク＆シート
    g.fillBox(4, 8, 12, 9, 11, 18, tc.shirt);
    g.fillBox(5, 8, 6, 8, 10, 12, 0x27272a);

    // バイカー胴体
    g.fillBox(4, 10, 10, 9, 17, 15, 0x212529);
    g.fillBox(5, 12, 9, 8, 15, 9, tc.shirt);
    g.fillBox(6, 11, 16, 7, 16, 16, metalChrome);

    return makeTemplate(g, 0.045, [6.5, 8.5, 14]);
  }

  if (type.id === 'yamamuron') {
    // ヤマムロン: でっっっっかい富士山！
    const g = new VoxelGrid(28, 22, 28);
    const seaOfTrees = 0x1b4332;
    const baseGreen = 0x2d6a4f;

    const mountainCol1 = team === 0 ? 0x9e2a2b : 0x1e3a8a;
    const mountainCol2 = team === 0 ? 0xba181b : 0x1d4ed8;
    const mountainCol3 = team === 0 ? 0xe5383b : 0x2563eb;

    const snowWhite = 0xffffff;
    const snowSoft = 0xf1f5f9;
    const calderaLava = 0xff3b00;
    const calderaLavaHot = 0xffd43b;

    // 最下層裾野 (radius ~ 13)
    for (let y = 0; y <= 3; y++) {
      const r = 13 - y * 0.5;
      for (let x = 0; x < 28; x++) {
        for (let z = 0; z < 28; z++) {
          const dx = x - 13.5;
          const dz = z - 13.5;
          if (dx * dx + dz * dz <= r * r) {
            g.set(x, y, z, y < 2 ? seaOfTrees : baseGreen);
          }
        }
      }
    }
    // 中層山肌 (radius 11.5 -> 7.5)
    for (let y = 4; y <= 12; y++) {
      const t = (y - 4) / 8;
      const r = 11.5 - t * 4.0;
      const col = t < 0.35 ? mountainCol1 : t < 0.7 ? mountainCol2 : mountainCol3;
      for (let x = 0; x < 28; x++) {
        for (let z = 0; z < 28; z++) {
          const dx = x - 13.5;
          const dz = z - 13.5;
          if (dx * dx + dz * dz <= r * r) {
            g.set(x, y, z, col);
          }
        }
      }
    }
    // 上層雪冠 (radius 7.0 -> 4.5)
    for (let y = 13; y <= 19; y++) {
      const t = (y - 13) / 6;
      const r = 7.0 - t * 2.5;
      for (let x = 0; x < 28; x++) {
        for (let z = 0; z < 28; z++) {
          const dx = x - 13.5;
          const dz = z - 13.5;
          if (dx * dx + dz * dz <= r * r) {
            const angle = Math.atan2(dz, dx);
            const wavy = Math.sin(angle * 5) * 0.8;
            const isSnow = y >= 15 || (y >= 13 && r + wavy < 6.8);
            g.set(x, y, z, isSnow ? (y >= 16 ? snowWhite : snowSoft) : mountainCol3);
          }
        }
      }
    }
    // 山頂カルデラ火口
    for (let y = 18; y <= 21; y++) {
      for (let x = 11; x <= 16; x++) {
        for (let z = 11; z <= 16; z++) {
          const dx = x - 13.5;
          const dz = z - 13.5;
          if (dx * dx + dz * dz <= 2.8 * 2.8) {
            if (y === 18) {
              g.set(x, y, z, dx * dx + dz * dz <= 1.5 ? calderaLavaHot : calderaLava);
            } else {
              g.set(x, y, z, 0);
            }
          }
        }
      }
    }

    return makeTemplate(g, 0.065, [13.5, 6.0, 13.5]);
  }

  if (type.id === 'hongon') {
    // ホンゴン: 名器黒塗りグランドピアノ＋鍵盤＋譜面台＋タキシードのピアニスト
    const g = new VoxelGrid(18, 18, 24);
    const pianoBlack = 0x111113;
    const pianoLid = 0x18181b;
    const whiteKey = 0xf8f9fa;
    const blackKey = 0x09090b;
    const sheetPaper = 0xffffff;
    const goldPedal = 0xd4af37;

    // ピアノ本体
    g.fillBox(1, 4, 10, 16, 10, 22, pianoBlack);
    g.fillBox(1, 10, 10, 16, 11, 22, pianoLid);
    g.fillBox(13, 4, 18, 16, 10, 22, 0); // グランドピアノカーブ
    // 脚
    g.fillBox(2, 0, 11, 3, 3, 12, pianoBlack);
    g.fillBox(14, 0, 11, 15, 3, 12, pianoBlack);
    g.fillBox(3, 0, 20, 4, 3, 21, pianoBlack);
    g.fillBox(8, 0, 11, 9, 1, 12, goldPedal);

    // 鍵盤
    g.fillBox(2, 7, 8, 15, 7, 10, whiteKey);
    for (let k = 3; k <= 14; k++) {
      if (k % 7 !== 2 && k % 7 !== 6) {
        g.set(k, 8, 9, blackKey);
        g.set(k, 8, 10, blackKey);
      }
    }

    // 譜面台＆楽譜
    g.fillBox(5, 11, 11, 12, 11, 12, pianoBlack);
    g.fillBox(6, 12, 11, 11, 15, 11, sheetPaper);
    g.set(7, 13, 11, 0x18181b);
    g.set(9, 14, 11, 0x18181b);
    g.set(10, 13, 11, 0x18181b);

    // ピアニスト
    g.fillBox(5, 3, 3, 12, 5, 7, 0x27272a); // スツール
    g.fillBox(6, 0, 4, 7, 2, 5, 0x18181b);
    g.fillBox(10, 0, 4, 11, 2, 5, 0x18181b);
    g.fillBox(6, 6, 4, 11, 15, 7, 0x18181b); // 胴体タキシード
    g.fillBox(7, 8, 7, 10, 14, 7, 0xffffff); // 白シャツ
    g.fillBox(8, 13, 8, 9, 14, 8, tc.shirt); // 蝶ネクタイ
    g.fillBox(6, 3, 3, 11, 7, 3, 0x18181b); // テールコート

    return makeTemplate(g, 0.045, [8.5, 5.0, 7.5]);
  }

  // 鎧戦象の巨躯と鞍
  if (type.id === 'warelephant') {
    const g = new VoxelGrid(12, 12, 10);
    g.fillBox(1, 0, 1, 10, 10, 8, look.skin);
    // 陣営カラーの鞍掛けと金縁
    g.fillBox(0, 4, 2, 11, 11, 7, tc.shirt);
    g.fillBox(0, 4, 2, 11, 4, 7, 0xd4af37);
    return makeTemplate(g, 0.042, [6, 1, 5]);
  }

  // 暴走バギーのシャーシ・カウル・ブルバー
  if (type.id === 'buggy') {
    const g = new VoxelGrid(12, 10, 14);
    // シャーシ底面フレーム
    g.fillBox(1, 1, 1, 10, 3, 12, 0x212529);
    // チームカラーのボディカウル（ボンネット・サイドフェンダー）
    g.fillBox(1, 3, 2, 10, 6, 12, tc.shirt);
    // エンジンフード（中央のブラックライン）
    g.fillBox(4, 6, 7, 7, 7, 12, 0x343a40);
    // 前面ブルバー（頑丈なガードバー）
    g.fillBox(1, 2, 13, 10, 5, 13, 0x495057);
    g.fillBox(0, 3, 12, 1, 4, 13, 0xced4da);
    g.fillBox(10, 3, 12, 11, 4, 13, 0xced4da);
    // 運転席コクピット（座席シートとステアリング）
    g.fillBox(3, 4, 3, 8, 8, 6, 0x1f1f1f);
    g.fillBox(4, 5, 7, 7, 6, 7, 0x495057);
    // 背面のツイン排気マフラー
    g.fillBox(2, 2, 0, 3, 3, 1, 0xced4da);
    g.fillBox(8, 2, 0, 9, 3, 1, 0xced4da);
    return makeTemplate(g, 0.042, [5.5, 1.5, 6.5]);
  }

  // 巨大アナコンダの胴体（太い蛇腹と背面のチームカラー鱗模様）
  if (type.id === 'anaconda') {
    const g = new VoxelGrid(12, 10, 12);
    // 蛇の胴体ベース（深緑）
    g.fillBox(1, 1, 1, 10, 8, 10, look.skin);
    // 腹面の淡色（蛇腹）
    g.fillBox(2, 0, 2, 9, 1, 9, 0xb7e4c7);
    // 背面のチームカラー菱形鱗模様
    g.fillBox(4, 8, 3, 7, 9, 8, tc.shirt);
    g.fillBox(3, 7, 4, 8, 8, 7, tc.accent);
    return makeTemplate(g, 0.044, [5.5, 2.0, 5.5]);
  }

  // おとりの胴体（藁束・ターゲットマーク・チームカラー帯）
  if (type.id === 'decoy') {
    const g = new VoxelGrid(10, 12, 8);
    // 藁束の胴体
    g.fillBox(1, 1, 1, 8, 11, 6, look.skin);
    // 胴体の縦木支柱
    g.fillBox(4, 0, 2, 5, 11, 4, 0x7f5539);
    // チームカラーの腰帯
    g.fillBox(1, 1, 1, 8, 3, 6, tc.shirt);
    // 正面の「的（ターゲットマーク）」（同心円: 赤・白・赤）
    g.fillBox(2, 5, 7, 7, 10, 7, 0xe03131);
    g.fillBox(3, 6, 7, 6, 9, 7, 0xffffff);
    g.fillBox(4, 7, 7, 5, 8, 7, 0xe03131);
    return makeTemplate(g, 0.038, [4.5, 1.0, 3.5]);
  }

  // 分裂キングスライムのゼリー胴体（内部にコアが透けて見える）
  if (type.id === 'slime') {
    const g = new VoxelGrid(12, 12, 10);
    const jelly = team === 0 ? 0x3bc96b : 0x28c986;
    g.fillBox(0, 0, 0, 11, 11, 9, jelly);
    // 中心の輝くスライムコア
    g.fillBox(4, 4, 3, 7, 7, 6, tc.shirt);
    g.fillBox(5, 5, 4, 6, 6, 5, 0xffe066);
    return makeTemplate(g, 0.044, [6, 1, 5]);
  }

  // 戦車（超巨大）の重装甲シャーシ・傾斜前面装甲・サイドスカート・リアエンジン
  if (type.id === 'giant_tank') {
    const g = new VoxelGrid(18, 12, 24);
    const armorCol = 0x3d4a3e;
    const darkArmor = 0x283329;
    const steel = 0x1f2420;
    // シャーシ中央本体
    g.fillBox(2, 2, 2, 15, 8, 21, armorCol);
    // 傾斜したフロント前面装甲
    g.fillBox(3, 2, 21, 14, 5, 23, darkArmor);
    g.fillBox(4, 5, 19, 13, 8, 22, armorCol);
    // 左右サイドスカート装甲板（履帯側面をカバー）
    g.fillBox(0, 1, 1, 2, 7, 22, darkArmor);
    g.fillBox(15, 1, 1, 17, 7, 22, darkArmor);
    // チームカラーの識別ストライプ（フェンダー上部）
    g.fillBox(1, 7, 3, 2, 8, 20, tc.shirt);
    g.fillBox(15, 7, 3, 16, 8, 20, tc.shirt);
    // リアエンジンデッキと排気スリット
    g.fillBox(4, 8, 2, 13, 9, 8, steel);
    g.fillBox(5, 9, 3, 7, 9, 7, 0x495057);
    g.fillBox(10, 9, 3, 12, 9, 7, 0x495057);
    // 排気管マフラー（背面左右）
    g.fillBox(2, 6, 0, 3, 8, 2, steel);
    g.fillBox(14, 6, 0, 15, 8, 2, steel);
    return makeTemplate(g, 0.048, [8.5, 3.0, 11.0]);
  }

  // 巨大ロボットの重装甲メカ胴体＆ツインスラスターバックパック
  if (type.id === 'giant_robot') {
    const g = new VoxelGrid(12, 13, 10);
    const darkSteel = 0x212529;
    const armorPlate = 0x495057;
    const lightPlate = 0x6c757d;
    // 骨盤・スカートアーマー（y=0..3）
    g.fillBox(2, 0, 2, 9, 3, 7, darkSteel);
    // フロントスカート（チームカラー）
    g.fillBox(3, 0, 7, 8, 3, 8, tc.shirt);
    // サイドスカートアーマー
    g.fillBox(1, 1, 2, 2, 4, 7, armorPlate);
    g.fillBox(9, 1, 2, 10, 4, 7, armorPlate);
    // 腹部・ウエストフレーム（y=3..5）
    g.fillBox(3, 3, 3, 8, 5, 6, lightPlate);
    // 胸部重装甲ブロック（y=5..11）
    g.fillBox(2, 5, 2, 9, 11, 7, armorPlate);
    // 胸部コックピットハッチ（チームカラー）
    g.fillBox(4, 6, 7, 7, 10, 8, tc.shirt);
    g.fillBox(5, 7, 8, 6, 9, 8, tc.accent);
    // 胸部左右のエアインテーク（ダクト）
    g.fillBox(2, 7, 7, 3, 9, 7, 0xff922b);
    g.fillBox(8, 7, 7, 9, 9, 7, 0xff922b);
    // 背面ツインジェットバーニア・バックパック（y=5..12, z=0..2）
    g.fillBox(3, 5, 0, 8, 12, 2, darkSteel);
    // 左スラスターノズル
    g.fillBox(3, 3, 0, 4, 5, 1, lightPlate);
    g.set(3, 3, 0, 0x38d9a9);
    g.set(4, 3, 0, 0x38d9a9);
    // 右スラスターノズル
    g.fillBox(7, 3, 0, 8, 5, 1, lightPlate);
    g.set(7, 3, 0, 0x38d9a9);
    g.set(8, 3, 0, 0x38d9a9);
    return makeTemplate(g, 0.046, [5.5, 1.0, 4.5]);
  }

  // 幾何神ラミエル: 浮遊する完全な正八面体結晶ボディ
  if (type.id === 'angel_ramiel') {
    const size = 19;
    const g = new VoxelGrid(size, size, size);
    const cx = 9;
    const cy = 9;
    const cz = 9;
    const r = 8.5;
    for (let z = 0; z < size; z++) {
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const dist1 = Math.abs(x - cx) + Math.abs(y - cy) + Math.abs(z - cz);
          if (dist1 <= r) {
            const dCore = Math.hypot(x - cx, y - cy, z - cz);
            if (dCore <= 2.8) {
              g.set(x, y, z, 0xd90429);
            } else if (dist1 >= r - 1.2) {
              g.set(x, y, z, (x + y + z) % 2 === 0 ? 0x4dabf7 : 0x74c0fc);
            } else {
              g.set(x, y, z, 0x1971c2);
            }
          }
        }
      }
    }
    return makeTemplate(g, 0.05, [cx, 3.5, cz]);
  }

  // 使徒神サキエル: 漆黒の巨躯と深紅に光る使徒コア
  if (type.id === 'angel_sachiel') {
    const g = new VoxelGrid(12, 14, 11);
    const black = 0x141517;
    const darkGray = 0x25262b;
    const coreRed = 0xff1744;
    g.fillBox(2, 0, 2, 9, 12, 8, black);
    g.fillBox(4, 5, 8, 7, 8, 9, coreRed);
    g.fillBox(5, 6, 9, 6, 7, 10, 0xff8787);
    g.fillBox(3, 4, 8, 8, 4, 8, darkGray);
    g.fillBox(3, 9, 8, 8, 9, 8, darkGray);
    g.fillBox(5, 2, 0, 6, 13, 1, 0x343a40);
    g.fillBox(2, 6, 0, 9, 7, 1, darkGray);
    g.fillBox(2, 10, 0, 9, 11, 1, darkGray);
    g.fillBox(0, 10, 3, 2, 13, 7, darkGray);
    g.fillBox(9, 10, 3, 11, 13, 7, darkGray);
    return makeTemplate(g, 0.045, [5.5, 1.0, 4.5]);
  }

  // 拒絶神ゼルエル: 巨大なマント状肩装甲・露出コア・肋骨ガード
  if (type.id === 'angel_zeruel') {
    const g = new VoxelGrid(16, 15, 12);
    const dark = 0x1f1f23;
    const armor = 0x2b2b2b;
    const bone = 0xf1f3f5;
    const core = 0xd90429;
    g.fillBox(3, 0, 2, 12, 12, 8, dark);
    g.fillBox(0, 7, 1, 3, 14, 9, armor);
    g.fillBox(12, 7, 1, 15, 14, 9, armor);
    g.fillBox(1, 14, 2, 14, 15, 8, armor);
    g.fillBox(6, 4, 8, 9, 7, 9, core);
    g.fillBox(7, 5, 9, 8, 6, 10, 0xff6b6b);
    g.fillBox(4, 3, 8, 5, 8, 9, bone);
    g.fillBox(10, 3, 8, 11, 8, 9, bone);
    g.fillBox(5, 8, 8, 10, 9, 8, bone);
    g.fillBox(4, 2, 0, 11, 13, 2, 0x141517);
    return makeTemplate(g, 0.046, [7.5, 1.0, 5.0]);
  }

  // 天落神サハクィエル: 巨大な幾何学使徒ボディ
  if (type.id === 'angel_sahaquiel') {
    const g = new VoxelGrid(18, 14, 14);
    const orange = 0xf76707;
    const yellow = 0xffd43b;
    const dark = 0x141517;
    g.fillBox(2, 1, 2, 15, 11, 11, orange);
    g.fillBox(1, 4, 1, 16, 8, 12, yellow);
    g.fillBox(3, 0, 3, 14, 12, 10, orange);
    g.fillBox(5, 3, 11, 12, 9, 12, 0xffffff);
    g.fillBox(6, 4, 12, 11, 8, 13, 0x1971c2);
    g.fillBox(7, 5, 13, 10, 7, 13, dark);
    g.fillBox(8, 6, 13, 9, 6, 13, 0xff0000);
    g.fillBox(4, 0, 5, 5, 1, 7, dark);
    g.fillBox(8, 0, 5, 9, 1, 7, dark);
    g.fillBox(12, 0, 5, 13, 1, 7, dark);
    return makeTemplate(g, 0.05, [8.5, 1.0, 6.0]);
  }

  // 骨盤(y=0)から胸(y=0.42)を覆う胴体
  const g = new VoxelGrid(10, 12, 8);

  // 腰・ベルト
  g.fillBox(1, 0, 2, 8, 2, 5, tc.pants);
  g.fillBox(1, 2, 2, 8, 2, 5, 0x3b2614);
  g.fillBox(4, 2, 5, 5, 2, 6, tc.accent);

  const chestColor =
    type.id === 'giant' || type.id === 'giant_eagle' ? look.skin : tc.shirt;
  g.fillBox(0, 3, 1, 9, 11, 6, chestColor);

  if (type.id === 'giant') {
    for (let y = 3; y <= 11; y++) {
      const x = Math.min(8, Math.max(1, Math.floor(((y - 3) / 8) * 7) + 1));
      g.fillBox(x, y, 1, Math.min(9, x + 1), y, 6, tc.shirt);
    }
  }

  // 胸当て鎧
  if (look.armor !== null) {
    g.fillBox(0, 4, 1, 9, 11, 6, look.armor);
    g.fillBox(4, 5, 6, 5, 10, 6, tc.shirt);
    g.fillBox(3, 8, 6, 6, 9, 6, tc.accent);
  }

  // 兵種固有の背面・胸部ディテール
  if (type.id === 'minigunner') {
    // 背中の大型弾薬バックパック
    g.fillBox(1, 4, 0, 8, 10, 1, 0x343a40);
    g.fillBox(2, 6, 0, 7, 8, 0, 0xd4af37);
  } else if (type.id === 'dragon') {
    // 黄金の腹鱗と背びれ・尻尾の付け根
    g.fillBox(2, 3, 6, 7, 10, 6, 0xe6a122);
    g.fillBox(4, 1, 0, 5, 9, 1, 0xe6a122);
  } else if (type.id === 'samurai') {
    // 陣営カラーの羽織と左腰の黒鞘
    g.fillBox(0, 4, 1, 2, 11, 6, tc.shirt);
    g.fillBox(7, 4, 1, 9, 11, 6, tc.shirt);
    g.fillBox(0, 1, 0, 1, 3, 7, 0x181820);
  } else if (type.id === 'ninja') {
    // 首元の赤いマフラーと背中の忍刀
    g.fillBox(1, 10, 1, 8, 11, 7, tc.shirt);
    g.fillBox(3, 4, 0, 5, 11, 1, 0x181820);
  } else if (type.id === 'bomber') {
    // 背中の火薬樽バックパック
    g.fillBox(2, 4, 0, 7, 10, 1, 0x5c3818);
    g.fillBox(2, 5, 0, 7, 5, 1, 0x868e96);
    g.fillBox(2, 9, 0, 7, 9, 1, 0x868e96);
  } else if (type.id === 'rocket_soldier') {
    // 背中に背負った予備ロケット弾ラック（2本の弾頭が斜めにセット）
    g.fillBox(2, 4, 0, 7, 6, 1, 0x212529); // ラック基部
    g.fillBox(2, 6, 0, 3, 11, 0, 0x3d4a3e); // 左弾体
    g.fillBox(2, 11, 0, 3, 12, 0, 0xff922b); // 左信管
    g.fillBox(6, 6, 0, 7, 11, 0, 0x3d4a3e); // 右弾体
    g.fillBox(6, 11, 0, 7, 12, 0, 0xff922b); // 右信管
    // 胸部の弾帯ポーチ
    g.fillBox(2, 4, 6, 4, 6, 6, 0x2b362c);
    g.fillBox(5, 4, 6, 7, 6, 6, 0x2b362c);
  } else if (type.id === 'satellite_soldier') {
    // 背面のハイテク衛星通信バックパック（通信アンテナ・ソーラー面）
    g.fillBox(1, 4, 0, 8, 11, 1, 0x1f2937);
    g.fillBox(2, 5, 0, 7, 10, 0, 0x111827);
    // 通信用パラボラ小型ディスク＆LED
    g.fillBox(3, 7, 0, 6, 9, 0, 0x38d9a9);
    g.set(7, 10, 0, 0xff6b6b);
    g.set(2, 10, 0, 0x51cf66);
  }

  return makeTemplate(g, 0.04, [5, 1, 4]);
}

function buildLimbTemplate(
  sx: number,
  sy: number,
  sz: number,
  bottomColor: number,
  topColor: number,
  length: number,
): VoxelPartTemplate {
  const g = new VoxelGrid(sx, sy, sz);
  const split = Math.floor(sy * 0.45);
  g.fillBox(0, 0, 0, sx - 1, split, sz - 1, bottomColor);
  g.fillBox(0, split + 1, 0, sx - 1, sy - 1, sz - 1, topColor);
  return makeTemplate(g, length / sy, [sx / 2, 0, sz / 2]);
}

/** バギー用の円形ボクセル車輪パーツテンプレート */
function buildWheelTemplate(radius: number, width: number): VoxelPartTemplate {
  const size = radius * 2 + 1;
  const g = new VoxelGrid(width, size, size);
  const r2 = radius * radius;
  const hubR2 = (radius * 0.45) ** 2;
  const cx = radius;
  const cz = radius;
  for (let z = 0; z < size; z++) {
    for (let y = 0; y < size; y++) {
      const d2 = (y - cx) ** 2 + (z - cz) ** 2;
      if (d2 <= r2) {
        const col = d2 <= hubR2 ? 0xced4da : 0x1f1f1f;
        for (let x = 0; x < width; x++) {
          g.set(x, y, z, col);
        }
      }
    }
  }
  return makeTemplate(g, 0.038, [width / 2, radius, radius]);
}

/** 大鷲やドラゴン用の翼パーツテンプレート */
function buildWingTemplate(mainColor: number, subColor: number, length: number): VoxelPartTemplate {
  const g = new VoxelGrid(4, 8, 8);
  g.fillBox(1, 0, 2, 2, 7, 4, mainColor);
  // 風切羽（後方へ広がる翼面）
  g.fillBox(1, 1, 0, 2, 7, 2, subColor);
  return makeTemplate(g, length / 8, [2, 0, 3.5]);
}

function buildWeaponGeometry(kind: WeaponKind, length: number, team: Team): BufferGeometry {
  const tc = TEAM_COLORS[team];
  if (kind === 'sword' || kind === 'katana') {
    const sy = 24;
    const g = new VoxelGrid(5, sy, 3);
    // 柄・鍔・刀身
    const hilt = kind === 'katana' ? 0x1c1c24 : 0x5a3518;
    g.fillBox(2, 0, 1, 2, 5, 1, hilt);
    g.fillBox(2, 0, 1, 2, 0, 1, tc.accent);
    g.fillBox(1, 6, 1, 3, 6, 1, 0xd4af37);
    if (kind === 'katana') {
      // 日本刀の細身で反りのある白銀刀身
      for (let y = 7; y < sy; y++) {
        const curveZ = y > sy - 5 ? 2 : 1;
        g.set(2, y, curveZ, 0xf4f8ff);
        if (y < sy - 2) g.set(1, y, curveZ, 0xc8d2e0);
      }
    } else {
      g.fillBox(1, 6, 1, 3, sy - 3, 1, 0xd8dee8);
      g.fillBox(2, 6, 1, 2, sy - 2, 1, 0xf4f8ff);
      g.set(2, sy - 1, 1, 0xf4f8ff);
    }
    return g.toGeometry(length / sy, [2.5, 1, 1.5]);
  }
  if (kind === 'spear') {
    const sy = 28;
    const g = new VoxelGrid(5, sy, 3);
    g.fillBox(2, 0, 1, 2, sy - 6, 1, 0x7c5128);
    g.fillBox(2, sy - 8, 1, 4, sy - 6, 1, tc.shirt);
    g.fillBox(1, sy - 5, 1, 3, sy - 3, 1, 0xd8dee8);
    g.fillBox(2, sy - 2, 1, 2, sy - 1, 1, 0xf4f8ff);
    return g.toGeometry(length / sy, [2.5, 1, 1.5]);
  }
  if (kind === 'staff') {
    // 雷導師の魔導スタッフ（先端に輝く青白い雷晶石）
    const sy = 26;
    const g = new VoxelGrid(5, sy, 5);
    g.fillBox(2, 0, 2, 2, sy - 6, 2, 0x4a2e1b);
    g.fillBox(1, sy - 6, 1, 3, sy - 5, 3, 0xd4af37);
    g.fillBox(1, sy - 4, 1, 3, sy - 2, 3, 0x66f0ff);
    g.set(2, sy - 1, 2, 0xffffff);
    return g.toGeometry(length / sy, [2.5, 1, 2.5]);
  }
  if (kind === 'tusks') {
    // 鎧戦象の2本の白い巨牙
    const sy = 18;
    const g = new VoxelGrid(9, sy, 5);
    g.fillBox(1, 0, 2, 2, sy - 3, 3, 0xfaf8f0);
    g.fillBox(6, 0, 2, 7, sy - 3, 3, 0xfaf8f0);
    g.fillBox(1, sy - 3, 3, 2, sy - 1, 4, 0xffffff);
    g.fillBox(6, sy - 3, 3, 7, sy - 1, 4, 0xffffff);
    return g.toGeometry(length / sy, [4.5, 1, 2.5]);
  }
  if (kind === 'axe') {
    // 突撃兵の両刃バトルアックス
    const sy = 20;
    const g = new VoxelGrid(5, sy, 7);
    g.fillBox(2, 0, 3, 2, sy - 2, 3, 0x6b4423);
    g.fillBox(1, sy - 8, 1, 3, sy - 2, 5, 0x9aa0a8);
    g.fillBox(2, sy - 9, 0, 2, sy - 1, 1, 0xf4f8ff);
    g.fillBox(2, sy - 9, 5, 2, sy - 1, 6, 0xf4f8ff);
    g.set(2, sy - 1, 3, 0xd4af37);
    return g.toGeometry(length / sy, [2.5, 1, 3.5]);
  }
  // 棍棒 / 大棍棒
  const sy = 18;
  const g = new VoxelGrid(5, sy, 5);
  const wood = kind === 'bigclub' ? 0x5c3818 : 0x7a4a21;
  g.fillBox(2, 0, 2, 2, 6, 2, wood);
  g.fillBox(1, 7, 1, 3, sy - 2, 3, wood);
  g.fillBox(1, sy - 1, 1, 3, sy - 1, 3, wood);
  if (kind === 'bigclub') {
    const stud = 0x9aa0a8;
    g.set(0, 11, 2, stud);
    g.set(4, 11, 2, stud);
    g.set(2, 11, 0, stud);
    g.set(2, 11, 4, stud);
    g.set(0, 14, 2, stud);
    g.set(4, 14, 2, stud);
  }
  return g.toGeometry(length / sy, [2.5, 1, 2.5]);
}

function buildOffhandGeometry(type: UnitType, team: Team): BufferGeometry | null {
  const tc = TEAM_COLORS[team];
  if (type.id === 'shielder') {
    // 盾兵の大盾（鉄縁・陣営カラー・中央の金鋲）
    const g = new VoxelGrid(11, 15, 3);
    g.fillBox(0, 0, 0, 10, 14, 1, 0x6c757d);
    g.fillBox(1, 1, 1, 9, 13, 2, tc.shirt);
    g.fillBox(4, 1, 2, 6, 13, 2, 0xd4af37);
    g.fillBox(1, 6, 2, 9, 8, 2, 0xd4af37);
    return g.toGeometry(0.042, [5.5, 7.5, 1]);
  }
  if (type.style === 'bomb') {
    // 爆弾兵が左手に抱える予備の黒色火薬爆弾
    const g = new VoxelGrid(6, 7, 6);
    g.fillBox(1, 0, 1, 4, 4, 4, 0x24292e);
    g.fillBox(0, 1, 1, 5, 3, 4, 0x24292e);
    g.fillBox(1, 1, 0, 4, 3, 5, 0x24292e);
    g.set(2, 5, 2, 0xd4af37);
    g.set(2, 6, 2, 0xff6b1a);
    return g.toGeometry(0.042, [3, 2.5, 3]);
  }
  if (type.style === 'bow') {
    const g = new VoxelGrid(3, 15, 7);
    const wood = 0x6e4420;
    const stringCol = 0xe8e4d8;
    for (let y = 0; y < 15; y++) {
      const d = Math.abs(y - 7);
      const z = d <= 2 ? 5 : d <= 4 ? 4 : d <= 6 ? 3 : 2;
      g.set(1, y, z, y >= 6 && y <= 8 ? tc.shirt : wood);
    }
    for (let y = 1; y < 14; y++) {
      g.set(1, y, 1, stringCol);
    }
    return g.toGeometry(0.04, [1.5, 7.5, 4]);
  }
  if (type.style === 'sniper') {
    // 対物スナイパーライフル（長い銃身・スコープ・マズルブレーキ）
    const g = new VoxelGrid(3, 7, 26);
    g.fillBox(1, 2, 0, 1, 4, 6, 0x2b3038); // ストック
    g.fillBox(1, 3, 6, 1, 4, 24, 0x1a1d24); // バレル
    g.fillBox(0, 3, 24, 2, 4, 25, 0x343a40); // マズルブレーキ
    g.fillBox(1, 5, 8, 1, 6, 14, 0x2b3038); // スコープ
    g.set(1, 5, 14, 0x38d9a9); // レンズ
    return g.toGeometry(0.04, [1.5, 3.5, 6]);
  }
  if (type.style === 'minigun') {
    // 6銃身ガトリング砲
    const g = new VoxelGrid(7, 7, 18);
    g.fillBox(1, 1, 0, 5, 5, 6, 0x343a40);
    g.fillBox(2, 2, 0, 4, 4, 6, tc.shirt);
    // 6本の回転銃身
    g.fillBox(3, 5, 6, 3, 5, 17, 0x868e96);
    g.fillBox(3, 1, 6, 3, 1, 17, 0x868e96);
    g.fillBox(1, 3, 6, 1, 3, 17, 0x868e96);
    g.fillBox(5, 3, 6, 5, 3, 17, 0x868e96);
    g.fillBox(1, 1, 14, 5, 5, 15, 0x495057);
    return g.toGeometry(0.04, [3.5, 3.5, 4]);
  }
  if (type.style === 'gravity') {
    // 重力術師が手に浮かべるミニ重力球
    const g = new VoxelGrid(5, 5, 5);
    g.fillBox(1, 1, 1, 3, 3, 3, 0x180828);
    g.set(2, 4, 2, 0xb042ff);
    g.set(2, 0, 2, 0xb042ff);
    g.set(0, 2, 2, 0xb042ff);
    g.set(4, 2, 2, 0xb042ff);
    return g.toGeometry(0.04, [2.5, 2.5, 2.5]);
  }
  if (type.style === 'rocket') {
    // 肩撃ち式大型ロケットランチャー（円筒チューブ・照準器・グリップ・弾頭）
    const g = new VoxelGrid(7, 7, 26);
    // ランチャー本体チューブ
    g.fillBox(1, 1, 2, 5, 5, 20, 0x3d4a3e);
    // チームカラーの識別リング
    g.fillBox(1, 1, 8, 5, 5, 10, tc.shirt);
    // リア排気ノズル（広がるコーン部）
    g.fillBox(0, 0, 0, 6, 6, 2, 0x212529);
    // 先端から覗くロケット弾頭
    g.fillBox(2, 2, 21, 4, 4, 24, 0x2b362c);
    g.fillBox(2, 2, 24, 4, 4, 25, 0xff922b);
    // オプティカル照準スコープ
    g.fillBox(1, 6, 10, 2, 6, 16, 0x1a1d24);
    g.set(1, 6, 16, 0x38d9a9);
    // フォアグリップ＆ピストルグリップ
    g.fillBox(3, 0, 12, 3, 1, 13, 0x212529);
    return g.toGeometry(0.04, [3.5, 2.5, 12]);
  }
  if (type.style === 'satellite_strike') {
    // 衛星攻撃兵士が手に持つミリタリー戦術PDA/レーザーデジグネーター
    const g = new VoxelGrid(7, 10, 3);
    // 頑丈な保護バンパーケース
    g.fillBox(0, 0, 0, 6, 9, 2, 0x1f2937);
    // シアン色に輝く戦術ディスプレイ画面
    g.fillBox(1, 2, 2, 5, 8, 2, 0x38d9a9);
    g.set(3, 5, 2, 0xffffff); // ターゲットマーク
    // アンテナロッド
    g.fillBox(5, 9, 1, 5, 12, 1, 0x9ca3af);
    g.set(5, 12, 1, 0xff6b6b);
    return g.toGeometry(0.038, [3.5, 4.5, 1.5]);
  }
  if (type.id === 'sezain') {
    return buildSubmachineGunGeometry(team);
  }
  return null;
}

function buildSubmachineGunGeometry(team: Team): BufferGeometry {
  const tc = TEAM_COLORS[team];
  const g = new VoxelGrid(4, 7, 14);
  const darkGunmetal = 0x212529;
  const lightMetal = 0x495057;
  g.fillBox(1, 2, 2, 2, 5, 8, darkGunmetal);
  g.fillBox(0, 3, 4, 0, 4, 7, tc.shirt);
  g.fillBox(3, 3, 4, 3, 4, 7, tc.shirt);
  g.fillBox(1, 0, 5, 2, 2, 7, 0x121416);
  g.fillBox(1, 3, 8, 2, 4, 12, lightMetal);
  g.fillBox(1, 3, 12, 2, 4, 13, darkGunmetal);
  g.fillBox(1, 0, 2, 2, 2, 3, 0x1a1d20);
  g.fillBox(1, 3, 0, 2, 4, 2, 0x343a40);
  return g.toGeometry(0.038, [1.5, 3.0, 4.0]);
}

function getUnitTemplateSet(type: UnitType, team: Team): UnitTemplateSet {
  const key = `${type.id}:${team}`;
  let set = templateCache.get(key);
  if (set) return set;
  const tc = TEAM_COLORS[team];
  const isWinged = type.id === 'giant_eagle' || type.id === 'dragon';
  const sleeve =
    type.look.armor ?? (type.id === 'giant' || type.id === 'warelephant' || type.id === 'slime' ? type.look.skin : tc.shirt);
  const legColor =
    type.id === 'dragon'
      ? tc.shirt
      : type.id === 'warelephant' || type.id === 'slime'
        ? type.look.skin
        : type.id === 'giant_eagle'
          ? 0xf5b82e
          : type.id === 'decoy'
            ? 0x7f5539
            : tc.pants;

  let upperArm: VoxelPartTemplate;
  let forearm: VoxelPartTemplate;
  let thigh: VoxelPartTemplate;
  let shin: VoxelPartTemplate;

  if (type.id === 'giant_tank') {
    // 戦車（超巨大）の重装無限軌道ロードホイール
    upperArm = buildWheelTemplate(5, 4);
    forearm = buildWheelTemplate(5, 4);
    thigh = buildWheelTemplate(6, 5);
    shin = buildWheelTemplate(6, 5);
  } else if (type.id === 'giant_robot') {
    // 巨大ロボットの重装甲メカ四肢（ショルダーアーマー・ロケットナックル・ヘビーフット）
    upperArm = buildLimbTemplate(4, 7, 4, 0x495057, tc.shirt, 0.32);
    forearm = buildLimbTemplate(4, 6, 4, 0x212529, 0x495057, 0.28);
    thigh = buildLimbTemplate(4, 8, 4, 0x343a40, 0x495057, 0.42);
    shin = buildLimbTemplate(4, 8, 5, 0x212529, tc.shirt, 0.43);
  } else if (type.id === 'buggy') {
    // 暴走バギーの4輪タイヤ
    upperArm = buildWheelTemplate(4, 3);
    forearm = buildWheelTemplate(4, 3);
    thigh = buildWheelTemplate(5, 4);
    shin = buildWheelTemplate(5, 4);
  } else if (type.id === 'anaconda') {
    // 巨大アナコンダの蛇身・尾
    upperArm = buildLimbTemplate(4, 6, 4, 0xb7e4c7, type.look.skin, 0.28);
    forearm = buildLimbTemplate(4, 6, 4, 0xb7e4c7, type.look.skin, 0.26);
    thigh = buildLimbTemplate(4, 7, 4, 0xb7e4c7, type.look.skin, 0.38);
    shin = buildLimbTemplate(3, 8, 3, 0xb7e4c7, type.look.skin, 0.42);
  } else if (type.id === 'dragon') {
    // ドラゴンのチームカラー翼と脚
    upperArm = buildWingTemplate(tc.shirt, 0xe6a122, 0.35);
    forearm = buildWingTemplate(0xe6a122, tc.shirt, 0.33);
    thigh = buildLimbTemplate(4, 8, 4, tc.shirt, tc.shirt, 0.41);
    shin = buildLimbTemplate(3, 8, 4, tc.shirt, tc.shirt, 0.4);
  } else if (type.id === 'decoy') {
    // おとりの木と藁の手足
    upperArm = buildLimbTemplate(3, 7, 3, type.look.skin, 0x7f5539, 0.29);
    forearm = buildLimbTemplate(3, 6, 3, type.look.skin, type.look.skin, 0.26);
    thigh = buildLimbTemplate(3, 8, 3, 0x7f5539, 0x7f5539, 0.4);
    shin = buildLimbTemplate(3, 8, 3, 0x7f5539, 0x7f5539, 0.4);
  } else if (type.id === 'sezain') {
    // セザイン: ライダースジャケットの腕とジーンズ脚
    upperArm = buildLimbTemplate(3, 7, 3, 0x212529, 0x212529, 0.29);
    forearm = buildLimbTemplate(3, 6, 3, 0x212529, 0x212529, 0.26);
    thigh = buildLimbTemplate(4, 8, 4, 0x1e293b, 0x1e293b, 0.41);
    shin = buildLimbTemplate(4, 8, 4, 0x111827, 0x1e293b, 0.4);
  } else if (type.id === 'yamamuron') {
    // ヤマムロン: 巨山の一体感を保つ裾野岩盤
    upperArm = buildLimbTemplate(2, 2, 2, 0x1e3621, 0x1e3621, 0.2);
    forearm = buildLimbTemplate(2, 2, 2, 0x1e3621, 0x1e3621, 0.2);
    thigh = buildLimbTemplate(3, 3, 3, 0x1e3621, 0x1e3621, 0.3);
    shin = buildLimbTemplate(3, 3, 3, 0x1e3621, 0x1e3621, 0.3);
  } else if (type.id === 'hongon') {
    // ホンゴン: ピアニストのタキシード腕とスラックス脚
    upperArm = buildLimbTemplate(3, 7, 3, 0x18181b, 0x18181b, 0.29);
    forearm = buildLimbTemplate(3, 6, 3, 0xffffff, 0x18181b, 0.26);
    thigh = buildLimbTemplate(3, 7, 3, 0x18181b, 0x18181b, 0.38);
    shin = buildLimbTemplate(3, 7, 3, 0x09090b, 0x18181b, 0.38);
  } else {
    upperArm = isWinged
      ? buildWingTemplate(type.look.skin, type.look.armor ?? tc.shirt, 0.34)
      : buildLimbTemplate(3, 7, 3, type.look.skin, sleeve, 0.29);
    forearm = isWinged
      ? buildWingTemplate(type.look.armor ?? tc.shirt, type.look.skin, 0.32)
      : buildLimbTemplate(3, 6, 3, type.look.skin, type.look.skin, 0.26);
    thigh = buildLimbTemplate(4, 8, 4, legColor, legColor, 0.41);
    shin = buildLimbTemplate(
      3,
      8,
      4,
      type.id === 'giant_eagle' || type.id === 'warelephant' || type.id === 'slime' ? legColor : 0x3b2614,
      legColor,
      0.4,
    );
  }

  set = {
    head: buildHeadTemplate(type, team),
    torso: buildTorsoTemplate(type, team),
    upperArm,
    forearm,
    thigh,
    shin,
    weapon:
      type.id === 'sezain'
        ? buildSubmachineGunGeometry(team)
        : type.weapon
        ? buildWeaponGeometry(type.weapon.kind, type.weapon.length, team)
        : null,
    bow: buildOffhandGeometry(type, team),
  };
  templateCache.set(key, set);
  return set;
}

/** 飛翔体（矢・銃弾・徹甲弾・手裏剣・火炎球）のジオメトリキャッシュ */
const projectileGeoCache = new Map<ProjectileKind, BufferGeometry>();

export function getProjectileGeometry(kind: ProjectileKind = 'arrow'): BufferGeometry {
  const cached = projectileGeoCache.get(kind);
  if (cached) return cached;

  let geom: BufferGeometry;
  if (kind === 'bullet') {
    const g = new VoxelGrid(2, 6, 2);
    g.fillBox(0, 0, 0, 1, 5, 1, 0xffe066);
    geom = g.toGeometry(0.032, [1, 6, 1]);
  } else if (kind === 'sniper') {
    const g = new VoxelGrid(2, 12, 2);
    g.fillBox(0, 0, 0, 1, 7, 1, 0xff922b);
    g.fillBox(0, 8, 0, 1, 11, 1, 0xffffff);
    geom = g.toGeometry(0.035, [1, 12, 1]);
  } else if (kind === 'shuriken') {
    // 十字手裏剣
    const g = new VoxelGrid(7, 2, 7);
    g.fillBox(2, 0, 2, 4, 0, 4, 0x495057);
    g.fillBox(3, 0, 0, 3, 0, 6, 0xd8dee8);
    g.fillBox(0, 0, 3, 6, 0, 3, 0xd8dee8);
    g.set(3, 0, 3, 0x181820);
    geom = g.toGeometry(0.035, [3.5, 0.5, 3.5]);
  } else if (kind === 'flame') {
    const g = new VoxelGrid(5, 5, 5);
    g.fillBox(0, 0, 0, 4, 4, 4, 0xff5900);
    g.fillBox(1, 1, 1, 3, 3, 3, 0xffd43b);
    geom = g.toGeometry(0.055, [2.5, 2.5, 2.5]);
  } else if (kind === 'bomb') {
    // 導火線付きの黒色火薬爆弾
    const g = new VoxelGrid(7, 8, 7);
    g.fillBox(1, 0, 1, 5, 5, 5, 0x212529);
    g.fillBox(0, 1, 1, 6, 4, 5, 0x2b3035);
    g.fillBox(1, 1, 0, 5, 4, 6, 0x2b3035);
    g.set(3, 6, 3, 0xd4af37);
    g.set(3, 7, 3, 0xff5900);
    geom = g.toGeometry(0.048, [3.5, 3, 3.5]);
  } else if (kind === 'rocket') {
    // 直進ロケット弾（先端コーン・オリーブ弾体・4枚の安定翼フィン）
    const g = new VoxelGrid(7, 14, 7);
    // 中央の円筒弾体
    g.fillBox(2, 2, 2, 4, 10, 4, 0x3d4a3e);
    // 先端信管コーン（オレンジ・イエロー）
    g.fillBox(2, 11, 2, 4, 12, 4, 0xff922b);
    g.set(3, 13, 3, 0xffd43b);
    // 後部推進ノズル
    g.fillBox(2, 0, 2, 4, 1, 4, 0x212529);
    // 4枚の十字スタビライザー翼（フィン）
    g.fillBox(3, 1, 0, 3, 4, 1, 0x1f2420);
    g.fillBox(3, 1, 5, 3, 4, 6, 0x1f2420);
    g.fillBox(0, 1, 3, 1, 4, 3, 0x1f2420);
    g.fillBox(5, 1, 3, 6, 4, 3, 0x1f2420);
    geom = g.toGeometry(0.042, [3.5, 14, 3.5]);
  } else if (kind === 'tank_shell') {
    // 戦車主砲の大口径徹甲榴弾（ゴールド薬莢・重量感ある徹甲弾頭）
    const g = new VoxelGrid(5, 12, 5);
    g.fillBox(1, 0, 1, 3, 8, 3, 0xd4af37);
    g.fillBox(1, 9, 1, 3, 10, 3, 0x495057);
    g.set(2, 11, 2, 0xced4da);
    geom = g.toGeometry(0.048, [2.5, 12, 2.5]);
  } else if (kind === 'rocket_punch') {
    // 巨大ロボットのロケットパンチ（鋼鉄ナックル＋ナックルガード＋推進スラスターノズル）
    const g = new VoxelGrid(9, 14, 9);
    const darkSteel = 0x212529;
    const armorPlate = 0x495057;
    const lightPlate = 0x868e96;
    // 前方ナックル・握り拳（y=7..13）
    g.fillBox(2, 7, 2, 6, 12, 6, armorPlate);
    // 拳のナックルガード（前部装甲突起）
    g.fillBox(2, 11, 7, 6, 13, 7, darkSteel);
    g.fillBox(2, 12, 2, 6, 13, 6, lightPlate);
    // 指関節ディテール
    g.fillBox(3, 8, 7, 3, 10, 7, lightPlate);
    g.fillBox(5, 8, 7, 5, 10, 7, lightPlate);
    // 中央アームスリーブ＆識別リング（y=4..6）
    g.fillBox(2, 4, 2, 6, 6, 6, darkSteel);
    g.fillBox(1, 5, 1, 7, 5, 7, 0xffd43b); // ゴールドリング
    // 後部円形ロケット推進ノズル（y=0..3）
    g.fillBox(2, 1, 2, 6, 3, 6, darkSteel);
    g.fillBox(1, 0, 1, 7, 1, 7, 0x1f2420);
    // 噴射口内部のプラズマコア（高熱の青白色）
    g.fillBox(3, 0, 3, 5, 1, 5, 0x74c0fc);
    g.set(4, 0, 4, 0xffffff);
    geom = g.toGeometry(0.048, [4.5, 14, 4.5]);
  } else if (kind === 'angel_bomb') {
    const g = new VoxelGrid(7, 7, 7);
    g.fillBox(1, 1, 1, 5, 5, 5, 0xf76707);
    g.fillBox(2, 0, 2, 4, 6, 4, 0xffd43b);
    g.fillBox(0, 2, 2, 6, 4, 4, 0xffd43b);
    g.fillBox(2, 2, 0, 4, 4, 6, 0xffd43b);
    g.fillBox(2, 2, 2, 4, 4, 4, 0xff0000);
    geom = g.toGeometry(0.065, [3.5, 3.5, 3.5]);
  } else if (kind === 'volcano_rock') {
    // 巨大火山弾（マグマが走るゴツゴツとした溶岩岩石）
    const g = new VoxelGrid(8, 8, 8);
    g.fillBox(1, 1, 1, 6, 6, 6, 0x2b2d42);
    g.fillBox(0, 2, 2, 7, 5, 5, 0x1a1a24);
    g.fillBox(2, 0, 2, 5, 7, 5, 0x1a1a24);
    g.fillBox(2, 2, 0, 5, 5, 7, 0x1a1a24);
    g.set(3, 7, 3, 0xff5900);
    g.set(4, 7, 4, 0xffd43b);
    g.set(0, 3, 3, 0xff3b00);
    g.set(7, 4, 4, 0xff5900);
    g.set(3, 3, 0, 0xff922b);
    g.set(4, 4, 7, 0xff3b00);
    g.set(2, 5, 6, 0xffd43b);
    geom = g.toGeometry(0.075, [4, 4, 4]);
  } else {
    const sy = 16;
    const g = new VoxelGrid(3, sy, 3);
    g.fillBox(0, 0, 1, 2, 2, 1, 0xf2f2f2);
    g.fillBox(1, 0, 0, 1, 2, 2, 0xf2f2f2);
    g.fillBox(1, 2, 1, 1, sy - 4, 1, 0x8a5a2b);
    g.fillBox(1, sy - 3, 1, 1, sy - 1, 1, 0xd8dee8);
    geom = g.toGeometry(0.04, [1.5, sy, 1.5]);
  }
  projectileGeoCache.set(kind, geom);
  return geom;
}

export function getArrowGeometry(): BufferGeometry {
  return getProjectileGeometry('arrow');
}

let kawariLogGeo: BufferGeometry | null = null;
/** からくり忍者の「変わり身の丸太」ボクセルジオメトリ */
export function getKawariLogGeometry(): BufferGeometry {
  if (kawariLogGeo) return kawariLogGeo;
  const g = new VoxelGrid(6, 12, 6);
  // 樹皮と切り口の年輪
  g.fillBox(0, 0, 0, 5, 11, 5, 0x6b4423);
  g.fillBox(1, 0, 1, 4, 11, 4, 0xd9a76a);
  // 葉っぱが1枚ついている
  g.fillBox(4, 6, 5, 5, 8, 5, 0x409142);
  kawariLogGeo = g.toGeometry(0.045, [3, 6, 3]);
  return kawariLogGeo;
}

// ---------------------------------------------------------------
// ユニット 1 体分の描画オブジェクトと部位破壊（ボクセル損壊）
// ---------------------------------------------------------------

export type BodyPartId =
  | 'head'
  | 'torso'
  | 'upperArmL'
  | 'forearmL'
  | 'upperArmR'
  | 'forearmR'
  | 'thighL'
  | 'shinL'
  | 'thighR'
  | 'shinR';

interface DestructiblePart {
  id: BodyPartId;
  mesh: Mesh;
  template: VoxelPartTemplate;
  /** 損壊が発生したときのみ複製される個別グリッド */
  mutableGrid: VoxelGrid | null;
  ownsGeometry: boolean;
  hp: number;
  maxHp: number;
  destroyed: boolean;
  /** この部位が破壊されたときに連動して脱落する末端部位 */
  childPart: BodyPartId | null;
}

const UP = new Vector3(0, 1, 0);
const _dir = new Vector3();
const _up = new Vector3();
const _right = new Vector3();
const _fwd = new Vector3();
const _quat = new Quaternion();
const _localHit = new Vector3();
const _voxelWorld = new Vector3();

function makeMesh(geom: BufferGeometry, mat: MeshLambertMaterial, scale: number): Mesh {
  const m = new Mesh(geom, mat);
  m.scale.setScalar(scale);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** 2 点 a→b に沿ってメッシュを配置・回転する（モデルの +Y 軸を a→b に合わせる） */
function placeLimb(mesh: Mesh, a: Vector3, b: Vector3): void {
  mesh.position.copy(a);
  _dir.subVectors(b, a);
  const len = _dir.length();
  if (len < 1e-5) return;
  _dir.divideScalar(len);
  _quat.setFromUnitVectors(UP, _dir);
  mesh.quaternion.copy(_quat);
}

/** 骨盤→胸のベクトルと肩の並びから、ねじれを含む直交基底でメッシュを配置する */
function placeOrientedPart(mesh: Mesh, origin: Vector3, upDir: Vector3, shoulderL: Vector3, shoulderR: Vector3): void {
  mesh.position.copy(origin);
  _up.copy(upDir).normalize();
  _right.subVectors(shoulderR, shoulderL);
  // _up に直交化
  _right.addScaledVector(_up, -_right.dot(_up));
  if (_right.lengthSq() < 1e-6) {
    _quat.setFromUnitVectors(UP, _up);
    mesh.quaternion.copy(_quat);
    return;
  }
  _right.normalize();
  _fwd.crossVectors(_up, _right).normalize();
  // 回転行列 [right, up, fwd] からクォータニオンを求める
  const m00 = _right.x, m01 = _up.x, m02 = _fwd.x;
  const m10 = _right.y, m11 = _up.y, m12 = _fwd.y;
  const m20 = _right.z, m21 = _up.z, m22 = _fwd.z;
  const tr = m00 + m11 + m22;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1.0) * 2;
    _quat.set((m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s);
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1.0 + m00 - m11 - m22) * 2;
    _quat.set(0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s);
  } else if (m11 > m22) {
    const s = Math.sqrt(1.0 + m11 - m00 - m22) * 2;
    _quat.set((m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s);
  } else {
    const s = Math.sqrt(1.0 + m22 - m00 - m11) * 2;
    _quat.set((m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s);
  }
  mesh.quaternion.copy(_quat);
}

/**
 * 物理ラグドールの各関節位置に合わせてボクセルパーツを毎フレーム追従させ、
 * 被弾時にはボクセルの欠損・部位破壊を適用するクラス。
 */
export class VoxelCharacterVisual {
  readonly group = new Group();
  private readonly material: MeshLambertMaterial;
  private readonly parts: Record<BodyPartId, DestructiblePart>;
  private readonly weaponMesh: Mesh | null;
  private readonly bowMesh: Mesh | null;

  constructor(readonly unit: Unit) {
    const set = getUnitTemplateSet(unit.type, unit.team);
    const s = unit.scale;
    const maxHp = unit.maxHp;
    this.material = new MeshLambertMaterial({ vertexColors: true });

    const createPart = (
      id: BodyPartId,
      tmpl: VoxelPartTemplate,
      hpRatio: number,
      childPart: BodyPartId | null = null,
    ): DestructiblePart => {
      const mesh = makeMesh(tmpl.geometry, this.material, s);
      this.group.add(mesh);
      return {
        id,
        mesh,
        template: tmpl,
        mutableGrid: null,
        ownsGeometry: false,
        hp: maxHp * hpRatio,
        maxHp: maxHp * hpRatio,
        destroyed: false,
        childPart,
      };
    };

    // 各部位の耐久値を設定（四肢や頭は集中攻撃や強打で部位破壊が起きるバランス）
    this.parts = {
      head: createPart('head', set.head, 0.42),
      torso: createPart('torso', set.torso, 0.85),
      upperArmL: createPart('upperArmL', set.upperArm, 0.34, 'forearmL'),
      forearmL: createPart('forearmL', set.forearm, 0.3),
      upperArmR: createPart('upperArmR', set.upperArm, 0.38, 'forearmR'),
      forearmR: createPart('forearmR', set.forearm, 0.34),
      thighL: createPart('thighL', set.thigh, 0.38, 'shinL'),
      shinL: createPart('shinL', set.shin, 0.34),
      thighR: createPart('thighR', set.thigh, 0.38, 'shinR'),
      shinR: createPart('shinR', set.shin, 0.34),
    };

    if (set.weapon) {
      this.weaponMesh = makeMesh(set.weapon, this.material, s);
      this.group.add(this.weaponMesh);
    } else {
      this.weaponMesh = null;
    }

    if (set.bow) {
      this.bowMesh = makeMesh(set.bow, this.material, s);
      this.group.add(this.bowMesh);
    } else {
      this.bowMesh = null;
    }

    this.sync();
  }

  /** 物理粒子の現在位置に合わせて各ボクセルメッシュの座標・回転・発光色を更新する */
  sync(): void {
    const u = this.unit;
    const P = u.joints;
    const pelvis = P[J.Pelvis].pos;
    const chest = P[J.Chest].pos;
    const head = P[J.Head].pos;
    const shL = P[J.ShoulderL].pos;
    const shR = P[J.ShoulderR].pos;

    // 胴体と頭（肩の向きから正面方向を決定）
    _dir.subVectors(chest, pelvis);
    placeOrientedPart(this.parts.torso.mesh, pelvis, _dir, shL, shR);
    _dir.subVectors(head, chest);
    placeOrientedPart(this.parts.head.mesh, head, _dir, shL, shR);

    // スライムのスクワッシュ＆ストレッチ変形
    if (u.type.id === 'slime') {
      const sq = u.squash;
      const xz = u.scale / Math.sqrt(Math.max(0.35, sq));
      const y = u.scale * sq;
      this.parts.torso.mesh.scale.set(xz, y, xz);
      this.parts.head.mesh.scale.set(xz, y, xz);
    }

    // 四肢
    placeLimb(this.parts.upperArmL.mesh, shL, P[J.ElbowL].pos);
    placeLimb(this.parts.forearmL.mesh, P[J.ElbowL].pos, P[J.HandL].pos);
    placeLimb(this.parts.upperArmR.mesh, shR, P[J.ElbowR].pos);
    placeLimb(this.parts.forearmR.mesh, P[J.ElbowR].pos, P[J.HandR].pos);
    placeLimb(this.parts.thighL.mesh, P[J.HipL].pos, P[J.KneeL].pos);
    placeLimb(this.parts.shinL.mesh, P[J.KneeL].pos, P[J.FootL].pos);
    placeLimb(this.parts.thighR.mesh, P[J.HipR].pos, P[J.KneeR].pos);
    placeLimb(this.parts.shinR.mesh, P[J.KneeR].pos, P[J.FootR].pos);

    // 近接武器・右手武器（右前腕が破壊されたら非表示）
    if (this.weaponMesh) {
      if (u.weaponParticles.length === 2) {
        this.weaponMesh.visible = !this.parts.forearmR.destroyed;
        placeLimb(this.weaponMesh, P[J.HandR].pos, u.weaponParticles[1].pos);
      } else if (u.type.id === 'sezain') {
        this.weaponMesh.visible = !this.parts.forearmR.destroyed;
        _dir.subVectors(chest, pelvis);
        placeOrientedPart(this.weaponMesh, P[J.HandR].pos, _dir, shL, shR);
      }
    }

    // 弓・銃・ガトリング・重力球・大盾（左前腕が破壊されたら非表示）
    if (this.bowMesh) {
      this.bowMesh.visible = !this.parts.forearmL.destroyed;
      _dir.subVectors(chest, pelvis);
      const anchorPos = u.shieldParticle ? u.shieldParticle.pos : P[J.HandL].pos;
      placeOrientedPart(this.bowMesh, anchorPos, _dir, shL, shR);
      if (u.type.id === 'minigunner') {
        this.bowMesh.rotateZ(u.barrelSpin);
      }
    }

    // 被弾フラッシュ・感電・炎上発光と死亡時の暗転
    if (u.hitFlash > 0) {
      this.material.emissive.setRGB(u.hitFlash * 0.7, u.hitFlash * 0.15, u.hitFlash * 0.1);
    } else if (u.shockTimer > 0) {
      this.material.emissive.setRGB(0.15, 0.55, 0.85);
    } else if (u.burnTimer > 0) {
      this.material.emissive.setRGB(0.65, 0.22, 0.02);
    } else {
      this.material.emissive.setRGB(0, 0, 0);
    }
    if (!u.alive) {
      this.material.color.setRGB(0.62, 0.62, 0.65);
    } else {
      this.material.color.setRGB(1, 1, 1);
    }
  }

  /**
   * 被弾箇所のボクセルを削り取り（または部位ごと破壊し）、
   * ドロップする不透明ボクセルパーティクルのリストを返す。
   */
  applyHitDamage(
    hitParticle: Particle,
    worldPoint: Vector3,
    damage: number,
    killed: boolean,
    carveScale = 1.0,
  ): { drops: DroppedVoxelSeed[]; partBroken: boolean } {
    this.group.updateMatrixWorld(true);
    const drops: DroppedVoxelSeed[] = [];
    let partBroken = false;

    const targetPart = this.resolveTargetPart(hitParticle, worldPoint);
    if (!targetPart) {
      return { drops, partBroken: false };
    }

    targetPart.hp -= damage * carveScale;

    // 1. 部位の耐久値が尽きた場合（または致命傷で頭部・四肢に当たった場合）は部位ごと粉砕する
    if (targetPart.hp <= 0 && targetPart.id !== 'torso') {
      this.shatterPart(targetPart, drops, 42);
      partBroken = true;
      if (targetPart.childPart) {
        const child = this.parts[targetPart.childPart];
        if (!child.destroyed) {
          this.shatterPart(child, drops, 28);
        }
      }
    } else {
      // 2. 部位の一部のボクセルをクレーター状に削り取ってドロップさせる
      const dmgRatio = Math.min(1.5, damage / Math.max(1, this.unit.maxHp));
      const baseRadius =
        targetPart.id === 'torso' || targetPart.id === 'head' ? 1.5 + dmgRatio * 2.8 : 1.3 + dmgRatio * 2.2;
      const carveRadius = baseRadius * Math.sqrt(carveScale);
      const carved = this.carveVoxelsAt(targetPart, worldPoint, carveRadius, drops);

      // 胴体以外の部位で残存ボクセルが 30% 未満になったら完全破壊に移行
      if (targetPart.id !== 'torso' && targetPart.mutableGrid) {
        const remain = targetPart.mutableGrid.countFilled();
        const initial = targetPart.template.grid.countFilled();
        if (remain < initial * 0.3) {
          this.shatterPart(targetPart, drops, 30);
          partBroken = true;
        }
      }

      // 万一かすり当たり等で削れたボクセル数が少ない場合も、表面のボクセル片を数個ドロップさせる
      if (carved < 5) {
        const worldVoxelSize = targetPart.template.voxelSize * this.unit.scale;
        const fallbackColor = TEAM_COLORS[this.unit.team].shirt;
        const extra = 6 - carved;
        for (let i = 0; i < extra; i++) {
          drops.push({
            pos: worldPoint.clone().add(
              new Vector3(
                (Math.random() - 0.5) * 0.12,
                (Math.random() - 0.5) * 0.12,
                (Math.random() - 0.5) * 0.12,
              ),
            ),
            color: i % 2 === 0 ? fallbackColor : this.unit.type.look.skin,
            size: worldVoxelSize,
          });
        }
      }
    }

    // 3. 撃破（死亡）時はさらに派手な部位損壊を追加
    if (killed) {
      partBroken = true;
      if (!this.parts.torso.destroyed) {
        this.carveVoxelsAt(this.parts.torso, this.unit.chest.pos, 2.8, drops);
      }
      const anyBroken = Object.values(this.parts).some((p) => p.destroyed);
      if (!anyBroken) {
        const victimPart = !this.parts.head.destroyed ? this.parts.head : this.parts.upperArmR;
        this.shatterPart(victimPart, drops, 36);
      }
    }

    return { drops, partBroken };
  }

  /** 被弾した関節粒子（または座標）から対応する部位を特定する */
  private resolveTargetPart(hitParticle: Particle, worldPoint: Vector3): DestructiblePart | null {
    const idx = this.unit.joints.indexOf(hitParticle);
    const map: Readonly<Record<number, BodyPartId>> = {
      [J.Head]: 'head',
      [J.Chest]: 'torso',
      [J.Pelvis]: 'torso',
      [J.ShoulderL]: 'upperArmL',
      [J.ElbowL]: 'forearmL',
      [J.HandL]: 'forearmL',
      [J.ShoulderR]: 'upperArmR',
      [J.ElbowR]: 'forearmR',
      [J.HandR]: 'forearmR',
      [J.HipL]: 'thighL',
      [J.KneeL]: 'shinL',
      [J.FootL]: 'shinL',
      [J.HipR]: 'thighR',
      [J.KneeR]: 'shinR',
      [J.FootR]: 'shinR',
    };
    const primaryId = map[idx];
    if (primaryId && !this.parts[primaryId].destroyed) {
      return this.parts[primaryId];
    }
    let best: DestructiblePart | null = null;
    let bestDist = Infinity;
    for (const part of Object.values(this.parts)) {
      if (part.destroyed) continue;
      const d = part.mesh.position.distanceToSquared(worldPoint);
      if (d < bestDist) {
        bestDist = d;
        best = part;
      }
    }
    return best;
  }

  /** 指定部位のワールド座標 worldPoint 周辺のボクセルを球状に削り取り、メッシュを再構築する */
  private carveVoxelsAt(
    part: DestructiblePart,
    worldPoint: Vector3,
    gridRadius: number,
    outDrops: DroppedVoxelSeed[],
  ): number {
    if (part.destroyed) return 0;
    if (!part.mutableGrid) {
      part.mutableGrid = part.template.grid.clone();
    }
    const grid = part.mutableGrid;
    const vs = part.template.voxelSize;
    const pivot = part.template.pivot;
    const worldVoxelSize = vs * this.unit.scale;

    part.mesh.updateMatrixWorld();
    _localHit.copy(worldPoint);
    part.mesh.worldToLocal(_localHit);

    const gx = _localHit.x / vs + pivot[0];
    const gy = _localHit.y / vs + pivot[1];
    const gz = _localHit.z / vs + pivot[2];

    let bestDist2 = Infinity;
    let cx = Math.round(gx);
    let cy = Math.round(gy);
    let cz = Math.round(gz);
    for (let z = 0; z < grid.sz; z++) {
      for (let y = 0; y < grid.sy; y++) {
        for (let x = 0; x < grid.sx; x++) {
          if (grid.get(x, y, z) === 0) continue;
          const d2 = (x + 0.5 - gx) ** 2 + (y + 0.5 - gy) ** 2 + (z + 0.5 - gz) ** 2;
          if (d2 < bestDist2) {
            bestDist2 = d2;
            cx = x;
            cy = y;
            cz = z;
          }
        }
      }
    }

    const r2 = gridRadius * gridRadius;
    const x0 = Math.max(0, Math.floor(cx - gridRadius));
    const x1 = Math.min(grid.sx - 1, Math.ceil(cx + gridRadius));
    const y0 = Math.max(0, Math.floor(cy - gridRadius));
    const y1 = Math.min(grid.sy - 1, Math.ceil(cy + gridRadius));
    const z0 = Math.max(0, Math.floor(cz - gridRadius));
    const z1 = Math.min(grid.sz - 1, Math.ceil(cz + gridRadius));

    let removed = 0;
    for (let z = z0; z <= z1; z++) {
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const col = grid.get(x, y, z);
          if (col === 0) continue;
          const d2 = (x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2;
          if (d2 <= r2) {
            grid.set(x, y, z, 0);
            removed++;
            _voxelWorld.set(
              (x + 0.5 - pivot[0]) * vs,
              (y + 0.5 - pivot[1]) * vs,
              (z + 0.5 - pivot[2]) * vs,
            );
            part.mesh.localToWorld(_voxelWorld);
            outDrops.push({
              pos: _voxelWorld.clone(),
              color: col,
              size: worldVoxelSize,
            });
          }
        }
      }
    }

    if (removed > 0) {
      if (part.ownsGeometry) {
        part.mesh.geometry.dispose();
      }
      part.mesh.geometry = grid.toGeometry(vs, pivot);
      part.ownsGeometry = true;
    }
    return removed;
  }

  /** 部位全体を破壊し、残っている全ボクセルを不透明パーティクルとして放出する */
  private shatterPart(part: DestructiblePart, outDrops: DroppedVoxelSeed[], maxDrops: number): void {
    if (part.destroyed) return;
    part.destroyed = true;
    part.mesh.visible = false;

    const grid = part.mutableGrid ?? part.template.grid;
    const vs = part.template.voxelSize;
    const pivot = part.template.pivot;
    const worldVoxelSize = vs * this.unit.scale;
    part.mesh.updateMatrixWorld();

    const candidates: DroppedVoxelSeed[] = [];
    for (let z = 0; z < grid.sz; z++) {
      for (let y = 0; y < grid.sy; y++) {
        for (let x = 0; x < grid.sx; x++) {
          const col = grid.get(x, y, z);
          if (col === 0) continue;
          _voxelWorld.set(
            (x + 0.5 - pivot[0]) * vs,
            (y + 0.5 - pivot[1]) * vs,
            (z + 0.5 - pivot[2]) * vs,
          );
          part.mesh.localToWorld(_voxelWorld);
          candidates.push({
            pos: _voxelWorld.clone(),
            color: col,
            size: worldVoxelSize,
          });
        }
      }
    }

    const step = Math.max(1, Math.ceil(candidates.length / maxDrops));
    for (let i = 0; i < candidates.length; i += step) {
      outDrops.push(candidates[i]);
    }

    if (part.ownsGeometry) {
      part.mesh.geometry.dispose();
      part.ownsGeometry = false;
    }
  }

  dispose(): void {
    for (const part of Object.values(this.parts)) {
      if (part.ownsGeometry) {
        part.mesh.geometry.dispose();
      }
    }
    this.material.dispose();
  }
}

/** 配置プレビュー用の半透明ゴーストモデルを生成する */
export function createPreviewGhost(type: UnitType, team: Team): Group {
  const set = getUnitTemplateSet(type, team);
  const mat = new MeshLambertMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.65,
  });
  const s = type.scale;
  const g = new Group();
  const torso = makeMesh(set.torso.geometry, mat, s);
  torso.position.set(0, 0.96 * s, 0);
  const head = makeMesh(set.head.geometry, mat, s);
  head.position.set(0, 1.74 * s, 0);
  g.add(torso, head);
  g.rotation.y = team === 0 ? Math.PI / 2 : -Math.PI / 2;
  return g;
}

/** 施設のボクセルグリッドを生成する */
export function buildFacilityVoxelGrid(typeId: FacilityTypeId, team: Team): { grid: VoxelGrid; voxelSize: number } {
  const teamCol = TEAM_COLORS[team];
  const primary = teamCol.shirt;
  const accent = teamCol.accent;

  switch (typeId) {
    case 'barracks': {
      // 召喚ポータル: 石の台座、四隅のオベリスク柱、中央の浮遊魔力クリスタル
      const sx = 24;
      const sy = 26;
      const sz = 24;
      const voxelSize = 0.088;
      const g = new VoxelGrid(sx, sy, sz);

      // 八角形台座
      const r = 10;
      const cx = 11.5;
      const cz = 11.5;
      for (let y = 0; y <= 3; y++) {
        const stoneCol = y === 0 ? 0x2e3138 : y === 3 ? 0x484c56 : 0x3a3d46;
        for (let z = 0; z < sz; z++) {
          for (let x = 0; x < sx; x++) {
            const dx = Math.abs(x - cx);
            const dz = Math.abs(z - cz);
            if (dx * dx + dz * dz <= r * r && dx + dz <= r * 1.35) {
              g.set(x, y, z, stoneCol);
            }
          }
        }
      }
      // 台座上面のルーン円環
      for (let z = 0; z < sz; z++) {
        for (let x = 0; x < sx; x++) {
          const d2 = (x - cx) ** 2 + (z - cz) ** 2;
          if (d2 >= 6.5 * 6.5 && d2 <= 8.5 * 8.5) {
            g.set(x, 3, z, primary);
          } else if (d2 <= 2.5 * 2.5) {
            g.set(x, 3, z, accent);
          }
        }
      }

      // 四隅のオベリスク柱
      const pillars = [
        [3, 3],
        [17, 3],
        [3, 17],
        [17, 17],
      ];
      for (const [px, pz] of pillars) {
        for (let y = 3; y <= 24; y++) {
          const pCol = y % 5 === 0 ? primary : 0x555a66;
          for (let z = pz; z <= pz + 3; z++) {
            for (let x = px; x <= px + 3; x++) {
              g.set(x, y, z, pCol);
            }
          }
        }
        // 柱の頂上飾り
        g.set(px + 1, 25, pz + 1, accent);
        g.set(px + 2, 25, pz + 1, accent);
        g.set(px + 1, 25, pz + 2, accent);
        g.set(px + 2, 25, pz + 2, accent);
      }

      // 中央の浮遊魔力クリスタル
      for (let y = 13; y <= 20; y++) {
        const cr = y <= 16 ? (y - 12) * 0.75 : (21 - y) * 0.75;
        for (let z = 8; z <= 15; z++) {
          for (let x = 8; x <= 15; x++) {
            const d2 = (x - cx) ** 2 + (z - cz) ** 2;
            if (d2 <= cr * cr) {
              g.set(x, y, z, y % 2 === 0 ? accent : primary);
            }
          }
        }
      }

      return { grid: g, voxelSize };
    }

    case 'buff_totem': {
      // 加護のトーテム: 木製トーテムポール、翼彫刻、黄金冠、輝く宝珠
      const sx = 20;
      const sy = 32;
      const sz = 20;
      const voxelSize = 0.08;
      const g = new VoxelGrid(sx, sy, sz);
      const cx = 9.5;
      const cz = 9.5;

      // 台座（石）
      for (let y = 0; y <= 3; y++) {
        for (let z = 3; z <= 16; z++) {
          for (let x = 3; x <= 16; x++) {
            const d2 = (x - cx) ** 2 + (z - cz) ** 2;
            if (d2 <= 6.8 * 6.8) {
              g.set(x, y, z, 0x3c3f47);
            }
          }
        }
      }

      // 木のトーテム柱（y: 4..25）
      for (let y = 4; y <= 25; y++) {
        const woodCol = (y % 4 === 0) ? 0x4a3220 : 0x62422b;
        for (let z = 7; z <= 12; z++) {
          for (let x = 7; x <= 12; x++) {
            g.set(x, y, z, woodCol);
          }
        }
      }

      // 彫刻帯（下段: チームカラー羽飾り y: 8..11）
      for (let y = 8; y <= 11; y++) {
        for (let x = 3; x <= 6; x++) {
          g.set(x, y, 9, primary);
          g.set(x, y, 10, primary);
        }
        for (let x = 13; x <= 16; x++) {
          g.set(x, y, 9, primary);
          g.set(x, y, 10, primary);
        }
      }

      // 中段アクセント（y: 15..17）
      for (let y = 15; y <= 17; y++) {
        for (let z = 6; z <= 13; z++) {
          for (let x = 6; x <= 13; x++) {
            if (x === 6 || x === 13 || z === 6 || z === 13) {
              g.set(x, y, z, accent);
            }
          }
        }
      }

      // 上段の大翼（y: 20..25）
      for (let y = 20; y <= 25; y++) {
        const wingSpan = (y - 19) * 1.2;
        for (let w = 1; w <= wingSpan; w++) {
          g.set(Math.max(1, Math.round(6 - w)), y, 9, primary);
          g.set(Math.max(1, Math.round(6 - w)), y, 10, primary);
          g.set(Math.min(18, Math.round(13 + w)), y, 9, primary);
          g.set(Math.min(18, Math.round(13 + w)), y, 10, primary);
        }
      }

      // 頂上の黄金冠（y: 26..27）
      for (let y = 26; y <= 27; y++) {
        for (let z = 6; z <= 13; z++) {
          for (let x = 6; x <= 13; x++) {
            g.set(x, y, z, 0xffd23a);
          }
        }
      }

      // 最上部の輝く宝珠（y: 28..31）
      for (let y = 28; y <= 31; y++) {
        for (let z = 7; z <= 12; z++) {
          for (let x = 7; x <= 12; x++) {
            const d2 = (x - cx) ** 2 + (z - cz) ** 2 + (y - 29.5) ** 2;
            if (d2 <= 2.6 * 2.6) {
              g.set(x, y, z, primary);
            }
          }
        }
      }

      return { grid: g, voxelSize };
    }

    case 'multiplier_gate': {
      // 増殖ゲート: 左右の頑丈な門柱、上部アーチ梁、「x2」プレート、中央のエネルギー膜
      const sx = 34;
      const sy = 32;
      const sz = 12;
      const voxelSize = 0.088;
      const g = new VoxelGrid(sx, sy, sz);

      // 左柱 (x: 2..8, z: 2..9, y: 0..27)
      for (let y = 0; y <= 27; y++) {
        const pCol = y % 6 === 0 ? primary : 0x3d434e;
        for (let z = 2; z <= 9; z++) {
          for (let x = 2; x <= 8; x++) {
            g.set(x, y, z, pCol);
          }
        }
        // 柱の前面ライン
        g.set(5, y, 10, primary);
      }
      // 左柱ベース拡大
      for (let y = 0; y <= 2; y++) {
        for (let z = 1; z <= 10; z++) {
          for (let x = 1; x <= 9; x++) {
            g.set(x, y, z, 0x2e323b);
          }
        }
      }

      // 右柱 (x: 25..31, z: 2..9, y: 0..27)
      for (let y = 0; y <= 27; y++) {
        const pCol = y % 6 === 0 ? primary : 0x3d434e;
        for (let z = 2; z <= 9; z++) {
          for (let x = 25; x <= 31; x++) {
            g.set(x, y, z, pCol);
          }
        }
        // 柱の前面ライン
        g.set(28, y, 10, primary);
      }
      // 右柱ベース拡大
      for (let y = 0; y <= 2; y++) {
        for (let z = 1; z <= 10; z++) {
          for (let x = 24; x <= 32; x++) {
            g.set(x, y, z, 0x2e323b);
          }
        }
      }

      // 上部アーチ梁 (y: 25..31, x: 2..31, z: 3..8)
      for (let y = 25; y <= 31; y++) {
        for (let z = 3; z <= 8; z++) {
          for (let x = 2; x <= 31; x++) {
            g.set(x, y, z, 0x484f5c);
          }
        }
      }

      // 中央上部「x2」プレート (y: 27..30, x: 13..21, z: 9)
      const gold = 0xffd700;
      // 'x' (x: 13..15, y: 27..29)
      g.set(13, 27, 9, gold);
      g.set(15, 27, 9, gold);
      g.set(14, 28, 9, gold);
      g.set(13, 29, 9, gold);
      g.set(15, 29, 9, gold);

      // '2' (x: 17..20, y: 27..30)
      g.set(17, 30, 9, gold);
      g.set(18, 30, 9, gold);
      g.set(19, 30, 9, gold);
      g.set(20, 29, 9, gold);
      g.set(19, 28, 9, gold);
      g.set(18, 28, 9, gold);
      g.set(17, 27, 9, gold);
      g.set(18, 27, 9, gold);
      g.set(19, 27, 9, gold);
      g.set(20, 27, 9, gold);

      // 中央のエネルギー膜（開口部 x: 9..24, y: 2..24, z: 5..6）
      const energyCol = primary;
      for (let y = 2; y <= 24; y++) {
        for (let x = 9; x <= 24; x++) {
          // 格子状またはストライプ状のエネルギーライン
          if ((x + y) % 3 === 0 || y % 4 === 0) {
            g.set(x, y, 5, energyCol);
            g.set(x, y, 6, energyCol);
          }
        }
      }

      return { grid: g, voxelSize };
    }

    case 'cannon_tower': {
      // 防衛キャノン砲台: 円柱石積み砦、胸壁付きデッキ、黒鉄の長砲身
      const sx = 24;
      const sy = 26;
      const sz = 24;
      const voxelSize = 0.09;
      const g = new VoxelGrid(sx, sy, sz);
      const cx = 11.5;
      const cz = 11.5;
      const r = 9.2;

      // 下部円柱要塞 (y: 0..17)
      for (let y = 0; y <= 17; y++) {
        const isBelt = y === 11 || y === 12;
        for (let z = 0; z < sz; z++) {
          for (let x = 0; x < sx; x++) {
            const d2 = (x - cx) ** 2 + (z - cz) ** 2;
            if (d2 <= r * r) {
              if (isBelt && d2 >= (r - 1.5) ** 2) {
                g.set(x, y, z, primary);
              } else {
                const stone = ((x * 17 + y * 31 + z * 53) & 7) > 3 ? 0x444750 : 0x545863;
                g.set(x, y, z, stone);
              }
            }
          }
        }
      }

      // デッキ床 (y: 18, 木製)
      for (let z = 0; z < sz; z++) {
        for (let x = 0; x < sx; x++) {
          const d2 = (x - cx) ** 2 + (z - cz) ** 2;
          if (d2 <= (r + 0.5) ** 2) {
            g.set(x, 18, z, 0x563e2a);
          }
        }
      }

      // 胸壁（y: 19..21 の外周凹凸）
      for (let y = 19; y <= 21; y++) {
        for (let z = 0; z < sz; z++) {
          for (let x = 0; x < sx; x++) {
            const d2 = (x - cx) ** 2 + (z - cz) ** 2;
            if (d2 > (r - 1.5) ** 2 && d2 <= (r + 0.8) ** 2) {
              const ang = Math.atan2(z - cz, x - cx);
              if (Math.sin(ang * 4) > -0.2) {
                g.set(x, y, z, 0x484c56);
              }
            }
          }
        }
      }

      // 中央の旋回砲台マウント (y: 19..20, x: 9..14, z: 9..14)
      for (let y = 19; y <= 20; y++) {
        for (let z = 9; z <= 14; z++) {
          for (let x = 9; x <= 14; x++) {
            g.set(x, y, z, 0x2b2d32);
          }
        }
      }

      // 大砲の砲身 (y: 20..22, x: 10..13, z: 10..22: +Z方向へ突き出る)
      for (let y = 20; y <= 22; y++) {
        for (let x = 10; x <= 13; x++) {
          for (let z = 10; z <= 22; z++) {
            // 先端の砲口は空洞にする
            if (z >= 20 && (x === 11 || x === 12) && y === 21) continue;
            g.set(x, y, z, 0x202226);
          }
        }
      }

      return { grid: g, voxelSize };
    }
  }
}

/** 施設用のThree.jsメッシュを生成する */
export function createFacilityMesh(typeId: FacilityTypeId, team: Team): Mesh {
  const { grid, voxelSize } = buildFacilityVoxelGrid(typeId, team);
  const geo = grid.toGeometry(voxelSize, [grid.sx / 2, 0, grid.sz / 2]);
  const mat = new MeshLambertMaterial({ vertexColors: true });
  const mesh = new Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** 施設配置プレビュー用の半透明ゴーストモデルを生成する */
export function createFacilityGhost(typeId: FacilityTypeId, team: Team): Group {
  const { grid, voxelSize } = buildFacilityVoxelGrid(typeId, team);
  const geo = grid.toGeometry(voxelSize, [grid.sx / 2, 0, grid.sz / 2]);
  const mat = new MeshLambertMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.65,
  });
  const mesh = new Mesh(geo, mat);
  const g = new Group();
  g.add(mesh);
  g.rotation.y = team === 0 ? Math.PI / 2 : -Math.PI / 2;
  return g;
}

/** 施設破壊時に飛散するボクセル破片のシードリストを生成する */
export function getFacilityVoxelSeeds(
  typeId: FacilityTypeId,
  team: Team,
  worldPos: Vector3,
  worldFacing: number,
  maxSeeds: number = 80,
): DroppedVoxelSeed[] {
  const { grid, voxelSize } = buildFacilityVoxelGrid(typeId, team);
  const seeds: DroppedVoxelSeed[] = [];
  const px = grid.sx / 2;
  const pz = grid.sz / 2;

  const sin = Math.sin(worldFacing);
  const cos = Math.cos(worldFacing);

  const filled: Array<{ x: number; y: number; z: number; col: number }> = [];
  for (let z = 0; z < grid.sz; z++) {
    for (let y = 0; y < grid.sy; y++) {
      for (let x = 0; x < grid.sx; x++) {
        const c = grid.get(x, y, z);
        if (c !== 0) filled.push({ x, y, z, col: c });
      }
    }
  }

  const step = Math.max(1, Math.floor(filled.length / maxSeeds));
  for (let i = 0; i < filled.length; i += step) {
    const item = filled[i];
    const lx = (item.x - px) * voxelSize;
    const ly = item.y * voxelSize;
    const lz = (item.z - pz) * voxelSize;

    const wx = worldPos.x + lx * cos + lz * sin;
    const wy = worldPos.y + ly;
    const wz = worldPos.z - lx * sin + lz * cos;

    seeds.push({
      pos: new Vector3(wx, wy, wz),
      color: item.col,
      size: voxelSize * 1.3,
    });
  }
  return seeds;
}

export type { UnitTypeId };
