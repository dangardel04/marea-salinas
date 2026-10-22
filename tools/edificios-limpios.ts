// Edificios de Salinas como volúmenes limpios: la huella del Catastro, las alturas medidas en el LiDAR
// y un tejado recto (plano o a cuatro aguas), en vez de la malla del tejado sacada de la nube, que
// con su ruido se veía «derretida».
// Uso: node tools/edificios-limpios.ts   (después de tools/edificios-lidar.py)
// Entrada: public/bahia/edificios-lidar.bin (de tools/edificios-lidar.py: tejados y suelo medidos
//          en la nube LiDAR PNOA 2024) y data/edificios_lidar_ids.json (qué partes del Catastro).
// Salida:  public/bahia/edificios-limpios.bin y src/scene/bahia-edificios-limpios.json.
//
// Por cada parte de edificio del Catastro (huella oficial; si no está bajada, se baja del WFS):
//   - Suelo: lo más bajo de la malla LiDAR junto al borde de la huella (pie de las fachadas, MEDIDO).
//   - Alero: percentil 25 de la cota del tejado LiDAR a menos de 1,5 m del borde (MEDIDO).
//   - Cumbre: percentil 95 de la cota del tejado LiDAR dentro de la huella (MEDIDO).
//   - Forma: si la cota del tejado crece hacia el interior (correlación con la distancia al borde
//     ≥ 0,55) y la cumbre está más de 1 m sobre el alero, a cuatro aguas con el esqueleto recto de
//     la huella y la pendiente ajustada a los puntos; si no, plano con un pretil de 0,4 m. La forma
//     a cuatro aguas es una SIMPLIFICACIÓN ELEGIDA (también se aplica a los tejados a dos aguas).
//   - Color del tejado: media del color de la nube en el tejado (MEDIDO); fachada: paleta clara
//     según la parte (DECORATIVO, la nube no la ve).
//   - Plantas: Catastro (numberOfFloorsAboveGround); la altura de planta = (alero − suelo) / plantas.
//
// Formato del .bin (triángulos sueltos), por vértice: Int16 x,y,z (dm, local), Int16 u (dm a lo largo
// del tramo de fachada), Int16 v (dm sobre el suelo), Int16 largo del tramo (dm); después Uint8 r,g,b,
// tipo (0 fachada, 1 tejado, 2 pretil), altura de planta (dm), plantas.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import proj4 from 'proj4';
import earcut from 'earcut';
import pkgEsqueleto from 'straight-skeleton';
import { LADO, N_RELIEVE, PASO_RELIEVE, aLocal } from '../src/bahia.ts';
import metaLidar from '../src/scene/bahia-edificios-lidar.json' with { type: 'json' };

const SkeletonBuilder = (pkgEsqueleto as unknown as { SkeletonBuilder: { BuildFromGeoJSON(p: number[][][][]): { Edges: { Polygon: { X: number; Y: number }[] }[]; Distances: Map<unknown, number> } } }).SkeletonBuilder;
const RAIZ = join(import.meta.dirname, '..');
const RAW = join(RAIZ, 'data', 'raw', 'catastro');
mkdirSync(RAW, { recursive: true });
const UTM30 = '+proj=utm +zone=30 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs'; // EPSG:25830
const deUtm = (x: number, y: number) => { const [lon, lat] = proj4(UTM30, 'EPSG:4326', [x, y]) as [number, number]; return { lat, lon }; };
const FACHADAS: [number, number, number][] = [[236, 233, 226], [234, 226, 208], [214, 214, 209], [229, 214, 186], [240, 238, 232]];

// ---------- Relieve (si la malla LiDAR no da el suelo) ----------
const rb = readFileSync(join(RAIZ, 'public', 'bahia', 'relieve.bin'));
const rel = new Int16Array(rb.buffer, rb.byteOffset, N_RELIEVE * N_RELIEVE);
function cota(x: number, z: number): number {
  const N = N_RELIEVE, c = (x + LADO / 2) / PASO_RELIEVE, f = (z + LADO / 2) / PASO_RELIEVE;
  const c0 = Math.max(0, Math.min(N - 2, Math.floor(c))), f0 = Math.max(0, Math.min(N - 2, Math.floor(f)));
  const fx = Math.min(1, Math.max(0, c - c0)), fy = Math.min(1, Math.max(0, f - f0));
  const g = (ff: number, cc: number) => rel[ff * N + cc] / 100;
  return (g(f0, c0) * (1 - fx) + g(f0, c0 + 1) * fx) * (1 - fy) + (g(f0 + 1, c0) * (1 - fx) + g(f0 + 1, c0 + 1) * fx) * fy;
}

// ---------- Malla LiDAR (medidas) ----------
const bl = readFileSync(join(RAIZ, 'public', 'bahia', 'edificios-lidar.bin'));
const nv = metaLidar.vertices;
const lp = new Int16Array(bl.buffer, bl.byteOffset, nv * 3);
const lc = new Uint8Array(bl.buffer, bl.byteOffset + nv * 6, nv * 3);
const CEL = 4;
const rejilla = new Map<string, number[]>();
for (let k = 0; k < nv; k++) {
  const c = `${Math.floor(lp[k * 3] / 10 / CEL)},${Math.floor(lp[k * 3 + 2] / 10 / CEL)}`;
  (rejilla.get(c) ?? rejilla.set(c, []).get(c)!).push(k);
}

// ---------- Catastro ----------
const ids: string[] = JSON.parse(readFileSync(join(RAIZ, 'data', 'edificios_lidar_ids.json'), 'utf8'));
const buscados = new Set(ids);
const URL_WFS = 'https://ovc.catastro.meh.es/INSPIRE/wfsBU.aspx?service=WFS&version=2.0.0&request=GetFeature&typenames=BU:BuildingPart&srsname=EPSG::25830';
const ZONA = [260400, 4828000, 262400, 4829900];   // la de tools/edificios-lidar.py (UTM 30N)
const PASO = 500;
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ficheros: string[] = [];
for (let x = Math.floor(ZONA[0] / PASO) * PASO; x < ZONA[2]; x += PASO) for (let y = Math.floor(ZONA[1] / PASO) * PASO; y < ZONA[3]; y += PASO) {
  const f = join(RAW, `${x}_${y}.xml`);
  if (!existsSync(f)) {
    for (let intento = 1; ; intento++) {
      try {
        const r = await fetch(`${URL_WFS}&bbox=${x},${y},${x + PASO},${y + PASO}`);
        let t = Buffer.from(await r.arrayBuffer());
        if (r.ok && t.toString('latin1').includes('No records founded')) t = Buffer.from('<gml:FeatureCollection/>');
        if (!r.ok || !t.toString('latin1', 0, 400).includes('FeatureCollection')) throw new Error(`${r.status} ${x},${y}`);
        writeFileSync(f, t);
        break;
      } catch (e) {
        if (intento >= 5) throw e;
        await espera(3000 * intento);
      }
    }
    await espera(300);
  }
  ficheros.push(f);
}
interface Parte { id: string; plantas: number; anillos: number[][] }   // anillos en local [x0,z0,x1,z1,...]
const partes = new Map<string, Parte>();
for (const f of ficheros) {
  const xml = readFileSync(f, 'latin1');
  for (const bloque of xml.split('<bu-ext2d:BuildingPart ').slice(1)) {
    const id = /gml:id="([^"]+)"/.exec(bloque)?.[1];
    if (!id || !buscados.has(id) || partes.has(id)) continue;
    const plantas = Number(/numberOfFloorsAboveGround>(\d+)</.exec(bloque)?.[1] ?? 0);
    const exterior = /<gml:exterior>([\s\S]*?)<\/gml:exterior>/.exec(bloque)?.[1];
    if (!exterior) continue;
    const anillos: number[][] = [];
    for (const trozo of [exterior, ...[...bloque.matchAll(/<gml:interior>([\s\S]*?)<\/gml:interior>/g)].map((m) => m[1])]) {
      const pl = /<gml:posList[^>]*>([^<]+)</.exec(trozo)?.[1];
      if (!pl) continue;
      const v = pl.trim().split(/\s+/).map(Number), l: number[] = [];
      for (let k = 0; k < v.length; k += 2) { const g = deUtm(v[k], v[k + 1]); const q = aLocal(g.lat, g.lon); l.push(q.x, q.z); }
      anillos.push(limpiar(l));
    }
    if (anillos[0]?.length >= 6) partes.set(id, { id, plantas, anillos: anillos.filter((a) => a.length >= 6) });
  }
}
console.log(`${partes.size} de ${ids.length} partes encontradas en el Catastro`);

/** Quita el punto de cierre, los repetidos (< 5 cm) y los alineados (el esqueleto los lleva mal). */
function limpiar(l: number[]): number[] {
  if (l.length >= 4 && Math.hypot(l[0] - l[l.length - 2], l[1] - l[l.length - 1]) < 0.05) l = l.slice(0, -2);
  let p: [number, number][] = [];
  for (let k = 0; k < l.length; k += 2) { const q: [number, number] = [l[k], l[k + 1]]; if (!p.length || Math.hypot(q[0] - p[p.length - 1][0], q[1] - p[p.length - 1][1]) > 0.05) p.push(q); }
  for (let cambio = true; cambio && p.length > 3;) {
    cambio = false;
    for (let k = 0; k < p.length; k++) {
      const a = p[(k - 1 + p.length) % p.length], b = p[k], c = p[(k + 1) % p.length];
      const cruz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (Math.abs(cruz) < 0.02 * Math.hypot(c[0] - a[0], c[1] - a[1])) { p.splice(k, 1); cambio = true; break; }
    }
  }
  return p.flat();
}
function dentro(px: number, pz: number, a: number[]): boolean {
  let d = false;
  for (let i = 0, j = a.length / 2 - 1; i < a.length / 2; j = i++) {
    const xi = a[i * 2], zi = a[i * 2 + 1], xj = a[j * 2], zj = a[j * 2 + 1];
    if ((zi > pz) !== (zj > pz) && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) d = !d;
  }
  return d;
}
function distBorde(px: number, pz: number, anillos: number[][]): number {
  let m = Infinity;
  for (const a of anillos) for (let i = 0, n = a.length / 2; i < n; i++) {
    const ax = a[i * 2], az = a[i * 2 + 1], bx = a[((i + 1) % n) * 2], bz = a[((i + 1) % n) * 2 + 1];
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L2));
    m = Math.min(m, Math.hypot(px - ax - dx * t, pz - az - dz * t));
  }
  return m;
}
const percentil = (v: number[], p: number) => { const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]; };
const area = (a: number[]) => { let s = 0; for (let i = 0, n = a.length / 2; i < n; i++) s += a[i * 2] * a[((i + 1) % n) * 2 + 1] - a[((i + 1) % n) * 2] * a[i * 2 + 1]; return s / 2; };
const hash = (s: string) => { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };

// ---------- Geometría ----------
const I16: number[] = [], U8: number[] = [];
const vert = (x: number, y: number, z: number, u: number, v: number, largo: number, c: number[], tipo: number, planta: number, plantas: number) => {
  I16.push(Math.round(x * 10), Math.round(y * 10), Math.round(z * 10), Math.round(u * 10), Math.round(v * 10), Math.round(largo * 10));
  U8.push(c[0], c[1], c[2], tipo, Math.min(255, Math.round(planta * 10)), Math.min(255, plantas));
};
const quad = (a: number[], b: number[], c: number[], d: number[], ua: number[], ub: number[], uc: number[], ud: number[], largo: number, col: number[], tipo: number, planta: number, plantas: number) => {
  for (const [p, q] of [[a, ua], [b, ub], [c, uc], [a, ua], [c, uc], [d, ud]]) vert(p[0], p[1], p[2], q[0], q[1], largo, col, tipo, planta, plantas);
};
const estad: number[][] = [];
let aguas = 0, planos = 0, sinNube = 0, fallos = 0, recortadas = 0;

// ---------- Primera pasada: medidas de cada parte ----------
interface Medida { p: Parte; suelo: number; alero: number; cumbre: number; color: number[]; fachada: number[]; plantas: number; planta: number; aCuatro: boolean; caja: number[] }
const medidas: Medida[] = [];
for (const p of partes.values()) {
  const ext = p.anillos[0];
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let k = 0; k < ext.length; k += 2) { x0 = Math.min(x0, ext[k]); x1 = Math.max(x1, ext[k]); z0 = Math.min(z0, ext[k + 1]); z1 = Math.max(z1, ext[k + 1]); }
  // vértices LiDAR dentro de la huella (o en su borde)
  const cand: { y: number; d: number; k: number }[] = [];
  for (let i = Math.floor((x0 - 1) / CEL); i <= Math.floor((x1 + 1) / CEL); i++) for (let j = Math.floor((z0 - 1) / CEL); j <= Math.floor((z1 + 1) / CEL); j++) {
    for (const k of rejilla.get(`${i},${j}`) ?? []) {
      const x = lp[k * 3] / 10, z = lp[k * 3 + 2] / 10;
      const d = distBorde(x, z, p.anillos);
      const enHueco = p.anillos.slice(1).some((h) => dentro(x, z, h));
      if ((dentro(x, z, ext) && !enHueco) || d < 0.3) cand.push({ y: lp[k * 3 + 1] / 10, d: dentro(x, z, ext) && !enHueco ? d : 0, k });
    }
  }
  // fuera del recorte de la malla LiDAR (más de 390 m de la playa): no se dibujaba, no se dibuja
  if (!cand.length) { recortadas++; continue; }
  const borde = cand.filter((c) => c.d < 0.3);
  const suelo = borde.length ? Math.min(...borde.map((c) => c.y)) : Math.min(...Array.from({ length: ext.length / 2 }, (_, k) => cota(ext[k * 2], ext[k * 2 + 1])));
  const tejado = cand.filter((c) => c.y > suelo + 1.5);
  const fachada = FACHADAS[hash(p.id) % FACHADAS.length];
  let alero: number, cumbre: number, color: number[];
  if (tejado.length < 4) {
    // sin nube suficiente: plantas × 3 m (SUPUESTO, como las cajas del Catastro)
    sinNube++;
    if (process.env.DEPURAR && sinNube < 8) console.log('sin nube', p.id, x0.toFixed(1), z0.toFixed(1), x1.toFixed(1), z1.toFixed(1), 'cand', cand.length, 'suelo', suelo.toFixed(1), 'ys', cand.slice(0, 8).map((c) => c.y.toFixed(1) + '@' + c.d.toFixed(1)).join(' '));
    alero = cumbre = suelo + Math.max(1, p.plantas) * 3;
    color = [150, 140, 130];
  } else {
    const cerca = tejado.filter((c) => c.d < 1.5);
    alero = percentil((cerca.length >= 3 ? cerca : tejado).map((c) => c.y), 0.25);
    cumbre = percentil(tejado.map((c) => c.y), 0.95);
    color = [0, 1, 2].map((q) => Math.round(tejado.reduce((s, c) => s + lc[c.k * 3 + q], 0) / tejado.length));
  }
  const plantas = Math.max(1, p.plantas);

  // ¿A cuatro aguas? Si el tejado no es llano (de p10 a p90 más de 1,2 m), la cota tiende a subir hacia
  // dentro (correlación con la distancia al borde > 0,2) y no son alturas muy distintas (< 6 m, que
  // sería un edificio escalonado: se deja plano a su altura más común).
  let aCuatro = false;
  if (tejado.length >= 8) {
    const ys = tejado.map((c) => c.y), extension = percentil(ys, 0.9) - percentil(ys, 0.1);
    const n = tejado.length, md = tejado.reduce((s, c) => s + c.d, 0) / n, my = ys.reduce((s, y) => s + y, 0) / n;
    let sxy = 0, sxx = 0, syy = 0;
    for (const c of tejado) { sxy += (c.d - md) * (c.y - my); sxx += (c.d - md) ** 2; syy += (c.y - my) ** 2; }
    const r = sxy / Math.sqrt(sxx * syy || 1);
    if (process.env.DEPURAR) estad.push([r, extension, cumbre - alero, n]);
    aCuatro = extension > 1.2 && extension < 6 && r > 0.2;
    if (!aCuatro) alero = extension < 6 ? percentil(ys, 0.5) : percentil(ys, 0.6);
  }
  const planta = (alero - suelo) / plantas;
  medidas.push({ p, suelo, alero, cumbre, color, fachada, plantas, planta, aCuatro, caja: [x0, z0, x1, z1] });
}

// Partes vecinas (comparten pared): la pared común solo se dibuja por encima de la más baja; si no,
// las dos fachadas quedan en el mismo plano y se pisan (ventanas con ruido).
const CEL_P = 20;
const indiceP = new Map<string, number[]>();
medidas.forEach((m, k) => {
  for (let i = Math.floor(m.caja[0] / CEL_P); i <= Math.floor(m.caja[2] / CEL_P); i++) for (let j = Math.floor(m.caja[1] / CEL_P); j <= Math.floor(m.caja[3] / CEL_P); j++) {
    const c = `${i},${j}`; (indiceP.get(c) ?? indiceP.set(c, []).get(c)!).push(k);
  }
});
const enParte = (m: Medida, x: number, z: number) => dentro(x, z, m.p.anillos[0]) && !m.p.anillos.slice(1).some((h) => dentro(x, z, h));
const arriba = (m: Medida) => (m.aCuatro ? m.alero : m.alero + 0.4);
/** Lo más alto de las otras partes en (x, z), o −∞ si no hay ninguna. */
function vecino(k: number, x: number, z: number): number {
  let h = -Infinity;
  for (const o of indiceP.get(`${Math.floor(x / CEL_P)},${Math.floor(z / CEL_P)}`) ?? []) if (o !== k && enParte(medidas[o], x, z)) h = Math.max(h, arriba(medidas[o]));
  return h;
}

// ---------- Segunda pasada: geometría ----------
medidas.forEach((m, kParte) => {
  const { p, suelo, alero, cumbre, color, fachada, plantas, planta, aCuatro } = m;

  // Fachadas (un cuadrilátero por lado, de 1 m bajo el suelo hasta el alero; con pretil si es plano)
  const altoFachada = aCuatro ? alero : alero + 0.4;
  for (const a of p.anillos) {
    const n = a.length / 2;
    for (let i = 0; i < n; i++) {
      const ax = a[i * 2], az = a[i * 2 + 1], bx = a[((i + 1) % n) * 2], bz = a[((i + 1) % n) * 2 + 1];
      const L = Math.hypot(bx - ax, bz - az);
      // lo que hay al otro lado de la pared (a 0,3 m hacia fuera)
      let ox = -(bz - az) / L, oz = (bx - ax) / L;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      if (enParte(m, mx + ox * 0.3, mz + oz * 0.3)) { ox = -ox; oz = -oz; }
      const otro = vecino(kParte, mx + ox * 0.3, mz + oz * 0.3);
      if (otro >= altoFachada - 0.05) continue;
      const desde = Math.max(suelo - 1, otro);
      quad([ax, desde, az], [bx, desde, bz], [bx, altoFachada, bz], [ax, altoFachada, az],
        [0, desde - suelo], [L, desde - suelo], [L, altoFachada - suelo], [0, altoFachada - suelo], L, fachada, 0, planta, plantas);
    }
  }

  // Tejado
  let hecho = false;
  if (aCuatro) {
    try {
      // El esqueleto quiere el exterior en un sentido y los patios en el otro (en x, −z: ejes matemáticos).
      const anillosG = p.anillos.map((a, i) => {
        const pts: [number, number][] = [];
        for (let q = 0; q < a.length; q += 2) pts.push([a[q], -a[q + 1]]);
        const s = area(pts.flat());
        if ((i === 0 && s < 0) || (i > 0 && s > 0)) pts.reverse();
        return pts;
      });
      const sk = SkeletonBuilder.BuildFromGeoJSON([anillosG]);
      let tMax = 0;
      for (const v of sk.Distances.values()) tMax = Math.max(tMax, v);
      // pendiente: la de los puntos, sin pasarse de la cumbre medida (y entre 12° y 50°)
      // pendiente para llegar a la cumbre medida, entre 12° y 50°
      const pend = Math.min(Math.max(tMax > 0 ? (cumbre - alero) / tMax : 0.5, Math.tan((12 * Math.PI) / 180)), Math.tan((50 * Math.PI) / 180));
      for (const e of sk.Edges) {
        const pts = e.Polygon.map((v) => [v.X, alero + (sk.Distances.get(v) ?? 0) * pend, -v.Y]);
        const tri = earcut(pts.flatMap((q) => [q[0], q[2]]));
        for (let q = 0; q < tri.length; q += 3) {
          const [A, B, C] = [pts[tri[q]], pts[tri[q + 1]], pts[tri[q + 2]]];
          const cr = (B[0] - A[0]) * (C[2] - A[2]) - (B[2] - A[2]) * (C[0] - A[0]);
          for (const P of cr > 0 ? [A, C, B] : [A, B, C]) vert(P[0], P[1], P[2], P[0], P[2], 0, color, 1, planta, plantas);
        }
      }
      hecho = true; aguas++;
    } catch { fallos++; }
  }
  if (!hecho) {
    planos++;
    const plano: number[] = [], huecos: number[] = [];
    p.anillos.forEach((a, i) => { if (i) huecos.push(plano.length / 2); plano.push(...a); });
    const tri = earcut(plano, huecos.length ? huecos : undefined, 2);
    for (let q = 0; q < tri.length; q += 3) {
      const [a, b, c] = [tri[q], tri[q + 1], tri[q + 2]];
      const cr = (plano[b * 2] - plano[a * 2]) * (plano[c * 2 + 1] - plano[a * 2 + 1]) - (plano[b * 2 + 1] - plano[a * 2 + 1]) * (plano[c * 2] - plano[a * 2]);
      for (const v of cr > 0 ? [a, c, b] : [a, b, c]) vert(plano[v * 2], alero, plano[v * 2 + 1], plano[v * 2], plano[v * 2 + 1], 0, color, 1, planta, plantas);
    }
    // cara de dentro del pretil (0,4 m), 0,2 m hacia dentro, y su remate
    for (const a of p.anillos) {
      const n = a.length / 2, s = Math.sign(area(a)) || 1;
      for (let i = 0; i < n; i++) {
        const ax = a[i * 2], az = a[i * 2 + 1], bx = a[((i + 1) % n) * 2], bz = a[((i + 1) % n) * 2 + 1];
        const L = Math.hypot(bx - ax, bz - az) || 1, nx = (-(bz - az) / L) * s * 0.2, nz = ((bx - ax) / L) * s * 0.2;
        quad([ax + nx, alero, az + nz], [bx + nx, alero, bz + nz], [bx + nx, alero + 0.4, bz + nz], [ax + nx, alero + 0.4, az + nz], [0, 0], [L, 0], [L, 0.4], [0, 0.4], L, fachada, 2, planta, plantas);
        quad([ax, alero + 0.4, az], [bx, alero + 0.4, bz], [bx + nx, alero + 0.4, bz + nz], [ax + nx, alero + 0.4, az + nz], [0, 0], [L, 0], [L, 0.2], [0, 0.2], L, fachada, 2, planta, plantas);
      }
    }
  }
});

if (process.env.DEPURAR) { const h = new Array(10).fill(0); for (const e of estad) h[Math.max(0, Math.min(9, Math.floor((e[0] + 1) * 5)))]++; console.log('r -1..1', h.join(' '), 'n', estad.length); console.log(estad.slice(0, 15).map((e) => e.map((v) => v.toFixed(2)).join('/')).join('  ')); }
const n = I16.length / 6;
const tamI = n * 12, salida = Buffer.alloc(tamI + n * 6);
Buffer.from(Int16Array.from(I16).buffer).copy(salida, 0);
Buffer.from(Uint8Array.from(U8).buffer).copy(salida, tamI);
writeFileSync(join(RAIZ, 'public', 'bahia', 'edificios-limpios.bin'), salida);
writeFileSync(join(RAIZ, 'src', 'scene', 'bahia-edificios-limpios.json'), JSON.stringify({
  fuente: `Huellas y plantas: Catastro (INSPIRE BuildingPart, ${URL_WFS}). Suelo, alero, cumbre y color del tejado: medidos en la malla de tools/edificios-lidar.py (LiDAR PNOA 2024, CNIG, CC BY 4.0). Ver tools/edificios-limpios.ts`,
  consultado: new Date().toISOString().slice(0, 10),
  partes: medidas.length, aCuatroAguas: aguas, planos, sinNube, esqueletoFallido: fallos, vertices: n,
  formato: 'Int16 x,y,z,u,v,largo (dm) por vértice; después Uint8 r,g,b,tipo,alturaPlanta(dm),plantas; triángulos sueltos',
  decorativo: 'Forma a cuatro aguas (simplificación elegida), pretil de 0,4 m de los tejados planos y color de fachada',
}, null, 1));
console.log(`${partes.size} partes (${recortadas} fuera del recorte): ${aguas} a cuatro aguas, ${planos} planos (${fallos} sin esqueleto), ${sinNube} sin nube; ${n} vértices, ${(salida.length / 1e6).toFixed(1)} MB`);
