import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { fetchJson } from '../util';

export type VesselKind = 'cruise' | 'superyacht' | 'yacht' | 'sailboat' | 'police' | 'boat' | 'jetski';

export interface DockSeg { x: number; z: number; w: number; l: number; h: number }
export interface CruiseBerth { name: string; line: string; x: number; z: number; y: number; h: number; len: number }
export interface PierBerth { x: number; z: number; y: number; h: number; kind: VesselKind }
export interface MarineRoute { kind: VesselKind; line?: string; len?: number; v: number; pts: [number, number][] }
export interface MarineData { waterZ: number; docks?: DockSeg[]; cruiseBerths: CruiseBerth[]; pierBerths: PierBerth[]; routes: MarineRoute[] }

interface ActiveRoute extends MarineRoute {
  cum: number[];
  total: number;
  offset: number;
}

function box(w: number, h: number, l: number, x: number, y: number, z: number, hex: number) {
  const g = new THREE.BoxGeometry(w, h, l).translate(x, y + h / 2, z);
  const c = new THREE.Color(hex), a = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < a.length; i += 3) a.set([c.r, c.g, c.b], i);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

const FUNNEL_COLOR: Record<string, number> = {
  virgin: 0xd91e2a,
  royal: 0x1055a5,
  carnival: 0xd41c2c,
  ncl: 0x1c4b82,
  msc: 0x1b2e4b,
};

export class Marine {
  readonly group = new THREE.Group();
  waterZ = 7;
  private data: MarineData | null = null;
  private active: ActiveRoute[] = [];
  private dockMesh!: THREE.InstancedMesh;
  private cruiseBody!: THREE.InstancedMesh;
  private cruiseFunnel!: THREE.InstancedMesh;
  private superyachtMesh!: THREE.InstancedMesh;
  private yachtMesh!: THREE.InstancedMesh;
  private sailboatDockedMesh!: THREE.InstancedMesh;
  private sailboatUnderwayMesh!: THREE.InstancedMesh;
  private policeMesh!: THREE.InstancedMesh;
  private boatMesh!: THREE.InstancedMesh;
  private jetskiMesh!: THREE.InstancedMesh;
  private wakeMesh!: THREE.InstancedMesh;
  private strobeMesh!: THREE.InstancedMesh;
  private t = 0;
  private ready = false;

  constructor() {
    this.buildMeshes();
    fetchJson<MarineData>('data/marine.json').then((d) => this.init(d)).catch((e) => console.warn('marine', e));
  }

  private buildMeshes() {
    const std = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.18 });
    const sailMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide });
    const wakeMat = new THREE.MeshBasicMaterial({ color: 0xeaf6fb, transparent: true, opacity: 0.65 });
    const strobeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

    // 1. Cruise Ship (~290 m unit length scaled per ship, 34 m beam, 48 m tall)
    const cruiseGeo = mergeGeometries([
      box(32, 5.5, 260, 0, 0, 0, 0x162844),          // lower dark-navy hull
      box(33, 6.0, 276, 0, 5.5, 6, 0xf4f6f9),        // upper white hull + bow flare
      box(28, 4.0, 22, 0, 8.0, 146, 0xf4f6f9),       // pointed bow stem
      box(30, 18.0, 238, 0, 11.5, -4, 0xf7f8fa),     // main balcony superstructure tiers
      box(30.4, 15.0, 226, 0, 13.0, -4, 0x3b688c),   // recessed blue balcony glass bands
      box(29.8, 1.4, 236, 0, 16.0, -4, 0xffffff),    // deck 7 white slab
      box(29.8, 1.4, 236, 0, 20.5, -4, 0xffffff),    // deck 9 white slab
      box(29.8, 1.4, 236, 0, 25.0, -4, 0xffffff),    // deck 11 white slab
      box(34.5, 3.2, 16, 0, 26.5, 96, 0x264b68),     // bridge wings + navigation glass
      box(26, 5.5, 195, 0, 29.5, -10, 0xf2f4f7),     // Lido / observation upper decks
      box(14, 0.8, 36, 0, 35.1, 15, 0x22b5d8),       // rooftop lido swimming pool
      box(18, 4.5, 42, 0, 35.0, 58, 0xffffff),       // forward observation lounge dome
    ]);
    const funnelGeo = mergeGeometries([
      box(9.5, 11.5, 24, 0, 35.0, -32, 0xffffff),    // funnel base casing
      box(10.0, 4.5, 28, 0, 43.0, -34, 0xffffff),    // winged funnel cap
    ]);

    // 2. Superyacht (~36 m, 3 decks, teak aft deck, radar arch)
    const superyachtGeo = mergeGeometries([
      box(7.4, 2.6, 34.0, 0, 0, 0, 0xf5f7fa),        // main hull
      box(5.6, 2.4, 6.0, 0, 0.4, 18.5, 0xf5f7fa),    // bow
      box(7.0, 0.4, 10.0, 0, 2.4, -12.0, 0xc8a97e),  // teak aft beach deck
      box(6.2, 2.4, 20.0, 0, 2.6, -1.0, 0xf7f8fa),   // main salon cabin
      box(6.3, 1.3, 17.0, 0, 3.1, -0.5, 0x233d54),   // wrap-around dark salon glass
      box(5.2, 2.1, 13.0, 0, 5.0, -2.5, 0xf7f8fa),   // upper sky-lounge deck
      box(5.3, 1.0, 10.5, 0, 5.5, -2.0, 0x233d54),   // bridge glass
      box(3.8, 2.2, 4.5, 0, 7.1, -4.0, 0xffffff),    // radar mast & sat domes
    ]);

    // 3. Motor Yacht (~16 m flybridge cruiser)
    const yachtGeo = mergeGeometries([
      box(4.4, 1.8, 15.0, 0, 0, 0, 0xf6f7f9),        // hull
      box(3.2, 1.6, 3.4, 0, 0.2, 8.4, 0xf6f7f9),     // bow
      box(4.0, 0.3, 4.5, 0, 1.6, -5.2, 0xc4a478),    // teak cockpit
      box(3.6, 1.6, 8.2, 0, 1.8, 0.2, 0xffffff),     // cabin
      box(3.7, 0.85, 6.8, 0, 2.1, 0.5, 0x243e56),    // cabin glass
      box(2.8, 1.1, 4.2, 0, 3.4, -0.5, 0xf4f6f8),    // flybridge
    ]);

    // 4a. Sailboat (docked: mast + boom, sails furled)
    const sailboatDockedGeo = mergeGeometries([
      box(3.6, 1.5, 13.5, 0, 0, 0, 0xf4f5f7),        // hull
      box(3.65, 0.35, 13.2, 0, 0.9, 0, 0x1d3b66),    // navy sheer stripe
      box(2.8, 0.8, 5.5, 0, 1.5, 0.5, 0xffffff),     // coachroof
      box(0.28, 16.5, 0.28, 0, 1.5, 1.2, 0xd8dde2),  // tall aluminum mast
      box(0.35, 0.45, 5.8, 0, 3.1, -1.7, 0x1d3b66),  // boom with navy canvas sail cover
    ]);

    // 4b. Sailboat (underway on the bay: full white mainsail + headsail jib)
    const sailboatUnderwayGeo = mergeGeometries([
      box(3.6, 1.5, 13.5, 0, 0, 0, 0xf4f5f7),        // hull
      box(3.65, 0.35, 13.2, 0, 0.9, 0, 0x1d3b66),    // navy sheer stripe
      box(2.8, 0.8, 5.5, 0, 1.5, 0.5, 0xffffff),     // coachroof
      box(0.28, 17.0, 0.28, 0, 1.5, 1.2, 0xd8dde2),  // mast
      box(0.18, 11.5, 4.6, 0.25, 3.2, -1.3, 0xfbfcfe), // lower mainsail
      box(0.16, 6.5, 2.6, 0.25, 11.2, -0.3, 0xfbfcfe), // upper mainsail peak
      box(0.16, 9.5, 3.4, -0.2, 2.6, 3.8, 0xf7f9fc), // forward headsail jib
    ]);

    // 5. Police Boat (Miami-Dade / USCG Marine Patrol center-console with blue/white hull & T-top)
    const policeGeo = mergeGeometries([
      box(3.4, 1.5, 11.2, 0, 0, 0, 0x14294a),        // dark navy patrol hull
      box(3.5, 0.45, 8.5, 0, 0.75, 0.4, 0xffffff),   // bold white police hull band
      box(3.55, 0.25, 4.2, 0, 0.85, 1.2, 0x0080ff),  // bright blue police flash
      box(2.1, 1.4, 2.8, 0, 1.5, -0.2, 0xf2f4f7),    // center console + helm
      box(2.0, 0.9, 1.8, 0, 2.1, 0.3, 0x7fb2cc),     // windshield
      box(2.6, 0.22, 4.0, 0, 3.1, -0.2, 0xffffff),   // white T-top canopy
      box(1.5, 0.32, 0.45, 0, 3.32, 0.4, 0x1d6bff),  // blue LED lightbar
      box(0.55, 1.1, 0.9, -0.7, 0.6, -5.8, 0x1e2024),// twin outboard left
      box(0.55, 1.1, 0.9, 0.7, 0.6, -5.8, 0x1e2024), // twin outboard right
    ]);

    // 6. Powerboat / Center-Console Sportboat (~9 m)
    const boatGeo = mergeGeometries([
      box(2.9, 1.3, 9.0, 0, 0, 0, 0xf4f6f9),
      box(2.95, 0.3, 8.6, 0, 0.75, 0, 0x1f6fa8),
      box(1.8, 1.1, 2.4, 0, 1.3, -0.2, 0xffffff),
      box(2.2, 0.18, 3.0, 0, 2.5, -0.2, 0x1f6fa8),
    ]);

    // 7. Jetski + Rider (~3.6 m personal watercraft)
    const jetskiGeo = mergeGeometries([
      box(1.35, 0.85, 3.6, 0, 0, 0, 0x00b4d8),       // aqua/white PWC hull
      box(0.9, 0.55, 1.6, 0, 0.85, 0.2, 0xf72585),   // seat & cowling
      box(0.55, 0.95, 0.55, 0, 1.1, -0.1, 0xffbe0b), // rider in high-vis life vest
      box(0.38, 0.38, 0.38, 0, 2.05, 0.0, 0x222629), // rider head/helmet
    ]);

    const dockGeo = mergeGeometries([
      box(1.0, 0.45, 1.0, 0, 0.85, 0, 0xb8a386),      // weathered wood / concrete pier deck
      box(0.18, 1.3, 0.18, -0.42, 0.0, -0.42, 0x5c4d3c), // corner piling
      box(0.18, 1.3, 0.18, 0.42, 0.0, -0.42, 0x5c4d3c),
      box(0.18, 1.3, 0.18, -0.42, 0.0, 0.42, 0x5c4d3c),
      box(0.18, 1.3, 0.18, 0.42, 0.0, 0.42, 0x5c4d3c),
    ]);
    const wakeGeo = new THREE.BoxGeometry(2.6, 0.16, 12.0).translate(0, 0.08, -7.5);
    const strobeGeo = new THREE.BoxGeometry(0.95, 0.65, 0.95);

    const make = (geo: THREE.BufferGeometry, mat: THREE.Material, max: number, color = false) => {
      const m = new THREE.InstancedMesh(geo, mat, max);
      m.frustumCulled = false;
      m.castShadow = mat !== wakeMat && mat !== strobeMat;
      m.receiveShadow = m.castShadow;
      if (color) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
      m.count = 0;
      this.group.add(m);
      return m;
    };

    this.dockMesh = make(dockGeo, std, 256);
    this.cruiseBody = make(cruiseGeo, std, 12);
    this.cruiseFunnel = make(funnelGeo, std, 12, true);
    this.superyachtMesh = make(superyachtGeo, std, 64);
    this.yachtMesh = make(yachtGeo, std, 160);
    this.sailboatDockedMesh = make(sailboatDockedGeo, std, 120);
    this.sailboatUnderwayMesh = make(sailboatUnderwayGeo, sailMat, 32);
    this.policeMesh = make(policeGeo, std, 24);
    this.boatMesh = make(boatGeo, std, 120);
    this.jetskiMesh = make(jetskiGeo, std, 32);
    this.wakeMesh = make(wakeGeo, wakeMat, 64);
    this.strobeMesh = make(strobeGeo, strobeMat, 24, true);
  }

  private init(d: MarineData) {
    this.data = d;
    this.waterZ = d.waterZ || 7;
    this.active = d.routes.map((r, i) => {
      const cum = [0];
      for (let k = 1; k < r.pts.length; k++) {
        const [x0, z0] = r.pts[k - 1], [x1, z1] = r.pts[k];
        cum.push(cum[k - 1] + Math.hypot(x1 - x0, z1 - z0));
      }
      const total = cum[cum.length - 1] || 1;
      return { ...r, cum, total, offset: ((i * 0.37) % 1) * total };
    });
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), euler = new THREE.Euler(0, 0, 0, 'YXZ');
    const pos = new THREE.Vector3(), sc = new THREE.Vector3();
    let nd = 0;
    for (const d of (this.data.docks ?? [])) {
      if (nd >= 256) break;
      pos.set(d.x, this.waterZ, d.z);
      q.setFromEuler(euler.set(0, d.h, 0));
      sc.set(d.w, 1, d.l);
      this.dockMesh.setMatrixAt(nd++, m.compose(pos, q, sc));
    }
    this.dockMesh.count = nd;
    this.dockMesh.instanceMatrix.needsUpdate = true;
    this.ready = true;
    this.update(0);
  }

  private sampleRoute(r: ActiveRoute, dist: number) {
    const d = ((dist % r.total) + r.total) % r.total;
    let k = 0;
    while (k < r.cum.length - 2 && r.cum[k + 1] < d) k++;
    const seg = Math.max(1e-3, r.cum[k + 1] - r.cum[k]);
    const f = (d - r.cum[k]) / seg;
    const [x0, z0] = r.pts[k], [x1, z1] = r.pts[k + 1];
    return {
      x: x0 + (x1 - x0) * f,
      z: z0 + (z1 - z0) * f,
      h: Math.atan2(x1 - x0, z1 - z0),
    };
  }

  update(dt: number) {
    if (!this.ready || !this.data) return;
    this.t += dt;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), euler = new THREE.Euler(0, 0, 0, 'YXZ');
    const pos = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1), col = new THREE.Color();
    const wy = this.waterZ;

    let nCruise = 0, nSuper = 0, nYacht = 0, nSailD = 0, nSailU = 0, nPolice = 0, nBoat = 0, nJet = 0, nWake = 0, nStrobe = 0;

    // 1. Docked Cruise Ships at PortMiami
    for (const c of this.data.cruiseBerths) {
      const scaleL = (c.len || 290) / 290;
      pos.set(c.x, wy, c.z);
      q.setFromEuler(euler.set(0, c.h, 0));
      m.compose(pos, q, sc.set(1, 1, scaleL));
      this.cruiseBody.setMatrixAt(nCruise, m);
      this.cruiseFunnel.setMatrixAt(nCruise, m);
      this.cruiseFunnel.setColorAt(nCruise, col.setHex(FUNNEL_COLOR[c.line] ?? 0x1b4f91));
      nCruise++;
    }

    // 2. Docked Yachts, Superyachts, Sailboats, Powerboats & Police Boats at the 141 OSM pier berths
    for (let i = 0; i < this.data.pierBerths.length; i++) {
      const b = this.data.pierBerths[i];
      const bob = Math.sin(this.t * 1.6 + i * 0.7) * 0.06;
      pos.set(b.x, wy + bob, b.z);
      q.setFromEuler(euler.set(0, b.h, Math.sin(this.t * 1.2 + i) * 0.015));
      m.compose(pos, q, sc.set(1, 1, 1));
      if (b.kind === 'superyacht' && nSuper < 64) this.superyachtMesh.setMatrixAt(nSuper++, m);
      else if (b.kind === 'sailboat' && nSailD < 120) this.sailboatDockedMesh.setMatrixAt(nSailD++, m);
      else if (b.kind === 'police' && nPolice < 24) {
        this.policeMesh.setMatrixAt(nPolice++, m);
        const flash = Math.sin(this.t * 9 + i * 2) > 0;
        pos.set(b.x, wy + 3.55, b.z);
        this.strobeMesh.setMatrixAt(nStrobe, m.compose(pos, q, sc.set(1, 1, 1)));
        this.strobeMesh.setColorAt(nStrobe++, col.setRGB(flash ? 0.15 : 2.2, flash ? 0.6 : 0.15, flash ? 2.8 : 0.2));
      } else if (b.kind === 'boat' && nBoat < 120) this.boatMesh.setMatrixAt(nBoat++, m);
      else if (nYacht < 160) this.yachtMesh.setMatrixAt(nYacht++, m);
    }

    // 3. Moving Marine Traffic along open-water channels & Biscayne Bay
    this.active.forEach((r, ri) => {
      // Spawn 1 vessel on cruise routes, 2–3 vessels spaced along yacht/sailboat/police/jetski routes
      const count = r.kind === 'cruise' ? 1 : r.kind === 'jetski' ? 3 : 2;
      for (let k = 0; k < count; k++) {
        const s = this.sampleRoute(r, r.offset + this.t * r.v + (k * r.total) / count);
        const bob = Math.sin(this.t * 2.4 + ri + k) * 0.08;
        pos.set(s.x, wy + bob, s.z);
        const roll = r.kind === 'sailboat' ? 0.14 * Math.sin(this.t * 0.6 + ri) : r.kind === 'jetski' ? -0.12 * Math.cos(this.t * 1.8 + k) : 0;
        const pitch = r.kind === 'jetski' || r.kind === 'police' ? -0.05 : 0;
        q.setFromEuler(euler.set(pitch, s.h, roll));
        m.compose(pos, q, sc.set(1, 1, 1));

        if (r.kind === 'cruise' && nCruise < 12) {
          this.cruiseBody.setMatrixAt(nCruise, m);
          this.cruiseFunnel.setMatrixAt(nCruise, m);
          this.cruiseFunnel.setColorAt(nCruise, col.setHex(FUNNEL_COLOR[r.line ?? 'msc'] ?? 0x1b2e4b));
          nCruise++;
          if (nWake < 64) {
            pos.set(s.x - Math.sin(s.h) * 145, wy + 0.08, s.z - Math.cos(s.h) * 145);
            this.wakeMesh.setMatrixAt(nWake++, m.compose(pos, q, sc.set(5.5, 1, 4.5)));
          }
        } else if (r.kind === 'superyacht' && nSuper < 64) {
          this.superyachtMesh.setMatrixAt(nSuper++, m);
          if (nWake < 64) this.wakeMesh.setMatrixAt(nWake++, m.compose(pos, q, sc.set(1.6, 1, 1.8)));
        } else if (r.kind === 'yacht' && nYacht < 160) {
          this.yachtMesh.setMatrixAt(nYacht++, m);
          if (nWake < 64) this.wakeMesh.setMatrixAt(nWake++, m.compose(pos, q, sc.set(1.1, 1, 1.2)));
        } else if (r.kind === 'sailboat' && nSailU < 32) {
          this.sailboatUnderwayMesh.setMatrixAt(nSailU++, m);
        } else if (r.kind === 'police' && nPolice < 24) {
          this.policeMesh.setMatrixAt(nPolice++, m);
          if (nWake < 64) this.wakeMesh.setMatrixAt(nWake++, m.compose(pos, q, sc.set(1.0, 1, 1.3)));
          if (nStrobe < 24) {
            const flash = Math.sin(this.t * 11 + ri * 3 + k) > 0;
            pos.set(s.x, wy + 3.55, s.z);
            this.strobeMesh.setMatrixAt(nStrobe, m.compose(pos, q, sc.set(1, 1, 1)));
            this.strobeMesh.setColorAt(nStrobe++, col.setRGB(flash ? 0.1 : 2.5, flash ? 0.6 : 0.1, flash ? 3.0 : 0.2));
          }
        } else if (r.kind === 'boat' && nBoat < 120) {
          this.boatMesh.setMatrixAt(nBoat++, m);
          if (nWake < 64) this.wakeMesh.setMatrixAt(nWake++, m.compose(pos, q, sc.set(0.9, 1, 1.1)));
        } else if (r.kind === 'jetski' && nJet < 32) {
          this.jetskiMesh.setMatrixAt(nJet++, m);
          if (nWake < 64) this.wakeMesh.setMatrixAt(nWake++, m.compose(pos, q, sc.set(0.55, 1, 1.1)));
        }
      }
    });

    const counts: [THREE.InstancedMesh, number][] = [
      [this.cruiseBody, nCruise],
      [this.cruiseFunnel, nCruise],
      [this.superyachtMesh, nSuper],
      [this.yachtMesh, nYacht],
      [this.sailboatDockedMesh, nSailD],
      [this.sailboatUnderwayMesh, nSailU],
      [this.policeMesh, nPolice],
      [this.boatMesh, nBoat],
      [this.jetskiMesh, nJet],
      [this.wakeMesh, nWake],
      [this.strobeMesh, nStrobe],
    ];
    for (const [mesh, c] of counts) {
      mesh.count = c;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
}
