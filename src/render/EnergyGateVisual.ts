import {
  NormalBlending,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  ShaderMaterial,
} from 'three';
import { GATE_TINTS, buildGatePylonGrids } from './VoxelModel';
import type { FacilityTypeId } from '../facilities/FacilityTypes';
import type { Team } from '../units/UnitTypes';

/** 発生装置の中心から、エネルギー網がつながる噴射口までの距離（m、等倍時） */
const PYLON_EMITTER_OFFSET = 0.58;
/** 網の上端・下端の高さ（m、等倍時） */
const NET_BOTTOM = 0.32;
const NET_TOP = 2.5;
const GLOW_BASE = 0.82;
const GLOW_PULSE = 0.18;

const NET_VERTEX = /* glsl */ `
  varying vec2 vMeters;
  uniform vec2 uSize;
  void main() {
    // 網の模様は倍率ではなくメートルで決める（幅が変わっても目の大きさは同じ）
    vMeters = uv * uSize;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const NET_FRAGMENT = /* glsl */ `
  varying vec2 vMeters;
  uniform vec2 uSize;
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uOpacity;

  float strand(float v, float width) {
    float d = abs(fract(v) - 0.5);
    return 1.0 - smoothstep(width, width + 0.05, d);
  }

  void main() {
    const float cell = 0.34;
    float a = (vMeters.x + vMeters.y) / cell;
    float b = (vMeters.x - vMeters.y) / cell;
    float net = max(strand(a, 0.05), strand(b, 0.05));

    // 発生装置から中央へ流れるエネルギーの脈動
    float fromEdge = min(vMeters.x, uSize.x - vMeters.x);
    float pulse = pow(0.5 + 0.5 * sin(fromEdge * 2.6 - uTime * 5.0), 6.0);

    // 上下の縁は電流が走るレールのように光らせる
    float rail = min(vMeters.y, uSize.y - vMeters.y);
    float railGlow = 1.0 - smoothstep(0.0, 0.11, rail);
    float nearEmitter = 1.0 - smoothstep(0.0, 0.5, fromEdge);
    float flicker = 0.92 + 0.08 * sin(uTime * 37.0 + vMeters.x * 3.0);

    float strength = 0.2 + net * (0.62 + pulse * 0.38) + railGlow * 0.9 + nearEmitter * 0.25;
    vec3 color = mix(uColor, vec3(1.0), clamp(net * pulse * 0.4 + railGlow * 0.45, 0.0, 1.0));
    gl_FragColor = vec4(color, clamp(strength * flicker, 0.0, 1.0) * uOpacity);
  }
`;

/**
 * ゲートの見た目。左右のエネルギー発生装置と、その間に張られた発光する網でできている。
 * 開口が広がっても装置は伸びず、間隔と網の幅だけが変わるので、どの幅でも形が崩れない。
 */
export class EnergyGateVisual {
  readonly root = new Group();
  /** 発生装置の本体（被弾の光や半透明の設定に使う） */
  readonly body: Mesh;
  private readonly bodyMaterial: MeshLambertMaterial;
  private readonly glowMaterial: MeshBasicMaterial;
  private readonly netMaterial: ShaderMaterial;
  private readonly energy: Color;
  private readonly netGeometry: PlaneGeometry;
  private readonly glowGeometry;

  /** @param poleOffset 中心から発生装置までの距離（m） */
  constructor(typeId: FacilityTypeId, team: Team, poleOffset: number, scale: number) {
    const { body, glow, voxelSize, pivot } = buildGatePylonGrids(team);
    this.energy = new Color(GATE_TINTS[typeId] ?? 0x66ccff);
    this.bodyMaterial = new MeshLambertMaterial({ vertexColors: true });
    this.glowMaterial = new MeshBasicMaterial({ color: this.energy.clone(), transparent: true });
    const bodyGeometry = body.toGeometry(voxelSize, pivot);
    this.glowGeometry = glow.toGeometry(voxelSize, pivot);

    const makePylon = (side: 1 | -1): Mesh => {
      const pylon = new Group();
      const shell = new Mesh(bodyGeometry, this.bodyMaterial);
      shell.castShadow = true;
      shell.receiveShadow = true;
      pylon.add(shell, new Mesh(this.glowGeometry, this.glowMaterial));
      pylon.position.x = -side * poleOffset;
      // 噴射口はモデルの +X にあるので、右の装置は半回転させて内側へ向ける
      pylon.rotation.y = side === 1 ? 0 : Math.PI;
      pylon.scale.setScalar(scale);
      this.root.add(pylon);
      return shell;
    };
    this.body = makePylon(1);
    makePylon(-1);

    const halfWidth = Math.max(0.2, poleOffset - PYLON_EMITTER_OFFSET * scale);
    const height = (NET_TOP - NET_BOTTOM) * scale;
    this.netGeometry = new PlaneGeometry(halfWidth * 2, height);
    this.netMaterial = new ShaderMaterial({
      vertexShader: NET_VERTEX,
      fragmentShader: NET_FRAGMENT,
      uniforms: {
        uSize: { value: [halfWidth * 2, height] },
        uColor: { value: this.energy },
        uTime: { value: 0 },
        uOpacity: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      blending: NormalBlending,
    });
    const net = new Mesh(this.netGeometry, this.netMaterial);
    net.position.y = NET_BOTTOM * scale + height / 2;
    this.root.add(net);
  }

  /** 毎フレーム呼ぶ。opacity は 0〜1 */
  update(time: number, opacity: number): void {
    const pulse = GLOW_BASE + GLOW_PULSE * Math.sin(time * 4.2);
    this.glowMaterial.color.copy(this.energy).multiplyScalar(1 + pulse * 0.6);
    this.glowMaterial.opacity = opacity;
    this.netMaterial.uniforms.uTime.value = time;
    this.netMaterial.uniforms.uOpacity.value = opacity;
  }

  /** 網の横幅（m） */
  get netWidth(): number {
    return (this.netMaterial.uniforms.uSize.value as number[])[0];
  }

  dispose(): void {
    this.body.geometry.dispose();
    this.glowGeometry.dispose();
    this.netGeometry.dispose();
    this.bodyMaterial.dispose();
    this.glowMaterial.dispose();
    this.netMaterial.dispose();
  }
}
