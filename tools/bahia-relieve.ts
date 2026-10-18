// Relieve de toda la bahía: tierra del MDT de 5 m del IGN + fondo marino de EMODnet.
// Uso: node tools/bahia-relieve.ts
// Salida: public/bahia/relieve.bin (Int16, cm sobre el CH de Avilés, N×N nodos, filas de norte
//         a sur, columnas de oeste a este) y src/scene/bahia-meta.json.
//
// Cada nodo lleva en su último bit si la altura es MEDIDA por el MDT (impar) o no (par).
// Eso cuesta 1 cm de precisión y ahorra un fichero de máscara.
//
// Referencias verticales:
//   MDT05 IGN: metros sobre el NMMA (Alicante). Se pasa al CH sumando NMMA_SOBRE_CH_APROX.
//   EMODnet DTM: metros respecto a la LAT, que es lo que el IHM usa como cero hidrográfico.
//
// Franja intermareal (la arena que cubre el mar y que el LiDAR no captó; EMODnet, con celdas de
// 115 m, no la resuelve): donde hay perfil de Sentinel‑2 (data/intermareal_s2.json, de
// tools/intermareal-s2.py) manda ese perfil, medido con la línea de agua. Más allá, y donde no
// hay perfil válido, junto a lo último conocido manda una pendiente genérica 1:50 y se pasa
// gradualmente a EMODnet, que manda del todo a 250 m. Eso último es APROXIMADO.
// También deja en data/raw/relieve_generico.bin el relieve sin Sentinel‑2 (referencia del ajuste).

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CENTRO, LADO, N_RELIEVE, PASO_RELIEVE, aGeo } from '../src/bahia.ts';
import { NMMA_SOBRE_CH_APROX } from '../src/config.ts';

const RAIZ = join(import.meta.dirname, '..');
const RAW = join(RAIZ, 'data', 'raw');
mkdirSync(RAW, { recursive: true });
mkdirSync(join(RAIZ, 'public', 'bahia'), { recursive: true });

// Recuadro geográfico que cubre el cuadrado local con margen.
const esq1 = aGeo(-LADO / 2 - 60, LADO / 2 + 60), esq2 = aGeo(LADO / 2 + 60, -LADO / 2 - 60);
const BB = { latMin: esq1.lat, latMax: esq2.lat, lonMin: esq1.lon, lonMax: esq2.lon };
const f6 = (v: number) => v.toFixed(6);

async function bajar(url: string, destino: string) {
  if (existsSync(destino)) return readFileSync(destino);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  const b = Buffer.from(await r.arrayBuffer());
  writeFileSync(destino, b);
  return b;
}

// ---------- MDT05 del IGN ----------
const URL_MDT = 'https://servicios.idee.es/wcs-inspire/mdt?SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage&COVERAGEID=Elevacion4258_5'
  + `&SUBSET=Lat(${f6(BB.latMin)},${f6(BB.latMax)})&SUBSET=Long(${f6(BB.lonMin)},${f6(BB.lonMax)})&FORMAT=application/asc`;
const textoMdt = (await bajar(URL_MDT, join(RAW, 'mdt05_bahia.asc'))).toString('latin1');
const cuerpo = textoMdt.split('filename=out.asc')[1].split('--wcs')[0].trim().split('\n');
const cab: Record<string, number> = {};
for (const l of cuerpo.slice(0, 5)) { const [k, v] = l.trim().split(/\s+/); cab[k] = Number(v); }
const mdt = { nc: cab.ncols, nr: cab.nrows, cs: cab.cellsize, x0: cab.xllcorner, y0: cab.yllcorner, v: new Float32Array(cab.ncols * cab.nrows) };
cuerpo.slice(5).forEach((l, i) => l.trim().split(/\s+/).forEach((v, j) => { mdt.v[i * mdt.nc + j] = Number(v); }));
console.log(`MDT05: ${mdt.nc}×${mdt.nr}, celda ${(mdt.cs * 3600).toFixed(3)}″`);

/** Bilineal en el MDT (geográficas); devuelve también si las 4 celdas son tierra medida. */
function muestraMdt(lat: number, lon: number): { h: number; medido: boolean } {
  const c = (lon - mdt.x0) / mdt.cs - 0.5, r = mdt.nr - 1 - ((lat - mdt.y0) / mdt.cs - 0.5);
  const j = Math.floor(c), i = Math.floor(r), fx = c - j, fy = r - i;
  const g = (ii: number, jj: number) => mdt.v[Math.min(mdt.nr - 1, Math.max(0, ii)) * mdt.nc + Math.min(mdt.nc - 1, Math.max(0, jj))];
  const a = g(i, j), b = g(i, j + 1), cc = g(i + 1, j), d = g(i + 1, j + 1);
  const UMBRAL_AGUA = 0.05; // el MDT pone 0 en el agua
  return { h: (a * (1 - fx) + b * fx) * (1 - fy) + (cc * (1 - fx) + d * fx) * fy, medido: Math.min(a, b, cc, d) > UMBRAL_AGUA };
}

// ---------- EMODnet DTM (TIFF float32 sin comprimir, en teselas) ----------
const URL_EMOD = 'https://ows.emodnet-bathymetry.eu/wcs?SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage&COVERAGEID=emodnet__mean'
  + `&SUBSET=Lat(${f6(BB.latMin - 0.01)},${f6(BB.latMax + 0.01)})&SUBSET=Long(${f6(BB.lonMin - 0.01)},${f6(BB.lonMax + 0.01)})&FORMAT=image/tiff`;
const tif = await bajar(URL_EMOD, join(RAW, 'emodnet_bahia.tif'));

/** Lector mínimo de GeoTIFF: cualquier orden de bytes, sin compresión, float32, en teselas o tiras. */
function leerTiff(b: Buffer) {
  const le = b.toString('latin1', 0, 2) === 'II';
  if (!le && b.toString('latin1', 0, 2) !== 'MM') throw new Error('No es un TIFF');
  const u16 = (o: number) => (le ? b.readUInt16LE(o) : b.readUInt16BE(o));
  const u32 = (o: number) => (le ? b.readUInt32LE(o) : b.readUInt32BE(o));
  const f32 = (o: number) => (le ? b.readFloatLE(o) : b.readFloatBE(o));
  const f64 = (o: number) => (le ? b.readDoubleLE(o) : b.readDoubleBE(o));
  const ifd = u32(4);
  const n = u16(ifd);
  const tags = new Map<number, number[]>();
  const tam = { 3: 2, 4: 4, 12: 8 } as Record<number, number>;
  for (let k = 0; k < n; k++) {
    const p = ifd + 2 + k * 12;
    const tag = u16(p), tipo = u16(p + 2), cuenta = u32(p + 4);
    const bytes = (tam[tipo] ?? 1) * cuenta;
    const off = bytes <= 4 ? p + 8 : u32(p + 8);
    const vals: number[] = [];
    for (let q = 0; q < cuenta; q++) {
      if (tipo === 3) vals.push(u16(off + q * 2));
      else if (tipo === 4) vals.push(u32(off + q * 4));
      else if (tipo === 12) vals.push(f64(off + q * 8));
    }
    tags.set(tag, vals);
  }
  const ancho = tags.get(256)![0], alto = tags.get(257)![0];
  if ((tags.get(259)?.[0] ?? 1) !== 1) throw new Error('TIFF comprimido: no soportado');
  if (tags.get(258)![0] !== 32 || tags.get(339)?.[0] !== 3) throw new Error('Se esperaba float32');
  const datos = new Float32Array(ancho * alto);
  if (tags.has(322)) {
    const tw = tags.get(322)![0], th = tags.get(323)![0], offs = tags.get(324)!;
    const porFila = Math.ceil(ancho / tw);
    offs.forEach((o, t) => {
      const tx = (t % porFila) * tw, ty = Math.floor(t / porFila) * th;
      for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
        if (tx + x < ancho && ty + y < alto) datos[(ty + y) * ancho + tx + x] = f32(o + (y * tw + x) * 4);
      }
    });
  } else {
    const offs = tags.get(273)!, rps = tags.get(278)![0];
    offs.forEach((o, s) => {
      for (let q = 0; q < rps * ancho && s * rps * ancho + q < datos.length; q++) datos[s * rps * ancho + q] = f32(o + q * 4);
    });
  }
  const m = tags.get(34264)!; // ModelTransformationTag
  return { ancho, alto, datos, dLon: m[0], lon0: m[3], dLat: m[5], lat0: m[7] };
}
const emod = leerTiff(tif);
console.log(`EMODnet: ${emod.ancho}×${emod.alto}, celda ${(emod.dLon * 60).toFixed(4)}′`);

function muestraEmod(lat: number, lon: number): number {
  const c = (lon - emod.lon0) / emod.dLon - 0.5, r = (lat - emod.lat0) / emod.dLat - 0.5;
  const j = Math.floor(c), i = Math.floor(r), fx = c - j, fy = r - i;
  const g = (ii: number, jj: number) => emod.datos[Math.min(emod.alto - 1, Math.max(0, ii)) * emod.ancho + Math.min(emod.ancho - 1, Math.max(0, jj))];
  return (g(i, j) * (1 - fx) + g(i, j + 1) * fx) * (1 - fy) + (g(i + 1, j) * (1 - fx) + g(i + 1, j + 1) * fx) * fy;
}

// ---------- Combinación ----------
const N = N_RELIEVE;
const alto = new Float32Array(N * N);
const medido = new Uint8Array(N * N);
for (let f = 0; f < N; f++) for (let c = 0; c < N; c++) {
  const g = aGeo(-LADO / 2 + c * PASO_RELIEVE, -LADO / 2 + f * PASO_RELIEVE);
  const m = muestraMdt(g.lat, g.lon);
  if (m.medido) { alto[f * N + c] = m.h + NMMA_SOBRE_CH_APROX; medido[f * N + c] = 1; }
}

const PENDIENTE = 1 / 50;
const TRANSICION = 250; // m desde lo último conocido hasta fiarse del todo de EMODnet

/** Completa lo que no es `conocido` (pendiente genérica desde el borde conocido más cercano y
 *  transición a EMODnet) y suaviza ligeramente lo no medido. */
function completar(conocido: Uint8Array, base: Float32Array) {
  // Distancia a lo conocido más cercano y altura de ese borde (transformada de distancia por
  // barrido en dos pasadas, métrica de chaflán 3-4 en unidades de celda).
  const INF = 1e9;
  const dist = new Float32Array(N * N).fill(INF);
  const borde = new Float32Array(N * N);
  const h = new Float32Array(base);
  for (let k = 0; k < N * N; k++) if (conocido[k]) { dist[k] = 0; borde[k] = base[k]; }
  const vec1 = [[-1, -1, 4], [-1, 0, 3], [-1, 1, 4], [0, -1, 3]];
  const vec2 = [[1, 1, 4], [1, 0, 3], [1, -1, 4], [0, 1, 3]];
  for (const [dirs, inicio, paso] of [[vec1, 0, 1], [vec2, N - 1, -1]] as const) {
    for (let f = inicio; f >= 0 && f < N; f += paso) for (let c = inicio; c >= 0 && c < N; c += paso) {
      const k = f * N + c;
      for (const [df, dc, w] of dirs) {
        const ff = f + df, cc = c + dc;
        if (ff < 0 || ff >= N || cc < 0 || cc >= N) continue;
        const kk = ff * N + cc;
        if (dist[kk] + w < dist[k]) { dist[k] = dist[kk] + w; borde[k] = borde[kk]; }
      }
    }
  }
  let usadoEmod = 0;
  for (let f = 0; f < N; f++) for (let c = 0; c < N; c++) {
    const k = f * N + c;
    if (conocido[k]) continue;
    const g = aGeo(-LADO / 2 + c * PASO_RELIEVE, -LADO / 2 + f * PASO_RELIEVE);
    const dMetros = (dist[k] / 3) * PASO_RELIEVE;
    const generica = (dist[k] >= INF ? -30 : borde[k]) - dMetros * PENDIENTE;
    const e = muestraEmod(g.lat, g.lon);
    // EMODnet positivo junto a la costa es tierra de su modelo de 115 m: no vale para el fondo.
    if (Number.isFinite(e) && e < 0) {
      // Transición suave (smoothstep) de la pendiente genérica a EMODnet entre 0 y TRANSICION m.
      const t = Math.min(1, dMetros / TRANSICION), w = t * t * (3 - 2 * t);
      h[k] = Math.max(-60, generica * (1 - w) + Math.min(e, generica) * w);
      if (w > 0.5) usadoEmod++;
    } else {
      h[k] = Math.max(-60, generica);
    }
  }
  // Suavizado ligero solo en lo no medido (la rejilla de EMODnet deja escalones de 115 m).
  const suave = new Float32Array(h);
  for (let pasada = 0; pasada < 3; pasada++) {
    const prev = new Float32Array(suave);
    for (let f = 1; f < N - 1; f++) for (let c = 1; c < N - 1; c++) {
      const k = f * N + c;
      if (medido[k]) continue;
      suave[k] = (prev[k] * 4 + prev[k - 1] + prev[k + 1] + prev[k - N] + prev[k + N]) / 8;
    }
  }
  return { suave, usadoEmod };
}

/** Int16 en cm con el bit de «medido» en la paridad. */
function aCm(suave: Float32Array) {
  const cm = new Int16Array(N * N);
  for (let k = 0; k < N * N; k++) {
    let v = Math.round(suave[k] * 100);
    if ((Math.abs(v) % 2 === 1) !== (medido[k] === 1)) v += v >= 0 ? 1 : -1;
    cm[k] = Math.max(-32767, Math.min(32767, v));
  }
  return Buffer.from(cm.buffer);
}

// 1) Relieve genérico (solo lo medido + pendiente 1:50 → EMODnet). Lo usa tools/intermareal-s2.py
//    como referencia, para que su resultado no dependa de haberlo aplicado ya.
const generico = completar(medido, alto);
writeFileSync(join(RAW, 'relieve_generico.bin'), aCm(generico.suave));

// 2) Franja intermareal medida con la línea de agua de Sentinel‑2 (data/intermareal_s2.json, de
//    tools/intermareal-s2.py). Cada perfil válido da la distancia a la que está cada cota; entre
//    dos perfiles vecinos se interpolan las curvas de nivel (misma cota en los dos) y se marca
//    como conocido cada nodo que tocan. Solo entre la arena medida y la orilla más baja observada.
interface PerfilS2 { bx: number; bz: number; nx: number; nz: number; ajuste: null | { puntos: [number, number][] } }
const RUTA_S2 = join(RAIZ, 'data', 'intermareal_s2.json');
const s2 = existsSync(RUTA_S2) ? JSON.parse(readFileSync(RUTA_S2, 'utf8')) as { perfiles: PerfilS2[]; cotaMax: number; consultado: string } : null;
const conocido = new Uint8Array(medido);
const conS2 = new Float32Array(alto);
let nodosS2 = 0;
if (s2) {
  const COTA_BASE = 3.1; // cota de la curva sobre la que se apoyan los perfiles
  /** Distancia por el perfil a la que está la cota c (puntos con d creciente y cota decreciente). */
  const distanciaA = (pts: [number, number][], c: number) => {
    for (let q = 1; q < pts.length; q++) {
      const [d0, z0] = pts[q - 1], [d1, z1] = pts[q];
      if (c <= z0 && c >= z1) return z0 === z1 ? d0 : d0 + ((z0 - c) / (z0 - z1)) * (d1 - d0);
    }
    return null;
  };
  const suma = new Float64Array(N * N), cuenta = new Uint16Array(N * N);
  const P = s2.perfiles;
  for (let i = 0; i + 1 < P.length; i++) {
    const a = P[i], b = P[i + 1];
    if (!a.ajuste || !b.ajuste) continue;
    // Donde la base se curva mucho (cabos) las normales se cruzan: ese tramo no se usa.
    if (a.nx * b.nx + a.nz * b.nz < Math.cos((30 * Math.PI) / 180)) continue;
    const pa: [number, number][] = [[0, COTA_BASE], ...a.ajuste.puntos.filter(([d, z]) => d > 0 && z < COTA_BASE)];
    const pb: [number, number][] = [[0, COTA_BASE], ...b.ajuste.puntos.filter(([d, z]) => d > 0 && z < COTA_BASE)];
    const cMin = Math.max(pa[pa.length - 1][1], pb[pb.length - 1][1]);
    for (let c = COTA_BASE; c >= cMin; c -= 0.005) {
      const da = distanciaA(pa, c), db = distanciaA(pb, c);
      if (da === null || db === null) continue;
      const xa = a.bx + da * a.nx, za = a.bz + da * a.nz, xb = b.bx + db * b.nx, zb = b.bz + db * b.nz;
      const pasos = Math.ceil(Math.hypot(xb - xa, zb - za) / 1);
      for (let s = 0; s <= pasos; s++) {
        const u = s / pasos;
        const col = Math.round((xa + (xb - xa) * u + LADO / 2) / PASO_RELIEVE), fil = Math.round((za + (zb - za) * u + LADO / 2) / PASO_RELIEVE);
        if (col < 0 || col >= N || fil < 0 || fil >= N) continue;
        const k = fil * N + col;
        if (medido[k]) continue;
        suma[k] += c; cuenta[k]++;
      }
    }
  }
  for (let k = 0; k < N * N; k++) if (cuenta[k]) { conS2[k] = suma[k] / cuenta[k]; conocido[k] = 1; nodosS2++; }
  console.log(`Sentinel‑2: ${nodosS2} nodos de la franja intermareal (${((nodosS2 * PASO_RELIEVE ** 2) / 1e4).toFixed(1)} ha)`);
} else {
  console.log('Sin data/intermareal_s2.json: la franja intermareal queda con la pendiente genérica.');
}
const { suave, usadoEmod } = s2 ? completar(conocido, conS2) : generico;
writeFileSync(join(RAIZ, 'public', 'bahia', 'relieve.bin'), aCm(suave));

const nMed = medido.reduce((s, x) => s + x, 0);
const meta = {
  centro: CENTRO, lado: LADO, paso: PASO_RELIEVE, n: N,
  formato: 'Int16 little-endian, cm sobre el CH de Avilés; filas de norte a sur, columnas de oeste a este. Altura impar = medida por el MDT, par = estimada.',
  fuentes: {
    intermareal: 'Copernicus Sentinel-2 L2A (línea de agua) + mareógrafo REDMAR Avilés: data/intermareal_s2.json',
    tierra: `IGN, MDT05 (LiDAR PNOA), WCS INSPIRE: ${URL_MDT}`,
    fondo: `EMODnet Bathymetry DTM 2024 (1/16′, referido a la LAT), WCS: ${URL_EMOD}`,
  },
  consultado: new Date().toISOString().slice(0, 10),
  nmmaSobreChAprox: +NMMA_SOBRE_CH_APROX.toFixed(4),
  pendienteGenerica: PENDIENTE,
  porcentajeMedido: +(100 * nMed / (N * N)).toFixed(1),
  porcentajeFondoEmodnet: +(100 * usadoEmod / (N * N)).toFixed(1),
  transicionMetros: TRANSICION,
  intermarealSentinel2: s2 ? { fuente: 'data/intermareal_s2.json (tools/intermareal-s2.py)', consultado: s2.consultado, hectareas: +((nodosS2 * PASO_RELIEVE ** 2) / 1e4).toFixed(1) } : null,
  nota: 'Tierra: medida (MDT05). Franja intermareal de la playa: perfil de la línea de agua de Sentinel-2 donde es válido. Resto de la franja y fondo cercano: pendiente 1:50 desde lo último conocido con transición a EMODnet (115 m) en 250 m, APROXIMADA.',
};
writeFileSync(join(RAIZ, 'src', 'scene', 'bahia-meta.json'), JSON.stringify(meta, null, 1));
console.log(`relieve ${N}×${N}: medido ${meta.porcentajeMedido}%, fondo EMODnet ${meta.porcentajeFondoEmodnet}%`);
let mn = Infinity, mx = -Infinity;
for (const v of suave) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
console.log(`alturas sobre el CH: ${mn.toFixed(1)} a ${mx.toFixed(1)} m`);
