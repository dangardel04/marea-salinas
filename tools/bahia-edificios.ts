// Edificios de la bahía en 3D a partir del Catastro (INSPIRE Buildings, partes de edificio).
// Uso: node tools/bahia-edificios.ts   (después de bahia-relieve.ts y bahia-orto.ts)
// Salida: public/bahia/edificios.bin y src/scene/bahia-edificios.json
//
// - Huella y número de plantas sobre rasante: Catastro (dato oficial).
// - Altura: plantas × ALTURA_PLANTA. SUPUESTO: 3 m por planta, valor típico, no medido.
// - Base: la cota más baja del terreno (MDT05) bajo la huella.
// - Color del tejado: media de la ortofoto PNOA dentro de la huella (real).
// - Color de fachada: neutro (decorativo; el Catastro no lo da).
//
// Formato del .bin: [Int16 x,y,z en decímetros por vértice] [Uint8 r,g,b por vértice], triángulos sueltos.

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import proj4 from 'proj4';
import earcut from 'earcut';
import { LADO, N_RELIEVE, PASO_RELIEVE, PIXELES_TESELA, aGeo, aLocal, recuadroTesela } from '../src/bahia.ts';

const RAIZ = join(import.meta.dirname, '..');
const RAW = join(RAIZ, 'data', 'raw', 'catastro');
const RGB = join(RAIZ, 'data', 'raw', 'orto-rgb');
mkdirSync(RAW, { recursive: true });
mkdirSync(RGB, { recursive: true });

const ALTURA_PLANTA = 3.0; // m, SUPUESTO
const UTM30 = '+proj=utm +zone=30 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs'; // EPSG:25830
const aUtm = (lat: number, lon: number) => proj4('EPSG:4326', UTM30, [lon, lat]) as [number, number];
const deUtm = (x: number, y: number) => { const [lon, lat] = proj4(UTM30, 'EPSG:4326', [x, y]) as [number, number]; return { lat, lon }; };

// ---------- Relieve (para la base y para saber dónde hay tierra) ----------
const N = N_RELIEVE;
const rb = readFileSync(join(RAIZ, 'public', 'bahia', 'relieve.bin'));
const rel = new Int16Array(rb.buffer, rb.byteOffset, N * N);
function cota(x: number, z: number): number {
  const c = (x + LADO / 2) / PASO_RELIEVE, f = (z + LADO / 2) / PASO_RELIEVE;
  const c0 = Math.max(0, Math.min(N - 2, Math.floor(c))), f0 = Math.max(0, Math.min(N - 2, Math.floor(f)));
  const fx = Math.min(1, Math.max(0, c - c0)), fy = Math.min(1, Math.max(0, f - f0));
  const g = (ff: number, cc: number) => rel[ff * N + cc] / 100;
  return (g(f0, c0) * (1 - fx) + g(f0, c0 + 1) * fx) * (1 - fy) + (g(f0 + 1, c0) * (1 - fx) + g(f0 + 1, c0 + 1) * fx) * fy;
}

// ---------- Descarga por cuadrículas UTM de 500 m ----------
const esqNO = aGeo(-LADO / 2, -LADO / 2), esqSE = aGeo(LADO / 2, LADO / 2);
const [xMin, yMax] = aUtm(esqNO.lat, esqNO.lon), [xMax, yMin] = aUtm(esqSE.lat, esqSE.lon);
const PASO = 500;
const celdas: [number, number][] = [];
for (let x = Math.floor(xMin / PASO) * PASO; x < xMax; x += PASO) for (let y = Math.floor(yMin / PASO) * PASO; y < yMax; y += PASO) {
  // Solo si en esa cuadrícula hay algo por encima del nivel medio del mar.
  let tierra = false;
  for (let a = 0; a <= 4 && !tierra; a++) for (let b = 0; b <= 4; b++) {
    const g = deUtm(x + (a * PASO) / 4, y + (b * PASO) / 4), l = aLocal(g.lat, g.lon);
    if (Math.abs(l.x) < LADO / 2 && Math.abs(l.z) < LADO / 2 && cota(l.x, l.z) > 3) { tierra = true; break; }
  }
  if (tierra) celdas.push([x, y]);
}
console.log(`${celdas.length} cuadrículas de 500 m con tierra`);

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
const URL_WFS = 'https://ovc.catastro.meh.es/INSPIRE/wfsBU.aspx?service=WFS&version=2.0.0&request=GetFeature&typenames=BU:BuildingPart&srsname=EPSG::25830';
let n = 0;
for (const [x, y] of celdas) {
  const f = join(RAW, `${x}_${y}.xml`);
  if (!existsSync(f)) {
    for (let intento = 1; ; intento++) {
      try {
        const r = await fetch(`${URL_WFS}&bbox=${x},${y},${x + PASO},${y + PASO}`);
        let t = Buffer.from(await r.arrayBuffer());
        // Cuadrícula sin edificios: el servicio responde con una excepción «No records founded».
        if (r.ok && t.toString('latin1').includes('No records founded')) t = Buffer.from('<gml:FeatureCollection/>');
        if (!r.ok || !t.toString('latin1', 0, 400).includes('FeatureCollection')) throw new Error(`${r.status} ${x},${y}: ${t.toString('latin1', 0, 300)}`);
        writeFileSync(f, t);
        break;
      } catch (e) {
        if (intento >= 5) throw e;
        await espera(3000 * intento);
      }
    }
    await espera(300);
  }
  if (++n % 10 === 0) process.stdout.write(`\rCatastro ${n}/${celdas.length}   `);
}
process.stdout.write('\n');

// ---------- Lectura ----------
interface Parte { id: string; plantas: number; anillos: number[][] } // anillos en UTM [x0,y0,x1,y1,...]
const partes = new Map<string, Parte>();
for (const [x, y] of celdas) {
  const xml = readFileSync(join(RAW, `${x}_${y}.xml`), 'latin1');
  for (const bloque of xml.split('<bu-ext2d:BuildingPart ').slice(1)) {
    const id = /gml:id="([^"]+)"/.exec(bloque)?.[1];
    const plantas = Number(/numberOfFloorsAboveGround>(\d+)</.exec(bloque)?.[1] ?? 0);
    if (!id || partes.has(id) || plantas <= 0) continue;
    const anillos: number[][] = [];
    const exterior = /<gml:exterior>([\s\S]*?)<\/gml:exterior>/.exec(bloque)?.[1];
    if (!exterior) continue;
    for (const trozo of [exterior, ...[...bloque.matchAll(/<gml:interior>([\s\S]*?)<\/gml:interior>/g)].map((m) => m[1])]) {
      const pl = /<gml:posList[^>]*>([^<]+)</.exec(trozo)?.[1];
      if (pl) anillos.push(pl.trim().split(/\s+/).map(Number));
    }
    partes.set(id, { id, plantas, anillos });
  }
}
console.log(`${partes.size} partes de edificio con plantas sobre rasante`);

// ---------- Ortofoto decodificada (nivel 4) para el color de los tejados ----------
const NIVEL_COLOR = 4;
const cacheRgb = new Map<string, Buffer | null>();
function rgbTesela(i: number, j: number): Buffer | null {
  const k = `${i}_${j}`;
  if (cacheRgb.has(k)) return cacheRgb.get(k)!;
  const jpg = join(RAIZ, 'public', 'bahia', 'orto', String(NIVEL_COLOR), `${k}.jpg`);
  let buf: Buffer | null = null;
  if (existsSync(jpg)) {
    const raw = join(RGB, `${NIVEL_COLOR}_${k}.rgb`);
    if (!existsSync(raw)) execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', jpg, '-f', 'rawvideo', '-pix_fmt', 'rgb24', raw]);
    buf = readFileSync(raw);
  }
  cacheRgb.set(k, buf);
  return buf;
}
function colorOrto(x: number, z: number): [number, number, number] | null {
  const lado = LADO / 2 ** NIVEL_COLOR;
  const i = Math.floor((x + LADO / 2) / lado), j = Math.floor((z + LADO / 2) / lado);
  const buf = rgbTesela(i, j);
  if (!buf) return null;
  const r = recuadroTesela(NIVEL_COLOR, i, j);
  const px = Math.min(PIXELES_TESELA - 1, Math.floor(((x - r.x0) / lado) * PIXELES_TESELA));
  const py = Math.min(PIXELES_TESELA - 1, Math.floor(((z - r.z0) / lado) * PIXELES_TESELA));
  const o = (py * PIXELES_TESELA + px) * 3;
  return [buf[o], buf[o + 1], buf[o + 2]];
}
function dentro(px: number, pz: number, anillo: number[]): boolean {
  let d = false;
  for (let a = 0, b = anillo.length / 2 - 1; a < anillo.length / 2; b = a++) {
    const xa = anillo[a * 2], za = anillo[a * 2 + 1], xb = anillo[b * 2], zb = anillo[b * 2 + 1];
    if ((za > pz) !== (zb > pz) && px < ((xb - xa) * (pz - za)) / (zb - za) + xa) d = !d;
  }
  return d;
}

// ---------- Geometría ----------
const pos: number[] = [];
const col: number[] = [];
const FACHADA: [number, number, number] = [222, 216, 204];
let usados = 0, sinColor = 0;
const vert = (x: number, y: number, z: number, c: [number, number, number]) => {
  pos.push(Math.round(x * 10), Math.round(y * 10), Math.round(z * 10));
  col.push(c[0], c[1], c[2]);
};

for (const p of partes.values()) {
  // A coordenadas locales (x este, z sur), quitando el punto de cierre repetido.
  const anillos = p.anillos.map((a) => {
    const l: number[] = [];
    for (let k = 0; k < a.length; k += 2) { const g = deUtm(a[k], a[k + 1]); const q = aLocal(g.lat, g.lon); l.push(q.x, q.z); }
    if (l.length >= 4 && l[0] === l[l.length - 2] && l[1] === l[l.length - 1]) l.splice(-2, 2);
    return l;
  }).filter((l) => l.length >= 6);
  if (!anillos.length) continue;
  const ext = anillos[0];
  if (ext.some((v) => Math.abs(v) > LADO / 2 - 5)) continue;

  let base = Infinity, sx = 0, sz = 0;
  for (let k = 0; k < ext.length; k += 2) { base = Math.min(base, cota(ext[k], ext[k + 1])); sx += ext[k]; sz += ext[k + 1]; }
  const techo = base + p.plantas * ALTURA_PLANTA;

  // Color medio del tejado: rejilla de puntos dentro de la huella.
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let k = 0; k < ext.length; k += 2) { minX = Math.min(minX, ext[k]); maxX = Math.max(maxX, ext[k]); minZ = Math.min(minZ, ext[k + 1]); maxZ = Math.max(maxZ, ext[k + 1]); }
  let cr = 0, cg = 0, cb = 0, nc = 0;
  for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) {
    const x = minX + ((a + 0.5) / 6) * (maxX - minX), z = minZ + ((b + 0.5) / 6) * (maxZ - minZ);
    if (!dentro(x, z, ext) || anillos.slice(1).some((h) => dentro(x, z, h))) continue;
    const c = colorOrto(x, z);
    if (c) { cr += c[0]; cg += c[1]; cb += c[2]; nc++; }
  }
  if (!nc) { const c = colorOrto(sx / (ext.length / 2), sz / (ext.length / 2)); if (c) { [cr, cg, cb] = c; nc = 1; } }
  const tejado: [number, number, number] = nc ? [cr / nc, cg / nc, cb / nc].map(Math.round) as [number, number, number] : [150, 140, 130];
  if (!nc) sinColor++;

  // Tejado plano (earcut con patios).
  const plano: number[] = [], huecos: number[] = [];
  anillos.forEach((a, k) => { if (k) huecos.push(plano.length / 2); plano.push(...a); });
  const tri = earcut(plano, huecos.length ? huecos : undefined, 2);
  for (let k = 0; k < tri.length; k += 3) {
    // Orden para que la normal apunte hacia arriba (y); comprobado con el signo del área.
    const [a, b, c] = [tri[k], tri[k + 1], tri[k + 2]];
    const cruz = (plano[b * 2] - plano[a * 2]) * (plano[c * 2 + 1] - plano[a * 2 + 1]) - (plano[b * 2 + 1] - plano[a * 2 + 1]) * (plano[c * 2] - plano[a * 2]);
    const orden = cruz > 0 ? [a, c, b] : [a, b, c];
    for (const v of orden) vert(plano[v * 2], techo, plano[v * 2 + 1], tejado);
  }
  // Fachadas: un cuadrilátero por lado de cada anillo, hundido 1 m bajo la base para tapar huecos con el terreno.
  for (const a of anillos) {
    const m = a.length / 2;
    for (let k = 0; k < m; k++) {
      const x1 = a[k * 2], z1 = a[k * 2 + 1], x2 = a[((k + 1) % m) * 2], z2 = a[((k + 1) % m) * 2 + 1];
      const y0 = base - 1;
      // Una sola cara: la web dibuja las fachadas por los dos lados (el sentido de los anillos del
      // Catastro no se garantiza) y da la vuelta a la normal en la cara de atrás.
      vert(x1, y0, z1, FACHADA); vert(x2, y0, z2, FACHADA); vert(x2, techo, z2, FACHADA);
      vert(x1, y0, z1, FACHADA); vert(x2, techo, z2, FACHADA); vert(x1, techo, z1, FACHADA);
    }
  }
  usados++;
}

const nv = pos.length / 3;
const salida = Buffer.alloc(nv * 6 + nv * 3);
Buffer.from(Int16Array.from(pos).buffer).copy(salida, 0);
Buffer.from(Uint8Array.from(col).buffer).copy(salida, nv * 6);
writeFileSync(join(RAIZ, 'public', 'bahia', 'edificios.bin'), salida);
writeFileSync(join(RAIZ, 'src', 'scene', 'bahia-edificios.json'), JSON.stringify({
  fuente: `Dirección General del Catastro, INSPIRE Buildings (BU:BuildingPart): ${URL_WFS}`,
  consultado: new Date().toISOString().slice(0, 10),
  partes: usados, vertices: nv, alturaPlantaSupuesta: ALTURA_PLANTA, sinColorDeOrtofoto: sinColor,
  formato: 'Int16 x,y,z (dm, local) por vértice y después Uint8 r,g,b por vértice; triángulos sueltos',
}, null, 1));
console.log(`${usados} partes → ${nv} vértices (${(salida.length / 1e6).toFixed(1)} MB), ${sinColor} sin color de ortofoto`);
