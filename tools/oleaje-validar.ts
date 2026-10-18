// Validación del oleaje: Open-Meteo Marine (modelo) frente a la boya de Gijón (medida), en el
// punto de la boya, durante los últimos 92 días (máximo que da Open-Meteo hacia atrás).
// Uso: node tools/oleaje-validar.ts   → data/oleaje_validacion.json
//
// Se compara cada hora con dato en ambas fuentes: altura significante (Hs frente a Hm0), periodo
// de pico (Tp) y dirección media de procedencia (diferencia circular).

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BOYA_GIJON } from '../src/oleaje/datos.ts';

const RAIZ = join(import.meta.dirname, '..');
const RAW = join(RAIZ, 'data', 'raw');
mkdirSync(RAW, { recursive: true });
const DIAS = 92;
const ahora = Date.UTC(2026, 9, 18, 0); // corte fijo para que el resultado sea reproducible
const desde = ahora - DIAS * 86_400_000;

async function bajar(url: string, f: string) {
  const ruta = join(RAW, f);
  if (existsSync(ruta)) return readFileSync(ruta, 'utf8');
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  const t = await r.text();
  writeFileSync(ruta, t);
  return t;
}

// Modelo en el punto de la boya.
const urlOm = `https://marine-api.open-meteo.com/v1/marine?latitude=${BOYA_GIJON.lat}&longitude=${BOYA_GIJON.lon}`
  + `&hourly=wave_height,wave_period,wave_direction&start_date=${new Date(desde).toISOString().slice(0, 10)}&end_date=${new Date(ahora - 86_400_000).toISOString().slice(0, 10)}&timezone=GMT&cell_selection=sea`;
const om = JSON.parse(await bajar(urlOm, 'openmeteo_boya_gijon_v2.json'));
// En el pasado Open-Meteo no da periodo de pico: se compara su periodo medio con el Tm02 de la boya.
const modelo = new Map<number, { hs: number; tp: number; dir: number }>();
om.hourly.time.forEach((iso: string, k: number) => {
  const hs = om.hourly.wave_height[k];
  if (hs != null) modelo.set(Date.parse(iso + ':00Z'), { hs, tp: om.hourly.wave_period[k], dir: om.hourly.wave_direction[k] });
});

// Boya, por tramos de 15 días.
const medida = new Map<number, { hs: number; tp: number; dir: number }>();
const p = (n: number) => String(n).padStart(2, '0');
const fmt = (t: number) => { const d = new Date(t); return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}@0000`; };
for (let a = desde; a < ahora; a += 15 * 86_400_000) {
  const b = Math.min(a + 15 * 86_400_000, ahora);
  const url = `https://poem.puertos.es/portus/StationData?code=${BOYA_GIJON.id}&params=Hm0,Tm02,MeanDir&from=${fmt(a)}&to=${fmt(b)}`;
  const j = JSON.parse(await bajar(url, `boya_gijon_tm02_${fmt(a).slice(0, 8)}.json`));
  for (const [s, [hs, q1], [tp, q2], [dir, q3]] of j[1]) if (q1 === 1 && q2 === 1 && q3 === 1) medida.set(s * 1000, { hs, tp, dir });
}

const pares: { m: { hs: number; tp: number; dir: number }; o: { hs: number; tp: number; dir: number } }[] = [];
for (const [t, o] of medida) { const m = modelo.get(t); if (m && m.tp != null && m.dir != null) pares.push({ m, o }); }

const media = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
const rms = (v: number[]) => Math.sqrt(media(v.map((x) => x * x)));
function correlacion(a: number[], b: number[]) {
  const ma = media(a), mb = media(b);
  let s = 0, sa = 0, sb = 0;
  for (let i = 0; i < a.length; i++) { s += (a[i] - ma) * (b[i] - mb); sa += (a[i] - ma) ** 2; sb += (b[i] - mb) ** 2; }
  return s / Math.sqrt(sa * sb);
}
const dHs = pares.map((x) => x.m.hs - x.o.hs);
const dTp = pares.map((x) => x.m.tp - x.o.tp);
const dDir = pares.map((x) => ((x.m.dir - x.o.dir + 540) % 360) - 180);
const r = (v: number) => +v.toFixed(3);
const salida = {
  metodo: 'Open-Meteo Marine (modelo) en el punto de la boya frente a la boya de Gijón (Portus 1117), horas con dato válido en ambas. Ver tools/oleaje-validar.ts.',
  periodo: { desde: new Date(desde).toISOString(), hasta: new Date(ahora).toISOString() },
  celdaModelo: { lat: om.latitude, lon: om.longitude },
  horas: pares.length,
  hs: { sesgo_m: r(media(dHs)), rms_m: r(rms(dHs)), correlacion: r(correlacion(pares.map((x) => x.m.hs), pares.map((x) => x.o.hs))), mediaBoya_m: r(media(pares.map((x) => x.o.hs))), errorRelativo: r(rms(dHs) / media(pares.map((x) => x.o.hs))) },
  periodoMedio: { nota: 'modelo: periodo medio (wave_period); boya: Tm02', sesgo_s: r(media(dTp)), rms_s: r(rms(dTp)) },
  direccion: { sesgo_grados: r(media(dDir)), rms_grados: r(rms(dDir)) },
};
writeFileSync(join(RAIZ, 'data', 'oleaje_validacion.json'), JSON.stringify(salida, null, 1));
console.log(JSON.stringify(salida, null, 1));
