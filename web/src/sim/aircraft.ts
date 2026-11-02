import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Planes (MIA east-west arrival/departure corridors over Downtown & Brickell) and helicopters
// (Biscayne Bay sightseeing loops, PortMiami & Brickell Key orbits) in the Miami airspace.

function box(w: number, h: number, l: number, x: number, y: number, z: number, hex: number) {
  const g = new THREE.BoxGeometry(w, h, l).translate(x, y + h / 2, z);
  const c = new THREE.Color(hex), a = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < a.length; i += 3) a.set([c.r, c.g, c.b], i);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

interface Plane {
  x0: number; z0: number;
  vx: number; vz: number;
  y: number;
  pitch: number;
  span: number;
  phase: number;
}

interface Helo {
  cx: number; cz: number;
  rx: number; rz: number;
  y: number;
  omega: number;
  phase: number;
}

const PLANES: Plane[] = [
  // MIA runway 26L / 27 final approach heading west over Biscayne Bay & Brickell
  { x0: 4400, z0: 1580, vx: -62, vz: -8, y: 340, pitch: -0.04, span: 5200, phase: 0.0 },
  { x0: 4400, z0: 2350, vx: -58, vz: -12, y: 310, pitch: -0.04, span: 5200, phase: 0.45 },
  // MIA eastbound climb-out over Downtown & PortMiami toward the Atlantic
  { x0: -300, z0: 820, vx: 68, vz: 10, y: 390, pitch: 0.07, span: 5200, phase: 0.22 },
  { x0: -300, z0: 1920, vx: 65, vz: -9, y: 430, pitch: 0.06, span: 5200, phase: 0.71 },
];

const HELOS: Helo[] = [
  // Biscayne Bay & Brickell Key sightseeing helicopter orbit
  { cx: 1820, cz: 1920, rx: 520, rz: 680, y: 155, omega: 0.048, phase: 0.0 },
  // PortMiami & Downtown bayfront patrol helicopter
  { cx: 2150, cz: 980, rx: 640, rz: 460, y: 175, omega: -0.042, phase: 2.1 },
  // Brickell avenue / Miami River low tour helicopter
  { cx: 1380, cz: 1520, rx: 410, rz: 520, y: 145, omega: 0.055, phase: 4.2 },
];

export class Aircraft {
  readonly group = new THREE.Group();
  private readonly planeMesh: THREE.InstancedMesh;
  private readonly heloMesh: THREE.InstancedMesh;
  private readonly rotorMesh: THREE.InstancedMesh;
  private readonly strobeMesh: THREE.InstancedMesh;
  private t = 0;

  constructor() {
    const std = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.25 });
    // Commercial airliner (~36 m fuselage, swept wings, tail fin, twin underwing engines)
    const planeGeo = mergeGeometries([
      box(3.8, 3.8, 34.0, 0, 0, 0, 0xf4f6f9),       // fuselage
      box(3.9, 1.1, 32.0, 0, 1.3, 0, 0x1d4f91),     // cheatline / windows band
      box(34.0, 0.65, 5.2, 0, 0.9, -1.2, 0xe8ecf2), // main wings
      box(12.0, 0.45, 2.8, 0, 1.6, -15.2, 0xe8ecf2),// horizontal stabilizer
      box(0.75, 6.8, 4.6, 0, 3.2, -14.8, 0x1d4f91), // vertical tail fin
      box(1.9, 1.9, 4.8, -6.2, -0.8, 1.2, 0xd8dde4),// left engine nacelle
      box(1.9, 1.9, 4.8, 6.2, -0.8, 1.2, 0xd8dde4), // right engine nacelle
    ]);
    // Helicopter (~11 m cabin + tail boom + skids)
    const heloGeo = mergeGeometries([
      box(2.4, 2.2, 5.6, 0, 0.6, 0.8, 0x1e3a5f),    // cabin body
      box(2.46, 1.1, 3.2, 0, 1.2, 1.8, 0x8fbcd4),   // cockpit glass
      box(0.7, 0.8, 6.2, 0, 1.4, -4.6, 0x1e3a5f),   // tail boom
      box(0.35, 2.1, 1.2, 0, 1.6, -7.4, 0xe87722),  // tail fin
      box(0.22, 0.22, 5.2, -1.2, 0, 0.6, 0x3a3e42), // left skid
      box(0.22, 0.22, 5.2, 1.2, 0, 0.6, 0x3a3e42),  // right skid
    ]);
    // Spinning main rotor blades
    const rotorGeo = mergeGeometries([
      box(11.5, 0.12, 0.45, 0, 3.0, 0.6, 0x2a2e33),
      box(0.45, 0.12, 11.5, 0, 3.0, 0.6, 0x2a2e33),
    ]);
    const strobeGeo = new THREE.BoxGeometry(1.1, 1.1, 1.1);
    const strobeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

    this.planeMesh = new THREE.InstancedMesh(planeGeo, std, PLANES.length);
    this.heloMesh = new THREE.InstancedMesh(heloGeo, std, HELOS.length);
    this.rotorMesh = new THREE.InstancedMesh(rotorGeo, std, HELOS.length);
    this.strobeMesh = new THREE.InstancedMesh(strobeGeo, strobeMat, PLANES.length + HELOS.length);
    this.strobeMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array((PLANES.length + HELOS.length) * 3), 3);

    for (const m of [this.planeMesh, this.heloMesh, this.rotorMesh, this.strobeMesh]) {
      m.frustumCulled = false;
      m.castShadow = m !== this.strobeMesh;
      this.group.add(m);
    }
  }

  update(dt: number, night: number) {
    this.t += dt;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), euler = new THREE.Euler(0, 0, 0, 'YXZ');
    const pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), col = new THREE.Color();
    let si = 0;

    PLANES.forEach((p, i) => {
      const speed = Math.hypot(p.vx, p.vz);
      const u = ((this.t * speed / p.span) + p.phase) % 1;
      const dist = u * p.span;
      const x = p.x0 + (p.vx / speed) * dist;
      const z = p.z0 + (p.vz / speed) * dist;
      const y = p.y + (u - 0.5) * p.span * Math.sin(p.pitch);
      const yaw = Math.atan2(p.vx, p.vz);
      euler.set(p.pitch, yaw, 0);
      q.setFromEuler(euler);
      pos.set(x, y, z);
      this.planeMesh.setMatrixAt(i, m.compose(pos, q, one));
      const blink = Math.sin(this.t * 5.5 + i * 2.1) > 0.65 ? 2.5 : 0.4 + night * 1.4;
      pos.set(x, y - 1.2, z);
      this.strobeMesh.setMatrixAt(si, m.compose(pos, q, one));
      this.strobeMesh.setColorAt(si, col.setRGB(blink, blink * 0.25, blink * 0.2));
      si++;
    });

    HELOS.forEach((h, i) => {
      const a = this.t * h.omega + h.phase;
      const x = h.cx + Math.cos(a) * h.rx;
      const z = h.cz + Math.sin(a) * h.rz;
      const dx = -Math.sin(a) * h.rx * h.omega;
      const dz = Math.cos(a) * h.rz * h.omega;
      const yaw = Math.atan2(dx, dz);
      const y = h.y + Math.sin(this.t * 1.3 + i) * 2.5;
      euler.set(0.06, yaw, -0.08 * Math.sign(h.omega));
      q.setFromEuler(euler);
      pos.set(x, y, z);
      this.heloMesh.setMatrixAt(i, m.compose(pos, q, one));
      euler.set(0, this.t * 22 + i, 0);
      this.rotorMesh.setMatrixAt(i, m.compose(pos, q.setFromEuler(euler), one));
      const blink = Math.sin(this.t * 7 + i * 1.7) > 0.5 ? 2.2 : 0.35 + night * 1.2;
      pos.set(x, y - 0.5, z);
      this.strobeMesh.setMatrixAt(si, m.compose(pos, q, one));
      this.strobeMesh.setColorAt(si, col.setRGB(blink * 0.2, blink, blink * 0.3));
      si++;
    });

    this.planeMesh.count = PLANES.length;
    this.heloMesh.count = HELOS.length;
    this.rotorMesh.count = HELOS.length;
    this.strobeMesh.count = si;
    for (const mesh of [this.planeMesh, this.heloMesh, this.rotorMesh, this.strobeMesh]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
}
