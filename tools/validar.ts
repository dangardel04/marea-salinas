// Validación de juegos de constantes contra la tabla oficial del IHM y las observaciones REDMAR.
// Uso: node tools/validar.ts
// Escribe data/validacion.json con todos los números que se resumen en VALIDACION.md.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { stationsById } from '@neaps/tide-database';
import { crearMotor, type Extremo } from '../src/tide/motor.ts';
import type { ConjuntoArmonico, Constituyente } from '../src/tide/armonicos.ts';

const RAIZ = join(import.meta.dirname, '..');
const leer = (f: string) => readFileSync(join(RAIZ, 'data', f), 'utf8');
const MIN = 60_000, HORA = 3_600_000, DIA = 86_400_000;

// ---------- Datos oficiales ----------
interface ExtremoIhm { t: number; altura: number; tipo: 'pleamar' | 'bajamar' }
function extremosIhm(puerto: string): ExtremoIhm[] {
  const j = JSON.parse(leer(`ihm_${puerto}_extremos.json`));
  return j.extremos.map((e: { utc: string; altura: number; tipo: string }) => ({ t: Date.parse(e.utc), altura: e.altura, tipo: e.tipo }));
}
function curvaIhm(puerto: string): { t: number; h: number }[] {
  return leer(`ihm_${puerto}_5min.csv`).trim().split('\n').slice(1).map((l) => {
    const [t, h] = l.split(',');
    return { t: Date.parse(t), h: Number(h) };
  });
}
function observaciones(est: string): { t: number; h: number }[] {
  return leer(`obs_${est}_10min.csv`).trim().split('\n').slice(1).map((l) => {
    const [, s, h] = l.split(',');
    return { t: Number(s) * 1000, h: Number(h) };
  });
}

/** Media de la curva oficial del IHM durante el año natural 2026 = nivel medio sobre el CH. */
function z0SobreCh(puerto: string) {
  const c = curvaIhm(puerto).filter((p) => p.t >= Date.UTC(2026, 0, 1) && p.t < Date.UTC(2027, 0, 1));
  return { z0: c.reduce((s, p) => s + p.h, 0) / c.length, puntos: c.length, minimo: Math.min(...c.map((p) => p.h)) };
}

// ---------- Estadística ----------
function resumen(v: number[]) {
  const n = v.length;
  if (!n) return null;
  const media = v.reduce((s, x) => s + x, 0) / n;
  const rms = Math.sqrt(v.reduce((s, x) => s + x * x, 0) / n);
  const abs = v.map(Math.abs).sort((a, b) => a - b);
  return { n, media: +media.toFixed(2), rms: +rms.toFixed(2), p95abs: +abs[Math.floor(0.95 * (n - 1))].toFixed(2), maxAbs: +abs[n - 1].toFixed(2) };
}

interface Emparejado { ihm: ExtremoIhm; pred: Extremo; dtMin: number; dhCm: number }

/** Empareja cada extremo oficial con el predicho del mismo tipo más cercano (máx. 3 h). */
function emparejar(oficiales: ExtremoIhm[], predichos: Extremo[]): Emparejado[] {
  const out: Emparejado[] = [];
  let j = 0;
  for (const o of oficiales) {
    while (j < predichos.length - 1 && predichos[j + 1].t <= o.t) j++;
    let mejor: Extremo | undefined;
    for (const c of predichos.slice(Math.max(0, j - 2), j + 3)) {
      if (c.tipo !== o.tipo) continue;
      if (!mejor || Math.abs(c.t - o.t) < Math.abs(mejor.t - o.t)) mejor = c;
    }
    if (mejor && Math.abs(mejor.t - o.t) <= 3 * HORA) {
      out.push({ ihm: o, pred: mejor, dtMin: (mejor.t - o.t) / MIN, dhCm: (mejor.altura - o.altura) * 100 });
    }
  }
  return out;
}

function compararConIhm(conjunto: ConjuntoArmonico, puerto: string, desde: number, hasta: number) {
  const motor = crearMotor(conjunto);
  const of = extremosIhm(puerto).filter((e) => e.t >= desde && e.t < hasta);
  const pr = motor.extremos(desde - 6 * HORA, hasta + 6 * HORA);
  const em = emparejar(of, pr);
  const curva = curvaIhm(puerto).filter((p) => p.t >= desde && p.t < hasta);
  const dCurva = curva.map((p) => (motor.altura(p.t) - p.h) * 100);
  const dentro = em.filter((e) => Math.abs(e.dtMin) <= 10 && Math.abs(e.dhCm) <= 15).length;
  return {
    extremosOficiales: of.length,
    emparejados: em.length,
    tiempoMin: resumen(em.map((e) => e.dtMin)),
    alturaCm: resumen(em.map((e) => e.dhCm)),
    pleamares: { tiempoMin: resumen(em.filter((e) => e.ihm.tipo === 'pleamar').map((e) => e.dtMin)), alturaCm: resumen(em.filter((e) => e.ihm.tipo === 'pleamar').map((e) => e.dhCm)) },
    bajamares: { tiempoMin: resumen(em.filter((e) => e.ihm.tipo === 'bajamar').map((e) => e.dtMin)), alturaCm: resumen(em.filter((e) => e.ihm.tipo === 'bajamar').map((e) => e.dhCm)) },
    curvaCada5minCm: resumen(dCurva),
    porcentajeDentroObjetivo: +(100 * dentro / Math.max(1, of.length)).toFixed(1),
    detalle: em,
  };
}

/** Extremos observados: máximos/mínimos de la serie de 10 min suavizada (media móvil de 50 min). */
function extremosObservados(obs: { t: number; h: number }[]): ExtremoIhm[] {
  const out: ExtremoIhm[] = [];
  const s = obs.map((p, i) => {
    const v = obs.slice(Math.max(0, i - 2), i + 3);
    const contiguo = v.length === 5 && v[4].t - v[0].t === 40 * MIN;
    return { t: p.t, h: contiguo ? v.reduce((a, b) => a + b.h, 0) / 5 : NaN };
  });
  const VENTANA = 18; // ±3 h
  for (let i = VENTANA; i < s.length - VENTANA; i++) {
    const v = s.slice(i - VENTANA, i + VENTANA + 1);
    if (v.some((p) => !Number.isFinite(p.h)) || v[v.length - 1].t - v[0].t !== 2 * VENTANA * 10 * MIN) continue;
    const hs = v.map((p) => p.h);
    if (s[i].h === Math.max(...hs)) out.push({ t: s[i].t, altura: obs[i].h, tipo: 'pleamar' });
    if (s[i].h === Math.min(...hs)) out.push({ t: s[i].t, altura: obs[i].h, tipo: 'bajamar' });
  }
  return out;
}

function compararConObservado(conjunto: ConjuntoArmonico, est: string, desde: number, hasta: number) {
  const motor = crearMotor(conjunto);
  const obs = observaciones(est).filter((p) => p.t >= desde && p.t < hasta);
  const residuo = obs.map((p) => (p.h - motor.altura(p.t)) * 100);
  const exObs = extremosObservados(obs);
  const em = emparejar(exObs, motor.extremos(desde - 6 * HORA, hasta + 6 * HORA));
  return {
    valores: obs.length,
    residuoCm: resumen(residuo),
    extremosObservados: exObs.length,
    tiempoMin: resumen(em.map((e) => e.dtMin)),
    alturaCm: resumen(em.map((e) => e.dhCm)),
  };
}

// ---------- Juegos de constantes ----------
function ajuste(est: string) {
  const f = join(RAIZ, 'data', `constantes_${est}_ajuste.json`);
  if (!existsSync(f)) throw new Error(`Falta ${f}: ejecuta node tools/ajuste.ts ${est}`);
  return JSON.parse(readFileSync(f, 'utf8')) as { z0: number; constituyentes: Constituyente[]; periodo: { desde: string; hasta: string } };
}
function ticon(id: string): Constituyente[] {
  return stationsById.get(id)!.harmonic_constituents.map((c: Constituyente) => ({ name: c.name, amplitude: c.amplitude, phase: c.phase }));
}

const zAvi = z0SobreCh('aviles');
const zGij = z0SobreCh('gijon');
const ajAvi = ajuste('aviles');
const ajGij = ajuste('gijon');
const hibAvi = JSON.parse(readFileSync(join(RAIZ, 'data', 'constantes_aviles_hibrido.json'), 'utf8')) as { z0: number; constituyentes: Constituyente[] };
const CH_GIJON_SOBRE_REDMAR = 0.35; // esquema datum oficial Gijón 2 (FUENTES.md §3)

const juegos: Record<string, { puerto: string; obs: string; ch: ConjuntoArmonico; obsDatum: ConjuntoArmonico; nota: string }> = {
  'A_ajuste_aviles': {
    puerto: 'aviles', obs: 'aviles',
    ch: { z0: zAvi.z0, constituyentes: ajAvi.constituyentes },
    obsDatum: { z0: ajAvi.z0, constituyentes: ajAvi.constituyentes },
    nota: 'Constantes por mínimos cuadrados con 1 año de REDMAR Avilés; Z0 sobre el CH = media de la curva IHM 2026',
  },
  'E_hibrido_aviles': {
    puerto: 'aviles', obs: 'aviles',
    ch: { z0: zAvi.z0, constituyentes: hibAvi.constituyentes },
    obsDatum: { z0: hibAvi.z0, constituyentes: hibAvi.constituyentes },
    nota: 'Híbrido (activo): REDMAR Avilés para los constituyentes rápidos + periodo largo de 5,8 años de Gijón; Z0 sobre el CH = media de la curva IHM 2026',
  },
  'B_ticon_aviles': {
    puerto: 'aviles', obs: 'aviles',
    ch: { z0: zAvi.z0, constituyentes: ticon('ticon/avilestg-avi-esp-cmems') },
    obsDatum: { z0: ajAvi.z0, constituyentes: ticon('ticon/avilestg-avi-esp-cmems') },
    nota: 'Constantes publicadas TICON-4 Avilés (2021-2025); Z0 sobre el CH = media de la curva IHM 2026',
  },
  'C_ajuste_gijon_control': {
    puerto: 'gijon', obs: 'gijon',
    ch: { z0: ajGij.z0 - CH_GIJON_SOBRE_REDMAR, constituyentes: ajGij.constituyentes },
    obsDatum: { z0: ajGij.z0, constituyentes: ajGij.constituyentes },
    nota: 'Control independiente: constantes por mínimos cuadrados de REDMAR Gijón; Z0 pasado al CH con el datum oficial (−0,35 m), sin usar nada del IHM',
  },
  'D_ticon_gijon': {
    puerto: 'gijon', obs: 'gijon',
    ch: { z0: ajGij.z0 - CH_GIJON_SOBRE_REDMAR, constituyentes: ticon('ticon/gijontg-gij-esp-cmems') },
    obsDatum: { z0: ajGij.z0, constituyentes: ticon('ticon/gijontg-gij-esp-cmems') },
    nota: 'TICON-4 Gijón con el Z0 del ajuste propio pasado al CH con el datum oficial',
  },
};

const HOY = Date.UTC(2026, 9, 18);
const PERIODOS = {
  semana_18_25_oct_2026: [HOY, HOY + 8 * DIA],
  futuro_18oct_31dic_2026: [HOY, Date.UTC(2027, 0, 1)],
  completo_oct2025_dic2026: [Date.UTC(2025, 9, 1), Date.UTC(2027, 0, 1)],
} as const;

const resultado: Record<string, unknown> = {
  generado: new Date().toISOString(),
  z0SobreCh: { aviles: zAvi, gijon: zGij },
  desfaseCeroPuertoAvilesSobreCh_estimado: +(hibAvi.z0 - zAvi.z0).toFixed(3),
  juegos: {},
};

for (const [nombre, j] of Object.entries(juegos)) {
  const r: Record<string, unknown> = { nota: j.nota, z0Ch: +j.ch.z0.toFixed(4), ihm: {}, observado: {} };
  for (const [p, [a, b]] of Object.entries(PERIODOS)) {
    const c = compararConIhm(j.ch, j.puerto, a, b);
    (r.ihm as Record<string, unknown>)[p] = p.startsWith('semana') ? c : { ...c, detalle: undefined };
  }
  const obsDesde = Date.UTC(2025, 9, 1), obsHasta = HOY + DIA;
  (r.observado as Record<string, unknown>).oct2025_oct2026 = compararConObservado(j.obsDatum, j.obs, obsDesde, obsHasta);
  (resultado.juegos as Record<string, unknown>)[nombre] = r;
  const s = (r.ihm as Record<string, ReturnType<typeof compararConIhm>>);
  const sem = s.semana_18_25_oct_2026, fut = s.futuro_18oct_31dic_2026;
  console.log(`\n${nombre}: ${j.nota}`);
  console.log(`  semana 18-25 oct: tiempo RMS ${sem.tiempoMin?.rms} min (máx ${sem.tiempoMin?.maxAbs}), altura RMS ${sem.alturaCm?.rms} cm (máx ${sem.alturaCm?.maxAbs}), sesgo ${sem.alturaCm?.media} cm, dentro objetivo ${sem.porcentajeDentroObjetivo}%`);
  console.log(`  18 oct-31 dic:    tiempo RMS ${fut.tiempoMin?.rms} min (máx ${fut.tiempoMin?.maxAbs}), altura RMS ${fut.alturaCm?.rms} cm (máx ${fut.alturaCm?.maxAbs}), sesgo ${fut.alturaCm?.media} cm, dentro ${fut.porcentajeDentroObjetivo}%`);
  const o = (r.observado as Record<string, ReturnType<typeof compararConObservado>>).oct2025_oct2026;
  console.log(`  vs observado:     residuo RMS ${o.residuoCm?.rms} cm (máx ${o.residuoCm?.maxAbs}); extremos: tiempo RMS ${o.tiempoMin?.rms} min, altura RMS ${o.alturaCm?.rms} cm`);
}
console.log(`\nZ0 sobre CH (media curva IHM 2026): Avilés ${zAvi.z0.toFixed(3)} m (${zAvi.puntos} puntos, mín ${zAvi.minimo}), Gijón ${zGij.z0.toFixed(3)} m`);
console.log(`Desfase estimado cero del puerto de Avilés sobre CH: ${resultado.desfaseCeroPuertoAvilesSobreCh_estimado} m`);
writeFileSync(join(RAIZ, 'data', 'validacion.json'), JSON.stringify(resultado, null, 1));
