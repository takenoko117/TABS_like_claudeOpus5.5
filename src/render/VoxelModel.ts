import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DataTexture,
  DoubleSide,
  EdgesGeometry,
  EquirectangularReflectionMapping,
  Group,
  LinearFilter,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  Quaternion,
  RepeatWrapping,
  RGBAFormat,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
} from 'three';
import type { ProjectileKind } from '../combat/CombatSystem';
import { isGateTypeId, type FacilityTypeId } from '../facilities/FacilityTypes';
import type { Particle } from '../physics/Particle';
import { buildAwakenedJewel, buildAwakenedMountain } from './YamamuronAwakenedModel';
import {
  buildDragonBodyHalves,
  buildDragonForeleg,
  buildDragonForeWing,
  buildDragonHead,
  buildDragonSegment,
  buildDragonShin,
  buildDragonTailTip,
  buildDragonThigh,
  buildDragonUpperWing,
  DRAGON_RIG,
  type DragonPartSpec,
} from './DragonModel';
import { getHayatoHeadGeometry } from './HayatoHeadModel';
import {
  getTanimonFistGeometry,
  getTanimonForearmGeometry,
  getTanimonUpperArmGeometry,
  placeTanimonFist,
  placeTanimonSegment,
  tanimonStretchThickness,
} from './TanimonArmModel';
import {
  HAYATO_HEAD_HEIGHT,
  HAYATO_HEAD_RISE,
  HAYATO_HOVER_MUL,
  HAYATO_MOUTH_Y,
  HAYATO_MOUTH_Z,
  hayatoHeadCenter,
  MOUTH_LASER_PIERCE,
} from '../units/HayatoHead';
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
  /** 被弾してもボクセルを削らない（高精細モデルで再構築の負荷を避ける） */
  uncarvable?: boolean;
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

function specTemplate(spec: DragonPartSpec): VoxelPartTemplate {
  return makeTemplate(spec.grid, spec.voxelSize, spec.pivot);
}

/** ヤマムロン強化形態の胴体と頭のテンプレート（陣営ごとに 1 度だけ生成する） */
interface YamamuronAwakenedTemplates {
  torso: VoxelPartTemplate;
  head: VoxelPartTemplate;
}
const yamamuronAwakenedCache = new Map<Team, YamamuronAwakenedTemplates>();
function getYamamuronAwakenedTemplates(team: Team): YamamuronAwakenedTemplates {
  let set = yamamuronAwakenedCache.get(team);
  if (!set) {
    set = {
      torso: { ...specTemplate(buildAwakenedMountain(team)), uncarvable: true },
      head: { ...specTemplate(buildAwakenedJewel()), uncarvable: true },
    };
    yamamuronAwakenedCache.set(team, set);
  }
  return set;
}

/** ドラゴンの後半身・前脚・首と尾の節・尾先（部位破壊対象外の装飾メッシュ）のジオメトリ */
interface DragonExtras {
  rear: BufferGeometry;
  /** [0] = -X 側用, [1] = +X 側用 */
  forelegs: [BufferGeometry, BufferGeometry];
  segment: BufferGeometry;
  tailTip: BufferGeometry;
}
const dragonExtraCache = new Map<Team, DragonExtras>();
function getDragonExtras(team: Team): DragonExtras {
  let e = dragonExtraCache.get(team);
  if (!e) {
    const geo = (spec: DragonPartSpec) => spec.grid.toGeometry(spec.voxelSize, spec.pivot);
    e = {
      rear: geo(buildDragonBodyHalves(team).rear),
      forelegs: [geo(buildDragonForeleg(team, -1)), geo(buildDragonForeleg(team, 1))],
      segment: geo(buildDragonSegment(team)),
      tailTip: geo(buildDragonTailTip(team)),
    };
    dragonExtraCache.set(team, e);
  }
  return e;
}

function buildHeadTemplate(type: UnitType, team: Team): VoxelPartTemplate {
  const look = type.look;
  const tc = TEAM_COLORS[team];
  const eyeWhite = 0xffffff;
  const pupil = 0x181820;

  if (type.id === 'sezain') {
    // セザイン: 重装甲バトルヘルメット＋黄金の双角＆クレスト（鶏冠）＋スカル顎ガード＋発光タクティカルバイザー
    const g = new VoxelGrid(14, 13, 12);
    const helmDark = 0x18181b;
    const helmMetal = 0x334155;
    const gold = 0xd4af37;
    const brightGold = 0xfacc15;
    const bone = 0xe2e8f0;

    // ヘルメット本体
    g.fillBox(3, 1, 2, 10, 8, 9, helmDark);
    g.fillBox(2, 2, 3, 11, 7, 8, helmMetal);

    // 頭頂部のチームカラー＆黄金クレスト（モヒカン風バトルブレード）
    g.fillBox(6, 8, 1, 7, 10, 9, tc.shirt);
    g.fillBox(6, 10, 2, 7, 11, 8, brightGold);
    g.fillBox(6, 11, 3, 7, 12, 6, tc.shirt);
    g.fillBox(6, 4, 1, 7, 9, 2, tc.shirt);

    // 左右から突き出す黄金のバトルホーン（双角装飾）
    g.fillBox(1, 5, 4, 2, 7, 6, gold);
    g.fillBox(0, 7, 5, 1, 9, 7, brightGold);
    g.fillBox(0, 9, 6, 0, 11, 8, 0xfef08a);
    g.fillBox(11, 5, 4, 12, 7, 6, gold);
    g.fillBox(12, 7, 5, 13, 9, 7, brightGold);
    g.fillBox(13, 9, 6, 13, 11, 8, 0xfef08a);

    // 発光偏光バイザー（鋭いV字シェイプ）
    g.fillBox(3, 4, 9, 10, 6, 10, 0x0f172a);
    g.fillBox(4, 5, 10, 9, 6, 10, 0x38bdf8);
    g.set(5, 5, 10, 0xe0f2fe);
    g.set(8, 5, 10, 0xe0f2fe);
    // 額の黄金エンブレム
    g.fillBox(6, 7, 9, 7, 8, 10, brightGold);

    // 重厚なスカル風マウスガード＆吸気ダクト
    g.fillBox(3, 1, 8, 10, 3, 10, 0x09090b);
    g.fillBox(2, 1, 6, 3, 3, 9, gold);
    g.fillBox(10, 1, 6, 11, 3, 9, gold);
    // 牙・スリット装飾
    g.set(5, 2, 10, bone);
    g.set(6, 1, 10, bone);
    g.set(7, 1, 10, bone);
    g.set(8, 2, 10, bone);

    return makeTemplate(g, 0.04, [6.5, 2.0, 5.5]);
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
    // ホンゴン: 豊かに波打つブロンドヘアーの長髪が美しい天才女性ピアニスト
    const g = new VoxelGrid(12, 16, 13);
    const skin = type.look.skin; // 0xfde2e4
    const skinShadow = 0xf8d7da;
    const blush = 0xfca5a5;
    const lipColor = 0xf43f5e;
    const eyeWhite = 0xffffff;
    const eyeIris = 0x0284c7; // 澄んだサファイアブルーの瞳
    const eyeLight = 0xffffff; // 瞳のキラキラハイライト
    const eyePupil = 0x0c4a6e;
    const eyeLash = 0x18181b;

    // 煌びやかなブロンドヘアーの多層カラーパレット
    const blondHighlight = 0xfef08a; // プラチナゴールドハイライト
    const blondMain = 0xfbbf24;      // 輝くゴールドブロンド
    const blondMid = 0xf59e0b;       // 蜂蜜ハニーブロンド
    const blondShadow = 0xd97706;    // アンバーシャドウ

    // ゴールドティアラ＆イヤリング＆宝石
    const tiaraGold = 0xffd43b;
    const tiaraGem = 0x38bdf8; // 額中央のサファイアジュエル
    const pearlEarring = 0xf8f9fa;

    // 1. 顔・頭部ベース（x=3..8, y=3..10, z=4..9）
    g.fillBox(3, 3, 4, 8, 10, 9, skin);
    g.fillBox(4, 2, 5, 7, 2, 7, skinShadow); // 顎・首元

    // 2. 表情（z=9 が顔正面）
    // 瞳（x=4, x=7）＋きらめくアイライト
    g.set(4, 7, 9, eyeWhite);
    g.set(5, 7, 9, eyeIris);
    g.set(5, 6, 9, eyePupil);
    g.set(4, 8, 9, eyeLight); // 左目ハイライト
    g.set(7, 7, 9, eyeIris);
    g.set(6, 7, 9, eyeWhite);
    g.set(6, 6, 9, eyePupil);
    g.set(7, 8, 9, eyeLight); // 右目ハイライト

    // 上まつげライン
    g.fillBox(4, 8, 9, 5, 8, 9, eyeLash);
    g.fillBox(6, 8, 9, 7, 8, 9, eyeLash);
    g.set(3, 8, 9, eyeLash); // 目尻の跳ね上げまつげ
    g.set(8, 8, 9, eyeLash);

    // チーク（ほんのり桜色）
    g.set(3, 5, 9, blush);
    g.set(8, 5, 9, blush);
    // リップ（上品なローズピンク）
    g.fillBox(5, 4, 9, 6, 4, 9, lipColor);

    // 左右耳元の揺れるパールイヤリング
    g.set(2, 5, 6, tiaraGold);
    g.set(2, 4, 6, pearlEarring);
    g.set(9, 5, 6, tiaraGold);
    g.set(9, 4, 6, pearlEarring);

    // 3. ブロンドヘアー
    // 頭頂部（y=11..13）ふんわり立ち上がるリッチなボリューム
    g.fillBox(2, 11, 2, 9, 12, 10, blondMain);
    g.fillBox(3, 13, 3, 8, 13, 9, blondHighlight);
    g.fillBox(4, 14, 4, 7, 14, 8, blondHighlight);

    // 前髪（額の上 y=9..10, z=10）自然な毛流れ
    g.fillBox(3, 9, 10, 8, 10, 10, blondMain);
    g.set(5, 9, 10, blondHighlight);
    g.set(6, 10, 10, blondHighlight);
    g.set(3, 8, 10, blondMid); // サイドへ流れる前髪
    g.set(8, 8, 10, blondMid);
    g.set(4, 8, 10, blondHighlight);

    // 左右サイドヘア（x=1..2, x=9..10, y=2..12）
    g.fillBox(1, 4, 3, 2, 11, 9, blondMain);
    g.fillBox(9, 4, 3, 10, 11, 9, blondMain);
    // 胸元・鎖骨へ優雅に流れるフロントサイド毛束（y=0..3, z=6..8）
    g.fillBox(2, 0, 7, 2, 3, 8, blondMain);
    g.fillBox(9, 0, 7, 9, 3, 8, blondMain);
    g.set(2, 1, 8, blondHighlight);
    g.set(9, 1, 8, blondHighlight);
    g.set(2, 0, 7, blondMid);
    g.set(9, 0, 7, blondMid);

    // 後頭部〜背中へと豊かに流れ落ちるウェーブ長髪（z=0..3, y=0..12）
    g.fillBox(2, 5, 1, 9, 11, 3, blondMain);
    g.fillBox(2, 2, 0, 9, 4, 2, blondMain);
    g.fillBox(3, 0, 0, 8, 1, 2, blondMid); // 毛先ウェーブ
    // ハイライトとシャドウの筋（立体的な美しい毛流れ）
    g.fillBox(4, 2, 1, 5, 8, 1, blondHighlight);
    g.fillBox(6, 2, 1, 7, 8, 1, blondHighlight);
    g.fillBox(2, 3, 1, 2, 7, 1, blondShadow);
    g.fillBox(9, 3, 1, 9, 7, 1, blondShadow);

    // 4. ゴールドティアラ（額の上の装飾）
    g.fillBox(3, 11, 10, 8, 11, 10, tiaraGold);
    g.set(5, 12, 10, tiaraGold);
    g.set(6, 12, 10, tiaraGold);
    g.set(5, 12, 11, tiaraGem); // 額中央の輝く宝石
    g.set(6, 12, 11, tiaraGem);

    return makeTemplate(g, 0.040, [5.5, 6.0, 5.5]);
  }

  if (type.id === 'zaisan') {
    // ザイサン: 深緑の短髪＋額の黒バンダナ＋左目刀傷＋口にくわえた三本目の日本刀！
    const g = new VoxelGrid(16, 10, 11);
    const skin = type.look.skin;
    const zoroGreen = 0x16a34a;
    const darkGreen = 0x14532d;
    const bandana = 0x18181b;

    // 頭部肌
    g.fillBox(5, 1, 2, 11, 7, 7, skin);

    // 目元（鋭い眼光＋左目の刀傷縦ライン）
    g.fillBox(6, 4, 8, 7, 5, 8, eyeWhite);
    g.fillBox(9, 4, 8, 10, 5, 8, eyeWhite);
    g.set(6, 4, 8, pupil);
    g.set(10, 4, 8, pupil);
    // 左目の刀傷
    g.set(6, 3, 8, 0x831843);
    g.set(6, 5, 8, 0x831843);
    g.set(6, 6, 8, 0x831843);

    // 深緑の短髪
    g.fillBox(4, 3, 1, 4, 8, 7, zoroGreen);
    g.fillBox(12, 3, 1, 12, 8, 7, zoroGreen);
    g.fillBox(5, 2, 1, 11, 8, 1, zoroGreen);
    g.fillBox(5, 8, 1, 11, 9, 8, zoroGreen);
    g.fillBox(5, 7, 8, 11, 8, 8, darkGreen);

    // 黒バンダナ（額当て）
    g.fillBox(5, 6, 2, 11, 6, 8, bandana);
    g.fillBox(4, 6, 2, 4, 6, 7, bandana);
    g.fillBox(12, 6, 2, 12, 6, 7, bandana);

    // 口元にくわえた3本目の刀（横一文字に構える）
    g.fillBox(7, 2, 7, 9, 2, 7, skin); // 口元
    // 柄（右側）
    g.fillBox(3, 2, 8, 6, 2, 8, bandana);
    g.set(2, 2, 8, 0xd4af37); // 柄頭
    // 鍔
    g.fillBox(7, 1, 8, 7, 3, 8, 0xd4af37);
    // 刀身（左側に長く伸びる白銀の刃）
    g.fillBox(8, 2, 8, 15, 2, 8, 0xf4f8ff);
    g.fillBox(8, 1, 8, 14, 1, 8, 0xc8d2e0);
    g.set(15, 2, 8, 0xf4f8ff); // 切先

    return makeTemplate(g, 0.04, [8, 4.0, 4.5]);
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

  // 3. 西洋ドラゴンの頭部（DragonModel で彫刻的に生成）
  if (type.id === 'dragon') {
    return specTemplate(buildDragonHead(team));
  }

  // 4. 暴走バギーの頭部（ルーフ・ロールケージ・イエロー大型フォグランプ）
  if (type.id === 'buggy') {
    const g = new VoxelGrid(10, 8, 8);
    // ロールケージ（パイプフレーム）
    g.fillBox(1, 0, 1, 2, 5, 2, 0x374151);
    g.fillBox(7, 0, 1, 8, 5, 2, 0x374151);
    g.fillBox(1, 0, 5, 2, 5, 6, 0x374151);
    g.fillBox(7, 0, 5, 8, 5, 6, 0x374151);
    // ルーフ天板
    g.fillBox(1, 5, 1, 8, 6, 6, tc.shirt);
    // 前面オフロード・フォグランプ（左右に光るイエローライト）
    g.fillBox(2, 6, 5, 3, 7, 6, 0xffe066);
    g.fillBox(6, 6, 5, 7, 7, 6, 0xffe066);
    return makeTemplate(g, 0.042, [4.5, 0.0, 3.5]);
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
    return makeTemplate(g, 0.044, [5.5, 2.5, 1.0]);
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
    const jelly = team === 0 ? 0x4cd97b : team === 1 ? 0x38d996 : team === 2 ? 0xfcc419 : 0x20c997;
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
    const g = new VoxelGrid(14, 10, 30);
    const armorCol = 0x3d4a3e;
    const darkArmor = 0x283329;
    // 砲塔本体
    g.fillBox(2, 0, 4, 11, 5, 16, armorCol);
    g.fillBox(3, 5, 5, 10, 6, 15, armorCol);
    // 天面コマンダーキューポラ・ハッチ（チームカラー）
    g.fillBox(7, 6, 8, 10, 7, 12, darkArmor);
    g.fillBox(8, 7, 9, 9, 8, 11, tc.shirt);
    // 長大な主砲バレル（砲身・マズルブレーキ）
    g.fillBox(5, 2, 16, 8, 4, 27, darkArmor);
    g.fillBox(4, 1, 27, 9, 5, 29, 0x1f2420); // 先端大型マズルブレーキ
    // 同軸機銃マズル
    g.fillBox(3, 3, 16, 4, 3, 18, 0x111412);
    // 砲塔左右のスモークディスチャージャー（発煙弾発射筒）
    g.fillBox(1, 3, 9, 1, 5, 12, darkArmor);
    g.fillBox(12, 3, 9, 12, 5, 12, darkArmor);
    return makeTemplate(g, 0.046, [6.5, 0.0, 10.0]);
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

  // 13. 拒絶神ゼルエル: 死神の髑髏仮面・冷酷な複眼光・神聖金紋・黒曜石ヘルメット
  if (type.id === 'angel_zeruel') {
    const g = new VoxelGrid(17, 16, 17);
    const bone = 0xf8f9fa;
    const boneShade = 0xdce0e5;
    const boneEdge = 0xb0b8c1;
    const obsidian = 0x141518;
    const darkArmor = 0x1f2126;
    const armorLight = 0x2c2e35;
    const eyeRed = 0xff0033;
    const eyeCore = 0xff758f;
    const markRed = 0xc92a2a;
    const gold = 0xf59f00;

    // 後頭部・頭頂部の黒曜石重装甲カウル（流線形の多段装甲）
    g.fillBox(2, 2, 1, 14, 12, 8, obsidian);
    g.fillBox(3, 12, 1, 13, 14, 9, darkArmor);
    g.fillBox(5, 14, 2, 11, 15, 8, armorLight);
    // 後頭部の白骨脊椎クレストと赤色排熱スリット
    g.fillBox(7, 3, 0, 9, 13, 1, boneShade);
    g.fillBox(8, 4, 0, 8, 12, 0, markRed);
    // 側頭部の重厚な装甲リブフィン＆金色の神聖紋章ライン
    g.fillBox(1, 4, 2, 2, 10, 7, darkArmor);
    g.fillBox(14, 4, 2, 15, 10, 7, darkArmor);
    g.fillBox(0, 5, 3, 1, 9, 6, obsidian);
    g.fillBox(15, 5, 3, 16, 9, 6, obsidian);
    g.fillBox(1, 7, 4, 1, 8, 8, gold);
    g.fillBox(15, 7, 4, 15, 8, 8, gold);

    // 髑髏の骨質ベース（前面: リアルな頭蓋骨の立体造形）
    g.fillBox(3, 3, 8, 13, 12, 11, boneShade);
    g.fillBox(4, 3, 11, 12, 12, 13, bone);
    // 額から頭頂への傾斜ドームライン
    g.fillBox(4, 12, 9, 12, 13, 11, bone);
    g.fillBox(5, 13, 9, 11, 14, 10, boneShade);

    // 張り出した頬骨（頬弓）と輪郭のシャープなエッジ
    g.fillBox(2, 4, 9, 3, 8, 12, boneEdge);
    g.fillBox(13, 4, 9, 14, 8, 12, boneEdge);
    g.fillBox(3, 3, 12, 4, 5, 13, boneShade);
    g.fillBox(12, 3, 12, 13, 5, 13, boneShade);

    // 鋭利な下顎と噛み合わさる骨牙ディテール
    g.fillBox(5, 0, 9, 11, 3, 13, boneShade);
    g.fillBox(6, 0, 13, 10, 2, 14, bone);
    // 牙の噛み合わせスリット
    g.fillBox(6, 2, 13, 10, 2, 14, obsidian);
    g.set(6, 2, 14, bone);
    g.set(8, 2, 14, bone);
    g.set(10, 2, 14, bone);

    // 鼻腔の逆三角形スリット
    g.fillBox(8, 4, 13, 8, 5, 14, obsidian);

    // 窪んだ深い眼窩スリット（漆黒）
    g.fillBox(4, 6, 12, 7, 8, 13, obsidian);
    g.fillBox(9, 6, 12, 12, 8, 13, obsidian);

    // 眼窩の奥に妖しく光る複眼・真紅の光条
    g.set(5, 7, 12, eyeRed);
    g.set(6, 7, 13, eyeCore);
    g.set(5, 6, 13, markRed);
    g.set(11, 7, 12, eyeRed);
    g.set(10, 7, 13, eyeCore);
    g.set(11, 6, 13, markRed);

    // 眉間の第三の目（黄金枠＋真紅コア）と額の血脈紋様
    g.fillBox(7, 9, 12, 9, 11, 13, gold);
    g.set(8, 10, 13, eyeRed);
    g.fillBox(8, 11, 12, 8, 13, 12, markRed);

    return makeTemplate(g, 0.038, [8.5, 4.0, 8.0]);
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

  // 光速アリの頭部（鋭く湾曲した大顎・2本のくの字触角・光速発光複眼）
  if (type.id === 'lightspeed_ant') {
    const g = new VoxelGrid(11, 10, 14);
    const chitin = 0x18181b;
    const chitinMid = 0x27272a;
    const cyanGlow = 0x38bdf8;
    const yellowGlow = 0xfef08a;
    // 楕円形のアリ頭部甲殻
    g.fillBox(2, 2, 2, 8, 6, 8, chitin);
    g.fillBox(3, 1, 3, 7, 7, 7, chitinMid);
    // 頭頂部のチームカラー＆光速ライン
    g.fillBox(4, 7, 3, 6, 7, 7, tc.shirt);
    g.fillBox(5, 7, 4, 5, 7, 8, cyanGlow);
    // 大きく張り出した光速複眼（シアン＆イエロー発光）
    g.fillBox(1, 3, 5, 2, 5, 7, cyanGlow);
    g.fillBox(8, 3, 5, 9, 5, 7, cyanGlow);
    g.set(1, 4, 6, yellowGlow);
    g.set(9, 4, 6, yellowGlow);
    // 前方に突き出す鋭い大顎（クワガタ・アリ型のハサミ顎）
    g.fillBox(2, 2, 8, 3, 3, 11, chitinMid);
    g.fillBox(7, 2, 8, 8, 3, 11, chitinMid);
    g.fillBox(3, 2, 11, 4, 3, 13, cyanGlow);
    g.fillBox(6, 2, 11, 7, 3, 13, cyanGlow);
    g.set(4, 2, 13, yellowGlow);
    g.set(6, 2, 13, yellowGlow);
    // 頭頂から前方へ伸びる2本のくの字触角
    g.fillBox(3, 6, 8, 3, 8, 9, chitinMid);
    g.fillBox(2, 8, 9, 2, 9, 12, tc.shirt);
    g.set(2, 9, 12, yellowGlow);
    g.fillBox(7, 6, 8, 7, 8, 9, chitinMid);
    g.fillBox(8, 8, 9, 8, 9, 12, tc.shirt);
    g.set(8, 9, 12, yellowGlow);
    return makeTemplate(g, 0.042, [5.5, 3.5, 4.5]);
  }

  // デオキシス: 三叉の角状突起・白いフェイスマスク・額の紫クリスタル・シアン眼光
  if (type.id === 'deoxys') {
    const g = new VoxelGrid(15, 14, 13);
    const redOrange = 0xee5a24;
    const cyan = 0x00d2d3;
    const white = 0xf1f5f9;
    const purple = 0xa855f7;

    // 頭部中央コア（流線型）
    g.fillBox(4, 2, 3, 10, 9, 9, redOrange);
    // 中央フェイス（白いマスク状）
    g.fillBox(5, 3, 8, 9, 8, 10, white);
    // 顔の中央縦ライン（シアン）
    g.fillBox(6, 2, 9, 8, 9, 10, cyan);
    // 額の紫クリスタルコア
    g.fillBox(6, 8, 9, 8, 10, 10, purple);
    g.set(7, 9, 10, 0xffffff);
    // 鋭い眼光
    g.fillBox(4, 5, 9, 5, 6, 10, cyan);
    g.set(5, 5, 10, 0xffffff);
    g.fillBox(9, 5, 9, 10, 6, 10, cyan);
    g.set(9, 5, 10, 0xffffff);

    // 左サイドの三叉突起
    g.fillBox(1, 4, 4, 3, 7, 7, redOrange);
    g.fillBox(0, 5, 4, 1, 9, 6, cyan);
    g.fillBox(0, 9, 4, 1, 12, 5, redOrange);
    g.fillBox(0, 3, 5, 1, 6, 8, redOrange);
    // 右サイドの三叉突起
    g.fillBox(11, 4, 4, 13, 7, 7, redOrange);
    g.fillBox(13, 5, 4, 14, 9, 6, cyan);
    g.fillBox(13, 9, 4, 14, 12, 5, redOrange);
    g.fillBox(13, 3, 5, 14, 6, 8, redOrange);

    // 頭頂部のセンタークレスト
    g.fillBox(6, 10, 3, 8, 13, 7, redOrange);
    g.fillBox(7, 10, 4, 7, 13, 6, cyan);

    return makeTemplate(g, 0.042, [7, 4, 6]);
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

  // 西洋ドラゴン: 厚い胸郭・腹鱗・背棘列・前脚を備えた水平の胴体
  if (type.id === 'dragon') {
    return specTemplate(buildDragonBodyHalves(team).front);
  }

  // デオキシス: V字トルソー・胸中央の光輝く紫「DNAクリスタルコア」・シアンエネルギーライン
  if (type.id === 'deoxys') {
    const g = new VoxelGrid(11, 13, 9);
    const redOrange = 0xee5a24;
    const darkRed = 0xc0392b;
    const cyan = 0x00d2d3;
    const purple = 0x9333ea;
    const purpleBright = 0xc084fc;

    // 骨盤・腰部（細身のエイリアンウェスト）
    g.fillBox(3, 0, 2, 7, 3, 6, redOrange);
    g.fillBox(4, 1, 2, 6, 2, 6, cyan);

    // 胸部（V字・引き締まったトルソー）
    g.fillBox(2, 4, 2, 8, 11, 6, redOrange);
    g.fillBox(1, 8, 2, 9, 11, 6, redOrange);

    // 腹部・側面のシアンエネルギーライン
    g.fillBox(2, 3, 3, 2, 9, 5, cyan);
    g.fillBox(8, 3, 3, 8, 9, 5, cyan);
    g.fillBox(4, 4, 6, 6, 6, 6, cyan);

    // 胸の中央に輝く「DNAクリスタルコア」（紫色・発光）
    g.fillBox(4, 7, 6, 6, 9, 7, purple);
    g.fillBox(4, 7, 7, 6, 9, 7, purpleBright);
    g.set(5, 8, 7, 0xffffff);

    // 背面のシアンリブ構造
    g.fillBox(4, 5, 1, 6, 10, 1, cyan);
    g.fillBox(3, 7, 1, 7, 8, 1, darkRed);

    return makeTemplate(g, 0.038, [5, 1, 4]);
  }

  if (type.id === 'sezain') {
    // セザイン: 1000cc超え超弩級リッターバイク（極太タイヤ・4気筒水冷大排気量エンジン・4本出しマフラー・大型カウル）＋重装バイカー胴体
    const g = new VoxelGrid(18, 22, 40);
    const bikeBlack = 0x18181b;
    const metalChrome = 0xe2e8f0;
    const midChrome = 0x94a3b8;
    const darkMetal = 0x334155;
    const tireRubber = 0x0f172a;
    const tireTread = 0x1e293b;
    const gold = 0xd4af37;
    const copper = 0xd97706;

    // 1. 後輪・極太240mmワイドタイヤ (z=2..11, y=0..9)
    for (let z = 2; z <= 11; z++) {
      for (let y = 0; y <= 9; y++) {
        const dy = y - 4.5;
        const dz = z - 6.5;
        const d2 = dy * dy + dz * dz;
        if (d2 <= 5.0 * 5.0) {
          const isRim = d2 <= 2.3 * 2.3;
          const isHub = d2 <= 1.0 * 1.0;
          for (let x = 5; x <= 12; x++) {
            const col = isHub ? gold : isRim ? metalChrome : (z + y) % 2 === 0 ? tireRubber : tireTread;
            g.set(x, y, z, col);
          }
        }
      }
    }

    // 2. 前輪・大径ファットタイヤ (z=28..37, y=0..9)
    for (let z = 28; z <= 37; z++) {
      for (let y = 0; y <= 9; y++) {
        const dy = y - 4.5;
        const dz = z - 32.5;
        const d2 = dy * dy + dz * dz;
        if (d2 <= 5.0 * 5.0) {
          const isRim = d2 <= 2.3 * 2.3;
          const isHub = d2 <= 1.0 * 1.0;
          for (let x = 6; x <= 11; x++) {
            const col = isHub ? gold : isRim ? metalChrome : (z + y) % 2 === 0 ? tireRubber : tireTread;
            g.set(x, y, z, col);
          }
        }
      }
    }
    // フロントダブルディスクブレーキ＆ゴールドキャリパー
    g.fillBox(5, 3, 30, 5, 6, 34, midChrome);
    g.fillBox(12, 3, 30, 12, 6, 34, midChrome);
    g.set(5, 6, 30, gold);
    g.set(12, 6, 30, gold);

    // 3. スイングアーム＆メインフレーム＆アンダーカウル
    g.fillBox(4, 4, 6, 5, 6, 15, midChrome);
    g.fillBox(12, 4, 6, 13, 6, 15, midChrome);
    g.fillBox(5, 2, 11, 12, 9, 27, bikeBlack);
    // アンダーカウル（チームカラーエッジ）
    g.fillBox(4, 2, 14, 13, 4, 26, bikeBlack);
    g.fillBox(4, 2, 15, 4, 3, 25, tc.shirt);
    g.fillBox(13, 2, 15, 13, 3, 25, tc.shirt);

    // 4. 1000cc超えモンスターエンジンブロック（張り出した冷却フィン・ゴールドクラッチカバー・4連エキゾーストマニホールド）
    g.fillBox(3, 3, 13, 14, 8, 23, darkMetal);
    for (let y = 4; y <= 8; y += 2) {
      g.fillBox(2, y, 15, 15, y, 22, metalChrome); // 冷却フィン
    }
    // 左右のゴールドクランクケースカバー
    g.fillBox(2, 3, 14, 2, 6, 18, gold);
    g.fillBox(15, 3, 14, 15, 6, 18, gold);
    // 4本出しチタン・エキゾーストパイプ＆大型ツインメガホンマフラー（左右2本ずつ斜め跳ね上げ）
    g.fillBox(4, 2, 23, 13, 5, 25, copper);
    // 左側2連マフラー
    g.fillBox(2, 2, 8, 3, 4, 16, metalChrome);
    g.fillBox(1, 4, 2, 3, 6, 10, metalChrome);
    g.fillBox(1, 5, 0, 3, 7, 3, darkMetal);
    g.set(2, 6, 0, 0xff5900); // アフターファイアの輝き
    // 右側2連マフラー
    g.fillBox(14, 2, 8, 15, 4, 16, metalChrome);
    g.fillBox(14, 4, 2, 16, 6, 10, metalChrome);
    g.fillBox(14, 5, 0, 16, 7, 3, darkMetal);
    g.set(15, 6, 0, 0xff5900);

    // 5. 大容量ビッグフューエルタンク＆エアロサイドカウル
    g.fillBox(4, 9, 17, 13, 12, 26, tc.shirt);
    g.fillBox(5, 12, 18, 12, 13, 25, tc.shirt);
    // タンク側面のゴールドエンブレム＆ニーグリップパッド
    g.fillBox(4, 10, 20, 4, 11, 24, gold);
    g.fillBox(13, 10, 20, 13, 11, 24, gold);
    g.fillBox(4, 9, 17, 4, 10, 19, bikeBlack);
    g.fillBox(13, 9, 17, 13, 10, 19, bikeBlack);
    // タンクキャップ
    g.fillBox(8, 13, 21, 9, 13, 23, metalChrome);

    // 6. フロント倒立ゴールドフォーク＆アッパーカウル・二眼LEDヘッドライト
    g.fillBox(4, 5, 27, 5, 14, 32, gold);
    g.fillBox(12, 5, 27, 13, 14, 32, gold);
    // フロントフェンダー
    g.fillBox(5, 8, 29, 12, 10, 35, tc.shirt);
    // アッパーカウル（フロントマスク）
    g.fillBox(4, 10, 26, 13, 15, 31, tc.shirt);
    g.fillBox(5, 14, 25, 12, 16, 29, 0x0f172a); // スモークウインドスクリーン
    // 凶悪な二眼デュアルプロジェクターヘッドライト＋ラムエアダクト
    g.fillBox(4, 11, 31, 7, 13, 32, 0xfef08a);
    g.fillBox(10, 11, 31, 13, 13, 32, 0xfef08a);
    g.fillBox(8, 11, 31, 9, 13, 32, 0x09090b);
    // ワイドハンドルバー＆ナックルガード
    g.fillBox(2, 14, 24, 15, 15, 25, metalChrome);
    g.fillBox(1, 14, 25, 3, 15, 26, bikeBlack);
    g.fillBox(14, 14, 25, 16, 15, 26, bikeBlack);

    // 7. 段付きシート＆跳ね上げリアテールカウル＋LEDテールランプ
    g.fillBox(5, 8, 10, 12, 10, 17, 0x27272a); // ライダーシート
    g.fillBox(4, 9, 4, 13, 12, 11, tc.shirt); // テールカウル
    g.fillBox(5, 12, 4, 12, 13, 9, bikeBlack); // タンデムシート・バックレスト
    g.fillBox(6, 10, 3, 11, 11, 4, 0xef4444); // テールランプ

    // 8. バイカーの上半身（重装甲バトルアーマージャケット・ゴールド胸章・背面の弾薬バックパック）
    // ライダーの骨盤〜胸は z=11..17 (シート直上), y=10..18
    g.fillBox(5, 10, 11, 12, 18, 17, 0x1e293b); // アーマージャケット本体
    // 胸部プロテクター＆チームカラーライン＆ゴールドエンブレム
    g.fillBox(4, 12, 12, 13, 17, 17, 0x0f172a);
    g.fillBox(6, 13, 17, 11, 17, 18, tc.shirt);
    g.fillBox(7, 15, 18, 10, 16, 18, gold);
    // 肩・鎖骨まわりの重厚なスタッズカラー（襟）
    g.fillBox(4, 17, 11, 13, 19, 16, 0x09090b);
    g.set(4, 19, 15, gold);
    g.set(13, 19, 15, gold);
    // 背面デュアルマガジン・弾薬バックパック
    g.fillBox(5, 11, 9, 12, 17, 11, 0x27272a);
    g.fillBox(6, 12, 8, 7, 16, 9, gold); // 左弾帯ドラム
    g.fillBox(10, 12, 8, 11, 16, 9, gold); // 右弾帯ドラム

    // 左右のフットペグ（ステップバー）
    g.fillBox(1, 2, 14, 3, 3, 16, metalChrome);
    g.fillBox(14, 2, 14, 16, 3, 16, metalChrome);

    return makeTemplate(g, 0.045, [9.0, 9.5, 14.0]);
  }

  if (type.id === 'yamamuron') {
    // ヤマムロン: でっっっっかい富士山！
    const g = new VoxelGrid(28, 22, 28);
    const seaOfTrees = 0x1b4332;
    const baseGreen = 0x2d6a4f;

    const mountainCol1 = team === 0 ? 0x9e2a2b : team === 1 ? 0x1e3a8a : team === 2 ? 0x92400e : 0x065f46;
    const mountainCol2 = team === 0 ? 0xba181b : team === 1 ? 0x1d4ed8 : team === 2 ? 0xd97706 : 0x059669;
    const mountainCol3 = team === 0 ? 0xe5383b : team === 1 ? 0x2563eb : team === 2 ? 0xf59e0b : 0x10b981;

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
    // ホンゴン: 巨大な名器フルコンサートグランドピアノ＋演奏会用イブニングドレスの女性ピアニスト
    const g = new VoxelGrid(30, 28, 46);

    // ピアノ用カラーパレット
    const pianoBlack = 0x0c0c0e;     // 最上級ピアノブラック（漆黒）
    const pianoRim = 0x1f1f24;       // 側板エッジライン
    const soundboardWood = 0xc89d66; // スプルース響板（明るい木目）
    const castIronPlate = 0xd4af37;  // 黄金の鋳鉄フレーム（ハープ）
    const castIronGlow = 0xf59f00;   // フレームの彫刻・リブ
    const stringSilver = 0xcfd4dc;   // ピアノ弦
    const whiteKey = 0xffffff;       // 象牙白鍵
    const blackKey = 0x09090b;       // 黒檀黒鍵
    const redFelt = 0xd90429;        // 鍵盤奥の深紅フェルト
    const sheetPaper = 0xffffff;     // 楽譜用紙
    const noteBlack = 0x18181b;      // 音符
    const goldPedal = 0xffd43b;      // 真鍮ペダル＆キャスター
    const stoolCushion = 0x1e1e24;   // ベルベットスツール

    // ピアニスト用カラーパレット
    const skin = look.skin;          // 0xfde2e4
    const dressColor = tc.shirt;     // 陣営カラーのサテンドレス
    const dressAccent = tc.accent;   // ドレスのフリル・トリミング
    const pearl = 0xf8f9fa;          // 真珠のネックレス
    const goldJewelry = 0xfcd34d;    // ゴールドアクセサリー

    // -------------------------------------------------------------
    // 1. 巨大グランドピアノの本体（側板リム・底板・響板）
    // -------------------------------------------------------------
    // 底板
    g.fillBox(4, 5, 17, 25, 5, 42, pianoBlack);
    // 側板リム（左側はストレートライン x=3..4, z=13..42）
    g.fillBox(3, 6, 13, 4, 11, 42, pianoBlack);
    g.fillBox(3, 11, 13, 4, 11, 42, pianoRim);

    // 側板リム（右側はグランドピアノ特有の流麗なS字カーブ）
    // z=13..22 はストレート x=25..26
    g.fillBox(25, 6, 13, 26, 11, 22, pianoBlack);
    g.fillBox(25, 11, 13, 26, 11, 22, pianoRim);
    // z=23..32 は緩やかに内側へ湾曲（くびれカーブ x=21..24）
    for (let z = 23; z <= 32; z++) {
      const curveX = Math.round(25 - (z - 22) * 0.45);
      g.fillBox(curveX, 6, z, curveX + 1, 11, z, pianoBlack);
      g.set(curveX + 1, 11, z, pianoRim);
      // 内側の底板
      g.fillBox(4, 5, z, curveX, 5, z, pianoBlack);
    }
    // z=33..43 はテールへの流線型ラウンド絞り込み（x=4..21 → x=4..12）
    for (let z = 33; z <= 42; z++) {
      const tailX = Math.round(20 - (z - 32) * 1.0);
      g.fillBox(tailX, 6, z, tailX + 1, 11, z, pianoBlack);
      g.set(tailX + 1, 11, z, pianoRim);
      g.fillBox(4, 5, z, tailX, 5, z, pianoBlack);
    }
    // テールエンド（丸みを帯びた終端 z=42..43, x=4..10）
    g.fillBox(4, 6, 42, 10, 11, 43, pianoBlack);
    g.fillBox(4, 11, 42, 10, 11, 43, pianoRim);

    // 響板（Soundboard: スプルース材の温かな木目）
    g.fillBox(5, 6, 18, 23, 6, 23, soundboardWood);
    for (let z = 24; z <= 40; z++) {
      const maxX = Math.round(23 - (z - 23) * 0.7);
      if (maxX >= 5) g.fillBox(5, 6, z, maxX, 6, z, soundboardWood);
    }

    // 内部の鋳鉄フレーム（ハープ / 金色フレーム）
    // 外周リブ
    g.fillBox(6, 7, 20, 7, 7, 38, castIronPlate);
    g.fillBox(14, 7, 22, 15, 7, 36, castIronPlate);
    g.fillBox(20, 7, 20, 21, 7, 28, castIronPlate);
    // 斜めリブクロス
    for (let i = 0; i < 9; i++) {
      g.set(8 + i, 7, 22 + i, castIronGlow);
      g.set(13 + i, 7, 20 + i, castIronGlow);
    }
    // 弦（ストリングス: シルバーライン）
    for (let z = 21; z <= 36; z += 2) {
      g.fillBox(8, 7, z, 13, 7, z, stringSilver);
      g.fillBox(16, 7, Math.min(28, z), 19, 7, Math.min(28, z), stringSilver);
    }

    // -------------------------------------------------------------
    // 2. 跳ね上げられた大屋根（Open Grand Lid & 突上棒）
    // -------------------------------------------------------------
    // ピアノの右上が斜めに持ち上がり、内部の金色のハープが美しく露出！
    // 左ヒンジ x=4 を軸として、右側が y=12 から y=24 へ斜めに跳ね上がる
    for (let z = 18; z <= 41; z++) {
      const maxLidX = Math.round(25 - (z - 18) * 0.55);
      for (let x = 4; x <= Math.max(5, maxLidX); x++) {
        // x に応じて高さ y が上がる（傾斜した屋根）
        const lidY = Math.min(24, Math.round(11 + (x - 4) * 0.65));
        g.set(x, lidY, z, pianoBlack);
        if (x === maxLidX || z === 41) g.set(x, lidY, z, pianoRim);
      }
    }
    // 金色の突上棒（Lid Prop）: 本体右側から大屋根を支える
    g.fillBox(22, 11, 28, 22, 21, 28, castIronPlate);

    // -------------------------------------------------------------
    // 3. 鍵盤部（白鍵・黒鍵の美しさと深紅フェルト・ネームロゴ）
    // -------------------------------------------------------------
    // キーベッド（鍵盤床）
    g.fillBox(4, 7, 13, 25, 8, 16, pianoBlack);
    // 鍵盤奥の深紅フェルトクロス
    g.fillBox(5, 9, 17, 24, 9, 17, redFelt);

    // 鍵盤（白鍵 x=5..24, y=9, z=14..16）
    g.fillBox(5, 9, 14, 24, 9, 16, whiteKey);
    g.fillBox(5, 8, 14, 24, 8, 14, whiteKey); // 鍵盤フロントエッジ
    // 黒鍵（立体的な黒檀キー）
    for (let k = 6; k <= 23; k++) {
      const mod = k % 7;
      if (mod !== 2 && mod !== 6) {
        g.fillBox(k, 10, 15, k, 10, 16, blackKey);
      }
    }
    // 鍵盤蓋の金文字ネームロゴ（ゴールドプレート）
    g.fillBox(12, 10, 17, 17, 10, 17, castIronPlate);

    // -------------------------------------------------------------
    // 4. 譜面台 & 開かれた楽譜
    // -------------------------------------------------------------
    // 譜面台フレーム
    g.fillBox(10, 11, 17, 19, 12, 18, pianoBlack);
    g.fillBox(11, 13, 18, 18, 17, 18, sheetPaper); // 開かれた楽譜
    g.fillBox(14, 13, 18, 15, 17, 18, 0xe2e8f0);   // 楽譜の中央折り目（影）
    g.fillBox(10, 13, 18, 10, 17, 18, pianoBlack); // 譜面台サイド
    g.fillBox(19, 13, 18, 19, 17, 18, pianoBlack);
    // 楽譜の五線譜＆音符ディテール
    g.fillBox(12, 14, 18, 14, 14, 18, noteBlack);
    g.fillBox(16, 15, 18, 17, 15, 18, noteBlack);
    g.set(13, 16, 18, noteBlack);
    g.set(16, 16, 18, noteBlack);

    // -------------------------------------------------------------
    // 5. ピアノ脚（3本の重厚な脚＋キャスター）＆ ペダル
    // -------------------------------------------------------------
    // 左前脚（x=5..6, z=15..16, y=0..5）
    g.fillBox(5, 1, 15, 6, 5, 16, pianoBlack);
    g.fillBox(5, 0, 15, 6, 0, 16, goldPedal); // 真鍮キャスター
    // 右前脚（x=23..24, z=15..16, y=0..5）
    g.fillBox(23, 1, 15, 24, 5, 16, pianoBlack);
    g.fillBox(23, 0, 15, 24, 0, 16, goldPedal);
    // 後部脚（x=6..7, z=39..40, y=0..5）
    g.fillBox(6, 1, 39, 7, 5, 40, pianoBlack);
    g.fillBox(6, 0, 39, 7, 0, 40, goldPedal);

    // ペダルライラ（中央のペダル柱 & 3本の黄金ペダル）
    g.fillBox(13, 1, 16, 16, 5, 16, pianoBlack);
    g.set(13, 0, 16, goldPedal); // ソフトペダル
    g.set(14, 0, 16, goldPedal); // ソステヌートペダル
    g.set(15, 0, 16, goldPedal); // ダンパーペダル

    // -------------------------------------------------------------
    // 6. ピアニストのスツール（演奏用ピアノ椅子）
    // -------------------------------------------------------------
    // クッション座面（x=10..19, y=5..6, z=5..9）
    g.fillBox(10, 5, 5, 19, 6, 9, stoolCushion);
    g.fillBox(9, 5, 7, 9, 6, 7, goldPedal);   // 昇降調整ノブ（左）
    g.fillBox(20, 5, 7, 20, 6, 7, goldPedal); // 昇降調整ノブ（右）
    // スツール脚（4本脚）
    g.fillBox(10, 0, 5, 11, 4, 5, pianoBlack);
    g.fillBox(18, 0, 5, 19, 4, 5, pianoBlack);
    g.fillBox(10, 0, 9, 11, 4, 9, pianoBlack);
    g.fillBox(18, 0, 9, 19, 4, 9, pianoBlack);

    // -------------------------------------------------------------
    // 7. ドレス姿の女性ピアニスト（上半身・ドレス・美肌）
    // -------------------------------------------------------------
    // 座る位置: x=12..17, z=6..8, y=7..15
    // 下半身・ドレスのスカート広がり（スツールから足元・鍵盤下へ）
    g.fillBox(11, 5, 5, 18, 7, 9, dressColor);
    g.fillBox(10, 4, 4, 19, 5, 9, dressColor);
    g.fillBox(12, 1, 9, 17, 4, 11, dressColor); // 前面スカートのドレープ
    g.fillBox(11, 4, 4, 18, 4, 5, dressAccent); // スカート裾フリル

    // ウエスト & コルセット（y=7..9, x=12..17, z=6..8）
    g.fillBox(12, 7, 6, 17, 9, 8, dressColor);
    g.fillBox(13, 7, 8, 16, 9, 8, dressAccent); // コルセットリボン装飾

    // 胸元ビスチェ & デコルテ（y=10..15）
    // バスト・ビスチェ（ドレス生地）
    g.fillBox(12, 10, 6, 17, 12, 8, dressColor);
    g.fillBox(13, 12, 8, 16, 12, 9, dressAccent); // ビスチェトップライン

    // デコルテ・胸元・首元の透き通るような美肌
    g.fillBox(13, 13, 7, 16, 15, 8, skin);
    g.fillBox(13, 13, 6, 16, 14, 6, skin); // 背中開き
    // 真珠のネックレス
    g.fillBox(13, 13, 8, 16, 13, 8, pearl);
    g.set(14, 12, 8, goldJewelry); // ネックレスのペンダントトップ

    // 背中の優美なドレスビッグリボン
    g.fillBox(13, 8, 5, 16, 9, 5, dressAccent);
    g.fillBox(12, 6, 4, 13, 8, 5, dressAccent); // リボンの垂れ布
    g.fillBox(16, 6, 4, 17, 8, 5, dressAccent);

    return makeTemplate(g, 0.042, [14.5, 6.0, 6.5]);
  }

  // 鎧戦象の巨躯と鞍
  if (type.id === 'warelephant') {
    const g = new VoxelGrid(14, 12, 18);
    // 象の胴体（マッシブな体躯）
    g.fillBox(1, 1, 1, 12, 10, 16, look.skin);
    // 陣営カラーの豪華な鞍掛け・布陣
    g.fillBox(0, 4, 3, 13, 11, 14, tc.shirt);
    g.fillBox(0, 4, 3, 13, 4, 14, 0xd4af37);
    g.fillBox(0, 11, 3, 13, 11, 14, 0xd4af37);
    return makeTemplate(g, 0.042, [7, 2, 9]);
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

  // 光速アリの胴体（前方の引き締まった胸部＋くびれた腹柄節＋後方の膨らんだ腹部＆光速発光ストライプ）
  if (type.id === 'lightspeed_ant') {
    const g = new VoxelGrid(12, 10, 22);
    const chitin = 0x18181b;
    const chitinMid = 0x27272a;
    const cyanGlow = 0x38bdf8;
    const yellowGlow = 0xfef08a;

    // 1. 後方の膨らんだ腹部 (Gaster: z=0..9)
    g.fillBox(2, 2, 1, 9, 7, 8, chitin);
    g.fillBox(1, 3, 2, 10, 6, 7, chitinMid);
    g.fillBox(3, 1, 2, 8, 8, 7, chitin);
    // 腹部のチームカラー＆光速ネオンストライプ帯
    g.fillBox(2, 3, 2, 9, 7, 3, tc.shirt);
    g.fillBox(2, 4, 5, 9, 8, 6, tc.shirt);
    g.fillBox(3, 8, 3, 8, 8, 4, cyanGlow);
    g.fillBox(3, 8, 6, 8, 8, 6, yellowGlow);
    // 尾端の光速スラスター発光
    g.fillBox(4, 4, 0, 7, 5, 1, cyanGlow);

    // 2. くびれた腰（腹柄節 Petiole: z=9..12）
    g.fillBox(4, 3, 9, 7, 5, 12, chitinMid);
    g.fillBox(5, 5, 10, 6, 6, 11, tc.shirt);

    // 3. 前方の胸部（Thorax: z=12..20）
    g.fillBox(3, 2, 12, 8, 6, 19, chitin);
    g.fillBox(2, 3, 13, 9, 5, 18, chitinMid);
    // 胸部背面の光速エネルギーライン
    g.fillBox(4, 6, 13, 7, 7, 18, tc.shirt);
    g.fillBox(5, 7, 13, 6, 7, 19, cyanGlow);

    return makeTemplate(g, 0.044, [6.0, 3.0, 12.0]);
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
    const jelly = team === 0 ? 0x3bc96b : team === 1 ? 0x28c986 : team === 2 ? 0xf59f00 : 0x12b886;
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
    return makeTemplate(g, 0.05, [cx, cy, cz]);
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

  // 拒絶神ゼルエル: 圧倒的な翼状マント肩装甲・白骨肋骨ケージ・くびれた腹筋装甲・脊椎スタビライザー
  if (type.id === 'angel_zeruel') {
    const g = new VoxelGrid(26, 22, 16);
    const obsidian = 0x141518;
    const darkArmor = 0x1f2126;
    const armorLight = 0x2c2e35;
    const armorEdge = 0x3d414a;
    const bone = 0xf8f9fa;
    const boneShade = 0xdce0e5;
    const coreGlow = 0xd90429;
    const warnRed = 0xff1744;
    const gold = 0xf59f00;

    // 1. 骨盤ガード・腰部外装スカート (y: 0..3) — 逆三角形の威厳あるシルエットの基部
    g.fillBox(6, 0, 3, 19, 3, 12, obsidian);
    g.fillBox(7, 1, 4, 18, 3, 11, darkArmor);
    // 腰前面の白骨ペルビスプレート＆黄金紋章
    g.fillBox(9, 0, 11, 16, 2, 12, boneShade);
    g.fillBox(11, 0, 12, 14, 3, 13, bone);
    g.fillBox(12, 1, 13, 13, 2, 13, gold);

    // 2. 引き締まった腹部・生体装甲ウエスト (y: 3..7)
    g.fillBox(7, 3, 4, 18, 7, 11, obsidian);
    g.fillBox(8, 3, 5, 17, 7, 10, darkArmor);
    // 腹部の白骨外骨格リブと赤色エネルギー血管ライン
    for (let y = 4; y <= 6; y += 2) {
      g.fillBox(8, y, 10, 11, y, 11, boneShade);
      g.fillBox(14, y, 10, 17, y, 11, boneShade);
    }
    g.fillBox(12, 3, 10, 13, 7, 11, warnRed);

    // 3. 広大な胸郭ベース (y: 7..17)
    g.fillBox(5, 7, 3, 20, 16, 11, obsidian);
    g.fillBox(6, 8, 4, 19, 17, 10, darkArmor);
    // 首元の重厚なカラー（襟装甲）
    g.fillBox(8, 16, 5, 17, 18, 11, armorLight);
    g.fillBox(9, 17, 10, 16, 18, 12, gold);

    // 4. 巨大な左右翼状マント肩装甲（頭部の両脇まで聳え立つ圧倒的シルエット）
    // 左肩マント (x: 0..6, y: 6..21)
    g.fillBox(1, 6, 2, 6, 18, 12, obsidian);
    g.fillBox(0, 8, 3, 5, 20, 11, darkArmor);
    g.fillBox(0, 11, 4, 4, 21, 10, armorLight);
    g.fillBox(1, 19, 4, 4, 21, 10, armorEdge);
    // 左肩の白骨ブレードクレスト・黄金ライン・赤色発光スリット
    g.fillBox(1, 20, 5, 3, 21, 9, bone);
    g.fillBox(0, 14, 11, 4, 15, 11, gold);
    g.fillBox(1, 17, 4, 4, 17, 10, warnRed);
    g.fillBox(0, 10, 11, 5, 11, 11, warnRed);

    // 右肩マント (x: 19..25, y: 6..21)
    g.fillBox(19, 6, 2, 24, 18, 12, obsidian);
    g.fillBox(20, 8, 3, 25, 20, 11, darkArmor);
    g.fillBox(21, 11, 4, 25, 21, 10, armorLight);
    g.fillBox(21, 19, 4, 24, 21, 10, armorEdge);
    // 右肩の白骨ブレードクレスト・黄金ライン・赤色発光スリット
    g.fillBox(22, 20, 5, 24, 21, 9, bone);
    g.fillBox(21, 14, 11, 25, 15, 11, gold);
    g.fillBox(21, 17, 4, 24, 17, 10, warnRed);
    g.fillBox(20, 10, 11, 25, 11, 11, warnRed);

    // 5. 背面の白骨脊椎ノード＆対空推進スタビライザーフィン
    g.fillBox(8, 4, 1, 17, 16, 3, obsidian);
    g.fillBox(11, 2, 0, 14, 18, 2, darkArmor);
    for (let y = 3; y <= 17; y += 2) {
      g.fillBox(12, y, 0, 13, y, 1, bone);
      g.fillBox(10, y, 1, 15, y, 2, boneShade);
    }
    // 背面左右の斜めスタビライザーウイング
    g.fillBox(5, 9, 0, 7, 17, 2, armorLight);
    g.fillBox(18, 9, 0, 20, 17, 2, armorLight);
    g.fillBox(6, 11, 0, 6, 15, 0, warnRed);
    g.fillBox(19, 11, 0, 19, 15, 0, warnRed);

    // 6. 胸部白骨肋骨ケージ（中央の滑らか真紅コア球体を包み込むリアルな湾曲リブ）
    // 下段肋骨 (y: 8..9)
    g.fillBox(6, 8, 11, 9, 9, 13, boneShade);
    g.fillBox(16, 8, 11, 19, 9, 13, boneShade);
    g.fillBox(9, 8, 13, 10, 8, 14, bone);
    g.fillBox(15, 8, 13, 16, 8, 14, bone);
    // 中段肋骨 (y: 11..12)
    g.fillBox(5, 11, 11, 8, 12, 13, bone);
    g.fillBox(17, 11, 11, 20, 12, 13, bone);
    g.fillBox(8, 11, 13, 9, 12, 15, bone);
    g.fillBox(16, 11, 13, 17, 12, 15, bone);
    // 上段肋骨・鎖骨アーチ (y: 14..15)
    g.fillBox(6, 14, 11, 9, 15, 13, bone);
    g.fillBox(16, 14, 11, 19, 15, 13, bone);
    g.fillBox(8, 15, 11, 17, 16, 13, boneShade);

    // 7. 中央コアチャンバー（滑らか球体コアが収まる深紅の炉心座）
    g.fillBox(9, 8, 9, 16, 14, 11, coreGlow);
    g.fillBox(10, 9, 8, 15, 13, 10, 0x5a0011);

    return makeTemplate(g, 0.042, [13.0, 3.0, 7.5]);
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
  } else if (type.id === 'samurai') {
    // 陣営カラーの羽織と左腰の黒鞘
    g.fillBox(0, 4, 1, 2, 11, 6, tc.shirt);
    g.fillBox(7, 4, 1, 9, 11, 6, tc.shirt);
    g.fillBox(0, 1, 0, 1, 3, 7, 0x181820);
  } else if (type.id === 'zaisan') {
    // ザイサン: 深緑の羽織＋胸元の筋肉＋腰の赤い腹巻き＋左腰の三連鞘
    g.fillBox(0, 4, 1, 2, 11, 6, 0x14532d);
    g.fillBox(7, 4, 1, 9, 11, 6, 0x14532d);
    g.fillBox(1, 4, 0, 8, 11, 1, 0x14532d);
    // 胸元の筋肉露出
    g.fillBox(3, 7, 6, 6, 11, 6, look.skin);
    // 赤い腹巻き
    g.fillBox(0, 1, 1, 9, 3, 6, 0xb91c1c);
    // 左腰に差した三連鞘（黒＋金金具）
    g.fillBox(0, 1, 0, 1, 2, 7, 0x181820);
    g.fillBox(0, 2, 1, 1, 3, 8, 0x27272a);
    g.fillBox(0, 0, 1, 1, 1, 7, 0x181820);
    g.set(0, 2, 7, 0xd4af37);
    g.set(0, 3, 8, 0xd4af37);
    g.set(0, 1, 7, 0xd4af37);
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

/** バギー用の本格オフロード4輪タイヤテンプレート（トレッドパターン・ホイールリム・ハブ付き） */
function buildBuggyWheelTemplate(teamColor: number, radius: number, width: number): VoxelPartTemplate {
  const size = radius * 2 + 1;
  const g = new VoxelGrid(width, size, size);
  const r2 = radius * radius;
  const hubR2 = (radius * 0.52) ** 2;
  const capR2 = (radius * 0.26) ** 2;
  const cx = radius;
  const cz = radius;
  for (let z = 0; z < size; z++) {
    for (let y = 0; y < size; y++) {
      const d2 = (y - cx) ** 2 + (z - cz) ** 2;
      if (d2 <= r2) {
        // オフロードタイヤのブロックパターン（角度に応じたトレッド突起）
        const angle = Math.atan2(z - cz, y - cx);
        const treadBlock = Math.sin(angle * 10) > 0.15;
        const isOuterEdge = d2 > (radius - 1) ** 2;
        if (isOuterEdge && !treadBlock) continue;

        let col = 0x18181b; // ディープブラック（タイヤゴム）
        if (d2 <= capR2) {
          col = teamColor; // チームカラーのセンターハブ
        } else if (d2 <= hubR2) {
          col = 0xd1d5db; // シルバー・アルミホイールリム
        } else if ((y === cx || z === cz) && d2 <= hubR2 * 1.5) {
          col = 0x4b5563; // ホイールスポーク
        }
        for (let x = 0; x < width; x++) {
          g.set(x, y, z, col);
        }
      }
    }
  }
  return makeTemplate(g, 0.040, [width / 2, radius, radius]);
}

/** 戦車（超巨大）用の重装無限軌道（キャタピラ履帯・ロードホイールユニット）テンプレート */
function buildTankTrackTemplate(teamColor: number, isLeft: boolean): VoxelPartTemplate {
  const width = 6;
  const height = 8;
  const length = 32;
  const g = new VoxelGrid(width, height, length);
  const trackCol = 0x212529; // 履帯ダークスチール
  const padCol = 0x111412; // 履帯ラバーブロック
  const rimCol = 0x4b5563; // ロードホイールリム
  const hubCol = 0x9ca3af; // ホイールハブ
  const armorCol = 0x3d4a3e; // 車体同色装甲

  // 1. キャタピラ履帯ベルト外周（底面・上面・前後スロープ）
  for (let z = 2; z <= 29; z++) {
    const col = z % 2 === 0 ? trackCol : padCol;
    // 底面履帯ベルト（Y=0）
    for (let x = 0; x < width; x++) g.set(x, 0, z, col);
    // 上面履帯ベルト（Y=6）
    for (let x = 0; x < width; x++) g.set(x, 6, z, col);
  }
  // 前後スロープ（前部アイドラー輪・後部スプロケット輪の傾斜）
  for (let x = 0; x < width; x++) {
    g.set(x, 1, 1, trackCol);
    g.set(x, 2, 0, trackCol);
    g.set(x, 3, 0, padCol);
    g.set(x, 4, 0, trackCol);
    g.set(x, 5, 1, padCol);
    g.set(x, 1, 30, trackCol);
    g.set(x, 2, 31, trackCol);
    g.set(x, 3, 31, padCol);
    g.set(x, 4, 31, trackCol);
    g.set(x, 5, 30, padCol);
  }

  // 2. ロードホイール（転輪 6 連）
  const wheelCenters = [5, 9, 14, 19, 23, 27];
  for (const cz of wheelCenters) {
    const cy = 3;
    const outerR = 2.5;
    for (let z = cz - 2; z <= cz + 2; z++) {
      for (let y = 1; y <= 5; y++) {
        const d2 = (y - cy) ** 2 + (z - cz) ** 2;
        if (d2 <= outerR * outerR) {
          const col = d2 <= 1.0 ? hubCol : rimCol;
          for (let x = 1; x < width - 1; x++) {
            g.set(x, y, z, col);
          }
        }
      }
    }
  }

  // 3. サイドスカート装甲（履帯上部を保護する外装板）
  const sideX = isLeft ? 0 : width - 1;
  g.fillBox(sideX, 4, 1, sideX, 7, 30, armorCol);
  // チームカラーの識別ストライプ（装甲板中央）
  g.fillBox(sideX, 6, 4, sideX, 6, 28, teamColor);

  return makeTemplate(g, 0.046, [width / 2, 0, length / 2]);
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
  if (type.id === 'zaisan') {
    return buildWeaponGeometry('katana', 1.15, team);
  }
  return null;
}

function buildSubmachineGunGeometry(team: Team): BufferGeometry {
  const tc = TEAM_COLORS[team];
  // 両手に構える大口径ヘビーマシンガン（ツインバレル・ドラムマガジン・ゴールド装飾・大型マズルブレーキ）
  const g = new VoxelGrid(7, 9, 20);
  const darkGunmetal = 0x1e293b;
  const barrelSteel = 0x94a3b8;
  const brightSteel = 0xe2e8f0;
  const gold = 0xd4af37;

  // レシーバー本体
  g.fillBox(2, 3, 2, 4, 7, 11, darkGunmetal);
  // チームカラー＆ゴールドのサイド装甲プレート
  g.fillBox(1, 4, 4, 1, 6, 9, tc.shirt);
  g.fillBox(5, 4, 4, 5, 6, 9, tc.shirt);
  g.fillBox(1, 5, 5, 1, 5, 8, gold);
  g.fillBox(5, 5, 5, 5, 5, 8, gold);
  // 上部ピカティニーレール＆ドットサイト照準器
  g.fillBox(2, 7, 3, 4, 7, 10, gold);
  g.fillBox(2, 8, 5, 4, 8, 7, darkGunmetal);
  g.set(3, 8, 7, 0x38bdf8); // サイトレンズ

  // 下部の大型ドラムマガジン（弾倉）
  g.fillBox(1, 0, 6, 5, 3, 10, 0x0f172a);
  g.fillBox(2, 1, 10, 4, 2, 10, gold); // 露出する真鍮弾帯

  // グリップ＆リアストック
  g.fillBox(2, 0, 2, 4, 3, 4, 0x09090b);
  g.fillBox(2, 4, 0, 4, 6, 2, 0x334155);

  // 上下2連ツインヘビーバレル（銃身）＆放熱ジャケット
  g.fillBox(2, 4, 11, 4, 6, 15, 0x334155);
  g.fillBox(2, 6, 11, 4, 6, 18, brightSteel); // 上銃身
  g.fillBox(2, 4, 11, 4, 4, 18, barrelSteel); // 下銃身

  // 先端の大型マズルブレーキ＆ゴールドリング
  g.fillBox(1, 3, 17, 5, 7, 18, gold);
  g.fillBox(1, 3, 18, 5, 7, 19, darkGunmetal);
  g.set(3, 6, 19, 0xff922b); // 銃口ハイライト
  g.set(3, 4, 19, 0xff922b);

  return g.toGeometry(0.04, [3.5, 2.5, 3.5]);
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
    // 戦車（超巨大）の重装無限軌道ユニット（左右履帯・ロードホイール）
    upperArm = buildTankTrackTemplate(tc.shirt, true);
    forearm = buildTankTrackTemplate(tc.shirt, false);
    thigh = buildWheelTemplate(4, 3);
    shin = buildWheelTemplate(4, 3);
  } else if (type.id === 'giant_robot') {
    // 巨大ロボットの重装甲メカ四肢（ショルダーアーマー・ロケットナックル・ヘビーフット）
    upperArm = buildLimbTemplate(4, 7, 4, 0x495057, tc.shirt, 0.32);
    forearm = buildLimbTemplate(4, 6, 4, 0x212529, 0x495057, 0.28);
    thigh = buildLimbTemplate(4, 8, 4, 0x343a40, 0x495057, 0.42);
    shin = buildLimbTemplate(4, 8, 5, 0x212529, tc.shirt, 0.43);
  } else if (type.id === 'buggy') {
    // 暴走バギーの本格オフロード4輪タイヤ（前輪4x4、後輪5x5ワイド）
    upperArm = buildBuggyWheelTemplate(tc.shirt, 4, 4);
    forearm = buildBuggyWheelTemplate(tc.shirt, 4, 4);
    thigh = buildBuggyWheelTemplate(tc.shirt, 5, 5);
    shin = buildBuggyWheelTemplate(tc.shirt, 5, 5);
  } else if (type.id === 'anaconda') {
    // 巨大アナコンダの蛇身・尾
    upperArm = buildLimbTemplate(3, 3, 3, 0xb7e4c7, type.look.skin, 0.2);
    forearm = buildLimbTemplate(3, 3, 3, 0xb7e4c7, type.look.skin, 0.2);
    thigh = buildLimbTemplate(6, 7, 6, 0xb7e4c7, type.look.skin, 0.38);
    shin = buildLimbTemplate(5, 7, 5, 0xb7e4c7, type.look.skin, 0.36);
  } else if (type.id === 'dragon') {
    // 西洋ドラゴンの皮膜翼（上腕翼・指骨付き前腕翼）と鉤爪の後脚
    upperArm = specTemplate(buildDragonUpperWing(team));
    forearm = specTemplate(buildDragonForeWing(team));
    thigh = specTemplate(buildDragonThigh(team));
    shin = specTemplate(buildDragonShin(team));
  } else if (type.id === 'decoy') {
    // おとりの木と藁の手足
    upperArm = buildLimbTemplate(3, 7, 3, type.look.skin, 0x7f5539, 0.29);
    forearm = buildLimbTemplate(3, 6, 3, type.look.skin, type.look.skin, 0.26);
    thigh = buildLimbTemplate(3, 8, 3, 0x7f5539, 0x7f5539, 0.4);
    shin = buildLimbTemplate(3, 8, 3, 0x7f5539, 0x7f5539, 0.4);
  } else if (type.id === 'sezain') {
    // セザイン: スパイク肩パッド付きライダース腕とニープロテクター付きライディングブーツ脚
    const uArm = new VoxelGrid(5, 7, 5);
    uArm.fillBox(1, 0, 1, 3, 6, 3, 0x1e293b);
    uArm.fillBox(0, 3, 0, 4, 6, 4, tc.shirt); // 大型ショルダーアーマー
    uArm.fillBox(0, 5, 1, 4, 6, 3, 0xd4af37); // ゴールド縁取り＆スパイク
    upperArm = makeTemplate(uArm, 0.29 / 7, [2.5, 0, 2.5]);

    const fArm = new VoxelGrid(4, 6, 4);
    fArm.fillBox(0, 0, 0, 3, 5, 3, 0x0f172a);
    fArm.fillBox(0, 3, 0, 3, 5, 3, 0x1e293b);
    fArm.fillBox(0, 1, 0, 3, 2, 3, 0xd4af37); // ガントレット金帯
    forearm = makeTemplate(fArm, 0.26 / 6, [2, 0, 2]);

    const th = new VoxelGrid(4, 7, 4);
    th.fillBox(0, 0, 0, 3, 6, 3, 0x1e293b);
    th.fillBox(0, 4, 0, 3, 6, 3, 0x0f172a); // ニーカップ上部
    th.fillBox(1, 5, 3, 2, 6, 3, 0xd4af37); // ゴールド膝パッド
    thigh = makeTemplate(th, 0.32 / 7, [2, 0, 2]);

    const sh = new VoxelGrid(4, 7, 5);
    sh.fillBox(0, 0, 0, 3, 6, 3, 0x09090b); // ヘビーライディングブーツ
    sh.fillBox(0, 0, 0, 3, 2, 4, 0x18181b); // つま先トゥスライダー
    sh.fillBox(0, 3, 3, 3, 4, 3, 0xd4af37); // ブーツバックル
    shin = makeTemplate(sh, 0.30 / 7, [2, 0, 2]);
  } else if (type.id === 'yamamuron') {
    // ヤマムロン: 巨山の一体感を保つ裾野岩盤
    upperArm = buildLimbTemplate(2, 2, 2, 0x1e3621, 0x1e3621, 0.2);
    forearm = buildLimbTemplate(2, 2, 2, 0x1e3621, 0x1e3621, 0.2);
    thigh = buildLimbTemplate(3, 3, 3, 0x1e3621, 0x1e3621, 0.3);
    shin = buildLimbTemplate(3, 3, 3, 0x1e3621, 0x1e3621, 0.3);
  } else if (type.id === 'hongon') {
    // ホンゴン: 女性ピアニストの優美な腕（オフショルダー袖＋ロンググローブ）としなやかな美脚（ヒールパンプス）
    // 上腕: ドレスのオフショルダー袖（チームカラー）＋美肌
    upperArm = buildLimbTemplate(3, 7, 3, type.look.skin, tc.shirt, 0.27);
    // 前腕: 白いシルクのロングオペラグローブ＋手首のゴールドブレスレット
    forearm = buildLimbTemplate(3, 6, 3, 0xf8f9fa, 0xd4af37, 0.25);
    // 大腿: ドレスのドレープに包まれたしなやかな脚部
    thigh = buildLimbTemplate(3, 7, 3, tc.shirt, tc.shirt, 0.35);
    // 脛・足先: ドレスの裾から覗く美脚＋エレガントな黒のハイヒール・パンプス
    shin = buildLimbTemplate(3, 7, 3, 0x18181b, type.look.skin, 0.35);
  } else if (type.id === 'zaisan') {
    // ザイサン: 羽織の袖・手甲と黒袴
    upperArm = buildLimbTemplate(3, 7, 3, type.look.skin, 0x14532d, 0.29);
    forearm = buildLimbTemplate(3, 6, 3, 0x18181b, type.look.skin, 0.26);
    thigh = buildLimbTemplate(4, 8, 4, 0x14532d, 0x14532d, 0.41);
    shin = buildLimbTemplate(4, 8, 4, 0x18181b, 0x14532d, 0.4);
  } else if (type.id === 'lightspeed_ant') {
    // 光速アリ: 細く俊敏な昆虫の6本脚（黒キチン質＋シアン発光関節）
    upperArm = buildLimbTemplate(2, 7, 2, 0x38bdf8, 0x18181b, 0.34);
    forearm = buildLimbTemplate(2, 7, 2, 0xfef08a, 0x18181b, 0.34);
    thigh = buildLimbTemplate(2, 8, 2, 0x38bdf8, 0x18181b, 0.38);
    shin = buildLimbTemplate(2, 8, 2, 0xfef08a, 0x18181b, 0.38);
  } else if (type.id === 'angel_zeruel') {
    // 拒絶神ゼルエル: 浮遊する黒曜石＆白骨外骨格の威厳ある両脚（腕は滑らかリボンメッシュで描画）
    upperArm = buildLimbTemplate(2, 2, 2, 0x141518, 0x141518, 0.15);
    forearm = buildLimbTemplate(2, 2, 2, 0x141518, 0x141518, 0.15);

    const th = new VoxelGrid(6, 9, 6);
    th.fillBox(1, 0, 1, 4, 8, 4, 0x141518);
    th.fillBox(0, 2, 1, 5, 7, 4, 0x1f2126);
    // 大腿部の白骨外骨格プレート＆真紅エネルギーライン
    th.fillBox(1, 3, 4, 4, 7, 5, 0xdce0e5);
    th.fillBox(2, 1, 4, 3, 8, 4, 0xff1744);
    thigh = makeTemplate(th, 0.36 / 9, [3, 0, 3]);

    const sh = new VoxelGrid(6, 10, 7);
    sh.fillBox(1, 2, 1, 4, 9, 4, 0x141518);
    sh.fillBox(1, 4, 2, 4, 8, 5, 0x1f2126);
    // 鋭利な白骨ニーガード（膝当て）と黄金リング・浮遊鉤爪足先
    sh.fillBox(1, 7, 4, 4, 9, 6, 0xf8f9fa);
    sh.fillBox(1, 3, 1, 4, 3, 5, 0xf59f00);
    sh.fillBox(2, 0, 2, 3, 2, 5, 0xdce0e5);
    sh.fillBox(2, 0, 5, 3, 1, 6, 0xff1744);
    shin = makeTemplate(sh, 0.38 / 10, [3, 0, 3]);
  } else if (type.id === 'deoxys') {
    // デオキシス: DNA二重螺旋の触手腕（赤橙＆シアン）と流線型の鋭い脚部
    const redOrange = 0xee5a24;
    const cyan = 0x00d2d3;

    // 上腕: 赤橙とシアンの螺旋パターン
    const ua = new VoxelGrid(4, 7, 4);
    for (let y = 0; y < 7; y++) {
      const shift = Math.floor(y * 0.7) % 4;
      ua.fillBox(0, y, 0, 3, y, 3, redOrange);
      if (shift === 0) ua.fillBox(0, y, 0, 1, y, 1, cyan);
      else if (shift === 1) ua.fillBox(2, y, 0, 3, y, 1, cyan);
      else if (shift === 2) ua.fillBox(2, y, 2, 3, y, 3, cyan);
      else ua.fillBox(0, y, 2, 1, y, 3, cyan);
    }
    upperArm = makeTemplate(ua, 0.32 / 7, [2, 0, 2]);

    // 前腕: 触手状に伸びるDNAハンド
    const fa = new VoxelGrid(4, 7, 4);
    for (let y = 0; y < 7; y++) {
      const shift = (Math.floor(y * 0.7) + 2) % 4;
      fa.fillBox(0, y, 0, 3, y, 3, redOrange);
      if (shift === 0) fa.fillBox(0, y, 0, 1, y, 1, cyan);
      else if (shift === 1) fa.fillBox(2, y, 0, 3, y, 1, cyan);
      else if (shift === 2) fa.fillBox(2, y, 2, 3, y, 3, cyan);
      else fa.fillBox(0, y, 2, 1, y, 3, cyan);
    }
    fa.set(1, 0, 1, cyan);
    fa.set(2, 0, 2, cyan);
    forearm = makeTemplate(fa, 0.30 / 7, [2, 0, 2]);

    // 大腿: 細身の赤橙＋シアンサイドライン
    const th = new VoxelGrid(4, 8, 4);
    th.fillBox(0, 0, 0, 3, 7, 3, redOrange);
    th.fillBox(1, 2, 3, 2, 6, 3, cyan);
    thigh = makeTemplate(th, 0.40 / 8, [2, 0, 2]);

    // 脛・尖った足先
    const sh = new VoxelGrid(4, 9, 4);
    sh.fillBox(0, 1, 0, 3, 8, 3, redOrange);
    sh.fillBox(1, 3, 3, 2, 7, 3, cyan);
    sh.fillBox(1, 0, 1, 2, 1, 2, cyan);
    shin = makeTemplate(sh, 0.42 / 9, [2, 0, 2]);
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
    // ドラゴンの火炎弾: 白熱の芯→黄→橙→赤のギザギザな外炎へ層を重ねた火球
    const g = new VoxelGrid(7, 7, 7);
    for (let z = 0; z < 7; z++) {
      for (let y = 0; y < 7; y++) {
        for (let x = 0; x < 7; x++) {
          const d = Math.hypot(x - 3, y - 3, z - 3);
          if (d > 3.3) continue;
          if (d > 2.6 && ((x * 7 + y * 13 + z * 5) & 3) === 0) continue; // 外炎の欠け
          g.set(x, y, z, d < 1.2 ? 0xfff4c2 : d < 2.0 ? 0xffd43b : d < 2.7 ? 0xff922b : 0xe8590c);
        }
      }
    }
    geom = g.toGeometry(0.05, [3.5, 3.5, 3.5]);
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
/** ヤマムロン強化モードのオーラの寸法と光輪の数 */
const YAMAMURON_AURA_RADIUS = 6.6;
const YAMAMURON_AURA_HEIGHT = 15;
const YAMAMURON_AURA_HALOS = 4;
const _dir = new Vector3();
const _up = new Vector3();
const _right = new Vector3();
const _fwd = new Vector3();
const _quat = new Quaternion();
const _localHit = new Vector3();
const _voxelWorld = new Vector3();
const _headPos = new Vector3();
const _headUp = new Vector3();

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

const _basisMat = new Matrix4();
/** 直交基底 [right, up, fwd] からメッシュを配置・回転する（車両・戦車等用） */
function placeBasisPart(mesh: Mesh, origin: Vector3, right: Vector3, up: Vector3, fwd: Vector3): void {
  mesh.position.copy(origin);
  _basisMat.makeBasis(right, up, fwd);
  mesh.quaternion.setFromRotationMatrix(_basisMat);
}

// 西洋ドラゴン配置用の作業ベクトル
const _dR = new Vector3();
const _dU = new Vector3();
const _dF = new Vector3();
const _dA = new Vector3();
const _dB = new Vector3();
const _dC = new Vector3();
const _dHead = new Vector3();
const _hR = new Vector3();
const _hU = new Vector3();
const _hF = new Vector3();
const _segX = new Vector3();
const _segY = new Vector3();
const _segZ = new Vector3();
const _dW = new Vector3();
const _fR = new Vector3();
const _fU = new Vector3();
const _fF = new Vector3();
const _rR = new Vector3();
const _rU = new Vector3();
const _rF = new Vector3();
const _tmpA = new Vector3();
const _tmpB = new Vector3();
const _tmpC = new Vector3();

/**
 * 直交基底 [srcR, srcU, srcF] を ヨー（srcU 軸）→ ピッチ（機首上げが正）→ ロール の順に回転し、out へ書き込む。
 * src と out には別のベクトルを渡すこと。
 */
function rotateFrame(
  outR: Vector3,
  outU: Vector3,
  outF: Vector3,
  srcR: Vector3,
  srcU: Vector3,
  srcF: Vector3,
  yaw: number,
  pitch: number,
  roll: number,
): void {
  outR.copy(srcR);
  outU.copy(srcU);
  outF.copy(srcF);
  if (yaw !== 0) {
    outR.applyAxisAngle(outU, yaw);
    outF.applyAxisAngle(outU, yaw);
  }
  if (pitch !== 0) {
    outU.applyAxisAngle(outR, -pitch);
    outF.applyAxisAngle(outR, -pitch);
  }
  if (roll !== 0) {
    outR.applyAxisAngle(outF, roll);
    outU.applyAxisAngle(outF, roll);
  }
}

/**
 * 首・尾の節を a→b に沿って配置する（+Y を a→b、+X を rightHint に揃える）。
 * overlap > 0 なら節の長さに合わせて Y 方向へ伸縮し、隣の節と重ねて継ぎ目を隠す。
 */
function placeDragonSegment(mesh: Mesh, a: Vector3, b: Vector3, rightHint: Vector3, radial: number, overlap: number): void {
  _segY.subVectors(b, a);
  const len = _segY.length();
  if (len < 1e-5) return;
  _segY.divideScalar(len);
  _segX.copy(rightHint).addScaledVector(_segY, -rightHint.dot(_segY));
  if (_segX.lengthSq() < 1e-6) _segX.set(1, 0, 0);
  _segX.normalize();
  _segZ.crossVectors(_segX, _segY);
  mesh.position.copy(a);
  _basisMat.makeBasis(_segX, _segY, _segZ);
  mesh.quaternion.setFromRotationMatrix(_basisMat);
  const sy = overlap > 0 ? (len * overlap) / DRAGON_RIG.segmentLength : radial;
  mesh.scale.set(radial, sy, radial);
}

/** 翼の骨を a→b（+X）に合わせ、翼膜（-Z）が胴体の後方へ広がるよう配置する */
function placeDragonWingBone(mesh: Mesh, a: Vector3, b: Vector3, fwdHint: Vector3, templateLen: number, s: number): void {
  _segX.subVectors(b, a);
  const len = _segX.length();
  if (len < 1e-5) return;
  _segX.divideScalar(len);
  _segZ.copy(fwdHint).addScaledVector(_segX, -fwdHint.dot(_segX));
  if (_segZ.lengthSq() < 1e-6) _segZ.copy(UP);
  _segZ.normalize();
  _segY.crossVectors(_segZ, _segX);
  mesh.position.copy(a);
  _basisMat.makeBasis(_segX, _segY, _segZ);
  mesh.quaternion.setFromRotationMatrix(_basisMat);
  const sx = Math.min(2.2 * s, Math.max(0.45 * s, len / templateLen));
  mesh.scale.set(sx, s, s);
}

/** 後脚の骨を a→b（+Y）に合わせ、爪先（+Z）が前方を向くよう配置する */
function placeDragonLegBone(mesh: Mesh, a: Vector3, b: Vector3, fwdHint: Vector3): void {
  _segY.subVectors(b, a);
  const len = _segY.length();
  if (len < 1e-5) return;
  _segY.divideScalar(len);
  _segZ.copy(fwdHint).addScaledVector(_segY, -fwdHint.dot(_segY));
  if (_segZ.lengthSq() < 1e-6) _segZ.set(0, 0, 1);
  _segZ.normalize();
  _segX.crossVectors(_segY, _segZ);
  mesh.position.copy(a);
  _basisMat.makeBasis(_segX, _segY, _segZ);
  mesh.quaternion.setFromRotationMatrix(_basisMat);
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

/** 拒絶神ゼルエル専用: 滑らかな帯状リボンカッター（波打つ高分割・立体稜線付き有機メッシュ）のジオメトリを生成 */
function createZeruelRibbonGeometry(segCount: number, s: number): BufferGeometry {
  const geom = new BufferGeometry();
  const cols = 5;
  const vertCount = (segCount + 1) * cols;
  const positions = new Float32Array(vertCount * 3);
  const colors = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const indices: number[] = [];

  for (let i = 0; i <= segCount; i++) {
    for (let c = 0; c < cols; c++) {
      const idx = (i * cols + c) * 3;
      positions[idx] = (c - 2) * 0.06 * s;
      positions[idx + 1] = -i * 0.09 * s;
      positions[idx + 2] = c === 2 ? 0.018 * s : 0;

      normals[idx] = 0;
      normals[idx + 1] = 0;
      normals[idx + 2] = 1;

      // 頂点カラー: 中央稜線は白銀ゴールド、中間層は冷徹なシルバーボーン、両端エッジは鮮烈な真紅の光刃
      if (c === 2) {
        colors[idx] = 1.0;
        colors[idx + 1] = 0.96;
        colors[idx + 2] = 0.88;
      } else if (c === 1 || c === 3) {
        colors[idx] = 0.92;
        colors[idx + 1] = 0.94;
        colors[idx + 2] = 0.98;
      } else {
        colors[idx] = 1.0;
        colors[idx + 1] = 0.04;
        colors[idx + 2] = 0.22;
      }
    }
  }

  for (let i = 0; i < segCount; i++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = i * cols + c;
      const b = i * cols + (c + 1);
      const c1 = (i + 1) * cols + c;
      const d = (i + 1) * cols + (c + 1);
      indices.push(a, c1, b);
      indices.push(b, c1, d);
    }
  }

  geom.setAttribute('position', new BufferAttribute(positions, 3));
  geom.setAttribute('color', new BufferAttribute(colors, 3));
  geom.setAttribute('normal', new BufferAttribute(normals, 3));
  geom.setIndex(indices);
  return geom;
}

let _ramielMirrorEnvMap: DataTexture | null = null;
/** 幾何神ラミエル専用: 鏡面反射（空・地平線・太陽フレア・オーロラ光帯）を演出するプロシージャル環境マップ */
function getRamielMirrorEnvMap(): DataTexture {
  if (_ramielMirrorEnvMap) return _ramielMirrorEnvMap;
  const width = 256;
  const height = 128;
  const data = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y++) {
    const v = y / (height - 1);
    const elev = v * 2.0 - 1.0; // -1 (底) ～ +1 (天頂)
    for (let x = 0; x < width; x++) {
      const u = x / width;
      const theta = u * Math.PI * 2.0;

      // 鋭い地平線スペキュラバンド＆多重太陽反射ハイライト
      const horizonGlow = Math.exp(-Math.pow(elev * 7.5, 2));
      const sun1 = Math.pow(Math.max(0, Math.cos(theta - 0.8) * Math.cos((elev - 0.28) * 2.2)), 18);
      const sun2 = Math.pow(Math.max(0, Math.cos(theta + 2.1) * Math.cos((elev - 0.15) * 2.5)), 24);
      const prismBand = Math.pow(0.5 + 0.5 * Math.sin(theta * 6.0 + elev * 9.0), 8);
      const auroraBand = Math.pow(0.5 + 0.5 * Math.cos(theta * 4.0 - elev * 7.0), 6) * (1.0 - Math.abs(elev) * 0.5);

      let r = 0;
      let g = 0;
      let b = 0;

      if (elev >= 0) {
        // 上半球: 深いコバルトサファイアから天頂・太陽の純白シアン反射へ
        const skyT = Math.pow(elev, 0.7);
        r = 12 * skyT + 75 * (1 - skyT);
        g = 38 * skyT + 175 * (1 - skyT);
        b = 115 * skyT + 250 * (1 - skyT);
      } else {
        // 下半球: 水晶大地の反射と鋭い蒼白スペキュラ
        const gndT = Math.pow(-elev, 0.65);
        r = 18 * gndT + 90 * (1 - gndT);
        g = 52 * gndT + 190 * (1 - gndT);
        b = 135 * gndT + 255 * (1 - gndT);
      }

      // 地平線・プリズム・太陽ハイライトの加算合成（キラキラ鏡面感）
      r += horizonGlow * 210 + (sun1 + sun2) * 255 + prismBand * 165 + auroraBand * 95;
      g += horizonGlow * 240 + (sun1 + sun2) * 255 + prismBand * 225 + auroraBand * 185;
      b += horizonGlow * 255 + (sun1 + sun2) * 255 + prismBand * 255 + auroraBand * 255;

      const idx = (y * width + x) * 4;
      data[idx] = Math.min(255, Math.round(r));
      data[idx + 1] = Math.min(255, Math.round(g));
      data[idx + 2] = Math.min(255, Math.round(b));
      data[idx + 3] = 255;
    }
  }

  const tex = new DataTexture(data, width, height, RGBAFormat);
  tex.mapping = EquirectangularReflectionMapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.colorSpace = SRGBColorSpace;
  tex.needsUpdate = true;
  _ramielMirrorEnvMap = tex;
  return tex;
}

let _ramielMirrorFacetTex: DataTexture | null = null;
/** 幾何神ラミエル専用: 多面体ダイヤモンドカット＆虹彩プリズム反射を演出する高精細鏡面テクスチャ */
function getRamielMirrorFacetTexture(): DataTexture {
  if (_ramielMirrorFacetTex) return _ramielMirrorFacetTex;
  const size = 256;
  const data = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;

      // 多重三角形・菱形ファセット格子模様
      const f1 = Math.abs(((u * 4.0) % 1.0) - 0.5) * 2.0;
      const f2 = Math.abs(((v * 4.0) % 1.0) - 0.5) * 2.0;
      const diagA = Math.abs((((u + v) * 4.0) % 1.0) - 0.5) * 2.0;
      const diagB = Math.abs((((u - v + 4.0) * 4.0) % 1.0) - 0.5) * 2.0;

      // ファセット稜線の鋭い鏡面ハイライトライン
      const edgeLine =
        Math.pow(Math.max(f1, f2, diagA, diagB), 14) * 0.9 +
        Math.pow(1.0 - Math.min(diagA, diagB), 18) * 0.85;

      // 各ファセット面ごとの微妙な角度差による明暗・プリズム干渉色
      const cellShade = 0.55 + 0.25 * Math.sin((u * 4.0 + v * 4.0) * Math.PI) + 0.2 * Math.cos((u - v) * 8.0 * Math.PI);
      const sparkle = Math.pow(Math.max(0, Math.cos(u * Math.PI * 8) * Math.cos(v * Math.PI * 8)), 28);
      const iridescence = 0.5 + 0.5 * Math.sin((u * 6.0 - v * 5.0) * Math.PI * 2.0);

      const r = (55 * cellShade + 48 * iridescence + edgeLine * 185 + sparkle * 255);
      const g = (145 * cellShade + 65 * (1 - iridescence * 0.4) + edgeLine * 225 + sparkle * 255);
      const b = (235 * cellShade + 30 + edgeLine * 255 + sparkle * 255);

      const idx = (y * size + x) * 4;
      data[idx] = Math.min(255, Math.round(r));
      data[idx + 1] = Math.min(255, Math.round(g));
      data[idx + 2] = Math.min(255, Math.round(b));
      data[idx + 3] = 255;
    }
  }

  const tex = new DataTexture(data, size, size, RGBAFormat);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.colorSpace = SRGBColorSpace;
  tex.needsUpdate = true;
  _ramielMirrorFacetTex = tex;
  return tex;
}

/**
 * 幾何神ラミエル専用: 多ポリゴン・ベベル＆ステップカット構造の鏡面ピラミッドジオメトリを生成する。
 * あえてボクセルを一切使わず、多数の鋭利な鏡面ポリゴン面で異質な神聖結晶を表現する。
 */
function createRamielMirrorPyramidGeometry(s: number, isUpper: boolean): BufferGeometry {
  const sign = isUpper ? 1 : -1;
  const maxR = 0.62 * s;
  const maxH = 0.72 * s * sign;
  const ringSegs = 16; // 16角形ベベル断面（主4頂点＋斜めベベル4頂点＋中間8頂点）

  // 高さ方向の5段階クリスタルカット層
  const tiers: ReadonlyArray<{ hFrac: number; rFrac: number; twist: number; ridgeBoost: number }> = [
    { hFrac: 0.0, rFrac: 1.0, twist: 0.0, ridgeBoost: 1.0 },
    { hFrac: 0.16, rFrac: 0.88, twist: 0.02, ridgeBoost: 1.06 },
    { hFrac: 0.46, rFrac: 0.58, twist: -0.02, ridgeBoost: 1.10 },
    { hFrac: 0.78, rFrac: 0.25, twist: 0.015, ridgeBoost: 1.05 },
    { hFrac: 1.0, rFrac: 0.0, twist: 0.0, ridgeBoost: 1.0 },
  ];

  const getRingVertex = (tierIdx: number, segIdx: number): [number, number, number] => {
    const tier = tiers[tierIdx];
    if (tier.rFrac === 0) return [0, maxH * tier.hFrac, 0];
    const i = ((segIdx % ringSegs) + ringSegs) % ringSegs;
    const baseAngle = (i / ringSegs) * Math.PI * 2.0 + tier.twist;
    // 正八面体の4つの主稜線(i % 4 === 0)を鋭く張り出させ、中間に多面体ダイヤモンドベベル面を形成
    const mod4 = i % 4;
    let shapeFactor = 1.0;
    if (mod4 === 0) shapeFactor = 1.06 * tier.ridgeBoost;
    else if (mod4 === 2) shapeFactor = 0.79;
    else shapeFactor = 0.89;

    const r = maxR * tier.rFrac * shapeFactor;
    return [Math.cos(baseAngle) * r, maxH * tier.hFrac, Math.sin(baseAngle) * r];
  };

  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];

  const pushTri = (
    p0: [number, number, number],
    p1: [number, number, number],
    p2: [number, number, number],
    uv0: [number, number],
    uv1: [number, number],
    uv2: [number, number],
    c0: [number, number, number],
    c1: [number, number, number],
    c2: [number, number, number],
  ) => {
    if (isUpper) {
      positions.push(...p0, ...p1, ...p2);
      uvs.push(...uv0, ...uv1, ...uv2);
      colors.push(...c0, ...c1, ...c2);
    } else {
      // 下部ピラミッドは法線が外側を向くよう頂点順序を反転
      positions.push(...p0, ...p2, ...p1);
      uvs.push(...uv0, ...uv2, ...uv1);
      colors.push(...c0, ...c2, ...c1);
    }
  };

  const getFacetColor = (tierIdx: number, segIdx: number): [number, number, number] => {
    const h = tiers[tierIdx].hFrac;
    const parity = (tierIdx + segIdx) % 3;
    if (h >= 0.95) {
      // 頂点は眩い純白シルバーシアン
      return [0.96, 0.99, 1.0];
    }
    if (parity === 0) {
      // 鏡面アイスホワイト・シアン
      return [0.76 + h * 0.2, 0.92 + h * 0.07, 1.0];
    }
    if (parity === 1) {
      // 鮮やかなクリスタルサファイア
      return [0.24 + h * 0.35, 0.62 + h * 0.28, 0.98];
    }
    // プリズム・ロイヤルアズール
    return [0.42 + h * 0.35, 0.74 + h * 0.2, 1.0];
  };

  for (let t = 0; t < tiers.length - 1; t++) {
    for (let sIdx = 0; sIdx < ringSegs; sIdx++) {
      const p00 = getRingVertex(t, sIdx);
      const p10 = getRingVertex(t, sIdx + 1);
      const p01 = getRingVertex(t + 1, sIdx);
      const p11 = getRingVertex(t + 1, sIdx + 1);

      const u0 = sIdx / ringSegs;
      const u1 = (sIdx + 1) / ringSegs;
      const v0 = tiers[t].hFrac;
      const v1 = tiers[t + 1].hFrac;

      const c00 = getFacetColor(t, sIdx);
      const c10 = getFacetColor(t, sIdx + 1);
      const c01 = getFacetColor(t + 1, sIdx);
      const c11 = getFacetColor(t + 1, sIdx + 1);

      if (t === tiers.length - 2) {
        // 最上段（頂点へ収束する三角形ファセット）
        pushTri(p00, p10, p01, [u0 * 2, v0 * 2], [u1 * 2, v0 * 2], [(u0 + u1), v1 * 2], c00, c10, c01);
      } else {
        pushTri(p00, p10, p11, [u0 * 2, v0 * 2], [u1 * 2, v0 * 2], [u1 * 2, v1 * 2], c00, c10, c11);
        pushTri(p00, p11, p01, [u0 * 2, v0 * 2], [u1 * 2, v1 * 2], [u0 * 2, v1 * 2], c00, c11, c01);
      }
    }
  }

  // 上下ピラミッドが展開・分離した際に見える内側の逆ピラミッド鏡面底面
  const innerCenter: [number, number, number] = [0, -0.08 * maxH, 0];
  const innerCol: [number, number, number] = [0.88, 0.96, 1.0];
  for (let sIdx = 0; sIdx < ringSegs; sIdx++) {
    const p0 = getRingVertex(0, sIdx);
    const p1 = getRingVertex(0, sIdx + 1);
    const u0 = sIdx / ringSegs;
    const u1 = (sIdx + 1) / ringSegs;
    pushTri(p1, p0, innerCenter, [u1, 0], [u0, 0], [0.5, 0.5], innerCol, innerCol, [1.0, 0.85, 0.95]);
  }

  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geom.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geom.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
  geom.computeVertexNormals();
  return geom;
}

/**
 * 幾何神ラミエル専用: 溜め・攻撃時に展開・回転する8枚の多面体ダイヤモンド・プリズムウィング（反射鏡プレート）
 */
function createRamielPrismWingGeometry(s: number): BufferGeometry {
  const w = 0.20 * s;
  const h = 0.42 * s;
  const d = 0.065 * s;

  // 10頂点の多面体ダイヤモンドブレード
  const V: Record<string, [number, number, number]> = {
    top: [0, h, 0],
    bottom: [0, -h * 0.65, 0],
    left: [-w, h * 0.08, 0],
    right: [w, h * 0.08, 0],
    upperL: [-w * 0.58, h * 0.56, d * 0.45],
    upperR: [w * 0.58, h * 0.56, d * 0.45],
    frontMid: [0, h * 0.14, d],
    frontUpper: [0, h * 0.52, d * 0.72],
    backMid: [0, h * 0.14, -d * 0.8],
  };

  const faces: ReadonlyArray<[[number, number, number], [number, number, number], [number, number, number], number]> = [
    [V.top, V.upperL, V.frontUpper, 0],
    [V.top, V.frontUpper, V.upperR, 1],
    [V.upperL, V.left, V.frontMid, 1],
    [V.upperL, V.frontMid, V.frontUpper, 0],
    [V.upperR, V.frontUpper, V.frontMid, 1],
    [V.upperR, V.frontMid, V.right, 0],
    [V.left, V.bottom, V.frontMid, 0],
    [V.right, V.frontMid, V.bottom, 1],
    // 背面ファセット
    [V.top, V.backMid, V.upperL, 1],
    [V.top, V.upperR, V.backMid, 0],
    [V.upperL, V.backMid, V.left, 0],
    [V.upperR, V.right, V.backMid, 1],
    [V.left, V.backMid, V.bottom, 1],
    [V.right, V.bottom, V.backMid, 0],
  ];

  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];

  for (const [p0, p1, p2, shade] of faces) {
    positions.push(...p0, ...p1, ...p2);
    uvs.push(0.1, 0.1, 0.9, 0.2, 0.5, 0.9);
    const cMain: [number, number, number] = shade === 0 ? [0.82, 0.95, 1.0] : [0.32, 0.72, 1.0];
    const cTip: [number, number, number] = [0.98, 0.99, 1.0];
    colors.push(...cTip, ...cMain, ...cMain);
  }

  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geom.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geom.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
  geom.computeVertexNormals();
  return geom;
}

/**
 * 物理ラグドールの各関節位置に合わせてボクセルパーツを毎フレーム追従させ、
 * 被弾時にはボクセルの欠損・部位破壊を適用するクラス。
 */
/** 属性の門で強化された兵の発光色 */
const ELEMENT_GLOW: Readonly<Record<'fire' | 'shock' | 'poison', readonly [number, number, number]>> = {
  fire: [0.42, 0.13, 0.02],
  shock: [0.3, 0.27, 0.04],
  poison: [0.1, 0.32, 0.06],
};

/** ハヤトの口レーザーの太さ（scale 1 あたりの半径。白熱芯・光・外周の順） */
const HAYATO_BEAM_RADII = [0.05, 0.13, 0.26] as const;
/** タニモンの片腕（上腕・前腕・こぶし） */
interface TanimonArm {
  upper: Mesh;
  fore: Mesh;
  fist: Mesh;
}
const _tanShoulder = new Vector3();
const _tanElbow = new Vector3();
const _tanHand = new Vector3();
const _tanDir = new Vector3();
const _hayatoCenter = new Vector3();
const _hayatoMouth = new Vector3();
const _hayatoQ = new Quaternion();
const _hayatoAxisX = new Vector3(1, 0, 0);
const _hayatoAxisZ = new Vector3(0, 0, 1);

export class VoxelCharacterVisual {
  readonly group = new Group();
  private readonly material: MeshLambertMaterial;
  private readonly parts: Record<BodyPartId, DestructiblePart>;
  private readonly weaponMesh: Mesh | null;
  private readonly bowMesh: Mesh | null;

  // 西洋ドラゴン専用: S 字にしなる首・うねる尾（装飾メッシュ）
  private dragonNeck: Mesh[] = [];
  private dragonTail: Mesh[] = [];
  private dragonTailTip: Mesh | null = null;
  private dragonRear: Mesh | null = null;
  private dragonForelegs: Mesh[] = [];
  private readonly dragonPts: Vector3[] = [];
  /** ブレス時の火炎ジェット（外炎・内炎・白熱芯の 3 層コーン）と口元の発光球 */
  private dragonJet: Mesh[] = [];
  private dragonMouthGlow: Mesh | null = null;
  /** ハヤトの顔（ローポリ 1 メッシュ）。口の開閉はモーフターゲット 0 番 */
  private hayatoHead: Mesh | null = null;
  private hayatoMouthOpen = 0;
  private readonly hayatoSeed = Math.random() * 10;
  /** 口レーザーの 3 層（白熱芯・陣営色の光・外周の淡い光） */
  private readonly hayatoBeam: Mesh[] = [];
  private hayatoMouthGlow: Mesh | null = null;
  /** 顔の下で浮力を生む陣営色の輪（敵味方の見分けも兼ねる） */
  private hayatoRing: Mesh | null = null;
  /** タニモンのローポリの剛腕（ボクセルの腕の代わりに表示する） */
  private tanimonArms: { l: TanimonArm; r: TanimonArm } | null = null;
  /** ヤマムロン強化モードのオーラ（外炎コーン・内炎コーン・地面の輪・昇る光輪） */
  private readonly yamamuronAura: Mesh[] = [];
  /** 胴体と頭が強化形態のモデルに差し替わっているか */
  private yamamuronAwakened = false;
  /** 首の突き出し量（+1: ブレスで前へ突き出す, -1: 溜めで仰け反る） */
  private dragonLunge = 0;
  private dragonLastTime = -1;
  private dragonBreathTimer = 0;
  private readonly dragonBreathDir = new Vector3(0, 0, 1);
  /** 描画上の口先（ワールド座標） */
  readonly dragonMouth = new Vector3();
  /** 物理上のブレス発射点から描画上の口先へのずれ（火炎弾の描画位置補正に使う） */
  readonly dragonBreathOffset = new Vector3();

  // 拒絶神ゼルエル専用の滑らかメッシュ＆有機的波打ちエフェクト
  private zeruelCoreMesh: Mesh | null = null;
  private zeruelCoreGlow: Mesh | null = null;
  private zeruelCoreRingA: Mesh | null = null;
  private zeruelCoreRingB: Mesh | null = null;
  private zeruelHalo: Mesh | null = null;
  private zeruelHaloInner: Mesh | null = null;
  private zeruelRibbonL: Mesh | null = null;
  private zeruelRibbonR: Mesh | null = null;
  private zeruelSubRibbonL: Mesh | null = null;
  private zeruelSubRibbonR: Mesh | null = null;
  private zeruelRibbonGeomL: BufferGeometry | null = null;
  private zeruelRibbonGeomR: BufferGeometry | null = null;
  private zeruelSubRibbonGeomL: BufferGeometry | null = null;
  private zeruelSubRibbonGeomR: BufferGeometry | null = null;
  private zeruelAtFieldOuter: Mesh | null = null;
  private zeruelAtFieldMid: Mesh | null = null;
  private zeruelAtFieldInner: Mesh | null = null;

  // 幾何神ラミエル専用の多ポリゴン鏡面反射キラキラボディ＆超豪華タメ・超極太レーザー演出メッシュ群
  private ramielMirrorMat: MeshPhysicalMaterial | null = null;
  private ramielUpperPyramid: Mesh | null = null;
  private ramielLowerPyramid: Mesh | null = null;
  private ramielInnerOcta: Mesh | null = null;
  private ramielPrismWings: Mesh[] = [];
  private ramielCoreMesh: Mesh | null = null;
  private ramielCoreGlow: Mesh | null = null;
  private ramielCoreRingA: Mesh | null = null;
  private ramielCoreRingB: Mesh | null = null;
  private ramielSparkles: Mesh[] = [];
  private ramielAccelRings: Mesh[] = [];
  private ramielMuzzleOrb: Mesh | null = null;
  private ramielMuzzleCrossA: Mesh | null = null;
  private ramielMuzzleCrossB: Mesh | null = null;
  private ramielSightBeam: Mesh | null = null;
  private ramielLaserCore: Mesh | null = null;
  private ramielLaserInner: Mesh | null = null;
  private ramielLaserOuter: Mesh | null = null;
  private ramielLaserShockRings: Mesh[] = [];
  private ramielImpactDome: Mesh | null = null;
  private ramielImpactRing: Mesh | null = null;
  private ramielAtFieldOuter: Mesh | null = null;
  private ramielAtFieldMid: Mesh | null = null;
  private ramielAtFieldInner: Mesh | null = null;

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

    // 西洋ドラゴン: 後半身・前脚・首・尾の節メッシュを生成
    if (unit.type.id === 'dragon') {
      const extras = getDragonExtras(unit.team);
      this.dragonRear = makeMesh(extras.rear, this.material, s);
      this.group.add(this.dragonRear);
      for (const geom of extras.forelegs) {
        const m = makeMesh(geom, this.material, s);
        this.group.add(m);
        this.dragonForelegs.push(m);
      }
      for (let i = 0; i < DRAGON_RIG.neckSegments; i++) {
        const m = makeMesh(extras.segment, this.material, s);
        this.group.add(m);
        this.dragonNeck.push(m);
      }
      for (let i = 0; i < DRAGON_RIG.tailSegments; i++) {
        const m = makeMesh(extras.segment, this.material, s);
        this.group.add(m);
        this.dragonTail.push(m);
      }
      this.dragonTailTip = makeMesh(extras.tailTip, this.material, s);
      this.group.add(this.dragonTailTip);
      for (let i = 0; i <= Math.max(DRAGON_RIG.neckSegments, DRAGON_RIG.tailSegments); i++) {
        this.dragonPts.push(new Vector3());
      }
      // 火炎ジェット: 口先を頂点に +Y 方向へ広がるコーン（加算合成で発光させる）
      const jetLayers = [
        { r: 0.62, h: 3.6, color: 0xff4d0d, opacity: 0.42 },
        { r: 0.38, h: 3.0, color: 0xffa31a, opacity: 0.6 },
        { r: 0.17, h: 2.1, color: 0xfff1b8, opacity: 0.85 },
      ];
      for (const l of jetLayers) {
        const geom = new ConeGeometry(l.r * (s / 2), l.h * (s / 2), 14, 1, true);
        geom.rotateX(Math.PI);
        geom.translate(0, (l.h * (s / 2)) / 2, 0);
        const mat = new MeshBasicMaterial({
          color: l.color,
          transparent: true,
          opacity: l.opacity,
          blending: AdditiveBlending,
          depthWrite: false,
          side: DoubleSide,
        });
        const m = new Mesh(geom, mat);
        m.visible = false;
        this.group.add(m);
        this.dragonJet.push(m);
      }
      this.dragonMouthGlow = new Mesh(
        new SphereGeometry(0.3 * (s / 2), 16, 12),
        new MeshBasicMaterial({ color: 0xffc94d, transparent: true, opacity: 0.8, blending: AdditiveBlending, depthWrite: false }),
      );
      this.dragonMouthGlow.visible = false;
      this.group.add(this.dragonMouthGlow);
    }

    if (unit.type.id === 'hayato') {
      this.material.flatShading = true;
      this.material.needsUpdate = true;
      const head = new Mesh(getHayatoHeadGeometry(), this.material);
      head.castShadow = true;
      head.morphTargetInfluences = [0];
      this.group.add(head);
      this.hayatoHead = head;

      const glow = TEAM_COLORS[unit.team].shirt;
      const beamLayers = [
        { color: 0xffffff, opacity: 1 },
        { color: glow, opacity: 0.75 },
        { color: glow, opacity: 0.28 },
      ];
      for (const layer of beamLayers) {
        // 高さ 1・半径 1 の筒を、毎フレーム長さと太さに合わせて拡大する
        const geom = new CylinderGeometry(1, 1, 1, 10, 1, true);
        geom.translate(0, 0.5, 0);
        const beam = new Mesh(
          geom,
          new MeshBasicMaterial({
            color: layer.color,
            transparent: true,
            opacity: layer.opacity,
            blending: AdditiveBlending,
            depthWrite: false,
            side: DoubleSide,
          }),
        );
        beam.visible = false;
        beam.frustumCulled = false;
        this.group.add(beam);
        this.hayatoBeam.push(beam);
      }
      this.hayatoMouthGlow = new Mesh(
        new SphereGeometry(1, 12, 10),
        new MeshBasicMaterial({ color: 0xfff4d6, transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false }),
      );
      this.hayatoMouthGlow.visible = false;
      this.group.add(this.hayatoMouthGlow);
      this.hayatoRing = new Mesh(
        new TorusGeometry(0.3 * HAYATO_HEAD_HEIGHT * s, 0.022 * HAYATO_HEAD_HEIGHT * s, 6, 12),
        new MeshBasicMaterial({ color: glow, transparent: true, opacity: 0.85 }),
      );
      this.group.add(this.hayatoRing);
    }

    if (unit.type.id === 'tanimon') {
      this.material.flatShading = true;
      this.material.needsUpdate = true;
      const make = (geom: BufferGeometry): Mesh => {
        const m = new Mesh(geom, this.material);
        m.castShadow = true;
        m.receiveShadow = true;
        this.group.add(m);
        return m;
      };
      const arm = (): TanimonArm => ({
        upper: make(getTanimonUpperArmGeometry(unit.team)),
        fore: make(getTanimonForearmGeometry()),
        fist: make(getTanimonFistGeometry()),
      });
      this.tanimonArms = { l: arm(), r: arm() };
    }

    if (unit.type.id === 'yamamuron') {
      const addAura = (geom: BufferGeometry, color: number, opacity: number): void => {
        const mesh = new Mesh(
          geom,
          new MeshBasicMaterial({ color, transparent: true, opacity, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }),
        );
        mesh.visible = false;
        this.group.add(mesh);
        this.yamamuronAura.push(mesh);
      };
      // 山の造形が見えるようコーンは薄くする。強化形態は戦闘中に初めて要るので配置時に作っておく
      getYamamuronAwakenedTemplates(unit.team);
      addAura(new ConeGeometry(YAMAMURON_AURA_RADIUS, YAMAMURON_AURA_HEIGHT, 28, 1, true), 0xff2a00, 0.14);
      addAura(new ConeGeometry(YAMAMURON_AURA_RADIUS * 0.74, YAMAMURON_AURA_HEIGHT * 0.86, 24, 1, true), 0xffc226, 0.1);
      addAura(new TorusGeometry(YAMAMURON_AURA_RADIUS, 0.09, 8, 64), 0xff9500, 0.95);
      for (let i = 0; i < YAMAMURON_AURA_HALOS; i++) {
        addAura(new TorusGeometry(1, 0.05, 8, 48), i % 2 === 0 ? 0xfff1a8 : 0xff5a00, 0.85);
      }
    }

    // 拒絶神ゼルエル専用の滑らかメッシュ＆有機的異質パーツ群の初期化
    if (unit.type.id === 'angel_zeruel') {
      // 1. 滑らかな深紅のコア球体 (SphereGeometry: ボクセル肋骨の中央に収まる異質球体)
      const coreMat = new MeshStandardMaterial({
        color: 0xff0033,
        roughness: 0.08,
        metalness: 0.35,
        emissive: 0xd90429,
        emissiveIntensity: 1.1,
      });
      this.zeruelCoreMesh = new Mesh(new SphereGeometry(0.165 * s, 32, 32), coreMat);
      this.group.add(this.zeruelCoreMesh);

      // コアの半透明グローオーラ球体
      const glowMat = new MeshBasicMaterial({
        color: 0xff2255,
        transparent: true,
        opacity: 0.38,
      });
      this.zeruelCoreGlow = new Mesh(new SphereGeometry(0.205 * s, 24, 24), glowMat);
      this.group.add(this.zeruelCoreGlow);

      // コア周囲を旋回する滑らかなエネルギーリングA/B (TorusGeometry)
      const ringMatA = new MeshBasicMaterial({
        color: 0xff3366,
        transparent: true,
        opacity: 0.88,
      });
      this.zeruelCoreRingA = new Mesh(new TorusGeometry(0.24 * s, 0.012 * s, 16, 48), ringMatA);
      this.group.add(this.zeruelCoreRingA);

      const ringMatB = new MeshBasicMaterial({
        color: 0xffd43b,
        transparent: true,
        opacity: 0.78,
      });
      this.zeruelCoreRingB = new Mesh(new TorusGeometry(0.28 * s, 0.009 * s, 16, 48), ringMatB);
      this.group.add(this.zeruelCoreRingB);

      // 2. 使徒の頭上二重ヘイロー光輪 (TorusGeometry)
      const haloMat = new MeshStandardMaterial({
        color: 0x141518,
        emissive: 0x9d4edd,
        emissiveIntensity: 1.1,
        roughness: 0.2,
        metalness: 0.5,
      });
      this.zeruelHalo = new Mesh(new TorusGeometry(0.54 * s, 0.026 * s, 16, 64), haloMat);
      this.group.add(this.zeruelHalo);

      const haloInnerMat = new MeshBasicMaterial({
        color: 0xffd43b,
        transparent: true,
        opacity: 0.85,
      });
      this.zeruelHaloInner = new Mesh(new TorusGeometry(0.36 * s, 0.014 * s, 16, 48), haloInnerMat);
      this.group.add(this.zeruelHaloInner);

      // 3. 滑らかで常に波打つ主リボンカッター帯 & 副リボン帯 (左右計4条)
      const ribbonMat = new MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.16,
        metalness: 0.38,
        side: DoubleSide,
        emissive: 0x3a0012,
      });
      this.zeruelRibbonGeomL = createZeruelRibbonGeometry(28, s);
      this.zeruelRibbonL = new Mesh(this.zeruelRibbonGeomL, ribbonMat);
      this.group.add(this.zeruelRibbonL);

      this.zeruelRibbonGeomR = createZeruelRibbonGeometry(28, s);
      this.zeruelRibbonR = new Mesh(this.zeruelRibbonGeomR, ribbonMat);
      this.group.add(this.zeruelRibbonR);

      this.zeruelSubRibbonGeomL = createZeruelRibbonGeometry(28, s);
      this.zeruelSubRibbonL = new Mesh(this.zeruelSubRibbonGeomL, ribbonMat);
      this.group.add(this.zeruelSubRibbonL);

      this.zeruelSubRibbonGeomR = createZeruelRibbonGeometry(28, s);
      this.zeruelSubRibbonR = new Mesh(this.zeruelSubRibbonGeomR, ribbonMat);
      this.group.add(this.zeruelSubRibbonR);

      // 4. 多重八角形ATフィールドシールド (外層・中層・内層の3重回転幾何学結界)
      const makeOctagonLayer = (radius: number, fillCol: number, edgeCol: number): Mesh => {
        const mat = new MeshBasicMaterial({
          color: fillCol,
          transparent: true,
          opacity: 0,
          side: DoubleSide,
        });
        const geom = new CircleGeometry(radius, 8);
        const mesh = new Mesh(geom, mat);
        const edges = new LineSegments(new EdgesGeometry(geom), new LineBasicMaterial({ color: edgeCol }));
        mesh.add(edges);
        mesh.visible = false;
        this.group.add(mesh);
        return mesh;
      };
      this.zeruelAtFieldOuter = makeOctagonLayer(1.45 * s, 0xff922b, 0xffd43b);
      this.zeruelAtFieldMid = makeOctagonLayer(1.02 * s, 0xff6b6b, 0xffa94d);
      this.zeruelAtFieldInner = makeOctagonLayer(0.58 * s, 0xff0033, 0xffffff);
    }

    // 幾何神ラミエル専用の多ポリゴン鏡面反射キラキラボディ＆超豪華タメ・超極太レーザー演出の初期化
    if (unit.type.id === 'angel_ramiel') {
      const envMap = getRamielMirrorEnvMap();
      const facetTex = getRamielMirrorFacetTexture();

      // 1. 鏡面反射＆プリズム虹彩を持つ多面体ミラーマテリアル（ボクセルとは一線を画す超光沢鏡面質感）
      this.ramielMirrorMat = new MeshPhysicalMaterial({
        color: 0xd0f0ff,
        map: facetTex,
        envMap,
        envMapIntensity: 2.6,
        vertexColors: true,
        metalness: 0.92,
        roughness: 0.04,
        clearcoat: 1.0,
        clearcoatRoughness: 0.02,
        reflectivity: 1.0,
        iridescence: 0.78,
        iridescenceIOR: 1.5,
        emissive: 0x0b3c7d,
        emissiveIntensity: 0.42,
         flatShading: true,
      });

      // 上部・下部多ポリゴン鏡面ピラミッド + ダイヤモンド稜線ハイライト
      const upperGeom = createRamielMirrorPyramidGeometry(s, true);
      this.ramielUpperPyramid = new Mesh(upperGeom, this.ramielMirrorMat);
      this.ramielUpperPyramid.castShadow = true;
      this.ramielUpperPyramid.receiveShadow = true;
      const upperEdges = new LineSegments(
        new EdgesGeometry(upperGeom, 10),
        new LineBasicMaterial({ color: 0xe8fbff, transparent: true, opacity: 0.85 }),
      );
      this.ramielUpperPyramid.add(upperEdges);
      this.group.add(this.ramielUpperPyramid);

      const lowerGeom = createRamielMirrorPyramidGeometry(s, false);
      this.ramielLowerPyramid = new Mesh(lowerGeom, this.ramielMirrorMat);
      this.ramielLowerPyramid.castShadow = true;
      this.ramielLowerPyramid.receiveShadow = true;
      const lowerEdges = new LineSegments(
        new EdgesGeometry(lowerGeom, 10),
        new LineBasicMaterial({ color: 0xe8fbff, transparent: true, opacity: 0.85 }),
      );
      this.ramielLowerPyramid.add(lowerEdges);
      this.group.add(this.ramielLowerPyramid);

      // 2. 内部の多分割ジオデシック結晶殻 (OctahedronGeometry detail=2: 128ポリゴンの鏡面内殻)
      const innerOctaGeom = new OctahedronGeometry(0.36 * s, 2);
      const innerOctaMat = new MeshPhysicalMaterial({
        color: 0x74c0fc,
        envMap,
        envMapIntensity: 2.8,
        metalness: 0.95,
        roughness: 0.03,
        clearcoat: 1.0,
        emissive: 0x1971c2,
        emissiveIntensity: 0.65,
        flatShading: true,
      });
      this.ramielInnerOcta = new Mesh(innerOctaGeom, innerOctaMat);
      this.group.add(this.ramielInnerOcta);

      // 3. 8枚の可変展開式ダイヤモンド・プリズムウィング（通常時は八面体表面に密着し、タメ時に花弁状のパラボラ反射鏡へ変形）
      const wingGeom = createRamielPrismWingGeometry(s);
      for (let i = 0; i < 8; i++) {
        const wing = new Mesh(wingGeom, this.ramielMirrorMat);
        wing.castShadow = true;
        const wingEdges = new LineSegments(
          new EdgesGeometry(wingGeom, 8),
          new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }),
        );
        wing.add(wingEdges);
        this.group.add(wing);
        this.ramielPrismWings.push(wing);
      }

      // 4. 中心に宿る高ポリゴン真紅の使徒コア球体 & 二重エネルギーリング
      const coreMat = new MeshStandardMaterial({
        color: 0xff0044,
        envMap,
        envMapIntensity: 2.0,
        roughness: 0.06,
        metalness: 0.45,
        emissive: 0xff1744,
        emissiveIntensity: 1.8,
      });
      this.ramielCoreMesh = new Mesh(new SphereGeometry(0.21 * s, 36, 36), coreMat);
      this.group.add(this.ramielCoreMesh);

      const coreGlowMat = new MeshBasicMaterial({
        color: 0xff4d79,
        transparent: true,
        opacity: 0.45,
      });
      this.ramielCoreGlow = new Mesh(new SphereGeometry(0.27 * s, 28, 28), coreGlowMat);
      this.group.add(this.ramielCoreGlow);

      this.ramielCoreRingA = new Mesh(
        new TorusGeometry(0.42 * s, 0.013 * s, 16, 64),
        new MeshBasicMaterial({ color: 0xa5f3fc, transparent: true, opacity: 0.88 }),
      );
      this.group.add(this.ramielCoreRingA);

      this.ramielCoreRingB = new Mesh(
        new TorusGeometry(0.49 * s, 0.010 * s, 16, 64),
        new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.78 }),
      );
      this.group.add(this.ramielCoreRingB);

      // 5. 鏡面ボディの周囲で常にキラキラと明滅・反射する14個の多面体スパークル結晶（星型閃光）
      const sparkleGeom = new OctahedronGeometry(0.062 * s, 0);
      const sparkleColors = [0xffffff, 0xa5f3fc, 0xe0f2fe, 0xfef08a, 0xe879f9];
      for (let i = 0; i < 14; i++) {
        const spMat = new MeshBasicMaterial({
          color: sparkleColors[i % sparkleColors.length],
          transparent: true,
          opacity: 0.92,
        });
        const spMesh = new Mesh(sparkleGeom, spMat);
        this.group.add(spMesh);
        this.ramielSparkles.push(spMesh);
      }

      // 6. 長いタメ時間（windup）に前方へ多段展開する3連装の荷電粒子加速リング
      const ringRadii = [0.58 * s, 0.42 * s, 0.28 * s];
      const ringCols = [0x38bdf8, 0x00f5d4, 0xffffff];
      for (let i = 0; i < 3; i++) {
        const accGeom = new TorusGeometry(ringRadii[i], 0.018 * s, 16, 48);
        const accMat = new MeshBasicMaterial({
          color: ringCols[i],
          transparent: true,
          opacity: 0.9,
        });
        const accMesh = new Mesh(accGeom, accMat);
        const octEdges = new LineSegments(
          new EdgesGeometry(new CircleGeometry(ringRadii[i] * 1.12, 8)),
          new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }),
        );
        accMesh.add(octEdges);
        accMesh.visible = false;
        this.group.add(accMesh);
        this.ramielAccelRings.push(accMesh);
      }

      // 7. 銃口焦点に収束する高密度プラズマ球＆十字フレア＆ロックオン照準プリズムレーザー
      this.ramielMuzzleOrb = new Mesh(
        new SphereGeometry(0.24 * s, 32, 32),
        new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 }),
      );
      this.ramielMuzzleOrb.visible = false;
      this.group.add(this.ramielMuzzleOrb);

      const crossGeo = new OctahedronGeometry(0.18 * s, 0);
      this.ramielMuzzleCrossA = new Mesh(
        crossGeo,
        new MeshBasicMaterial({ color: 0x00f5d4, transparent: true, opacity: 0.88 }),
      );
      this.ramielMuzzleCrossA.visible = false;
      this.group.add(this.ramielMuzzleCrossA);

      this.ramielMuzzleCrossB = new Mesh(
        crossGeo,
        new MeshBasicMaterial({ color: 0xe599f7, transparent: true, opacity: 0.82 }),
      );
      this.ramielMuzzleCrossB.visible = false;
      this.group.add(this.ramielMuzzleCrossB);

      // 照準ロックオンレーザー（長さ1のシリンダー、Y軸基準）
      const sightCyl = new CylinderGeometry(0.016 * s, 0.016 * s, 1.0, 12, 1, true);
      this.ramielSightBeam = new Mesh(
        sightCyl,
        new MeshBasicMaterial({ color: 0x00f5d4, transparent: true, opacity: 0.7, side: DoubleSide }),
      );
      this.ramielSightBeam.visible = false;
      this.group.add(this.ramielSightBeam);

      // 8. 超極太・広範囲・高威力3層3Dレーザービームメッシュ＆高速螺旋ショックリング＆着弾プラズマドーム
      const unitCylCore = new CylinderGeometry(1.0, 1.0, 1.0, 24, 1, false);
      const unitCylSheath = new CylinderGeometry(1.0, 1.0, 1.0, 28, 1, true);

      this.ramielLaserCore = new Mesh(
        unitCylCore,
        new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.98 }),
      );
      this.ramielLaserCore.visible = false;
      this.group.add(this.ramielLaserCore);

      this.ramielLaserInner = new Mesh(
        unitCylSheath,
        new MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.82, side: DoubleSide }),
      );
      this.ramielLaserInner.visible = false;
      this.group.add(this.ramielLaserInner);

      this.ramielLaserOuter = new Mesh(
        unitCylSheath,
        new MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.45, side: DoubleSide }),
      );
      this.ramielLaserOuter.visible = false;
      this.group.add(this.ramielLaserOuter);

      const shockTorusGeo = new TorusGeometry(1.0, 0.06, 14, 40);
      for (let i = 0; i < 6; i++) {
        const ringMesh = new Mesh(
          shockTorusGeo,
          new MeshBasicMaterial({
            color: i % 2 === 0 ? 0xffffff : 0x00f5d4,
            transparent: true,
            opacity: 0.9,
          }),
        );
        ringMesh.visible = false;
        this.group.add(ringMesh);
        this.ramielLaserShockRings.push(ringMesh);
      }

      this.ramielImpactDome = new Mesh(
        new SphereGeometry(1.0, 32, 24),
        new MeshBasicMaterial({ color: 0x74c0fc, transparent: true, opacity: 0.72, side: DoubleSide }),
      );
      this.ramielImpactDome.visible = false;
      this.group.add(this.ramielImpactDome);

      this.ramielImpactRing = new Mesh(
        new TorusGeometry(1.0, 0.055, 16, 48),
        new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.92 }),
      );
      this.ramielImpactRing.visible = false;
      this.group.add(this.ramielImpactRing);

      // 9. 多重八角形ATフィールドシールド
      const makeRamielAtLayer = (radius: number, fillCol: number, edgeCol: number): Mesh => {
        const mat = new MeshBasicMaterial({
          color: fillCol,
          transparent: true,
          opacity: 0,
          side: DoubleSide,
        });
        const geom = new CircleGeometry(radius, 8);
        const mesh = new Mesh(geom, mat);
        const edges = new LineSegments(new EdgesGeometry(geom), new LineBasicMaterial({ color: edgeCol }));
        mesh.add(edges);
        mesh.visible = false;
        this.group.add(mesh);
        return mesh;
      };
      this.ramielAtFieldOuter = makeRamielAtLayer(1.38 * s, 0xff922b, 0xffd43b);
      this.ramielAtFieldMid = makeRamielAtLayer(0.96 * s, 0xffa94d, 0xffe066);
      this.ramielAtFieldInner = makeRamielAtLayer(0.55 * s, 0x38bdf8, 0xffffff);
    }

    this.sync();
  }

  /** 物理粒子の現在位置に合わせて各ボクセルメッシュの座標・回転・発光色を更新する */
  sync(): void {
    const u = this.unit;
    if (this.yamamuronAura.length > 0) this.syncYamamuronAura();
    if (u.type.id === 'angel_zeruel') {
      this.syncZeruel();
      this.updateMaterialStatus();
      return;
    }
    if (u.type.id === 'dragon') {
      this.syncDragon();
      this.updateMaterialStatus();
      return;
    }
    if (u.type.id === 'buggy') {
      this.syncBuggy();
      this.updateMaterialStatus();
      return;
    }
    if (u.type.id === 'giant_tank') {
      this.syncTank();
      this.updateMaterialStatus();
      return;
    }
    if (u.type.id === 'sezain') {
      this.syncSezain();
      this.updateMaterialStatus();
      return;
    }
    if (u.type.id === 'warelephant') {
      this.syncWarelephant();
      this.updateMaterialStatus();
      return;
    }
    if (u.type.id === 'anaconda') {
      this.syncAnaconda();
      this.updateMaterialStatus();
      return;
    }
    if (u.type.id === 'angel_ramiel') {
      this.syncRamiel();
      this.updateMaterialStatus();
      return;
    }
    if (u.type.id === 'hayato') {
      this.syncHayato();
      this.updateMaterialStatus();
      return;
    }
    if (u.type.id === 'lightspeed_ant') {
      this.syncLightspeedAnt();
      this.updateMaterialStatus();
      return;
    }

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
    // 頭部を首元にフィット配置（首浮き・デュラハン状態を解消）
    _headUp.copy(_dir).normalize();
    _headPos.copy(chest).addScaledVector(_headUp, 0.18 * u.scale);
    placeOrientedPart(this.parts.head.mesh, _headPos, _dir, shL, shR);

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
    if (this.tanimonArms) this.syncTanimonArms(this.tanimonArms);

    // 近接武器・右手武器（右前腕が破壊されたら非表示）
    if (this.weaponMesh) {
      if (u.weaponParticles.length === 2) {
        this.weaponMesh.visible = !this.parts.forearmR.destroyed;
        placeLimb(this.weaponMesh, P[J.HandR].pos, u.weaponParticles[1].pos);
      }
    }

    // 弓・銃・ガトリング・重力球・大盾・左手武器（左前腕が破壊されたら非表示）
    if (this.bowMesh) {
      this.bowMesh.visible = !this.parts.forearmL.destroyed;
      if (u.type.id === 'zaisan') {
        _dir.subVectors(P[J.HandL].pos, P[J.ElbowL].pos);
        if (_dir.lengthSq() > 1e-4) _dir.normalize();
        else _dir.set(0, 0, 1);
        const tipPos = P[J.HandL].pos.clone().addScaledVector(_dir, 1.15 * u.scale);
        placeLimb(this.bowMesh, P[J.HandL].pos, tipPos);
      } else {
        _dir.subVectors(chest, pelvis);
        const anchorPos = u.shieldParticle ? u.shieldParticle.pos : P[J.HandL].pos;
        placeOrientedPart(this.bowMesh, anchorPos, _dir, shL, shR);
        if (u.type.id === 'minigunner') {
          this.bowMesh.rotateZ(u.barrelSpin);
        }
      }
    }

    this.updateMaterialStatus();
  }

  /**
   * タニモンの剛腕を置く。ボクセルの腕は当たり判定と部位破壊のために残し、表示だけ差し替える。
   * 右腕は攻撃中、敵の頭（unit.tanimonHand）まで前腕を伸ばす。伸びるほど前腕は細くなる。
   */
  private syncTanimonArms(arms: { l: TanimonArm; r: TanimonArm }): void {
    const u = this.unit;
    const P = u.joints;
    const s = u.scale;
    for (const id of ['upperArmL', 'forearmL', 'upperArmR', 'forearmR'] as const) this.parts[id].mesh.visible = false;
    for (const isR of [false, true]) {
      const arm = isR ? arms.r : arms.l;
      const side = isR ? 1 : -1;
      const upperPart = this.parts[isR ? 'upperArmR' : 'upperArmL'];
      const forePart = this.parts[isR ? 'forearmR' : 'forearmL'];
      // 太い腕が胴にめり込まないよう、肩・肘・手を体の外へずらす
      _tanShoulder.copy(P[isR ? J.ShoulderR : J.ShoulderL].pos).addScaledVector(u.rightDir, side * 0.07 * s);
      _tanShoulder.y -= 0.02 * s;
      _tanElbow.copy(P[isR ? J.ElbowR : J.ElbowL].pos).addScaledVector(u.rightDir, side * 0.06 * s);
      const reach = isR ? u.tanimonReach : 0;
      if (reach > 0.001) {
        // こぶしの中心が頭に重なるよう、手首はつかむ点の少し手前に置く
        _tanDir.subVectors(u.tanimonHand, _tanElbow);
        const len = _tanDir.length();
        _tanHand.copy(u.tanimonHand);
        if (len > 1e-4) _tanHand.addScaledVector(_tanDir, (-0.09 * s) / len);
      } else {
        _tanHand.copy(P[isR ? J.HandR : J.HandL].pos).addScaledVector(u.rightDir, side * 0.05 * s);
      }
      arm.upper.visible = !upperPart.destroyed;
      arm.fore.visible = !upperPart.destroyed && !forePart.destroyed;
      arm.fist.visible = arm.fore.visible;
      // 節の +X は右腕で体の外側を向くので、左腕は左右反転して置く
      placeTanimonSegment(arm.upper, _tanShoulder, _tanElbow, u.forward, s, !isR);
      const foreLen = _tanElbow.distanceTo(_tanHand);
      placeTanimonSegment(arm.fore, _tanElbow, _tanHand, u.forward, s * tanimonStretchThickness(foreLen, s), !isR);
      _tanDir.subVectors(_tanHand, _tanElbow);
      // つかむ手は大きく開いて見えるよう、伸ばしている間だけ大きくする
      placeTanimonFist(arm.fist, _tanHand, _tanDir, u.forward, s * (1 + 0.45 * reach), !isR);
    }
  }

  /** ドラゴンが火炎ブレスを 1 発吐いたことを通知する（火炎ジェットの向き・表示時間を更新） */
  notifyDragonBreath(dir: Vector3): void {
    if (dir.lengthSq() < 1e-8) return;
    this.dragonBreathDir.copy(dir).normalize();
    this.dragonBreathTimer = 0.22;
  }

  /**
   * 西洋ドラゴン専用の配置処理（ダイナミック版）。
   * 物理骨格（直立の羽ばたき姿勢）はそのままに、見た目だけを胴体座標系で組み立てる。
   *  - 胴体は腰で前半身・後半身の 2 パーツに分かれ、羽ばたきに合わせて上下に揺れながらうねる
   *  - 翼は大きな振幅で打ち下ろし、翼端が遅れてしなり、打ち上げ時には翼をひねって畳む
   *  - 頭は首振り・うなずき・傾げを重ね、ブレスの溜めでは仰け反る
   *  - 前脚・後脚は左右交互にばたつかせ、尾は後半身からムチのようにうねる
   */
  private syncDragon(): void {
    const u = this.unit;
    const s = u.scale;
    const P = u.joints;
    const pelvis = P[J.Pelvis].pos;
    const time = performance.now() * 0.001;
    const R = DRAGON_RIG;
    const alive = u.alive;
    const lively = alive ? 1 : 0.12;
    const breathing = alive && u.attackPhase === 'strike';
    const charging = alive && u.attackPhase === 'windup';
    const dt = this.dragonLastTime < 0 ? 0 : Math.min(0.1, Math.max(0, time - this.dragonLastTime));
    this.dragonLastTime = time;

    // 首の突き出し: 溜めで仰け反り、ブレスで「ぐいーん」と一気に前へ突き出す
    const lungeTarget = breathing ? 1 : charging ? -1 : 0;
    const lungeRate = lungeTarget > this.dragonLunge ? 9 : 4;
    this.dragonLunge += (lungeTarget - this.dragonLunge) * Math.min(1, dt * lungeRate);
    const L = Math.max(0, this.dragonLunge); // 前へ突き出す量
    const B = Math.max(0, -this.dragonLunge); // 仰け反る量

    // 羽ばたき位相（物理の羽ばたきより少しゆっくり、その分ストロークを大きく）
    const ph = u.walkPhase * 0.8;
    const flap = alive ? Math.sin(ph) : -0.5;
    const lag = alive ? Math.sin(ph - 0.75) : -0.5;
    const stroke = alive ? Math.cos(ph) : 0; // > 0: 打ち上げ, < 0: 打ち下ろし
    // 打ち下ろしで体が持ち上がる（揚力のうねり）
    const heave = -Math.cos(ph - 0.45) * 0.075 * lively;

    // 基準となる水平な胴体基底
    _dF.set(u.forward.x, 0, u.forward.z);
    if (_dF.lengthSq() < 1e-6) _dF.set(0, 0, 1);
    _dF.normalize();
    _dU.copy(UP);
    _dR.crossVectors(_dU, _dF).normalize();

    // 物理骨格の左右が胴体基底 _dR のどちら側にあるか（L/R 部位を正しい側へ配置するため）
    _hR.subVectors(P[J.ShoulderR].pos, P[J.ShoulderL].pos);
    _hR.y = 0;
    const rs = _hR.dot(_dR) >= 0 ? 1 : -1;

    // 腰（前後半身の関節）
    _dW.copy(pelvis).addScaledVector(_dU, heave * s).addScaledVector(_dF, R.waistZ * s);

    // 前半身: 羽ばたきに合わせたピッチ＋ゆったりした左右のうねり
    const frontYaw = Math.sin(time * 1.3) * 0.09 * lively;
    const frontPitch = (0.1 * stroke + 0.16 * B - 0.14 * L) * lively;
    const frontRoll = Math.sin(time * 1.1) * 0.06 * lively;
    rotateFrame(_fR, _fU, _fF, _dR, _dU, _dF, frontYaw, frontPitch, frontRoll);
    // 後半身: 前半身と逆位相に揺れて胴体全体が S 字にしなる
    const rearYaw = -Math.sin(time * 1.3 - 0.7) * 0.14 * lively;
    const rearPitch = -0.13 * Math.cos(ph - 0.6) * lively;
    const rearRoll = -frontRoll * 0.7;
    rotateFrame(_rR, _rU, _rF, _dR, _dU, _dF, rearYaw, rearPitch, rearRoll);

    const frontPoint = (out: Vector3, x: number, y: number, z: number): Vector3 =>
      out.copy(_dW).addScaledVector(_fR, x * s).addScaledVector(_fU, y * s).addScaledVector(_fF, (z - R.waistZ) * s);
    const rearPoint = (out: Vector3, x: number, y: number, z: number): Vector3 =>
      out.copy(_dW).addScaledVector(_rR, x * s).addScaledVector(_rU, y * s).addScaledVector(_rF, (z - R.waistZ) * s);

    const torso = this.parts.torso;
    const bodyVisible = !torso.destroyed;
    torso.mesh.visible = bodyVisible;
    placeBasisPart(torso.mesh, _dW, _fR, _fU, _fF);
    if (this.dragonRear) {
      this.dragonRear.visible = bodyVisible;
      placeBasisPart(this.dragonRear, _dW, _rR, _rU, _rF);
    }

    // 頭部: ブレスの首振り（肩のねじれ）を基準に、首振り・うなずき・傾げを重ねる
    if (_hR.lengthSq() < 1e-6 || !alive) _hR.copy(_dR).multiplyScalar(rs);
    _hR.normalize().multiplyScalar(rs);
    _hF.crossVectors(_hR, UP).normalize();
    _hU.copy(UP);
    _hR.crossVectors(_hU, _hF).normalize();
    const sway = (1 - 0.75 * L) * lively;
    const tremble = L * Math.sin(time * 47) * 0.035; // 炎を吐く反動の小刻みな震え
    const headYaw = (Math.sin(time * 1.7) * 0.2 + Math.sin(time * 3.1) * 0.06) * sway + tremble;
    const headPitch = -0.1 + Math.sin(time * 2.3) * 0.12 * sway - 0.08 * stroke * lively + 0.42 * B - 0.22 * L + tremble;
    const headRoll = Math.sin(time * 1.4) * 0.1 * sway;
    const headBaseR = _tmpA.copy(_hR);
    const headBaseU = _tmpB.copy(_hU);
    const headBaseF = _tmpC.copy(_hF);
    rotateFrame(_hR, _hU, _hF, headBaseR, headBaseU, headBaseF, headYaw, headPitch, headRoll);
    _dHead
      .copy(P[J.Head].pos)
      .addScaledVector(headBaseF, (0.24 + 0.58 * L - 0.14 * B) * s)
      .addScaledVector(UP, (-0.06 + heave * 0.6 + Math.sin(time * 2.3 + 0.4) * 0.04 * sway - 0.14 * L + 0.1 * B) * s)
      .addScaledVector(headBaseR, Math.sin(time * 1.7 - 0.5) * 0.07 * sway * s);
    const head = this.parts.head;
    head.mesh.visible = !head.destroyed;
    placeBasisPart(head.mesh, _dHead, _hR, _hU, _hF);

    // 口先（顎の間）と、物理上のブレス発射点（Unit 側と同じ式）からのずれ
    const hv = 0.019 * s; // 頭部テンプレートのボクセル寸法
    this.dragonMouth.copy(_dHead).addScaledVector(_hF, 19.5 * hv).addScaledVector(_hU, 1.5 * hv);
    this.dragonBreathOffset
      .copy(this.dragonMouth)
      .sub(P[J.Head].pos)
      .addScaledVector(u.forward, -0.5 * s);

    // 首: 付け根→（左右に揺れる）制御点→頭の 2 次ベジェ曲線に沿って節を並べる
    // 突き出し時は制御点も前へ引き出し、首をほぼ水平に伸ばしきる
    frontPoint(_dA, R.neckBase[0], R.neckBase[1], R.neckBase[2]);
    frontPoint(
      _dB,
      R.neckCtrl[0] - Math.sin(time * 1.7 - 0.9) * 0.06 * sway,
      R.neckCtrl[1] - 0.1 * L + 0.04 * B,
      R.neckCtrl[2] + 0.26 * L - 0.08 * B,
    );
    _dC.copy(_dHead).addScaledVector(_hF, -0.02 * s);
    const nN = this.dragonNeck.length;
    for (let i = 0; i <= nN; i++) {
      const t = i / nN;
      const a = (1 - t) * (1 - t);
      const b = 2 * (1 - t) * t;
      const c = t * t;
      this.dragonPts[i].set(
        _dA.x * a + _dB.x * b + _dC.x * c,
        _dA.y * a + _dB.y * b + _dC.y * c,
        _dA.z * a + _dB.z * b + _dC.z * c,
      );
    }
    for (let i = 0; i < nN; i++) {
      const m = this.dragonNeck[i];
      m.visible = bodyVisible;
      placeDragonSegment(m, this.dragonPts[i], this.dragonPts[i + 1], _fR, s * (1.15 - 0.13 * i), 1.35);
    }

    // 尾: 後半身から生え、左右のうねり＋羽ばたきに遅れて伝わるムチのしなり
    const nT = this.dragonTail.length;
    for (let i = 0; i <= nT; i++) {
      const lx = (Math.sin(time * 2.6 - i * 0.7) * 0.034 + Math.sin(time * 4.3 - i * 0.9) * 0.008) * i * lively;
      const whip = -Math.cos(ph - 0.5 - i * 0.38) * 0.016 * i * lively;
      const ly = R.tailBase[1] - 0.045 * i + 0.0045 * i * i + Math.sin(time * 2.0 - i * 0.6) * 0.012 * i * lively + whip;
      const lz = R.tailBase[2] - 0.15 * i;
      rearPoint(this.dragonPts[i], lx, ly, lz);
    }
    for (let i = 0; i < nT; i++) {
      const m = this.dragonTail[i];
      m.visible = bodyVisible;
      placeDragonSegment(m, this.dragonPts[i + 1], this.dragonPts[i], _rR, s * (1.0 - 0.075 * i), 1.35);
    }
    if (this.dragonTailTip) {
      this.dragonTailTip.visible = bodyVisible;
      placeDragonSegment(this.dragonTailTip, this.dragonPts[nT], this.dragonPts[nT - 1], _rR, s * 0.85, 0);
    }

    // 翼: 大きな振幅で打ち下ろし、翼端は遅れてしなる。打ち上げでは後方へ引きつつひねって空気を逃がす
    const a1 = 0.2 + 0.85 * flap;
    const a2 = a1 + 0.05 + 0.62 * lag;
    const upperLen = R.upperWingLength;
    const foreLen = R.foreWingLength;
    const twist = 0.4 * stroke;
    _tmpA.copy(_fF).multiplyScalar(Math.cos(twist)).addScaledVector(_fU, -Math.sin(twist));
    for (const side of [-1, 1] as const) {
      const upper = side < 0 ? this.parts.upperArmL : this.parts.upperArmR;
      const fore = side < 0 ? this.parts.forearmL : this.parts.forearmR;
      const lx = side * rs;
      const sx = R.shoulder[0];
      const sy = R.shoulder[1];
      const sz = R.shoulder[2];
      const ex = sx + upperLen * Math.cos(a1);
      const ey = sy + upperLen * Math.sin(a1);
      const ez = sz - 0.06 - 0.05 * stroke;
      const hx = ex + foreLen * Math.cos(a2);
      const hy = ey + foreLen * Math.sin(a2);
      const hz = ez - 0.1 - 0.14 * stroke;
      frontPoint(_dA, sx * lx, sy, sz);
      frontPoint(_dB, ex * lx, ey, ez);
      frontPoint(_dC, hx * lx, hy, hz);
      upper.mesh.visible = !upper.destroyed;
      placeDragonWingBone(upper.mesh, _dA, _dB, _tmpA, upperLen, s);
      fore.mesh.visible = !fore.destroyed && !upper.destroyed;
      placeDragonWingBone(fore.mesh, _dB, _dC, _tmpA, foreLen, s);
    }

    // 後脚: 左右交互に蹴り出すようにばたつかせる（骨の長さは一定のまま角度で動かす）
    const thighLen = 0.21;
    const shinLen = 0.24;
    const kick = time * 6.5;
    for (const side of [-1, 1] as const) {
      const thigh = side < 0 ? this.parts.thighL : this.parts.thighR;
      const shin = side < 0 ? this.parts.shinL : this.parts.shinR;
      const lx = side * rs;
      const lt = kick + (side < 0 ? 0 : Math.PI);
      const th1 = 0.67 + 0.38 * Math.sin(lt) * lively;
      const th2 = -0.43 + 0.55 * Math.sin(lt - 1.0) * lively;
      const kx = R.hip[0] + 0.03;
      const ky = R.hip[1] - thighLen * Math.cos(th1);
      const kz = R.hip[2] + thighLen * Math.sin(th1);
      const fx = kx - 0.01;
      const fy = ky - shinLen * Math.cos(th2);
      const fz = kz + shinLen * Math.sin(th2);
      rearPoint(_dA, R.hip[0] * lx, R.hip[1], R.hip[2]);
      rearPoint(_dB, kx * lx, ky, kz);
      rearPoint(_dC, fx * lx, fy, fz);
      thigh.mesh.visible = !thigh.destroyed;
      placeDragonLegBone(thigh.mesh, _dA, _dB, _rF);
      shin.mesh.visible = !shin.destroyed;
      placeDragonLegBone(shin.mesh, _dB, _dC, _rF);
    }

    // 前脚: 胸の下で左右交互に掻くようにばたつかせる
    for (let i = 0; i < this.dragonForelegs.length; i++) {
      const m = this.dragonForelegs[i];
      const xs = i === 0 ? -1 : 1; // テンプレートの外側方向
      const lt = kick * 1.1 + (xs * rs < 0 ? 0.6 : 0.6 + Math.PI);
      const swing = (0.15 + 0.5 * Math.sin(lt)) * lively;
      frontPoint(_dA, R.foreleg[0] * xs, R.foreleg[1], R.foreleg[2]);
      rotateFrame(_tmpA, _tmpB, _tmpC, _fR, _fU, _fF, 0, swing, 0);
      m.visible = bodyVisible;
      placeBasisPart(m, _dA, _tmpA, _tmpB, _tmpC);
    }

    // 火炎ジェット: ブレスを吐いている間、口先から揺らめく 3 層の炎の円錐を噴射する
    this.dragonBreathTimer = Math.max(0, this.dragonBreathTimer - dt);
    const jetOn = alive && !head.destroyed && breathing && this.dragonBreathTimer > 0;
    _quat.setFromUnitVectors(UP, this.dragonBreathDir);
    for (let i = 0; i < this.dragonJet.length; i++) {
      const m = this.dragonJet[i];
      m.visible = jetOn;
      if (!jetOn) continue;
      m.position.copy(this.dragonMouth);
      m.quaternion.copy(_quat);
      // 層ごとに位相の違うちらつき（長さ・太さ・回転）
      const flick = Math.sin(time * (29 + i * 7) + i * 1.7) * 0.5 + Math.random() * 0.5;
      const len = (0.75 + 0.35 * flick) * Math.min(1, L * 1.3 + 0.2);
      const wid = 0.8 + 0.35 * Math.random();
      m.scale.set(wid, len, wid);
      m.rotateY(time * (6 + i * 3));
    }
    // 口元の発光: 溜めでは喉の奥で脈打ちながら膨らみ、ブレス中は激しく明滅する
    if (this.dragonMouthGlow) {
      const g = this.dragonMouthGlow;
      const glowOn = alive && !head.destroyed && (jetOn || B > 0.05);
      g.visible = glowOn;
      if (glowOn) {
        g.position.copy(this.dragonMouth).addScaledVector(_hF, -2 * hv);
        const k = jetOn ? 1.15 + Math.random() * 0.45 : 0.35 + 0.55 * B + Math.sin(time * 18) * 0.12;
        g.scale.setScalar(k);
        (g.material as MeshBasicMaterial).color.setHex(jetOn ? 0xffd166 : 0xff7a1a);
      }
    }
  }

  /** ヤマムロンの胴体と頭を強化形態／通常形態のモデルへ差し替える（損壊は修復される） */
  private setYamamuronForm(awakened: boolean): void {
    this.yamamuronAwakened = awakened;
    const forms = awakened
      ? getYamamuronAwakenedTemplates(this.unit.team)
      : getUnitTemplateSet(this.unit.type, this.unit.team);
    const swaps: ReadonlyArray<[DestructiblePart, VoxelPartTemplate]> = [
      [this.parts.torso, forms.torso],
      [this.parts.head, forms.head],
    ];
    for (const [part, template] of swaps) {
      if (part.ownsGeometry) part.mesh.geometry.dispose();
      part.ownsGeometry = false;
      part.mutableGrid = null;
      part.template = template;
      part.mesh.geometry = template.geometry;
      part.hp = part.maxHp;
      part.destroyed = false;
      part.mesh.visible = true;
    }
  }

  /** ヤマムロン強化モードのオーラを山の周囲に配置し、脈動させる */
  private syncYamamuronAura(): void {
    const u = this.unit;
    if (u.yamamuronEnraged !== this.yamamuronAwakened) this.setYamamuronForm(u.yamamuronEnraged);
    const on = u.alive && u.yamamuronEnraged;
    const [outer, inner, groundRing, ...halos] = this.yamamuronAura;
    for (const m of this.yamamuronAura) m.visible = on;
    if (!on) return;

    const time = performance.now() * 0.001;
    const { x, z } = u.pelvis.pos;

    // 炎のコーンは逆回転しながら不規則に揺らぐ
    const flick = Math.sin(time * 23) * 0.04 + Math.random() * 0.05;
    outer.position.set(x, YAMAMURON_AURA_HEIGHT / 2, z);
    outer.rotation.y = time * 2.4;
    outer.scale.set(1.04 + flick, 1 + flick * 1.6, 1.04 + flick);
    inner.position.set(x, YAMAMURON_AURA_HEIGHT * 0.43, z);
    inner.rotation.y = -time * 3.6;
    inner.scale.set(1 - flick, 1 + flick * 2.2, 1 - flick);

    groundRing.position.set(x, 0.14, z);
    groundRing.rotation.x = Math.PI / 2;
    groundRing.scale.setScalar(1.1 + Math.sin(time * 6) * 0.1);

    // 光輪は裾野から山頂へ昇りながら窄まって消える
    halos.forEach((halo, i) => {
      const t = (time * 0.7 + i / halos.length) % 1;
      const radius = YAMAMURON_AURA_RADIUS * (1.08 - t * 0.95);
      halo.position.set(x, 0.2 + t * YAMAMURON_AURA_HEIGHT, z);
      halo.rotation.x = Math.PI / 2;
      halo.scale.set(radius, radius, 1);
      (halo.material as MeshBasicMaterial).opacity = 0.9 * (1 - t);
    });
  }

  /** 暴走バギー専用の4輪オフロードビークル配置処理 */
  private syncBuggy(): void {
    const u = this.unit;
    const s = u.scale;
    const P = u.joints;
    const pelvis = P[J.Pelvis].pos;

    // 車体基底 [right, up, fwd]
    _fwd.copy(u.forward).normalize();
    _up.subVectors(P[J.Chest].pos, pelvis);
    if (_up.lengthSq() < 1e-4) _up.copy(UP);
    else _up.normalize();
    _right.crossVectors(_up, _fwd).normalize();
    _fwd.crossVectors(_right, _up).normalize();

    // 1. 車体（Torso: シャーシ・カウル・ブルバー）
    if (!this.parts.torso.destroyed) {
      this.parts.torso.mesh.visible = true;
      placeBasisPart(this.parts.torso.mesh, pelvis, _right, _up, _fwd);
    } else {
      this.parts.torso.mesh.visible = false;
    }

    // 2. ルーフ・ロールケージ（Head: 車体上面に密着マウント）
    if (!this.parts.head.destroyed) {
      this.parts.head.mesh.visible = true;
      const roofPos = _voxelWorld.copy(pelvis).addScaledVector(_up, 0.17 * s).addScaledVector(_fwd, 0.02 * s);
      placeBasisPart(this.parts.head.mesh, roofPos, _right, _up, _fwd);
    } else {
      this.parts.head.mesh.visible = false;
    }

    // 3. 4輪オフロードタイヤ（左前・右前・左後・右後）
    const trackHalfFwd = 0.36 * s;
    const trackHalfRear = 0.38 * s;
    const baseFwd = 0.30 * s;
    const baseRear = -0.28 * s;
    const wheelCenterYFwd = -0.20 * s;
    const wheelCenterYRear = -0.16 * s;
    const spinAngle = -u.walkPhase * 2.5;

    const placeBuggyWheel = (part: DestructiblePart, x: number, z: number, yOff: number) => {
      if (part.destroyed) {
        part.mesh.visible = false;
        return;
      }
      part.mesh.visible = true;
      const pos = _voxelWorld.copy(pelvis)
        .addScaledVector(_right, x)
        .addScaledVector(_fwd, z)
        .addScaledVector(_up, yOff);
      placeBasisPart(part.mesh, pos, _right, _up, _fwd);
      part.mesh.rotateX(spinAngle);
    };

    // 左前輪 (upperArmL) & 右前輪 (upperArmR)
    placeBuggyWheel(this.parts.upperArmL, -trackHalfFwd, baseFwd, wheelCenterYFwd);
    placeBuggyWheel(this.parts.upperArmR, trackHalfFwd, baseFwd, wheelCenterYFwd);
    // 左後輪 (thighL) & 右後輪 (thighR) - ワイド大径
    placeBuggyWheel(this.parts.thighL, -trackHalfRear, baseRear, wheelCenterYRear);
    placeBuggyWheel(this.parts.thighR, trackHalfRear, baseRear, wheelCenterYRear);

    // 不要パーツは完全非表示
    this.parts.forearmL.mesh.visible = false;
    this.parts.forearmR.mesh.visible = false;
    this.parts.shinL.mesh.visible = false;
    this.parts.shinR.mesh.visible = false;
    if (this.weaponMesh) this.weaponMesh.visible = false;
    if (this.bowMesh) this.bowMesh.visible = false;
  }

  /** 戦車（超巨大）専用の重装無限軌道・旋回砲塔配置処理 */
  private syncTank(): void {
    const u = this.unit;
    const s = u.scale;
    const P = u.joints;
    const pelvis = P[J.Pelvis].pos;

    // 車体基底 [right, up, fwd]
    _fwd.copy(u.forward).normalize();
    _up.subVectors(P[J.Chest].pos, pelvis);
    if (_up.lengthSq() < 1e-4) _up.copy(UP);
    else _up.normalize();
    _right.crossVectors(_up, _fwd).normalize();
    _fwd.crossVectors(_right, _up).normalize();

    // 1. 車体（Torso: 重装甲シャーシ）
    if (!this.parts.torso.destroyed) {
      this.parts.torso.mesh.visible = true;
      placeBasisPart(this.parts.torso.mesh, pelvis, _right, _up, _fwd);
    } else {
      this.parts.torso.mesh.visible = false;
    }

    // 2. 砲塔（Head: 旋回砲塔・長大主砲）
    if (!this.parts.head.destroyed) {
      this.parts.head.mesh.visible = true;
      const turretPos = _voxelWorld.copy(pelvis).addScaledVector(_up, 0.24 * s);
      if (u.target && u.target.alive) {
        _dir.subVectors(u.target.pelvis.pos, turretPos);
        _dir.y = 0; // 水平旋回
        if (_dir.lengthSq() > 1e-3) {
          _dir.normalize();
          const tRight = _localHit.crossVectors(_up, _dir).normalize();
          placeBasisPart(this.parts.head.mesh, turretPos, tRight, _up, _dir);
        } else {
          placeBasisPart(this.parts.head.mesh, turretPos, _right, _up, _fwd);
        }
      } else {
        placeBasisPart(this.parts.head.mesh, turretPos, _right, _up, _fwd);
      }
    } else {
      this.parts.head.mesh.visible = false;
    }

    // 3. 左右無限軌道（キャタピラユニット・完全接地）
    const trackOffset = 0.46 * s;
    const trackY = -0.36 * s;

    // 左履帯 (upperArmL)
    if (!this.parts.upperArmL.destroyed) {
      this.parts.upperArmL.mesh.visible = true;
      const posL = _voxelWorld.copy(pelvis).addScaledVector(_right, -trackOffset).addScaledVector(_up, trackY);
      placeBasisPart(this.parts.upperArmL.mesh, posL, _right, _up, _fwd);
    } else {
      this.parts.upperArmL.mesh.visible = false;
    }

    // 右履帯 (upperArmR)
    if (!this.parts.upperArmR.destroyed) {
      this.parts.upperArmR.mesh.visible = true;
      const posR = _voxelWorld.copy(pelvis).addScaledVector(_right, trackOffset).addScaledVector(_up, trackY);
      placeBasisPart(this.parts.upperArmR.mesh, posR, _right, _up, _fwd);
    } else {
      this.parts.upperArmR.mesh.visible = false;
    }

    // 不要パーツは完全非表示
    this.parts.forearmL.mesh.visible = false;
    this.parts.forearmR.mesh.visible = false;
    this.parts.thighL.mesh.visible = false;
    this.parts.shinL.mesh.visible = false;
    this.parts.thighR.mesh.visible = false;
    this.parts.shinR.mesh.visible = false;
    if (this.weaponMesh) this.weaponMesh.visible = false;
    if (this.bowMesh) this.bowMesh.visible = false;
  }

  /** セザイン専用のバイカー＆巨大1000ccバイク配置処理（車体水平固定・またがり乗車・両手銃構え） */
  private syncSezain(): void {
    const u = this.unit;
    const s = u.scale;
    const P = u.joints;
    const pelvis = P[J.Pelvis].pos;
    const chest = P[J.Chest].pos;
    const shL = P[J.ShoulderL].pos;
    const shR = P[J.ShoulderR].pos;

    // バイク車体基底 [right, up, fwd]（地面に対して水平を維持し、タイヤのめり込み・傾きを防ぐ）
    _fwd.copy(u.forward).normalize();
    _up.copy(UP);
    _right.crossVectors(_up, _fwd).normalize();
    _fwd.crossVectors(_right, _up).normalize();

    if (!this.parts.torso.destroyed) {
      this.parts.torso.mesh.visible = true;
      placeBasisPart(this.parts.torso.mesh, pelvis, _right, _up, _fwd);
    } else {
      this.parts.torso.mesh.visible = false;
    }

    // ヘルメット（Head）をライダー胴体の首元に密着配置
    if (!this.parts.head.destroyed) {
      this.parts.head.mesh.visible = true;
      const headPos = _voxelWorld.copy(pelvis).addScaledVector(_up, 0.39 * s).addScaledVector(_fwd, 0.02 * s);
      placeBasisPart(this.parts.head.mesh, headPos, _right, _up, _fwd);
    } else {
      this.parts.head.mesh.visible = false;
    }

    // ライダーの四肢（バイクのタンク・エンジンを両脚で確実に挟み込み、ステップに足を乗せる）
    placeLimb(this.parts.upperArmL.mesh, shL, P[J.ElbowL].pos);
    placeLimb(this.parts.forearmL.mesh, P[J.ElbowL].pos, P[J.HandL].pos);
    placeLimb(this.parts.upperArmR.mesh, shR, P[J.ElbowR].pos);
    placeLimb(this.parts.forearmR.mesh, P[J.ElbowR].pos, P[J.HandR].pos);

    // 脚はバイク車体座標系に固定して、確実にシートからエンジン側面・ステップバーにまたがらせる
    const hipL = _localHit.copy(pelvis).addScaledVector(_right, -0.22 * s).addScaledVector(_up, 0.02 * s).addScaledVector(_fwd, -0.02 * s);
    const kneeL = _voxelWorld.copy(pelvis).addScaledVector(_right, -0.32 * s).addScaledVector(_up, -0.10 * s).addScaledVector(_fwd, 0.22 * s);
    placeLimb(this.parts.thighL.mesh, hipL, kneeL);
    const footL = _localHit.copy(pelvis).addScaledVector(_right, -0.30 * s).addScaledVector(_up, -0.32 * s).addScaledVector(_fwd, 0.06 * s);
    placeLimb(this.parts.shinL.mesh, kneeL, footL);

    const hipR = _localHit.copy(pelvis).addScaledVector(_right, 0.22 * s).addScaledVector(_up, 0.02 * s).addScaledVector(_fwd, -0.02 * s);
    const kneeR = _voxelWorld.copy(pelvis).addScaledVector(_right, 0.32 * s).addScaledVector(_up, -0.10 * s).addScaledVector(_fwd, 0.22 * s);
    placeLimb(this.parts.thighR.mesh, hipR, kneeR);
    const footR = _localHit.copy(pelvis).addScaledVector(_right, 0.30 * s).addScaledVector(_up, -0.32 * s).addScaledVector(_fwd, 0.06 * s);
    placeLimb(this.parts.shinR.mesh, kneeR, footR);

    // 右手ヘビーマシンガン（前方へ向けて構える）
    if (this.weaponMesh) {
      this.weaponMesh.visible = !this.parts.forearmR.destroyed;
      placeBasisPart(this.weaponMesh, P[J.HandR].pos, _right, _up, _fwd);
    }

    // 左手ヘビーマシンガン（前方へ向けて構える・二丁拳銃/両手銃）
    if (this.bowMesh) {
      this.bowMesh.visible = !this.parts.forearmL.destroyed;
      placeBasisPart(this.bowMesh, P[J.HandL].pos, _right, _up, _fwd);
    }

    void chest;
  }

  /** 鎧戦象専用の4本脚・象頭部配置処理 */
  private syncWarelephant(): void {
    const u = this.unit;
    const s = u.scale;
    const P = u.joints;
    const pelvis = P[J.Pelvis].pos;
    const chest = P[J.Chest].pos;
    const shL = P[J.ShoulderL].pos;
    const shR = P[J.ShoulderR].pos;

    // 象の背骨方向（水平前方向）と上方向
    _fwd.subVectors(chest, pelvis).normalize();
    if (_fwd.lengthSq() < 1e-4) _fwd.copy(u.forward);
    _up.copy(UP);
    _right.crossVectors(_up, _fwd).normalize();
    _up.crossVectors(_fwd, _right).normalize();

    // 胴体
    placeBasisPart(this.parts.torso.mesh, pelvis, _right, _up, _fwd);

    // 象の頭部・長い鼻・大きな牙を胴体前面に自然にマウント
    const headPos = _voxelWorld.copy(chest).addScaledVector(_fwd, 0.28 * s).addScaledVector(_up, 0.08 * s);
    placeBasisPart(this.parts.head.mesh, headPos, _right, _up, _fwd);

    // 象の4本脚（前脚2本、後脚2本）
    placeLimb(this.parts.upperArmL.mesh, shL, P[J.ElbowL].pos);
    placeLimb(this.parts.forearmL.mesh, P[J.ElbowL].pos, P[J.HandL].pos);
    placeLimb(this.parts.upperArmR.mesh, shR, P[J.ElbowR].pos);
    placeLimb(this.parts.forearmR.mesh, P[J.ElbowR].pos, P[J.HandR].pos);
    placeLimb(this.parts.thighL.mesh, P[J.HipL].pos, P[J.KneeL].pos);
    placeLimb(this.parts.shinL.mesh, P[J.KneeL].pos, P[J.FootL].pos);
    placeLimb(this.parts.thighR.mesh, P[J.HipR].pos, P[J.KneeR].pos);
    placeLimb(this.parts.shinR.mesh, P[J.KneeR].pos, P[J.FootR].pos);
  }

  /** 巨大アナコンダ: 蛇頭・大蛇の這い胴体・うねる尾節の完全同期 */
  private syncAnaconda(): void {
    const u = this.unit;
    const P = u.joints;

    const head = P[J.Head].pos;
    const chest = P[J.Chest].pos;
    const pelvis = P[J.Pelvis].pos;
    const hipL = P[J.HipL].pos;
    const kneeL = P[J.KneeL].pos;
    const footL = P[J.FootL].pos;
    const hipR = P[J.HipR].pos;

    // 蛇頭（Head）: 首（Chest）から前方へ
    if (!this.parts.head.destroyed) {
      this.parts.head.mesh.visible = true;
      _dir.subVectors(head, chest);
      if (_dir.lengthSq() < 1e-6) _dir.copy(u.forward);
      _dir.normalize();
      _right.crossVectors(_dir, UP).normalize();
      if (_right.lengthSq() < 1e-6) _right.set(1, 0, 0);
      _up.crossVectors(_right, _dir).normalize();
      const headPos = _voxelWorld.copy(chest).addScaledVector(_dir, 0.16 * u.scale);
      placeBasisPart(this.parts.head.mesh, headPos, _right, _up, _dir);
    } else {
      this.parts.head.mesh.visible = false;
    }

    // 前胴（Torso）: 骨盤から胸へ
    if (!this.parts.torso.destroyed) {
      this.parts.torso.mesh.visible = true;
      _dir.subVectors(chest, pelvis);
      if (_dir.lengthSq() < 1e-6) _dir.copy(u.forward);
      _dir.normalize();
      _right.crossVectors(_dir, UP).normalize();
      if (_right.lengthSq() < 1e-6) _right.set(1, 0, 0);
      _up.crossVectors(_right, _dir).normalize();
      placeBasisPart(this.parts.torso.mesh, pelvis, _right, _up, _dir);
    } else {
      this.parts.torso.mesh.visible = false;
    }

    // 蛇腹セグメントの直列連結（大蛇のうねる身体）
    placeLimb(this.parts.thighL.mesh, pelvis, hipL);
    placeLimb(this.parts.shinL.mesh, hipL, kneeL);
    placeLimb(this.parts.thighR.mesh, kneeL, footL);
    placeLimb(this.parts.shinR.mesh, footL, hipR);

    // 蛇に腕はないので非表示
    this.parts.upperArmL.mesh.visible = false;
    this.parts.forearmL.mesh.visible = false;
    this.parts.upperArmR.mesh.visible = false;
    this.parts.forearmR.mesh.visible = false;
  }

  /** 拒絶神ゼルエル: 圧倒的な神威、滑らかな真紅コア、多重AT結界、常に妖しく波打つ両腕リボンカッター */
  private syncZeruel(): void {
    const u = this.unit;
    const s = u.scale;
    const P = u.joints;
    const pelvis = P[J.Pelvis].pos;
    const time = performance.now() * 0.001;

    // 前方・上・右基底ベクトル（直立・浮遊姿勢の安定＋攻撃時の前傾・反り）
    _fwd.copy(u.forward).normalize();
    if (_fwd.lengthSq() < 1e-4) _fwd.set(1, 0, 0);
    _up.copy(UP);
    // ワインドアップ時は溜めでやや反り、ストライク時は前方へ威圧的に前傾する
    if (u.attackPhase === 'windup') {
      _up.addScaledVector(_fwd, -0.10).normalize();
    } else if (u.attackPhase === 'strike') {
      _up.addScaledVector(_fwd, 0.16).normalize();
    } else if (u.defenseTimer > 0) {
      _up.addScaledVector(_fwd, -0.06).normalize();
    }
    _right.crossVectors(_up, _fwd).normalize();
    if (_right.lengthSq() < 1e-4) _right.set(1, 0, 0);
    _fwd.crossVectors(_right, _up).normalize();

    // 1. 胴体（Torso）の配置: Pelvis にマウント
    if (!this.parts.torso.destroyed && u.alive) {
      this.parts.torso.mesh.visible = true;
      placeBasisPart(this.parts.torso.mesh, pelvis, _right, _up, _fwd);
    } else {
      this.parts.torso.mesh.visible = false;
    }

    // 2. 頭部（Head）の配置: 巨大な両肩マントの間に低く威圧的にマウント（首浮きゼロ）
    const headAnchor = _headPos.copy(pelvis).addScaledVector(_up, 0.56 * s).addScaledVector(_fwd, 0.14 * s);
    if (!this.parts.head.destroyed && u.alive) {
      this.parts.head.mesh.visible = true;
      placeBasisPart(this.parts.head.mesh, headAnchor, _right, _up, _fwd);
    } else {
      this.parts.head.mesh.visible = false;
    }

    // 3. 浮遊する黒曜石＆白骨外骨格の両脚（腕ボクセルは滑らかリボンメッシュで代替するため非表示）
    this.parts.upperArmL.mesh.visible = false;
    this.parts.forearmL.mesh.visible = false;
    this.parts.upperArmR.mesh.visible = false;
    this.parts.forearmR.mesh.visible = false;
    if (u.alive) {
      this.parts.thighL.mesh.visible = !this.parts.thighL.destroyed;
      this.parts.shinL.mesh.visible = !this.parts.shinL.destroyed;
      this.parts.thighR.mesh.visible = !this.parts.thighR.destroyed;
      this.parts.shinR.mesh.visible = !this.parts.shinR.destroyed;
      placeLimb(this.parts.thighL.mesh, P[J.HipL].pos, P[J.KneeL].pos);
      placeLimb(this.parts.shinL.mesh, P[J.KneeL].pos, P[J.FootL].pos);
      placeLimb(this.parts.thighR.mesh, P[J.HipR].pos, P[J.KneeR].pos);
      placeLimb(this.parts.shinR.mesh, P[J.KneeR].pos, P[J.FootR].pos);
    } else {
      this.parts.thighL.mesh.visible = false;
      this.parts.shinL.mesh.visible = false;
      this.parts.thighR.mesh.visible = false;
      this.parts.shinR.mesh.visible = false;
    }

    if (!u.alive) {
      if (this.zeruelCoreMesh) this.zeruelCoreMesh.visible = false;
      if (this.zeruelCoreGlow) this.zeruelCoreGlow.visible = false;
      if (this.zeruelCoreRingA) this.zeruelCoreRingA.visible = false;
      if (this.zeruelCoreRingB) this.zeruelCoreRingB.visible = false;
      if (this.zeruelHalo) this.zeruelHalo.visible = false;
      if (this.zeruelHaloInner) this.zeruelHaloInner.visible = false;
      if (this.zeruelRibbonL) this.zeruelRibbonL.visible = false;
      if (this.zeruelRibbonR) this.zeruelRibbonR.visible = false;
      if (this.zeruelSubRibbonL) this.zeruelSubRibbonL.visible = false;
      if (this.zeruelSubRibbonR) this.zeruelSubRibbonR.visible = false;
      if (this.zeruelAtFieldOuter) this.zeruelAtFieldOuter.visible = false;
      if (this.zeruelAtFieldMid) this.zeruelAtFieldMid.visible = false;
      if (this.zeruelAtFieldInner) this.zeruelAtFieldInner.visible = false;
      return;
    }

    // 4. 滑らかな深紅コア球体 & エネルギーリング（ボクセル肋骨ケージの中央にピタリと収まる異質球体）
    if (this.zeruelCoreMesh) {
      if (!this.parts.torso.destroyed) {
        this.zeruelCoreMesh.visible = true;
        const corePos = _voxelWorld.copy(pelvis).addScaledVector(_up, 0.34 * s).addScaledVector(_fwd, 0.21 * s);
        this.zeruelCoreMesh.position.copy(corePos);

        // 呼吸・生命の有機的波打ち脈動とワインドアップ／防御時の高揚
        const isWindup = u.attackPhase === 'windup';
        const isStrike = u.attackPhase === 'strike';
        const isDefending = u.defenseTimer > 0;
        const pulseX = 1.0 + Math.sin(time * 4.2) * 0.08 + (isWindup ? Math.sin(time * 24.0) * 0.20 : 0);
        const pulseY = 1.0 + Math.cos(time * 3.6) * 0.08 + (isWindup ? Math.cos(time * 24.0) * 0.20 : 0);
        const pulseZ = 1.0 + Math.sin(time * 5.0 + 1.0) * 0.10 + (isStrike ? 0.25 : 0);
        this.zeruelCoreMesh.scale.set(pulseX, pulseY, pulseZ);

        const coreMat = this.zeruelCoreMesh.material as MeshStandardMaterial;
        coreMat.emissiveIntensity = isStrike ? 3.2 : isWindup ? 2.6 : isDefending ? 2.2 : 0.95 + Math.sin(time * 3.8) * 0.35;

        if (this.zeruelCoreGlow) {
          this.zeruelCoreGlow.visible = true;
          this.zeruelCoreGlow.position.copy(corePos);
          const glowPulse = ((pulseX + pulseY) * 0.5) * (1.15 + Math.sin(time * 3.2) * 0.08);
          this.zeruelCoreGlow.scale.set(glowPulse, glowPulse, glowPulse);
        }

        const ringSpeed = isWindup || isStrike ? 3.2 : isDefending ? 2.6 : 1.0;
        if (this.zeruelCoreRingA) {
          this.zeruelCoreRingA.visible = true;
          this.zeruelCoreRingA.position.copy(corePos);
          this.zeruelCoreRingA.rotation.x = time * 2.4 * ringSpeed;
          this.zeruelCoreRingA.rotation.y = time * 1.7 * ringSpeed;
        }
        if (this.zeruelCoreRingB) {
          this.zeruelCoreRingB.visible = true;
          this.zeruelCoreRingB.position.copy(corePos);
          this.zeruelCoreRingB.rotation.z = -time * 2.8 * ringSpeed;
          this.zeruelCoreRingB.rotation.x = time * 1.3 * ringSpeed;
        }
      } else {
        this.zeruelCoreMesh.visible = false;
        if (this.zeruelCoreGlow) this.zeruelCoreGlow.visible = false;
        if (this.zeruelCoreRingA) this.zeruelCoreRingA.visible = false;
        if (this.zeruelCoreRingB) this.zeruelCoreRingB.visible = false;
      }
    }

    // 5. 滑らかな使徒の二重ヘイロー（頭上光輪・有機的揺動と逆回転）
    if (this.zeruelHalo) {
      if (!this.parts.head.destroyed) {
        this.zeruelHalo.visible = true;
        const haloPos = _voxelWorld.copy(headAnchor)
          .addScaledVector(_up, (0.44 + Math.sin(time * 2.2) * 0.04) * s)
          .addScaledVector(_fwd, -0.08 * s);
        this.zeruelHalo.position.copy(haloPos);
        this.zeruelHalo.rotation.x = Math.PI * 0.46 + Math.sin(time * 1.5) * 0.10;
        this.zeruelHalo.rotation.y = Math.cos(time * 1.2) * 0.08;
        this.zeruelHalo.rotation.z = time * 0.8;

        if (this.zeruelHaloInner) {
          this.zeruelHaloInner.visible = true;
          this.zeruelHaloInner.position.copy(haloPos);
          this.zeruelHaloInner.rotation.x = Math.PI * 0.46 - Math.sin(time * 1.8) * 0.12;
          this.zeruelHaloInner.rotation.z = -time * 1.6;
        }
      } else {
        this.zeruelHalo.visible = false;
        if (this.zeruelHaloInner) this.zeruelHaloInner.visible = false;
      }
    }

    // 6. 滑らかで常に波打つ主・副リボンカッター帯（左右計4条: 肩マント内部から隙間なく出現）
    const shoulderOffset = 0.43 * s;
    const shoulderUp = 0.48 * s;
    const shoulderFwd = 0.06 * s;

    if (!this.parts.torso.destroyed) {
      if (this.zeruelRibbonL && this.zeruelRibbonGeomL) {
        this.zeruelRibbonL.visible = true;
        const leftAnchor = _voxelWorld.copy(pelvis)
          .addScaledVector(_right, -shoulderOffset)
          .addScaledVector(_up, shoulderUp)
          .addScaledVector(_fwd, shoulderFwd);
        placeBasisPart(this.zeruelRibbonL, leftAnchor, _right, _up, _fwd);
        this.updateRibbonGeometry(this.zeruelRibbonGeomL, true, false, time, u, s);
      }
      if (this.zeruelRibbonR && this.zeruelRibbonGeomR) {
        this.zeruelRibbonR.visible = true;
        const rightAnchor = _voxelWorld.copy(pelvis)
          .addScaledVector(_right, shoulderOffset)
          .addScaledVector(_up, shoulderUp)
          .addScaledVector(_fwd, shoulderFwd);
        placeBasisPart(this.zeruelRibbonR, rightAnchor, _right, _up, _fwd);
        this.updateRibbonGeometry(this.zeruelRibbonGeomR, false, false, time, u, s);
      }
      if (this.zeruelSubRibbonL && this.zeruelSubRibbonGeomL) {
        this.zeruelSubRibbonL.visible = true;
        const subLeftAnchor = _voxelWorld.copy(pelvis)
          .addScaledVector(_right, -0.34 * s)
          .addScaledVector(_up, 0.36 * s)
          .addScaledVector(_fwd, -0.02 * s);
        placeBasisPart(this.zeruelSubRibbonL, subLeftAnchor, _right, _up, _fwd);
        this.updateRibbonGeometry(this.zeruelSubRibbonGeomL, true, true, time, u, s);
      }
      if (this.zeruelSubRibbonR && this.zeruelSubRibbonGeomR) {
        this.zeruelSubRibbonR.visible = true;
        const subRightAnchor = _voxelWorld.copy(pelvis)
          .addScaledVector(_right, 0.34 * s)
          .addScaledVector(_up, 0.36 * s)
          .addScaledVector(_fwd, -0.02 * s);
        placeBasisPart(this.zeruelSubRibbonR, subRightAnchor, _right, _up, _fwd);
        this.updateRibbonGeometry(this.zeruelSubRibbonGeomR, false, true, time, u, s);
      }
    } else {
      if (this.zeruelRibbonL) this.zeruelRibbonL.visible = false;
      if (this.zeruelRibbonR) this.zeruelRibbonR.visible = false;
      if (this.zeruelSubRibbonL) this.zeruelSubRibbonL.visible = false;
      if (this.zeruelSubRibbonR) this.zeruelSubRibbonR.visible = false;
    }

    // 7. 多重八角形ATフィールド結界（防御時に3層の八角形バリアが展開・逆回転・脈動）
    const defStrength = Math.max(u.hitFlash, Math.min(1.0, u.defenseTimer / 0.45));
    if (defStrength > 0.02) {
      const expand = Math.min(1.0, (1.0 - u.defenseTimer / 0.68) * 3.5 + 0.35);
      const basePos = _voxelWorld.copy(pelvis).addScaledVector(_up, 0.38 * s);

      if (this.zeruelAtFieldOuter) {
        this.zeruelAtFieldOuter.visible = true;
        const posOuter = _localHit.copy(basePos).addScaledVector(_fwd, 0.78 * s);
        placeBasisPart(this.zeruelAtFieldOuter, posOuter, _right, _up, _fwd);
        this.zeruelAtFieldOuter.rotateZ(time * 2.2);
        this.zeruelAtFieldOuter.scale.setScalar(expand);
        (this.zeruelAtFieldOuter.material as MeshBasicMaterial).opacity = defStrength * 0.42;
      }
      if (this.zeruelAtFieldMid) {
        this.zeruelAtFieldMid.visible = true;
        const posMid = _localHit.copy(basePos).addScaledVector(_fwd, 0.88 * s);
        placeBasisPart(this.zeruelAtFieldMid, posMid, _right, _up, _fwd);
        this.zeruelAtFieldMid.rotateZ(-time * 3.4);
        this.zeruelAtFieldMid.scale.setScalar(expand * (0.95 + Math.sin(time * 18.0) * 0.08));
        (this.zeruelAtFieldMid.material as MeshBasicMaterial).opacity = defStrength * 0.55;
      }
      if (this.zeruelAtFieldInner) {
        this.zeruelAtFieldInner.visible = true;
        const posInner = _localHit.copy(basePos).addScaledVector(_fwd, 0.98 * s);
        placeBasisPart(this.zeruelAtFieldInner, posInner, _right, _up, _fwd);
        this.zeruelAtFieldInner.rotateZ(time * 4.8);
        this.zeruelAtFieldInner.scale.setScalar(expand);
        (this.zeruelAtFieldInner.material as MeshBasicMaterial).opacity = defStrength * 0.72;
      }
    } else {
      if (this.zeruelAtFieldOuter) this.zeruelAtFieldOuter.visible = false;
      if (this.zeruelAtFieldMid) this.zeruelAtFieldMid.visible = false;
      if (this.zeruelAtFieldInner) this.zeruelAtFieldInner.visible = false;
    }
  }

  /** ゼルエルの帯状リボンカッターの動的3D波打ち・ねじれ・攻撃伸縮・防御クロスガード変形 */
  private updateRibbonGeometry(
    geom: BufferGeometry,
    isLeft: boolean,
    isSub: boolean,
    time: number,
    u: Unit,
    s: number,
  ): void {
    const posAttr = geom.getAttribute('position') as BufferAttribute;
    const pos = posAttr.array as Float32Array;
    const segCount = 28;
    const cols = 5;
    const phase = u.attackPhase;
    const sideSign = isLeft ? 1 : -1;

    let windupProgress = 0;
    if (phase === 'windup') {
      windupProgress = Math.min(1.0, u.phaseTime / Math.max(0.01, u.type.windup));
    }
    let strikeProgress = 0;
    if (phase === 'strike') {
      strikeProgress = Math.min(1.0, u.phaseTime / Math.max(0.01, u.type.strike));
    }
    let recoverProgress = 0;
    if (phase === 'recover') {
      recoverProgress = Math.min(1.0, u.phaseTime / Math.max(0.01, u.type.recover));
    }

    const baseWidth = (isSub ? 0.14 : 0.24) * s;

    for (let i = 0; i <= segCount; i++) {
      const frac = i / segCount;
      let x = 0;
      let y = 0;
      let z = 0;
      let twist = 0;
      // 先端に向かって鋭利なブレード状にテーパー
      const width = baseWidth * (1.0 - frac * 0.42);

      if (phase === 'strike') {
        // 攻撃モーション: 前方へ超高速・長大に伸長し、左右の刃がX字に交差しながら敵陣を薙ぎ払う！
        const maxReach = (isSub ? 2.6 : 3.8) * s;
        const ext = Math.sin(Math.min(1.0, strikeProgress * 1.45) * Math.PI * 0.5);
        const whipWave = Math.sin(frac * Math.PI * 2.5 - strikeProgress * 12.0) * 0.18 * s * (1.0 - strikeProgress * 0.5);
        const crossSweep = sideSign * (Math.cos(strikeProgress * Math.PI) * 0.45 * frac + Math.sin(frac * Math.PI) * 0.22) * s;

        z = frac * maxReach * Math.max(0.18, ext);
        x = crossSweep + whipWave;
        y = -frac * (isSub ? 0.35 : 0.18) * s + Math.sin(frac * Math.PI * 2.0 + time * 16.0) * 0.10 * s;
        twist = (isLeft ? 1 : -1) * (0.65 + frac * 1.4);
      } else if (phase === 'windup') {
        // 溜めモーション: 肩の周囲で折り紙のように高速螺旋トルネード状に凝縮・展開待機
        const phaseOffset = isSub ? Math.PI * 0.7 : 0;
        const angle = time * 16.0 + i * 0.42 + phaseOffset;
        const radius = (isSub ? 0.22 : 0.32) * (1.0 + frac * 0.35) * s * (1.0 - windupProgress * 0.35);
        x = sideSign * (0.08 * s + Math.cos(angle) * radius * frac);
        y = (0.12 * windupProgress - frac * 0.45) * s + Math.sin(angle) * radius * 0.65 * frac;
        z = (frac * 0.42 + Math.sin(windupProgress * Math.PI * 0.5) * 0.28) * s;
        twist = angle * 0.5;
      } else if (u.defenseTimer > 0 && phase === 'none') {
        // 防御モーション: 両腕のリボンが胸部コアの前面でX字の防護クロスシールドを織り成し、波打ちながら敵弾を拒絶！
        const defBlend = Math.min(1.0, u.defenseTimer / 0.25);
        const idleLen = (isSub ? 1.85 : 2.5) * s;
        const idleY = -frac * idleLen;
        const idleX = sideSign * 0.06 * s + Math.sin(time * 4.0 + i * 0.35) * (0.04 + frac * 0.22) * s;
        const idleZ = Math.cos(time * 3.1 + i * 0.4) * (0.05 + frac * 0.24) * s;

        // 胸部前面をX字に覆う防護軌道
        const guardX = sideSign * (0.42 * (1.0 - frac * 1.65)) * s;
        const guardY = (-0.08 - frac * (isSub ? 0.55 : 0.42) + Math.sin(frac * Math.PI) * 0.12) * s;
        const guardZ = (0.38 + Math.sin(frac * Math.PI) * 0.26 + Math.sin(time * 24.0 + i * 0.6) * 0.04) * s;

        x = idleX * (1 - defBlend) + guardX * defBlend;
        y = idleY * (1 - defBlend) + guardY * defBlend;
        z = idleZ * (1 - defBlend) + guardZ * defBlend;
        twist = sideSign * 0.8 * defBlend;
      } else {
        // 通常時 & リカバー時: 体の一部が常に妖しく滑らかに3D波打ち・捻れ続ける演出
        const length = (isSub ? 1.85 : 2.55) * s;
        const recPull = phase === 'recover' ? (1.0 - recoverProgress) * 0.9 * s * frac : 0;
        const freq = isSub ? 4.4 : 3.4;
        const phaseShift = (isLeft ? 0 : Math.PI * 0.65) + (isSub ? 1.8 : 0);

        const waveX = Math.sin(time * freq + i * 0.34 + phaseShift) * (0.03 + frac * (isSub ? 0.28 : 0.22)) * s;
        const waveZ = Math.cos(time * (freq * 0.82) + i * 0.38 + phaseShift) * (0.04 + frac * (isSub ? 0.30 : 0.26)) * s;
        const harmonic = Math.sin(time * 7.8 - i * 0.65) * 0.035 * s * frac;

        x = sideSign * (0.05 * s * frac) + waveX + harmonic;
        y = -frac * length + Math.sin(time * 3.0 + i * 0.25) * 0.04 * s * frac;
        z = waveZ + recPull;
        twist = Math.sin(time * 2.9 + i * 0.32 + phaseShift) * 0.65 * frac;
      }

      const cosT = Math.cos(twist);
      const sinT = Math.sin(twist);
      const ridgeZ = 0.022 * s;

      // 横5列の頂点座標を更新（ねじれ角度 twist と中央立体稜線を反映）
      for (let c = 0; c < cols; c++) {
        const idx = (i * cols + c) * 3;
        const uOff = ((c - 2) / 2) * (width * 0.5);
        const vOff = c === 2 ? ridgeZ : (c === 1 || c === 3 ? ridgeZ * 0.45 : 0);
        pos[idx] = x + uOff * cosT - vOff * sinT;
        pos[idx + 1] = y + uOff * sinT * 0.25;
        pos[idx + 2] = z + uOff * sinT + vOff * cosT;
      }
    }

    posAttr.needsUpdate = true;
    geom.computeVertexNormals();
  }

  /**
   * 幾何神ラミエル: 多ポリゴン鏡面反射キラキラボディ＆超豪華タメ変形・3D超極太レーザー演出。
   * ボクセルメッシュは完全に非表示とし、鏡面テクスチャと環境反射を持つ多面体結晶をアニメーションさせる。
   */
  /** 攻撃の段階から、今の口の開き具合（0〜1）の目標を求める */
  private hayatoMouthTarget(time: number): number {
    const u = this.unit;
    if (!u.alive) return 0.6;
    if (u.attackPhase === 'windup') return Math.min(1, u.phaseTime / Math.max(0.05, u.type.windup * 0.45));
    if (u.attackPhase === 'strike') return 0.92 + Math.sin(time * 38) * 0.08;
    if (u.attackPhase === 'recover') return Math.max(0, 1 - u.phaseTime / Math.max(0.05, u.type.recover));
    // 待機中はときどき口をパクパクさせる
    const chatter = Math.sin(time * 0.9 + this.hayatoSeed) > 0.7;
    return chatter ? Math.abs(Math.sin(time * 9)) * 0.5 : 0;
  }

  private syncHayato(): void {
    const head = this.hayatoHead;
    if (!head) return;
    const u = this.unit;
    const s = u.scale;
    const size = HAYATO_HEAD_HEIGHT * s;
    const time = performance.now() * 0.001;

    hayatoHeadCenter(_hayatoCenter, u.pelvis.pos, s);
    _fwd.copy(u.forward).normalize();
    if (u.alive) {
      _up.copy(UP);
    } else {
      // 倒れたら物理の胴体の傾きに合わせて転がり、地面にめり込まないようにする
      _up.subVectors(u.chest.pos, u.pelvis.pos).normalize();
      if (u.pelvis.pos.y > -0.2) _hayatoCenter.y = Math.max(_hayatoCenter.y, size * 0.42);
    }
    _right.crossVectors(_up, _fwd);
    if (_right.lengthSq() < 1e-6) _right.set(1, 0, 0);
    _right.normalize();
    _up.crossVectors(_fwd, _right).normalize();

    // 見えないボクセルも顔の位置に置いておき、被弾の破片が顔から飛ぶようにする
    for (const part of Object.values(this.parts)) {
      placeBasisPart(part.mesh, _hayatoCenter, _right, _up, _fwd);
      part.mesh.visible = false;
    }

    this.hayatoMouthOpen += (this.hayatoMouthTarget(time) - this.hayatoMouthOpen) * 0.4;
    const mouth = this.hayatoMouthOpen;
    head.morphTargetInfluences![0] = mouth;

    // 溜めでのけぞり、照射中は小刻みに震える。普段は写真のように少し首をかしげる
    const windup = u.attackPhase === 'windup' ? Math.min(1, u.phaseTime / Math.max(0.05, u.type.windup)) : 0;
    const striking = u.alive && u.attackPhase === 'strike';
    const pitch = -0.2 * windup + (striking ? 0.05 + Math.sin(time * 47) * 0.015 : 0);
    const roll = u.alive ? 0.09 + Math.sin(time * 1.1 + this.hayatoSeed) * 0.05 : 0;
    _basisMat.makeBasis(_right, _up, _fwd);
    head.position.copy(_hayatoCenter);
    head.quaternion
      .setFromRotationMatrix(_basisMat)
      .multiply(_hayatoQ.setFromAxisAngle(_hayatoAxisX, pitch))
      .multiply(_hayatoQ.setFromAxisAngle(_hayatoAxisZ, roll));
    head.scale.setScalar(size);

    // 口の位置（閉じているときの唇の線から、全開の位置まで動く）
    _hayatoMouth
      .set(0, (-0.2 + (HAYATO_MOUTH_Y + 0.2) * mouth) * size, (0.42 + (HAYATO_MOUTH_Z - 0.42) * mouth) * size)
      .applyQuaternion(head.quaternion)
      .add(_hayatoCenter);

    if (this.hayatoRing) {
      this.hayatoRing.visible = u.alive;
      this.hayatoRing.position.set(_hayatoCenter.x, _hayatoCenter.y - 0.62 * size, _hayatoCenter.z);
      this.hayatoRing.rotation.set(Math.PI / 2, 0, time * 1.6);
    }

    const glow = this.hayatoMouthGlow;
    if (glow) {
      const charging = u.alive && u.attackPhase === 'windup';
      glow.visible = charging || striking;
      glow.position.copy(_hayatoMouth);
      glow.scale.setScalar(size * (striking ? 0.13 + Math.sin(time * 40) * 0.012 : 0.03 + 0.09 * windup));
    }

    for (const beam of this.hayatoBeam) beam.visible = striking;
    if (striking) {
      if (u.laserAimPos.lengthSq() > 0.01) _dir.subVectors(u.laserAimPos, _hayatoMouth);
      else _dir.copy(_fwd).multiplyScalar(8);
      const aimDist = Math.max(0.5, _dir.length());
      _dir.divideScalar(aimDist);
      // 照準の先へ突き抜けるが、下向きなら地面で止める
      let length = aimDist + MOUTH_LASER_PIERCE;
      if (_dir.y < -0.001) length = Math.min(length, _hayatoMouth.y / -_dir.y);
      const pulse = 1 + Math.sin(time * 52) * 0.12;
      HAYATO_BEAM_RADII.forEach((radius, i) => {
        const beam = this.hayatoBeam[i];
        beam.position.copy(_hayatoMouth);
        beam.quaternion.setFromUnitVectors(UP, _dir);
        beam.scale.set(radius * s * pulse, length, radius * s * pulse);
      });
    }
  }

  private syncRamiel(): void {
    const u = this.unit;
    const s = u.scale;
    const pelvis = u.pelvis.pos;
    const time = performance.now() * 0.001;

    // 進行方向・照準方向基底ベクトル
    _fwd.copy(u.forward).normalize();
    if (_fwd.lengthSq() < 1e-6) _fwd.set(1, 0, 0);
    _right.crossVectors(UP, _fwd).normalize();
    if (_right.lengthSq() < 1e-6) _right.set(1, 0, 0);
    _up.crossVectors(_fwd, _right).normalize();

    // 被弾破片計算のために見えないボクセルTorsoの行列だけ同期し、全ボクセルメッシュを完全非表示にする
    placeBasisPart(this.parts.torso.mesh, pelvis, _right, _up, _fwd);
    this.parts.torso.mesh.visible = false;
    this.parts.head.mesh.visible = false;
    this.parts.upperArmL.mesh.visible = false;
    this.parts.forearmL.mesh.visible = false;
    this.parts.upperArmR.mesh.visible = false;
    this.parts.forearmR.mesh.visible = false;
    this.parts.thighL.mesh.visible = false;
    this.parts.shinL.mesh.visible = false;
    this.parts.thighR.mesh.visible = false;
    this.parts.shinR.mesh.visible = false;

    if (!u.alive || this.parts.torso.destroyed) {
      if (this.ramielUpperPyramid) this.ramielUpperPyramid.visible = false;
      if (this.ramielLowerPyramid) this.ramielLowerPyramid.visible = false;
      if (this.ramielInnerOcta) this.ramielInnerOcta.visible = false;
      for (const w of this.ramielPrismWings) w.visible = false;
      if (this.ramielCoreMesh) this.ramielCoreMesh.visible = false;
      if (this.ramielCoreGlow) this.ramielCoreGlow.visible = false;
      if (this.ramielCoreRingA) this.ramielCoreRingA.visible = false;
      if (this.ramielCoreRingB) this.ramielCoreRingB.visible = false;
      for (const sp of this.ramielSparkles) sp.visible = false;
      for (const r of this.ramielAccelRings) r.visible = false;
      if (this.ramielMuzzleOrb) this.ramielMuzzleOrb.visible = false;
      if (this.ramielMuzzleCrossA) this.ramielMuzzleCrossA.visible = false;
      if (this.ramielMuzzleCrossB) this.ramielMuzzleCrossB.visible = false;
      if (this.ramielSightBeam) this.ramielSightBeam.visible = false;
      if (this.ramielLaserCore) this.ramielLaserCore.visible = false;
      if (this.ramielLaserInner) this.ramielLaserInner.visible = false;
      if (this.ramielLaserOuter) this.ramielLaserOuter.visible = false;
      for (const sr of this.ramielLaserShockRings) sr.visible = false;
      if (this.ramielImpactDome) this.ramielImpactDome.visible = false;
      if (this.ramielImpactRing) this.ramielImpactRing.visible = false;
      if (this.ramielAtFieldOuter) this.ramielAtFieldOuter.visible = false;
      if (this.ramielAtFieldMid) this.ramielAtFieldMid.visible = false;
      if (this.ramielAtFieldInner) this.ramielAtFieldInner.visible = false;
      return;
    }

    const phase = u.attackPhase;
    const isWindup = phase === 'windup';
    const isStrike = phase === 'strike';
    const isRecover = phase === 'recover';

    const windupProg = isWindup ? Math.min(1.0, u.phaseTime / Math.max(0.01, u.type.windup)) : 0;
    const recoverProg = isRecover ? Math.min(1.0, u.phaseTime / Math.max(0.01, u.type.recover)) : 0;

    // 幾何学形態変形率 morph (0 = 完全正八面体結晶, 1 = 最大展開された星型多面体・荷電粒子砲形態)
    let morph = 0;
    if (isWindup) {
      morph = Math.sin(Math.min(1.0, windupProg * 1.15) * Math.PI * 0.5);
    } else if (isStrike) {
      morph = 1.0;
    } else if (isRecover) {
      morph = Math.max(0, 1.0 - recoverProg * 1.25);
    }

    // 鏡面マテリアルの発光・プリズム反射強度更新
    if (this.ramielMirrorMat) {
      if (u.hitFlash > 0.05) {
        this.ramielMirrorMat.emissive.setHex(0xffffff);
        this.ramielMirrorMat.emissiveIntensity = 0.8 + u.hitFlash * 1.4;
      } else if (isStrike) {
        this.ramielMirrorMat.emissive.setHex(0x00e5ff);
        this.ramielMirrorMat.emissiveIntensity = 1.45 + Math.sin(time * 48.0) * 0.35;
      } else if (isWindup) {
        this.ramielMirrorMat.emissive.setHex(windupProg > 0.75 ? 0x38bdf8 : 0x1971c2);
        this.ramielMirrorMat.emissiveIntensity = 0.45 + windupProg * 1.1 + Math.sin(time * (8.0 + windupProg * 28.0)) * 0.25;
      } else {
        this.ramielMirrorMat.emissive.setHex(0x0b3c7d);
        this.ramielMirrorMat.emissiveIntensity = 0.38 + Math.sin(time * 3.2) * 0.12;
      }
    }

    // 1. 上部・下部多ポリゴン鏡面ピラミッド（タメに応じて上下に分離し、逆回転しながら鏡面光を放つ）
    const splitGap = (0.012 + morph * 0.26 + Math.sin(time * 2.8) * 0.015) * s;
    const baseSpin = time * 0.45 + (isWindup ? Math.pow(windupProg, 2) * 8.5 : isStrike ? time * 4.5 : 0);

    if (this.ramielUpperPyramid) {
      this.ramielUpperPyramid.visible = true;
      const upPos = _voxelWorld.copy(pelvis).addScaledVector(_up, splitGap);
      placeBasisPart(this.ramielUpperPyramid, upPos, _right, _up, _fwd);
      this.ramielUpperPyramid.rotateY(baseSpin);
      if (morph > 0.01) {
        const breathe = 1.0 + morph * 0.08 + (isStrike ? Math.sin(time * 40.0) * 0.04 : 0);
        this.ramielUpperPyramid.scale.set(breathe, 1.0 - morph * 0.12, breathe);
      } else {
        this.ramielUpperPyramid.scale.set(1, 1, 1);
      }
    }

    if (this.ramielLowerPyramid) {
      this.ramielLowerPyramid.visible = true;
      const lowPos = _voxelWorld.copy(pelvis).addScaledVector(_up, -splitGap);
      placeBasisPart(this.ramielLowerPyramid, lowPos, _right, _up, _fwd);
      this.ramielLowerPyramid.rotateY(-baseSpin * 1.15);
      if (morph > 0.01) {
        const breathe = 1.0 + morph * 0.08 + (isStrike ? Math.cos(time * 40.0) * 0.04 : 0);
        this.ramielLowerPyramid.scale.set(breathe, 1.0 - morph * 0.12, breathe);
      } else {
        this.ramielLowerPyramid.scale.set(1, 1, 1);
      }
    }

    // 2. 内部ジオデシック多面体ミラーコア殻
    if (this.ramielInnerOcta) {
      this.ramielInnerOcta.visible = true;
      this.ramielInnerOcta.position.copy(pelvis);
      this.ramielInnerOcta.rotation.set(time * 1.4, -time * 1.9, time * 0.9);
      const innerScale = 0.85 + morph * 0.42 + Math.sin(time * 6.0) * 0.05;
      this.ramielInnerOcta.scale.setScalar(innerScale);
    }

    // 3. 8枚の可変展開ダイヤモンド・プリズムウィング（通常時は八面体の8面に寄り添い、タメ・照射時は前方へ花弁展開＆高速公転！）
    const wingSpin = time * (0.55 + morph * 3.8);
    for (let i = 0; i < this.ramielPrismWings.length; i++) {
      const wing = this.ramielPrismWings[i];
      wing.visible = true;
      const isTopHalf = i < 4;
      const idx4 = i % 4;
      const octAngle = (idx4 / 4) * Math.PI * 2 + Math.PI * 0.25 + baseSpin * (isTopHalf ? 1 : -1);

      // 通常時: 正八面体の8つの斜面に沿って浮遊配置
      const idleRadial = 0.36 * s;
      const idleY = (isTopHalf ? 0.24 : -0.24) * s + Math.sin(time * 3.4 + i * 0.9) * 0.02 * s;
      const idleX = Math.cos(octAngle) * idleRadial;
      const idleZ = Math.sin(octAngle) * idleRadial;

      // 展開時(morph→1): 照準方向(_fwd)を取り囲む8枚羽根の巨大パラボラ反射鏡リングへ変形！
      const cannonAngle = (i / 8) * Math.PI * 2 + wingSpin * (i % 2 === 0 ? 1 : -1.4);
      const cannonRadius = (0.68 + (i % 2) * 0.16 + (isWindup ? Math.sin(windupProg * Math.PI) * 0.12 : 0)) * s;
      const cannonRight = Math.cos(cannonAngle) * cannonRadius;
      const cannonUp = Math.sin(cannonAngle) * cannonRadius;
      const cannonFwd = (i % 2 === 0 ? 0.28 : -0.10) * s;

      // ワールド座標補間
      const posIdle = _localHit
        .copy(pelvis)
        .addScaledVector(_right, idleX)
        .addScaledVector(_up, idleY)
        .addScaledVector(_fwd, idleZ);
      const posCannon = _voxelWorld
        .copy(pelvis)
        .addScaledVector(_right, cannonRight)
        .addScaledVector(_up, cannonUp)
        .addScaledVector(_fwd, cannonFwd);

      wing.position.lerpVectors(posIdle, posCannon, morph);
      placeBasisPart(wing, wing.position, _right, _up, _fwd);
      if (morph < 0.5) {
        wing.rotateY(-octAngle);
        wing.rotateX(isTopHalf ? -0.52 : Math.PI + 0.52);
      } else {
        wing.rotateZ(cannonAngle - Math.PI * 0.5);
        wing.rotateX(0.42 + Math.sin(time * 12.0 + i) * 0.08);
      }
    }

    // 4. 中央の真紅使徒コア球体＆エネルギーリング
    if (this.ramielCoreMesh) {
      this.ramielCoreMesh.visible = true;
      this.ramielCoreMesh.position.copy(pelvis);
      const corePulse = 1.0 + morph * 0.35 + Math.sin(time * (isWindup || isStrike ? 28.0 : 4.5)) * (isWindup || isStrike ? 0.16 : 0.07);
      this.ramielCoreMesh.scale.setScalar(corePulse);
      const cMat = this.ramielCoreMesh.material as MeshStandardMaterial;
      cMat.emissiveIntensity = isStrike ? 3.8 : isWindup ? 1.8 + windupProg * 2.2 : 1.5 + Math.sin(time * 4.0) * 0.4;
    }
    if (this.ramielCoreGlow) {
      this.ramielCoreGlow.visible = true;
      this.ramielCoreGlow.position.copy(pelvis);
      const glowScale = 1.0 + morph * 0.55 + Math.sin(time * 16.0) * 0.12;
      this.ramielCoreGlow.scale.setScalar(glowScale);
    }
    const ringSpd = 1.0 + morph * 4.5;
    if (this.ramielCoreRingA) {
      this.ramielCoreRingA.visible = true;
      this.ramielCoreRingA.position.copy(pelvis);
      this.ramielCoreRingA.rotation.set(time * 2.1 * ringSpd, time * 1.5 * ringSpd, 0);
      this.ramielCoreRingA.scale.setScalar(1.0 + morph * 0.25);
    }
    if (this.ramielCoreRingB) {
      this.ramielCoreRingB.visible = true;
      this.ramielCoreRingB.position.copy(pelvis);
      this.ramielCoreRingB.rotation.set(-time * 1.7 * ringSpd, 0, time * 2.5 * ringSpd);
      this.ramielCoreRingB.scale.setScalar(1.0 + morph * 0.32);
    }

    // 5. キラキラ輝く14個の多面体スパークル結晶（鏡面ボディの周囲で絶えず明滅・煌めく）
    for (let i = 0; i < this.ramielSparkles.length; i++) {
      const sp = this.ramielSparkles[i];
      sp.visible = true;
      const orbAng = time * (1.2 + (i % 3) * 0.5) + (i / this.ramielSparkles.length) * Math.PI * 2;
      const elevAng = Math.sin(time * 1.8 + i * 1.7) * 1.1;
      const rad = (0.58 + (i % 4) * 0.11 + morph * 0.24) * s;
      const sx = Math.cos(orbAng) * Math.cos(elevAng) * rad;
      const sy = Math.sin(elevAng) * rad;
      const sz = Math.sin(orbAng) * Math.cos(elevAng) * rad;
      sp.position.set(pelvis.x + sx, pelvis.y + sy, pelvis.z + sz);
      sp.rotation.set(time * 5.0 + i, time * 7.0 - i, time * 4.0);
      // キラキラと鋭く瞬くスケール変化
      const twinkle = 0.25 + Math.pow(0.5 + 0.5 * Math.sin(time * 8.5 + i * 2.3), 3) * (1.25 + morph * 0.7);
      sp.scale.set(twinkle * 0.55, twinkle * 1.65, twinkle * 0.55);
    }

    // 照準ターゲット方向ベクトル aimDir と距離 aimDist を計算
    const hasAim = u.laserAimPos.lengthSq() > 0.01;
    const targetPoint = hasAim
      ? _localHit.copy(u.laserAimPos)
      : _localHit.copy(pelvis).addScaledVector(_fwd, 24.0);
    const aimVec = _dir.subVectors(targetPoint, pelvis);
    const aimDist = Math.max(2.0, aimVec.length());
    const aimDir = aimVec.clone().divideScalar(aimDist);
    const aimRight = new Vector3().crossVectors(UP, aimDir);
    if (aimRight.lengthSq() < 1e-5) aimRight.set(1, 0, 0);
    else aimRight.normalize();
    const aimUp = new Vector3().crossVectors(aimDir, aimRight).normalize();

    const muzzleOffset = 0.72 * s;
    const muzzlePos = _voxelWorld.copy(pelvis).addScaledVector(aimDir, muzzleOffset);

    // 6. タメ時間（windup）＆照射中（strike）の前方3連装・荷電粒子加速リングと収束プラズマ球
    if (isWindup || isStrike) {
      const deployFrac = isStrike ? 1.0 : Math.min(1.0, windupProg * 1.25);
      for (let i = 0; i < this.ramielAccelRings.length; i++) {
        const ring = this.ramielAccelRings[i];
        ring.visible = true;
        const distFwd = (0.45 + i * 0.34) * s * deployFrac;
        const rPos = pelvis.clone().addScaledVector(aimDir, distFwd);
        placeBasisPart(ring, rPos, aimRight, aimUp, aimDir);
        const rotDir = i % 2 === 0 ? 1 : -1;
        ring.rotateZ(time * (3.5 + windupProg * 14.0 + (isStrike ? 18.0 : 0)) * rotDir);
        const pulseS = isStrike
          ? 1.15 + Math.sin(time * 45.0 + i) * 0.12
          : deployFrac * (0.85 + Math.sin(time * 18.0 + i * 1.2) * 0.12);
        ring.scale.setScalar(pulseS);
      }

      // 銃口焦点に収束する高エネルギー球体＆十字スターフレア
      if (this.ramielMuzzleOrb) {
        this.ramielMuzzleOrb.visible = true;
        this.ramielMuzzleOrb.position.copy(muzzlePos);
        const orbScale = isStrike
          ? 2.2 + Math.sin(time * 55.0) * 0.35
          : 0.2 + Math.pow(windupProg, 1.6) * 1.85 + Math.sin(time * 32.0) * 0.18 * windupProg;
        this.ramielMuzzleOrb.scale.setScalar(orbScale);
        const orbMat = this.ramielMuzzleOrb.material as MeshBasicMaterial;
        orbMat.color.setHex(windupProg > 0.8 || isStrike ? 0xffffff : 0x74c0fc);
      }
      if (this.ramielMuzzleCrossA && this.ramielMuzzleCrossB) {
        this.ramielMuzzleCrossA.visible = true;
        this.ramielMuzzleCrossB.visible = true;
        this.ramielMuzzleCrossA.position.copy(muzzlePos);
        this.ramielMuzzleCrossB.position.copy(muzzlePos);
        const flareLen = (isStrike ? 3.8 : 0.6 + windupProg * 3.0) * (0.9 + Math.sin(time * 40.0) * 0.2);
        this.ramielMuzzleCrossA.scale.set(flareLen, 0.28, 0.28);
        this.ramielMuzzleCrossB.scale.set(0.28, flareLen, 0.28);
        this.ramielMuzzleCrossA.rotation.set(0, 0, time * 8.0);
        this.ramielMuzzleCrossB.rotation.set(0, 0, time * 8.0);
      }

      // タメ中のターゲットロックオン・プリズム照準レーザーライン
      if (this.ramielSightBeam) {
        this.ramielSightBeam.visible = isWindup;
        if (isWindup) {
          const sightLen = Math.max(1.0, aimDist - muzzleOffset);
          const midSight = muzzlePos.clone().addScaledVector(aimDir, sightLen * 0.5);
          this.ramielSightBeam.position.copy(midSight);
          _quat.setFromUnitVectors(UP, aimDir);
          this.ramielSightBeam.quaternion.copy(_quat);
          const sightThick = 0.6 + windupProg * 2.2 + (windupProg > 0.8 ? Math.sin(time * 60.0) * 0.8 : 0);
          this.ramielSightBeam.scale.set(sightThick, sightLen, sightThick);
          const sMat = this.ramielSightBeam.material as MeshBasicMaterial;
          sMat.color.setHex(windupProg > 0.82 ? 0xff2a85 : 0x00f5d4);
          sMat.opacity = 0.35 + windupProg * 0.55;
        }
      }
    } else {
      for (const ring of this.ramielAccelRings) ring.visible = false;
      if (this.ramielMuzzleOrb) this.ramielMuzzleOrb.visible = false;
      if (this.ramielMuzzleCrossA) this.ramielMuzzleCrossA.visible = false;
      if (this.ramielMuzzleCrossB) this.ramielMuzzleCrossB.visible = false;
      if (this.ramielSightBeam) this.ramielSightBeam.visible = false;
    }

    // 7. 超極太・広範囲・高威力3Dレーザービーム＆高速進行ショックリング＆着弾プラズマドーム（strike ～ recover序盤）
    const showLaser = isStrike || (isRecover && recoverProg < 0.35);
    if (showLaser) {
      const fade = isStrike ? 1.0 : Math.max(0, 1.0 - recoverProg / 0.35);
      const pulse = (1.0 + Math.sin(time * 65.0) * 0.14) * fade;
      // ターゲットを突き抜けてさらに奥まで貫通する極太レーザー長
      const beamLength = Math.max(aimDist + 14.0, 38.0);
      const beamMid = muzzlePos.clone().addScaledVector(aimDir, beamLength * 0.5);
      _quat.setFromUnitVectors(UP, aimDir);

      if (this.ramielLaserCore) {
        this.ramielLaserCore.visible = true;
        this.ramielLaserCore.position.copy(beamMid);
        this.ramielLaserCore.quaternion.copy(_quat);
        const rCore = 0.62 * pulse;
        this.ramielLaserCore.scale.set(rCore, beamLength, rCore);
        (this.ramielLaserCore.material as MeshBasicMaterial).opacity = 0.98 * fade;
      }
      if (this.ramielLaserInner) {
        this.ramielLaserInner.visible = true;
        this.ramielLaserInner.position.copy(beamMid);
        this.ramielLaserInner.quaternion.copy(_quat);
        const rInner = 1.48 * pulse;
        this.ramielLaserInner.scale.set(rInner, beamLength, rInner);
        (this.ramielLaserInner.material as MeshBasicMaterial).opacity = 0.82 * fade;
      }
      if (this.ramielLaserOuter) {
        this.ramielLaserOuter.visible = true;
        this.ramielLaserOuter.position.copy(beamMid);
        this.ramielLaserOuter.quaternion.copy(_quat);
        const rOuter = 2.55 * (1.0 + Math.cos(time * 48.0) * 0.16) * fade;
        this.ramielLaserOuter.scale.set(rOuter, beamLength, rOuter);
        (this.ramielLaserOuter.material as MeshBasicMaterial).opacity = 0.44 * fade;
      }

      // レーザー軸に沿って超高速で駆け抜ける6連プラズマ衝撃波リング
      for (let i = 0; i < this.ramielLaserShockRings.length; i++) {
        const sr = this.ramielLaserShockRings[i];
        sr.visible = true;
        const travel = ((time * 3.8 + i / this.ramielLaserShockRings.length) % 1.0) * beamLength;
        const srPos = muzzlePos.clone().addScaledVector(aimDir, travel);
        placeBasisPart(sr, srPos, aimRight, aimUp, aimDir);
        const ringScale = (1.65 + Math.sin(travel * 0.4 + i) * 0.45) * fade;
        sr.scale.setScalar(ringScale);
      }

      // 着弾点(targetPoint)の超巨大プラズマ爆縮ドーム＆衝撃波リング
      if (this.ramielImpactDome) {
        this.ramielImpactDome.visible = true;
        this.ramielImpactDome.position.copy(targetPoint);
        const domeScale = (3.4 + Math.sin(time * 50.0) * 0.55) * fade;
        this.ramielImpactDome.scale.setScalar(domeScale);
        (this.ramielImpactDome.material as MeshBasicMaterial).opacity = 0.68 * fade;
      }
      if (this.ramielImpactRing) {
        this.ramielImpactRing.visible = true;
        this.ramielImpactRing.position.set(targetPoint.x, Math.max(0.15, targetPoint.y), targetPoint.z);
        this.ramielImpactRing.rotation.set(Math.PI * 0.5, 0, time * 10.0);
        const impRingScale = (4.8 + ((time * 12.0) % 2.4)) * fade;
        this.ramielImpactRing.scale.setScalar(impRingScale);
      }
    } else {
      if (this.ramielLaserCore) this.ramielLaserCore.visible = false;
      if (this.ramielLaserInner) this.ramielLaserInner.visible = false;
      if (this.ramielLaserOuter) this.ramielLaserOuter.visible = false;
      for (const sr of this.ramielLaserShockRings) sr.visible = false;
      if (this.ramielImpactDome) this.ramielImpactDome.visible = false;
      if (this.ramielImpactRing) this.ramielImpactRing.visible = false;
    }

    // 8. 多重八角形ATフィールド結界（被弾防御時＆タメ終盤〜発射時に前面展開）
    const defStrength = Math.max(
      u.hitFlash,
      Math.min(1.0, u.defenseTimer / 0.45),
      isWindup && windupProg > 0.65 ? (windupProg - 0.65) * 2.2 : isStrike ? 0.75 : 0,
    );
    if (defStrength > 0.02) {
      const expand = Math.min(1.0, defStrength * 1.15 + 0.35);
      if (this.ramielAtFieldOuter) {
        this.ramielAtFieldOuter.visible = true;
        const posOuter = pelvis.clone().addScaledVector(aimDir, 0.85 * s);
        placeBasisPart(this.ramielAtFieldOuter, posOuter, aimRight, aimUp, aimDir);
        this.ramielAtFieldOuter.rotateZ(time * 2.4);
        this.ramielAtFieldOuter.scale.setScalar(expand);
        (this.ramielAtFieldOuter.material as MeshBasicMaterial).opacity = defStrength * 0.40;
      }
      if (this.ramielAtFieldMid) {
        this.ramielAtFieldMid.visible = true;
        const posMid = pelvis.clone().addScaledVector(aimDir, 0.96 * s);
        placeBasisPart(this.ramielAtFieldMid, posMid, aimRight, aimUp, aimDir);
        this.ramielAtFieldMid.rotateZ(-time * 3.6);
        this.ramielAtFieldMid.scale.setScalar(expand * (0.95 + Math.sin(time * 18.0) * 0.08));
        (this.ramielAtFieldMid.material as MeshBasicMaterial).opacity = defStrength * 0.52;
      }
      if (this.ramielAtFieldInner) {
        this.ramielAtFieldInner.visible = true;
        const posInner = pelvis.clone().addScaledVector(aimDir, 1.08 * s);
        placeBasisPart(this.ramielAtFieldInner, posInner, aimRight, aimUp, aimDir);
        this.ramielAtFieldInner.rotateZ(time * 5.0);
        this.ramielAtFieldInner.scale.setScalar(expand);
        (this.ramielAtFieldInner.material as MeshBasicMaterial).opacity = defStrength * 0.68;
      }
    } else {
      if (this.ramielAtFieldOuter) this.ramielAtFieldOuter.visible = false;
      if (this.ramielAtFieldMid) this.ramielAtFieldMid.visible = false;
      if (this.ramielAtFieldInner) this.ramielAtFieldInner.visible = false;
    }
  }

  /** 光速アリ専用の昆虫ボディ（頭・胸・腹）＆6本脚高速駆動配置処理 */
  private syncLightspeedAnt(): void {
    const u = this.unit;
    const s = u.scale;
    const P = u.joints;
    const pelvis = P[J.Pelvis].pos;
    const chest = P[J.Chest].pos;
    const head = P[J.Head].pos;

    // アリの進行方向ベクトル（水平〜前傾）
    _fwd.subVectors(chest, pelvis);
    if (_fwd.lengthSq() < 1e-5) _fwd.copy(u.forward);
    else _fwd.normalize();
    _up.copy(UP);
    _right.crossVectors(_up, _fwd).normalize();
    if (_right.lengthSq() < 1e-5) _right.set(1, 0, 0);
    _up.crossVectors(_fwd, _right).normalize();

    // 1. 胴体（胸部＋くびれ＋腹部）
    if (!this.parts.torso.destroyed) {
      this.parts.torso.mesh.visible = true;
      placeBasisPart(this.parts.torso.mesh, pelvis, _right, _up, _fwd);
    } else {
      this.parts.torso.mesh.visible = false;
    }

    // 2. 頭部（触角・大顎・複眼）を胸部前端に配置
    if (!this.parts.head.destroyed) {
      this.parts.head.mesh.visible = true;
      _dir.subVectors(head, chest);
      if (_dir.lengthSq() < 1e-5) _dir.copy(_fwd);
      else _dir.normalize();
      const headRight = _localHit.crossVectors(UP, _dir).normalize();
      if (headRight.lengthSq() < 1e-5) headRight.copy(_right);
      const headUp = _headUp.crossVectors(_dir, headRight).normalize();
      const headPos = _voxelWorld.copy(chest).addScaledVector(_fwd, 0.14 * s);
      placeBasisPart(this.parts.head.mesh, headPos, headRight, headUp, _dir);
    } else {
      this.parts.head.mesh.visible = false;
    }

    // 3. アリの6本脚（前脚2本・中脚2本・後脚2本を胸部〜腹柄節から接地させる）
    const thoraxFrontL = _voxelWorld.copy(chest).addScaledVector(_right, -0.14 * s).addScaledVector(_fwd, 0.10 * s);
    const thoraxMidL = _headPos.copy(pelvis).addScaledVector(_right, -0.15 * s).addScaledVector(_fwd, 0.12 * s);
    placeLimb(this.parts.upperArmL.mesh, thoraxFrontL, P[J.ElbowL].pos);
    placeLimb(this.parts.forearmL.mesh, thoraxMidL, P[J.HandL].pos);

    const thoraxFrontR = _voxelWorld.copy(chest).addScaledVector(_right, 0.14 * s).addScaledVector(_fwd, 0.10 * s);
    const thoraxMidR = _headPos.copy(pelvis).addScaledVector(_right, 0.15 * s).addScaledVector(_fwd, 0.12 * s);
    placeLimb(this.parts.upperArmR.mesh, thoraxFrontR, P[J.ElbowR].pos);
    placeLimb(this.parts.forearmR.mesh, thoraxMidR, P[J.HandR].pos);

    // 後脚（2関節で力強く地面を蹴る）
    placeLimb(this.parts.thighL.mesh, P[J.HipL].pos, P[J.KneeL].pos);
    placeLimb(this.parts.shinL.mesh, P[J.KneeL].pos, P[J.FootL].pos);
    placeLimb(this.parts.thighR.mesh, P[J.HipR].pos, P[J.KneeR].pos);
    placeLimb(this.parts.shinR.mesh, P[J.KneeR].pos, P[J.FootR].pos);
  }

  /** 被弾フラッシュ・感電・炎上発光と死亡時の暗転マテリアル更新 */
  private updateMaterialStatus(): void {
    const u = this.unit;
    if (u.hitFlash > 0) {
      this.material.emissive.setRGB(u.hitFlash * 0.7, u.hitFlash * 0.15, u.hitFlash * 0.1);
    } else if (u.shockTimer > 0) {
      this.material.emissive.setRGB(0.15, 0.55, 0.85);
    } else if (u.burnTimer > 0) {
      this.material.emissive.setRGB(0.65, 0.22, 0.02);
    } else if (u.elementInfusion) {
      // 属性の門で強化された兵は属性の色でほのかに光る
      const [r, g, b] = ELEMENT_GLOW[u.elementInfusion];
      this.material.emissive.setRGB(r, g, b);
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
    if (part.destroyed || part.template.uncarvable) return 0;
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
    const hayatoFx = [...this.hayatoBeam, ...(this.hayatoMouthGlow ? [this.hayatoMouthGlow] : []), ...(this.hayatoRing ? [this.hayatoRing] : [])];
    for (const m of [...this.dragonJet, ...this.yamamuronAura, ...hayatoFx, ...(this.dragonMouthGlow ? [this.dragonMouthGlow] : [])]) {
      m.geometry.dispose();
      (m.material as MeshBasicMaterial).dispose();
    }
    if (this.zeruelCoreMesh) {
      this.zeruelCoreMesh.geometry.dispose();
      (this.zeruelCoreMesh.material as MeshStandardMaterial).dispose();
    }
    if (this.zeruelCoreGlow) {
      this.zeruelCoreGlow.geometry.dispose();
      (this.zeruelCoreGlow.material as MeshBasicMaterial).dispose();
    }
    if (this.zeruelCoreRingA) {
      this.zeruelCoreRingA.geometry.dispose();
      (this.zeruelCoreRingA.material as MeshBasicMaterial).dispose();
    }
    if (this.zeruelCoreRingB) {
      this.zeruelCoreRingB.geometry.dispose();
      (this.zeruelCoreRingB.material as MeshBasicMaterial).dispose();
    }
    if (this.zeruelHalo) {
      this.zeruelHalo.geometry.dispose();
      (this.zeruelHalo.material as MeshStandardMaterial).dispose();
    }
    if (this.zeruelHaloInner) {
      this.zeruelHaloInner.geometry.dispose();
      (this.zeruelHaloInner.material as MeshBasicMaterial).dispose();
    }
    if (this.zeruelRibbonGeomL) this.zeruelRibbonGeomL.dispose();
    if (this.zeruelRibbonGeomR) this.zeruelRibbonGeomR.dispose();
    if (this.zeruelSubRibbonGeomL) this.zeruelSubRibbonGeomL.dispose();
    if (this.zeruelSubRibbonGeomR) this.zeruelSubRibbonGeomR.dispose();
    if (this.zeruelRibbonL) {
      (this.zeruelRibbonL.material as MeshStandardMaterial).dispose();
    }
    for (const shield of [this.zeruelAtFieldOuter, this.zeruelAtFieldMid, this.zeruelAtFieldInner]) {
      if (shield) {
        shield.geometry.dispose();
        (shield.material as MeshBasicMaterial).dispose();
      }
    }
    if (this.ramielMirrorMat) this.ramielMirrorMat.dispose();
    if (this.ramielUpperPyramid) this.ramielUpperPyramid.geometry.dispose();
    if (this.ramielLowerPyramid) this.ramielLowerPyramid.geometry.dispose();
    if (this.ramielInnerOcta) {
      this.ramielInnerOcta.geometry.dispose();
      (this.ramielInnerOcta.material as MeshPhysicalMaterial).dispose();
    }
    if (this.ramielPrismWings.length > 0) {
      this.ramielPrismWings[0].geometry.dispose();
    }
    if (this.ramielCoreMesh) {
      this.ramielCoreMesh.geometry.dispose();
      (this.ramielCoreMesh.material as MeshStandardMaterial).dispose();
    }
    if (this.ramielCoreGlow) {
      this.ramielCoreGlow.geometry.dispose();
      (this.ramielCoreGlow.material as MeshBasicMaterial).dispose();
    }
    if (this.ramielCoreRingA) {
      this.ramielCoreRingA.geometry.dispose();
      (this.ramielCoreRingA.material as MeshBasicMaterial).dispose();
    }
    if (this.ramielCoreRingB) {
      this.ramielCoreRingB.geometry.dispose();
      (this.ramielCoreRingB.material as MeshBasicMaterial).dispose();
    }
    if (this.ramielSparkles.length > 0) {
      this.ramielSparkles[0].geometry.dispose();
      for (const sp of this.ramielSparkles) {
        (sp.material as MeshBasicMaterial).dispose();
      }
    }
    for (const ring of this.ramielAccelRings) {
      ring.geometry.dispose();
      (ring.material as MeshBasicMaterial).dispose();
    }
    if (this.ramielMuzzleOrb) {
      this.ramielMuzzleOrb.geometry.dispose();
      (this.ramielMuzzleOrb.material as MeshBasicMaterial).dispose();
    }
    if (this.ramielMuzzleCrossA) {
      this.ramielMuzzleCrossA.geometry.dispose();
      (this.ramielMuzzleCrossA.material as MeshBasicMaterial).dispose();
    }
    if (this.ramielMuzzleCrossB) {
      (this.ramielMuzzleCrossB.material as MeshBasicMaterial).dispose();
    }
    if (this.ramielSightBeam) {
      this.ramielSightBeam.geometry.dispose();
      (this.ramielSightBeam.material as MeshBasicMaterial).dispose();
    }
    if (this.ramielLaserCore) {
      this.ramielLaserCore.geometry.dispose();
      (this.ramielLaserCore.material as MeshBasicMaterial).dispose();
    }
    if (this.ramielLaserInner) {
      this.ramielLaserInner.geometry.dispose();
      (this.ramielLaserInner.material as MeshBasicMaterial).dispose();
    }
    if (this.ramielLaserOuter) {
      (this.ramielLaserOuter.material as MeshBasicMaterial).dispose();
    }
    if (this.ramielLaserShockRings.length > 0) {
      this.ramielLaserShockRings[0].geometry.dispose();
      for (const sr of this.ramielLaserShockRings) {
        (sr.material as MeshBasicMaterial).dispose();
      }
    }
    if (this.ramielImpactDome) {
      this.ramielImpactDome.geometry.dispose();
      (this.ramielImpactDome.material as MeshBasicMaterial).dispose();
    }
    if (this.ramielImpactRing) {
      this.ramielImpactRing.geometry.dispose();
      (this.ramielImpactRing.material as MeshBasicMaterial).dispose();
    }
    for (const shield of [this.ramielAtFieldOuter, this.ramielAtFieldMid, this.ramielAtFieldInner]) {
      if (shield) {
        shield.geometry.dispose();
        (shield.material as MeshBasicMaterial).dispose();
      }
    }
  }
}

/** 配置プレビュー用の半透明ゴーストモデルを生成する */
export function createPreviewGhost(type: UnitType, team: Team): Group {
  const s = type.scale;
  const g = new Group();
  if (type.id === 'hayato') {
    const ghostHead = new Mesh(
      getHayatoHeadGeometry().clone(),
      new MeshLambertMaterial({ vertexColors: true, flatShading: true, transparent: true, opacity: 0.75 }),
    );
    ghostHead.scale.setScalar(HAYATO_HEAD_HEIGHT * s);
    ghostHead.position.y = (0.96 * HAYATO_HOVER_MUL + HAYATO_HEAD_RISE) * s;
    g.add(ghostHead);
    g.rotation.y = team === 0 ? Math.PI / 2 : -Math.PI / 2;
    return g;
  }
  if (type.id === 'angel_ramiel') {
    const ghostMirrorMat = new MeshPhysicalMaterial({
      color: 0xa5f3fc,
      map: getRamielMirrorFacetTexture(),
      envMap: getRamielMirrorEnvMap(),
      envMapIntensity: 2.2,
      vertexColors: true,
      metalness: 0.88,
      roughness: 0.06,
      transparent: true,
      opacity: 0.78,
      flatShading: true,
    });
    const upper = new Mesh(createRamielMirrorPyramidGeometry(s, true), ghostMirrorMat);
    const lower = new Mesh(createRamielMirrorPyramidGeometry(s, false), ghostMirrorMat);
    upper.position.set(0, 2.7, 0);
    lower.position.set(0, 2.7, 0);
    g.add(upper, lower);
    g.rotation.y = team === 0 ? Math.PI / 2 : -Math.PI / 2;
    return g;
  }
  const set = getUnitTemplateSet(type, team);
  const mat = new MeshLambertMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.65,
  });
  const torso = makeMesh(set.torso.geometry, mat, s);
  const baseY = type.id === 'angel_zeruel' ? 1.01 * s : 0.96 * s;
  torso.position.set(0, baseY, 0);
  const head = makeMesh(set.head.geometry, mat, s);
  if (type.id === 'angel_zeruel') {
    head.position.set(0, baseY + 0.56 * s, 0.14 * s);
    const coreMesh = new Mesh(
      new SphereGeometry(0.165 * s, 24, 24),
      new MeshBasicMaterial({ color: 0xff0033, transparent: true, opacity: 0.75 }),
    );
    coreMesh.position.set(0, baseY + 0.34 * s, 0.21 * s);
    g.add(coreMesh);
  } else {
    head.position.set(0, 1.74 * s, 0);
  }
  g.add(torso, head);
  g.rotation.y = team === 0 ? Math.PI / 2 : -Math.PI / 2;
  return g;
}

/**
 * ゲートのエネルギー発生装置の1本分を作る。
 * body は金属の筐体、glow は発光する部分（描画側で属性の色を付ける）で、噴射口はモデルの +X を向く。
 */
export function buildGatePylonGrids(team: Team): {
  body: VoxelGrid;
  glow: VoxelGrid;
  voxelSize: number;
  pivot: [number, number, number];
} {
  const sx = 15;
  const sy = 33;
  const sz = 13;
  const c = 6;
  const body = new VoxelGrid(sx, sy, sz);
  const glow = new VoxelGrid(sx, sy, sz);
  const accent = TEAM_COLORS[team].shirt;
  const dark = 0x23272f;
  const metal = 0x3a414d;
  const light = 0x5d6675;
  const copper = 0xc08040;
  const LIT = 0xffffff;

  for (let z = 0; z < sz; z++) {
    for (let x = 0; x < sx; x++) {
      const dx = Math.abs(x - c);
      const dz = Math.abs(z - c);
      const box = Math.max(dx, dz);
      for (let y = 0; y < sy; y++) {
        if (y <= 2) {
          // 土台（角を落とした台座と、チーム色の縁取り）
          if (box <= 6 && dx + dz <= 10) body.set(x, y, z, y === 2 && box === 6 ? accent : dark);
        } else if (y <= 5) {
          const r = y === 5 ? 4 : 5;
          if (box <= r) body.set(x, y, z, y === 5 ? light : metal);
        } else if (y <= 22) {
          // 反応炉: 中央の発光コアを4本の支柱とコイルが囲む
          if (box <= 1) glow.set(x, y, z, LIT);
          else if (dx >= 3 && dx <= 4 && dz >= 3 && dz <= 4) body.set(x, y, z, metal);
          else if (box === 3 && (y - 9) % 5 <= 1 && y >= 9 && y <= 20) body.set(x, y, z, copper);
        } else if (y <= 26) {
          // 上部の蓋
          const r = y === 23 ? 5 : 4;
          if (box <= r) body.set(x, y, z, y === 24 && box === 4 ? accent : y === 23 ? light : metal);
        } else if (y <= 29) {
          if (box <= 2) body.set(x, y, z, dark);
        } else if (dx + dz <= (y === 32 ? 0 : 1)) {
          // 頂点の発光クリスタル
          glow.set(x, y, z, LIT);
        }
      }
    }
  }

  // 内側へ向いた3段の噴射口（ここから網が張られる）
  for (const base of [7, 14, 20]) {
    for (let y = base; y <= base + 2; y++) {
      for (let z = c - 1; z <= c + 1; z++) {
        for (let x = c + 2; x <= c + 6; x++) body.set(x, y, z, y === base + 1 && z === c ? light : metal);
        glow.set(c + 7, y, z, LIT);
      }
    }
  }
  return { body, glow, voxelSize: 0.088, pivot: [c + 0.5, 0, c + 0.5] };
}

/** 施設のボクセルグリッドを生成する */
export function buildFacilityVoxelGrid(typeId: FacilityTypeId, team: Team): { grid: VoxelGrid; voxelSize: number } {
  const gateEnergy = GATE_TINTS[typeId] ?? 0x66ccff;
  // ローグライトの門は増殖ゲートと同じ形を使い、エネルギーの色だけを変える
  if (isGateTypeId(typeId)) typeId = 'multiplier_gate';
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
      // 配置プレビューと破壊時の破片に使う、最小の開口のゲート全体（左右の発生装置とエネルギー網）
      const pylons = buildGatePylonGrids(team);
      const sx = 42;
      const sy = pylons.body.sy;
      const sz = pylons.body.sz;
      const g = new VoxelGrid(sx, sy, sz);
      const left = 7;
      const right = 34;
      const px = pylons.pivot[0] - 0.5;
      for (let z = 0; z < sz; z++) {
        for (let y = 0; y < sy; y++) {
          for (let x = 0; x < pylons.body.sx; x++) {
            const bodyColor = pylons.body.get(x, y, z);
            const color = pylons.glow.get(x, y, z) !== 0 ? gateEnergy : bodyColor;
            if (color === 0) continue;
            g.set(left + (x - px), y, z, color);
            g.set(right - (x - px), y, z, color);
          }
        }
      }
      const netZ = Math.floor(sz / 2);
      for (let y = 4; y <= 28; y++) {
        for (let x = 15; x <= 26; x++) {
          if ((x + y) % 5 === 0 || (x - y + 100) % 5 === 0) g.set(x, y, netZ, gateEnergy);
        }
      }
      return { grid: g, voxelSize: pylons.voxelSize };
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

    case 'terrain_wall': {
      // 防壁ブロック（壁）: 横幅約3.0m・高さ2.6mの重厚な石造り城壁・銃眼（クレネル）付き
      const sx = 32;
      const sy = 26;
      const sz = 12;
      const voxelSize = 0.095;
      const g = new VoxelGrid(sx, sy, sz);

      // 土台（y: 0..3）
      for (let y = 0; y <= 3; y++) {
        for (let z = 1; z <= 10; z++) {
          for (let x = 1; x <= 30; x++) {
            const baseCol = ((x * 13 + y * 29 + z * 41) & 3) === 0 ? 0x4b463e : 0x5c554b;
            g.set(x, y, z, baseCol);
          }
        }
      }

      // 主壁体（y: 4..21）レンガ積みパターン
      for (let y = 4; y <= 21; y++) {
        const brickRow = Math.floor(y / 3);
        const isMortarY = y % 3 === 0;
        for (let z = 2; z <= 9; z++) {
          for (let x = 1; x <= 30; x++) {
            const isPillar = x <= 4 || x >= 27 || (x >= 14 && x <= 17);
            const isMortarX = ((x + (brickRow % 2) * 3) % 6) === 0;
            let col = 0x787166;
            if (isPillar) {
              col = y === 12 || y === 13 ? 0xd97706 : 0x625c52;
            } else if (isMortarY || isMortarX) {
              col = 0x544e45;
            } else if (((x * 17 + brickRow * 31) & 3) === 0) {
              col = 0x8a8275;
            }
            g.set(x, y, z, col);
          }
        }
      }

      // 柱の張り出しバットレス（控え壁）
      for (let y = 0; y <= 22; y++) {
        for (const px of [2, 3, 15, 16, 28, 29]) {
          g.set(px, y, 1, 0x524c43);
          g.set(px, y, 10, 0x524c43);
        }
      }

      // 上部の胸壁・銃眼（クレネル y: 22..25）
      for (let y = 22; y <= 25; y++) {
        for (let z = 2; z <= 9; z++) {
          for (let x = 1; x <= 30; x++) {
            // 4箇所の凸部を作る
            const merlon =
              (x >= 1 && x <= 6) ||
              (x >= 9 && x <= 14) ||
              (x >= 17 && x <= 22) ||
              (x >= 25 && x <= 30);
            if (y === 22 || merlon) {
              g.set(x, y, z, y === 25 ? 0x8c8478 : 0x6d665c);
            }
          }
        }
      }

      return { grid: g, voxelSize };
    }

    case 'terrain_slope': {
      // スロープブロック（坂道）: -Z（手前）から+Z（奥）へ向かって登る幅2.6m・長さ3.2m・高さ1.8mの突撃スロープ
      const sx = 26;
      const sy = 19;
      const sz = 32;
      const voxelSize = 0.1;
      const g = new VoxelGrid(sx, sy, sz);

      for (let z = 0; z < sz; z++) {
        const t = z / (sz - 1);
        const maxH = Math.max(1, Math.round(t * 18));
        for (let y = 0; y <= maxH; y++) {
          const isTopSurface = y >= maxH - 1;
          for (let x = 1; x <= 24; x++) {
            const isSideRail = x <= 2 || x >= 23;
            if (isSideRail && y === maxH) {
              // サイドの金属・石材ガードレール
              g.set(x, Math.min(sy - 1, y + 1), z, 0x495057);
            }
            if (isTopSurface) {
              // 登坂面の矢印シェブロン模様と滑り止めステップ
              const relX = Math.abs(x - 12.5);
              const chevron = ((z - Math.floor(relX * 0.8) + 32) % 8);
              if (relX <= 7 && (chevron === 0 || chevron === 1)) {
                g.set(x, y, z, 0xf59f00); // 黄橙色の進行方向シェブロン
              } else if (z % 4 === 0) {
                g.set(x, y, z, 0x6c584c); // 滑り止め横木
              } else {
                g.set(x, y, z, 0x8a7968); // スロープ天板
              }
            } else {
              // 側面・内部の石積み構造（軽量化のため内部は中空にし外殻と梁のみ配置）
              if (x <= 2 || x >= 23 || y === 0 || z >= sz - 2 || z % 8 === 0) {
                const stoneCol = ((x + y + z) % 3 === 0) ? 0x4f4a42 : 0x5f5950;
                g.set(x, y, z, stoneCol);
              }
            }
          }
        }
      }

      return { grid: g, voxelSize };
    }

    case 'terrain_pit': {
      // 落とし穴ブロック（奈落）: 地面にぽっかり空いた暗黒の奈落ホール＋危険警告の石枠と内向きスパイク
      const sx = 32;
      const sy = 5;
      const sz = 32;
      const voxelSize = 0.11;
      const g = new VoxelGrid(sx, sy, sz);
      const cx = 15.5;
      const cz = 15.5;
      const holeR = 11.8;
      const rimOuterR = 15.2;

      for (let z = 0; z < sz; z++) {
        for (let x = 0; x < sx; x++) {
          const dist = Math.hypot(x - cx, z - cz);
          if (dist <= holeR) {
            // 奈落の底面（y: 0 に漆黒の虚無と渦巻く深淵リングを描画）
            const isAbyssRing = Math.abs(dist - holeR * 0.65) < 0.8 || Math.abs(dist - holeR * 0.32) < 0.7;
            g.set(x, 0, z, isAbyssRing ? 0x1a1426 : 0x07060a);
            if (dist >= holeR - 1.2) {
              g.set(x, 1, z, 0x1e1b24);
            }
          } else if (dist <= rimOuterR) {
            // 外周の崩れた石枠と黒黄の危険ストライプ縁石 (y: 0..2)
            const ang = Math.atan2(z - cz, x - cx);
            const stripe = Math.floor(((ang + Math.PI) / (Math.PI * 2)) * 16) % 2 === 0;
            g.set(x, 0, z, 0x3b3731);
            g.set(x, 1, z, dist <= holeR + 1.4 ? (stripe ? 0xe67700 : 0x2b2927) : 0x524c44);
            if (((x * 19 + z * 37) & 3) === 0 && dist > holeR + 1.2) {
              g.set(x, 2, z, 0x665e54);
            }
          }
        }
      }

      // 穴の縁から内側へ突き出す8本の鋭い牙スパイク
      for (let i = 0; i < 8; i++) {
        const ang = (i * Math.PI) / 4;
        const cos = Math.cos(ang);
        const sin = Math.sin(ang);
        for (let s = 0; s < 3; s++) {
          const r = holeR - s * 0.85;
          const sxPos = Math.round(cx + cos * r);
          const szPos = Math.round(cz + sin * r);
          g.set(sxPos, 1, szPos, s === 2 ? 0xd8dee9 : 0x868e96);
        }
      }

      return { grid: g, voxelSize };
    }
  }
}

/** 施設用のThree.jsメッシュを生成する */
/** 門の種類ごとのエネルギーの色 */
export const GATE_TINTS: Partial<Record<FacilityTypeId, number>> = {
  multiplier_gate: 0xc77dff,
  giant_gate: 0xffb35c,
  shrink_gate: 0x7fd6ff,
  fire_gate: 0xff6a3d,
  thunder_gate: 0xfff06a,
  venom_gate: 0x8fe36a,
  power_gate: 0xff3b3b,
  reach_gate: 0x5b8cff,
  haste_gate: 0x66ffe0,
  vitality_gate: 0xff9ec4,
  swift_gate: 0xd8ff5c,
  guard_gate: 0xb0bccc,
  impact_gate: 0xe0c090,
  rebirth_gate: 0x7ee0a8,
  samsara_gate: 0xffe08a,
  blast_gate: 0xff8a3d,
  magnet_gate: 0xc48aff,
};

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

// ---------------------------------------------------------------
// ローグライト残機表示用のボクセルハート
// ---------------------------------------------------------------

/** ハートの輪郭（9列×8行）。先頭が最上段（y=7）、末尾が最下段（y=0） */
const HEART_PATTERN: readonly string[] = [
  '011000110',
  '111101111',
  '111111111',
  '111111111',
  '011111110',
  '001111100',
  '000111000',
  '000010000',
];

/** ハートをどの部分として切り出すか（left/right は破砕時の半分。中央列は上下で割り振って亀裂らしくする） */
export type HeartVoxelPart = 'full' | 'left' | 'right';
/** alive=赤い通常ハート、lost=失ったあとのグレーハート */
export type HeartVoxelVariant = 'alive' | 'lost';

const HEART_COLORS: Readonly<
  Record<HeartVoxelVariant, { back: number; mid: number; front: number; highlight: number; shadow: number }>
> = {
  alive: { back: 0xa81c34, mid: 0xdd2a47, front: 0xef3e57, highlight: 0xff92a5, shadow: 0x8f1830 },
  lost: { back: 0x373b43, mid: 0x565b64, front: 0x686e78, highlight: 0x979da8, shadow: 0x2c2f36 },
};

/** ボクセルハートのグリッドを生成する（9×8×厚み3、原点はグリッド座標） */
export function buildHeartVoxelGrid(variant: HeartVoxelVariant, part: HeartVoxelPart): VoxelGrid {
  const g = new VoxelGrid(9, 8, 3);
  const cols = HEART_COLORS[variant];
  for (let row = 0; row < 8; row++) {
    const y = 7 - row;
    const line = HEART_PATTERN[row];
    for (let x = 0; x < 9; x++) {
      if (line[x] !== '1') continue;
      // 破砕時の左右分割（中央列 x=4 は上半分を左、下半分を右に寄せてジグザグの亀裂にする）
      if (part === 'left' && !(x < 4 || (x === 4 && y >= 4))) continue;
      if (part === 'right' && !(x > 4 || (x === 4 && y < 4))) continue;
      for (let z = 0; z < 3; z++) {
        let color = z === 0 ? cols.back : z === 1 ? cols.mid : cols.front;
        // 前面の左上にピンクのハイライト、下端は影色で立体感を出す
        if (z === 2 && y >= 6 && x >= 1 && x <= 3) color = cols.highlight;
        else if (y <= 1) color = cols.shadow;
        g.set(x, y, z, color);
      }
    }
  }
  return g;
}

/** ボクセルハートのジオメトリを生成する（中心が原点になるようピボットを取る） */
export function buildHeartGeometry(
  variant: HeartVoxelVariant,
  part: HeartVoxelPart,
  voxelSize: number,
): BufferGeometry {
  const grid = buildHeartVoxelGrid(variant, part);
  return grid.toGeometry(voxelSize, [grid.sx / 2, grid.sy / 2, grid.sz / 2]);
}

export type { UnitTypeId };
