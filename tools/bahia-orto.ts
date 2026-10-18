// Pirámide de teselas de la ortofoto PNOA (IGN) para la escena de la bahía.
// Uso: node tools/bahia-orto.ts   (después de tools/bahia-relieve.ts)
// Salida: public/bahia/orto/<nivel>/<i>_<j>.jpg (512×512) y src/scene/bahia-orto.json (índice).
//
// Niveles 0-3: todas las teselas. Niveles 4 y 5: solo las que tienen tierra o zona intermareal
// (algún nodo del relieve por encima de −2 m sobre el CH); el mar abierto lo pinta el agua.
// Resolución: nivel 0 = 12,5 m/píxel … nivel 5 = 0,39 m/píxel. Siempre por encima de la escala
// 1:70 000 a la que el servicio cambia de PNOA a Sentinel-2.

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LADO, N_RELIEVE, NIVEL_MAX_ORTO, PIXELES_TESELA, aGeo, recuadroTesela } from '../src/bahia.ts';

const RAIZ = join(import.meta.dirname, '..');
const DEST = join(RAIZ, 'public', 'bahia', 'orto');
const WMS = 'https://www.ign.es/wms-inspire/pnoa-ma?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=OI.OrthoimageCoverage&STYLES=&CRS=EPSG:4326&FORMAT=image/jpeg';

const b = readFileSync(join(RAIZ, 'public', 'bahia', 'relieve.bin'));
const N = N_RELIEVE;
const rel = new Int16Array(b.buffer, b.byteOffset, N * N);

function tieneTierra(nivel: number, i: number, j: number): boolean {
  const r = recuadroTesela(nivel, i, j);
  const c0 = Math.floor((r.x0 + LADO / 2) / 5), c1 = Math.ceil((r.x1 + LADO / 2) / 5);
  const f0 = Math.floor((r.z0 + LADO / 2) / 5), f1 = Math.ceil((r.z1 + LADO / 2) / 5);
  for (let f = f0; f <= f1; f++) for (let c = c0; c <= c1; c++) {
    if (rel[Math.min(N - 1, f) * N + Math.min(N - 1, c)] > -200) return true;
  }
  return false;
}

const trabajos: { nivel: number; i: number; j: number }[] = [];
for (let nivel = 0; nivel <= NIVEL_MAX_ORTO; nivel++) {
  const n = 2 ** nivel;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    if (nivel <= 3 || tieneTierra(nivel, i, j)) trabajos.push({ nivel, i, j });
  }
}
console.log(`${trabajos.length} teselas`);

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
let hechas = 0, bytes = 0;
async function bajar(t: { nivel: number; i: number; j: number }) {
  const dir = join(DEST, String(t.nivel));
  mkdirSync(dir, { recursive: true });
  const fichero = join(dir, `${t.i}_${t.j}.jpg`);
  if (!existsSync(fichero)) {
    const r = recuadroTesela(t.nivel, t.i, t.j);
    const no = aGeo(r.x0, r.z0), se = aGeo(r.x1, r.z1); // noroeste y sureste
    // WMS 1.3.0 con EPSG:4326: el BBOX va en orden latitud, longitud.
    const url = `${WMS}&BBOX=${se.lat.toFixed(7)},${no.lon.toFixed(7)},${no.lat.toFixed(7)},${se.lon.toFixed(7)}&WIDTH=${PIXELES_TESELA}&HEIGHT=${PIXELES_TESELA}`;
    for (let intento = 1; ; intento++) {
      try {
        const res = await fetch(url);
        const tipo = res.headers.get('content-type') ?? '';
        if (!res.ok || !tipo.includes('jpeg')) throw new Error(`${res.status} ${tipo}`);
        writeFileSync(fichero, Buffer.from(await res.arrayBuffer()));
        break;
      } catch (e) {
        if (intento >= 5) throw e;
        await espera(1500 * intento);
      }
    }
    await espera(120);
  }
  bytes += readFileSync(fichero).length;
  hechas++;
  if (hechas % 25 === 0) process.stdout.write(`\r${hechas}/${trabajos.length} (${(bytes / 1e6).toFixed(1)} MB)   `);
}

// Dos peticiones a la vez para no cargar el servidor del IGN.
const cola = [...trabajos];
await Promise.all([0, 1].map(async () => { for (let t = cola.shift(); t; t = cola.shift()) await bajar(t); }));
process.stdout.write('\n');

// Índice: qué teselas existen en cada nivel (para que la web no pida las que no hay).
const indice: Record<number, string[]> = {};
for (const t of trabajos) (indice[t.nivel] ??= []).push(`${t.i}_${t.j}`);
writeFileSync(join(RAIZ, 'src', 'scene', 'bahia-orto.json'), JSON.stringify({
  fuente: `IGN, PNOA máxima actualidad, WMS ${WMS.split('?')[0]} capa OI.OrthoimageCoverage`,
  consultado: new Date().toISOString().slice(0, 10),
  pixeles: PIXELES_TESELA, niveles: NIVEL_MAX_ORTO, indice,
}));
console.log(`listo: ${hechas} teselas, ${(bytes / 1e6).toFixed(1)} MB`);
