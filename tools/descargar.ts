// Descarga los datos de marea que usan el ajuste armónico y la validación.
// Uso: node tools/descargar.ts [AAAA-MM-DD fin]   (por defecto, hoy en UTC)
//
// Guarda en data/raw/ (no versionado) las respuestas tal cual y genera en data/
// los ficheros derivados que sí se versionan:
//   - data/obs_<estación>_10min.csv   nivel observado REDMAR, media de 10 min centrada, UTC
//   - data/ihm_<puerto>_extremos.json pleamares y bajamares oficiales del IHM, UTC
//   - data/ihm_<puerto>_5min.csv       curva oficial del IHM cada 5 min, UTC
// Todas las fuentes están descritas en FUENTES.md.

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const RAIZ = join(import.meta.dirname, '..');
const RAW = join(RAIZ, 'data', 'raw');
const DATA = join(RAIZ, 'data');
mkdirSync(RAW, { recursive: true });

const fin = process.argv[2] ? new Date(process.argv[2] + 'T00:00:00Z') : new Date();

/** Estaciones REDMAR y periodo que se descarga de cada una. */
const ESTACIONES = [
  { codigo: 3107, nombre: 'aviles', desde: '2025-10-01' },
  { codigo: 3108, nombre: 'gijon', desde: '2021-01-01' },
];

/** Puertos del IHM (id del servicio getmarea) y meses que se descargan. */
const PUERTOS_IHM = [
  { id: 7, nombre: 'aviles' },
  { id: 6, nombre: 'gijon' },
];
const IHM_DESDE = '2025-10';
const IHM_HASTA = '2026-12';

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function bajar(url: string, destino: string): Promise<string> {
  if (existsSync(destino)) return readFileSync(destino, 'utf8');
  for (let intento = 1; ; intento++) {
    const r = await fetch(url);
    if (r.ok) {
      const texto = await r.text();
      writeFileSync(destino, texto);
      await espera(150); // respeta el límite de peticiones del servicio
      return texto;
    }
    if (intento >= 4) throw new Error(`${r.status} al pedir ${url}`);
    await espera(2000 * intento);
  }
}

const aaaammdd = (d: Date) => d.toISOString().slice(0, 10).replaceAll('-', '');

/** Recorre meses [desde, hasta) como pares de fechas UTC. */
function* meses(desde: Date, hasta: Date) {
  let a = new Date(Date.UTC(desde.getUTCFullYear(), desde.getUTCMonth(), 1));
  while (a < hasta) {
    const b = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + 1, 1));
    yield [a, b < hasta ? b : hasta] as const;
    a = b;
  }
}

// ---------- Observaciones REDMAR (Portus, minutales) ----------
async function observaciones() {
  for (const est of ESTACIONES) {
    const minutos = new Map<number, number>(); // segundo UNIX → nivel (m)
    for (const [a, b] of meses(new Date(est.desde + 'T00:00:00Z'), fin)) {
      const url = `https://poem.puertos.es/portus/StationData?code=${est.codigo}&params=SeaLevel&from=${aaaammdd(a)}@0000&to=${aaaammdd(b)}@0000`;
      const json = JSON.parse(await bajar(url, join(RAW, `portus_${est.codigo}_${aaaammdd(a)}.json`)));
      // Formato: [["UTC","SeaLevel (m)"], [[segundos, [nivel, qc]], ...]]
      for (const [t, [nivel, qc]] of json[1] as [number, [number, number]][]) {
        if (qc === 1 && Number.isFinite(nivel)) minutos.set(t, nivel);
      }
      process.stdout.write(`\r${est.nombre}: ${a.toISOString().slice(0, 7)} (${minutos.size} minutos válidos)   `);
    }
    process.stdout.write('\n');
    // Media de 10 minutos centrada en cada múltiplo de 10 min (t-5 min .. t+4 min).
    // Exige al menos 8 de los 10 minutos para aceptar el valor.
    const lineas = ['utc_iso,segundos,nivel_m,n_minutos'];
    const tiempos = [...minutos.keys()].sort((x, y) => x - y);
    const t0 = Math.ceil(tiempos[0] / 600) * 600;
    const t1 = Math.floor(tiempos[tiempos.length - 1] / 600) * 600;
    for (let t = t0; t <= t1; t += 600) {
      let suma = 0, n = 0;
      for (let k = -5; k <= 4; k++) {
        const v = minutos.get(t + k * 60);
        if (v !== undefined) { suma += v; n++; }
      }
      if (n >= 8) lineas.push(`${new Date(t * 1000).toISOString()},${t},${(suma / n).toFixed(4)},${n}`);
    }
    writeFileSync(join(DATA, `obs_${est.nombre}_10min.csv`), lineas.join('\n') + '\n');
    console.log(`  → data/obs_${est.nombre}_10min.csv: ${lineas.length - 1} valores`);
  }
}

// ---------- Predicción oficial del IHM ----------
async function ihm() {
  for (const p of PUERTOS_IHM) {
    const extremos: { utc: string; altura: number; tipo: string }[] = [];
    const curva: string[] = ['utc_iso,altura_m'];
    for (const [a] of meses(new Date(IHM_DESDE + '-01T00:00:00Z'), new Date(Date.UTC(+IHM_HASTA.slice(0, 4), +IHM_HASTA.slice(5, 7), 1)))) {
      const mes = a.toISOString().slice(0, 7).replace('-', '');
      const base = `https://ideihm.covam.es/api-ihm/getmarea?request=gettide&id=${p.id}&month=${mes}`;
      const json = JSON.parse(await bajar(`${base}&format=json`, join(RAW, `ihm_${p.id}_${mes}.json`)));
      for (const m of json.mareas.datos.marea) {
        // Comprobado: las horas del servicio están en UTC (coinciden con la curva "Horas UTC").
        extremos.push({ utc: `${m.fecha}T${m.hora}:00Z`, altura: Number(m.altura), tipo: m.tipo });
      }
      const html = await bajar(`${base}&format=gra&time=5min`, join(RAW, `ihm_${p.id}_${mes}_5min.html`));
      for (const [, t, y] of html.matchAll(/x : '([^']+)', y :([-0-9.]+)/g)) {
        curva.push(`${t.replace(' ', 'T')}Z,${y}`);
      }
      process.stdout.write(`\rIHM ${p.nombre}: ${mes}   `);
    }
    process.stdout.write('\n');
    writeFileSync(join(DATA, `ihm_${p.nombre}_extremos.json`), JSON.stringify({
      fuente: `IHM, https://ideihm.covam.es/api-ihm/getmarea?request=gettide&id=${p.id}`,
      consultado: new Date().toISOString().slice(0, 10),
      horas: 'UTC',
      alturas: 'metros sobre el cero hidrográfico del IHM',
      extremos,
    }, null, 1));
    writeFileSync(join(DATA, `ihm_${p.nombre}_5min.csv`), curva.join('\n') + '\n');
    console.log(`  → ${extremos.length} extremos y ${curva.length - 1} puntos de curva`);
  }
}

await observaciones();
await ihm();
