// Prepara el relieve de la escena a partir del MDT de 5 m del IGN (servicio WCS INSPIRE).
// Uso: node tools/mdt.ts
// Salida: public/terreno.bin (Int16, centímetros sobre el NMMA) y src/scene/terreno-meta.json
//
// Malla alineada con la playa: eje u a lo largo de la orilla (rumbo 57,8°) y eje v
// perpendicular, positivo hacia el mar (rumbo 327,8°). Paso de 5 m.
// El MDT solo trae tierra emergida: la lámina de agua y la franja intermareal que estaba
// cubierta cuando se tomó el LiDAR salen como 0. Ahí el relieve se prolonga con una
// pendiente genérica (APROXIMADA, no medida) que se marca en los metadatos.

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLAYA } from '../src/config.ts';

const RAIZ = join(import.meta.dirname, '..');
const RAW = join(RAIZ, 'data', 'raw');
mkdirSync(RAW, { recursive: true });

const URL_WCS = 'https://servicios.idee.es/wcs-inspire/mdt?SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage'
  + '&COVERAGEID=Elevacion4258_5&SUBSET=Lat(43.565,43.600)&SUBSET=Long(-5.985,-5.925)&FORMAT=application/asc';
const fichero = join(RAW, 'mdt05_salinas.asc');
if (!existsSync(fichero)) {
  const r = await fetch(URL_WCS);
  if (!r.ok) throw new Error(`WCS IGN: ${r.status}`);
  writeFileSync(fichero, Buffer.from(await r.arrayBuffer()));
}

// La respuesta es multipart: cabecera MIME + rejilla ESRI ASCII.
const texto = readFileSync(fichero, 'latin1');
const cuerpo = texto.split('filename=out.asc')[1].split('--wcs')[0].trim().split('\n');
const cab: Record<string, number> = {};
for (const l of cuerpo.slice(0, 5)) { const [k, v] = l.trim().split(/\s+/); cab[k] = Number(v); }
const nc = cab.ncols, nr = cab.nrows, cs = cab.cellsize, x0 = cab.xllcorner, y0 = cab.yllcorner;
const rejilla = new Float32Array(nc * nr);
cuerpo.slice(5).forEach((l, i) => l.trim().split(/\s+/).forEach((v, j) => { rejilla[i * nc + j] = Number(v); }));

function mdt(lat: number, lon: number): number {
  // Interpolación bilineal en la rejilla geográfica.
  const c = (lon - x0) / cs - 0.5, r = nr - 1 - ((lat - y0) / cs - 0.5);
  const j = Math.floor(c), i = Math.floor(r), fx = c - j, fy = r - i;
  const g = (ii: number, jj: number) => rejilla[Math.min(nr - 1, Math.max(0, ii)) * nc + Math.min(nc - 1, Math.max(0, jj))];
  return (g(i, j) * (1 - fx) + g(i, j + 1) * fx) * (1 - fy) + (g(i + 1, j) * (1 - fx) + g(i + 1, j + 1) * fx) * fy;
}

// Escena centrada 1000 m al NE del punto oficial de la playa (zona de El Espartal, con dunas).
const CENTRO_U = 1000;
const U = { min: -600, max: 600 }, V = { min: -420, max: 380 }, PASO = 5;
const nu = (U.max - U.min) / PASO + 1, nv = (V.max - V.min) / PASO + 1;
const mLat = 110574, mLon = 111320 * Math.cos(PLAYA.lat * Math.PI / 180);
const eje = PLAYA.ejeGrados * Math.PI / 180, normal = (PLAYA.ejeGrados + 270) * Math.PI / 180;

/** Pendiente genérica bajo el último punto emergido del MDT (1:50, valor típico de playa disipativa). APROXIMADA. */
const PENDIENTE_GENERICA = 1 / 50;
const FONDO_MIN_NMMA = -9;
const UMBRAL_AGUA = 0.05; // el MDT pone 0 en el agua

const alturas = new Float32Array(nu * nv);
const medido = new Uint8Array(nu * nv);
for (let a = 0; a < nu; a++) {
  const u = CENTRO_U + U.min + a * PASO;
  // Recorre el perfil desde tierra hacia el mar.
  let ultimoV = NaN, ultimaH = NaN, enMar = false;
  for (let b = 0; b < nv; b++) {
    const v = V.min + b * PASO;
    const lat = PLAYA.lat + (u * Math.cos(eje) + v * Math.cos(normal)) / mLat;
    const lon = PLAYA.lon + (u * Math.sin(eje) + v * Math.sin(normal)) / mLon;
    const h = mdt(lat, lon);
    const k = a * nv + b;
    if (!enMar && h > UMBRAL_AGUA) {
      alturas[k] = h; medido[k] = 1; ultimoV = v; ultimaH = h;
    } else {
      enMar = true;
      const base = Number.isFinite(ultimaH) ? ultimaH : 0;
      const d = Number.isFinite(ultimoV) ? v - ultimoV : v - V.min;
      alturas[k] = Math.max(FONDO_MIN_NMMA, base - d * PENDIENTE_GENERICA);
    }
  }
}

// Suavizado 2D (tres pasadas de media móvil de 5 celdas en cada eje, ≈ gaussiana de ~10 m):
// el MDT viene redondeado a metros en muchas celdas y el corte donde empieza la pendiente
// genérica cambia de una columna a otra, lo que dibujaba una orilla en dientes de sierra.
function suavizar(origen: Float32Array, pasadas: number, radio: number): Float32Array {
  let a0 = origen;
  for (let p = 0; p < pasadas; p++) {
    const tmp = new Float32Array(a0.length), out = new Float32Array(a0.length);
    for (let a = 0; a < nu; a++) for (let b = 0; b < nv; b++) {
      let s = 0, n = 0;
      for (let d = -radio; d <= radio; d++) { const aa = a + d; if (aa >= 0 && aa < nu) { s += a0[aa * nv + b]; n++; } }
      tmp[a * nv + b] = s / n;
    }
    for (let a = 0; a < nu; a++) for (let b = 0; b < nv; b++) {
      let s = 0, n = 0;
      for (let d = -radio; d <= radio; d++) { const bb = b + d; if (bb >= 0 && bb < nv) { s += tmp[a * nv + bb]; n++; } }
      out[a * nv + b] = s / n;
    }
    a0 = out;
  }
  return a0;
}
const suave = suavizar(alturas, 3, 2);

const cm = Int16Array.from(suave, (h) => Math.round(h * 100));
mkdirSync(join(RAIZ, 'public'), { recursive: true });
writeFileSync(join(RAIZ, 'public', 'terreno.bin'), Buffer.from(cm.buffer));
const meta = {
  fuente: 'IGN, MDT05 (LiDAR PNOA) vía WCS INSPIRE: ' + URL_WCS,
  consultado: new Date().toISOString().slice(0, 10),
  referenciaVertical: 'metros sobre el NMMA (nivel medio del mar en Alicante), como el MDT del IGN',
  unidades: 'Int16 en centímetros, orden [u][v] (u a lo largo de la orilla, v hacia el mar)',
  centroU: CENTRO_U, u: U, v: V, paso: PASO, nu, nv,
  pendienteGenericaBajoAgua: PENDIENTE_GENERICA,
  medidoPorcentaje: +(100 * medido.reduce((s, x) => s + x, 0) / medido.length).toFixed(1),
  nota: 'Celdas por debajo del último punto emergido del MDT: pendiente genérica 1:50 hasta −9 m. APROXIMADO.',
};
writeFileSync(join(RAIZ, 'src', 'scene', 'terreno-meta.json'), JSON.stringify(meta, null, 1));
console.log(`terreno ${nu}×${nv}, medido ${meta.medidoPorcentaje}% de las celdas`);
