import * as THREE from 'three';

export interface Weather {
  cloud: number;
  rain: number;
  snow: number;
  cover: number;
}

export const WEATHERS: Record<string, Weather> = {
  clear: { cloud: 0, rain: 0, snow: 0, cover: 0 },
  cloudy: { cloud: 1, rain: 0, snow: 0, cover: 0 },
  rain: { cloud: 1, rain: 1, snow: 0, cover: 0 },
  snow: { cloud: 1, rain: 0, snow: 1, cover: 1 },
};

export interface Climate { clear: number[]; cloudy: number[]; rain: number[]; snow: number[]; cover: number[]; snowy: boolean[] }

export interface LiveWeather { w: Weather; said: string }

const WMO_TEXT: Record<number, string> = {
  0: 'clear', 1: 'mostly clear', 2: 'partly cloudy', 3: 'overcast',
  45: 'fog', 48: 'fog',
  51: 'drizzle', 53: 'drizzle', 55: 'drizzle',
  61: 'light rain', 63: 'rain', 65: 'heavy rain',
  80: 'showers', 81: 'showers', 82: 'heavy showers',
  95: 'thunderstorm', 96: 'thunderstorm', 99: 'thunderstorm',
};

/** Live conditions over Brickell from Open-Meteo (NOAA HRRR / GFS, no key required). */
export async function fetchLiveWeather(lat = 25.763, lon = -80.19): Promise<LiveWeather> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
    + '&current=temperature_2m,cloud_cover,precipitation,rain,showers,weather_code&timezone=America%2FNew_York';
  const r = await fetch(url);
  if (!r.ok) throw new Error(`weather HTTP ${r.status}`);
  const j = await r.json();
  const cur = j.current ?? {};
  const code = Number(cur.weather_code ?? 0);
  const mm = Math.max(Number(cur.precipitation ?? 0), Number(cur.rain ?? 0), Number(cur.showers ?? 0));
  const rainy = (code >= 51 && code <= 67) || (code >= 80 && code <= 99) || mm > 0.05;
  const rain = rainy ? Math.min(1, Math.max(0.35, mm / 2.5 || (code >= 63 || code >= 81 ? 0.85 : 0.45))) : 0;
  const cloud = Math.max(rain > 0 ? 0.85 : 0, Math.min(1, Number(cur.cloud_cover ?? 0) / 100));
  const c = Number(cur.temperature_2m);
  const temp = Number.isFinite(c) ? `${Math.round(c * 9 / 5 + 32)}°F` : '';
  const word = WMO_TEXT[code] ?? (rain > 0 ? 'rain' : cloud > 0.7 ? 'cloudy' : cloud > 0.25 ? 'partly cloudy' : 'clear');
  return { w: { cloud, rain, snow: 0, cover: 0 }, said: [temp, word].filter(Boolean).join(' · ') };
}

const roll = (day: number, k: number) => { const x = Math.sin(day * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };

export function typical(_c: Climate | null, day: number): { w: Weather; said: string } {
  // South Florida: wet season roughly mid-May through October, dry season November through April.
  const wet = day >= 135 && day <= 295;
  const r = roll(day, 1);
  const rainChance = wet ? 0.24 : 0.07;
  const cloudChance = wet ? 0.36 : 0.22;
  const kind = r < rainChance ? 'rain' : r < rainChance + cloudChance ? 'cloudy' : 'clear';
  return { w: { ...WEATHERS[kind] }, said: kind };
}

export const visibility = (w: Weather) => 1 - 0.1 * w.cloud - 0.4 * w.rain - 0.55 * w.snow;

const DROPS = 9000;
const PRECIP_V = `
uniform float uTime; uniform vec3 uCam; uniform float uBox; uniform float uSnow; uniform float uSize;
attribute float aEnd;
varying float vA;
void main() {
  vec3 p = position;
  float fall = mix(9.0, 1.1, uSnow), t = uTime * fall;
  p.y -= t;
  p.x += uTime * mix(1.5, 0.5, uSnow) + uSnow * sin(uTime * 0.9 + p.z * 0.7) * 0.6;
  p.z += uSnow * cos(uTime * 0.7 + p.x * 0.5) * 0.6;
  p = uCam + mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5;
  if (aEnd > 0.5) p += vec3(-0.015, 0.9, 0.0) * (1.0 - uSnow);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = min(uSize / -mv.z, 5.0);
  vA = smoothstep(uBox * 0.5, uBox * 0.2, length(p - uCam)) * smoothstep(1.5, 4.0, -mv.z);
}`;
const PRECIP_F = `
uniform float uSnow; uniform vec3 uCol; varying float vA;
void main() {
  float a = vA;
  if (uSnow > 0.5) { vec2 q = gl_PointCoord - 0.5; a *= smoothstep(0.5, 0.2, length(q)); }
  gl_FragColor = vec4(uCol, a * mix(0.28, 0.85, uSnow));
}`;

export class Precip {
  private readonly rain: THREE.LineSegments;
  private readonly snow: THREE.Points;
  private readonly uniforms = {
    uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uBox: { value: 60 }, uSnow: { value: 0 }, uSize: { value: 0 },
    uCol: { value: new THREE.Color(0xc8d2dc) },
  };

  constructor(scene: THREE.Scene) {
    const N = DROPS, box = this.uniforms.uBox.value, rnd = () => (Math.random() - 0.5) * box;
    const lines = new Float32Array(N * 6), ends = new Float32Array(N * 2), pts = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const x = rnd(), y = rnd(), z = rnd();
      lines.set([x, y, z, x, y, z], i * 6);
      ends[i * 2 + 1] = 1;
      pts.set([rnd(), rnd(), rnd()], i * 3);
    }
    const mat = (snow: boolean) => new THREE.ShaderMaterial({ vertexShader: PRECIP_V, fragmentShader: PRECIP_F, transparent: true, depthWrite: false,
      uniforms: { ...this.uniforms, uSnow: { value: snow ? 1 : 0 }, uSize: { value: snow ? 40 : 0 } } });
    const lg = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(lines, 3)).setAttribute('aEnd', new THREE.BufferAttribute(ends, 1));
    const pg = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(pts, 3)).setAttribute('aEnd', new THREE.BufferAttribute(new Float32Array(N), 1));
    this.rain = new THREE.LineSegments(lg, mat(false));
    this.snow = new THREE.Points(pg, mat(true));
    for (const o of [this.rain, this.snow]) { o.frustumCulled = false; o.visible = false; scene.add(o); }
  }

  update(t: number, cam: THREE.Vector3, w: Weather, night: number) {
    this.uniforms.uTime.value = t;
    this.uniforms.uCam.value.copy(cam);
    this.uniforms.uCol.value.setRGB(1, 1, 1).multiplyScalar(1 - 0.75 * night);
    this.rain.visible = w.rain > 0.01;
    this.snow.visible = w.snow > 0.01;
    this.rain.geometry.setDrawRange(0, Math.round(w.rain * DROPS) * 2);
    this.snow.geometry.setDrawRange(0, Math.round(w.snow * DROPS));
  }
}
