// Ortofoto PNOA (IGN) a más detalle para la zona del Club Náutico: nivel 6 (teselas de 100 m, 0,195 m/píxel;
// la ortofoto PNOA tiene 0,15–0,25 m según el vuelo, así que no se inventa detalle). El resto de la
// escena se queda en el nivel 5 (0,39 m/píxel): la web usa en cada sitio la mejor tesela que existe.
// Uso: node tools/bahia-orto-detalle.ts   (después de tools/bahia-orto.ts)
// Salida: public/bahia/orto/6/<i>_<j>.jpg y el nivel 6 en el índice de src/scene/bahia-orto.json.

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NIVEL_ORTO_DETALLE, PIXELES_TESELA, aGeo, recuadroTesela, LADO } from '../src/bahia.ts';
import paseo from '../src/scene/bahia-paseo.json' with { type: 'json' };

const RAIZ = join(import.meta.dirname, '..');
const WMS = 'https://www.ign.es/wms-inspire/pnoa-ma?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=OI.OrthoimageCoverage&STYLES=&CRS=EPSG:4326&FORMAT=image/jpeg';
const club = paseo.lugares.find((l) => l.nombre === 'Club Náutico')!;
const RADIO = 140;   // m alrededor del Club Náutico (ELEGIDO)

const n = 2 ** NIVEL_ORTO_DETALLE;
const lado = LADO / n;
const trabajos: { i: number; j: number }[] = [];
for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
  const r = recuadroTesela(NIVEL_ORTO_DETALLE, i, j);
  const cx = Math.max(r.x0, Math.min(club.x, r.x1)), cz = Math.max(r.z0, Math.min(club.z, r.z1));
  if (Math.hypot(cx - club.x, cz - club.z) < RADIO) trabajos.push({ i, j });
}
console.log(`${trabajos.length} teselas de ${lado} m`);

const dir = join(RAIZ, 'public', 'bahia', 'orto', String(NIVEL_ORTO_DETALLE));
mkdirSync(dir, { recursive: true });
for (const t of trabajos) {
  const fichero = join(dir, `${t.i}_${t.j}.jpg`);
  if (existsSync(fichero)) continue;
  const r = recuadroTesela(NIVEL_ORTO_DETALLE, t.i, t.j);
  const no = aGeo(r.x0, r.z0), se = aGeo(r.x1, r.z1);
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
      await new Promise((ok) => setTimeout(ok, 1500 * intento));
    }
  }
  await new Promise((ok) => setTimeout(ok, 150));
}

const ruta = join(RAIZ, 'src', 'scene', 'bahia-orto.json');
const meta = JSON.parse(readFileSync(ruta, 'utf-8'));
meta.indice[NIVEL_ORTO_DETALLE] = trabajos.map((t) => `${t.i}_${t.j}`);
meta.nivelDetalle = { nivel: NIVEL_ORTO_DETALLE, zona: 'Club Náutico', radio: RADIO, consultado: new Date().toISOString().slice(0, 10) };
writeFileSync(ruta, JSON.stringify(meta));
console.log('listo');
