// Tabla oficial del IHM (solo para comparar en la interfaz; si no hay red, no se muestra).
// El servicio da pleamares y bajamares por día UTC, con horas en UTC (comprobado, FUENTES.md §3).

import { PUERTO_IHM } from '../config';

export interface ExtremoOficial { t: number; altura: number; tipo: 'pleamar' | 'bajamar' }

const cache = new Map<string, Promise<ExtremoOficial[]>>();

function diaUtc(fecha: string): Promise<ExtremoOficial[]> {
  let p = cache.get(fecha);
  if (!p) {
    p = fetch(`https://ideihm.covam.es/api-ihm/getmarea?request=gettide&id=${PUERTO_IHM.id}&date=${fecha}&format=json`)
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((j) => (j.mareas.datos.marea as { hora: string; altura: string; tipo: string }[]).map((m) => ({
        t: Date.parse(`${fecha.slice(0, 4)}-${fecha.slice(4, 6)}-${fecha.slice(6, 8)}T${m.hora}:00Z`),
        altura: Number(m.altura),
        tipo: m.tipo as ExtremoOficial['tipo'],
      })));
    p.catch(() => cache.delete(fecha)); // reintentar más tarde si falla
    cache.set(fecha, p);
  }
  return p;
}

const aaaammdd = (t: number) => new Date(t).toISOString().slice(0, 10).replaceAll('-', '');

/** Extremos oficiales en [desde, hasta) (ms UTC). Pide los días UTC que hagan falta. */
export async function extremosOficiales(desde: number, hasta: number): Promise<ExtremoOficial[]> {
  const fechas = new Set<string>();
  for (let t = desde; t < hasta + 86_400_000; t += 86_400_000) fechas.add(aaaammdd(Math.min(t, hasta)));
  const listas = await Promise.all([...fechas].map(diaUtc));
  return listas.flat().filter((e) => e.t >= desde && e.t < hasta).sort((a, b) => a.t - b.t);
}
