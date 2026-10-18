// Utilidades de hora. Regla del proyecto: internamente todo es UTC (ms desde época);
// lo que se muestra siempre está en Europe/Madrid, calculado con Intl (que ya conoce
// el horario de verano), nunca sumando 1 o 2 horas a mano.

import { ZONA_HORARIA } from './config.ts';

const fmtHora = new Intl.DateTimeFormat('es-ES', { timeZone: ZONA_HORARIA, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const fmtFecha = new Intl.DateTimeFormat('es-ES', { timeZone: ZONA_HORARIA, weekday: 'short', day: 'numeric', month: 'short' });
const fmtFechaLarga = new Intl.DateTimeFormat('es-ES', { timeZone: ZONA_HORARIA, weekday: 'long', day: 'numeric', month: 'long' });
const fmtPartes = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONA_HORARIA, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
const fmtZona = new Intl.DateTimeFormat('es-ES', { timeZone: ZONA_HORARIA, timeZoneName: 'short' });

export const horaMadrid = (t: number) => fmtHora.format(t);
export const fechaMadrid = (t: number) => fmtFecha.format(t);
export const fechaLargaMadrid = (t: number) => fmtFechaLarga.format(t);

/** Abreviatura de la zona en ese instante (p. ej. «CEST» o «CET»). */
export function zonaMadrid(t: number): string {
  return fmtZona.formatToParts(t).find((p) => p.type === 'timeZoneName')?.value ?? '';
}

/** Componentes de fecha y hora civiles en Madrid. */
export function partesMadrid(t: number) {
  const p = Object.fromEntries(fmtPartes.formatToParts(t).map((x) => [x.type, x.value]));
  return { anio: +p.year, mes: +p.month, dia: +p.day, hora: +p.hour, minuto: +p.minute, segundo: +p.second };
}

/** Desfase de Madrid respecto a UTC en ese instante, en minutos (60 en invierno, 120 en verano). */
export function desfaseMadridMin(t: number): number {
  const p = partesMadrid(t);
  const comoUtc = Date.UTC(p.anio, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo);
  return Math.round((comoUtc - Math.floor(t / 1000) * 1000) / 60_000);
}

/**
 * Instante UTC de las 00:00 en Madrid del día civil que contiene a t.
 * Funciona aunque ese día dure 23 o 25 horas.
 */
export function inicioDiaMadrid(t: number): number {
  const p = partesMadrid(t);
  return utcDesdeMadrid(p.anio, p.mes, p.dia, 0, 0);
}

/** Convierte una hora civil de Madrid a UTC (ms). Para horas repetidas o inexistentes toma la primera válida. */
export function utcDesdeMadrid(anio: number, mes: number, dia: number, hora: number, minuto: number): number {
  const ingenuo = Date.UTC(anio, mes - 1, dia, hora, minuto);
  // Prueba los dos desfases posibles y se queda con el que reproduce la hora pedida.
  for (const d of [120, 60]) {
    const t = ingenuo - d * 60_000;
    const p = partesMadrid(t);
    if (p.dia === dia && p.hora === hora && p.minuto === minuto) return t;
  }
  return ingenuo - desfaseMadridMin(ingenuo) * 60_000;
}

/** Inicio del día siguiente en Madrid (ms UTC). */
export function inicioDiaSiguienteMadrid(t: number): number {
  return inicioDiaMadrid(inicioDiaMadrid(t) + 36 * 3_600_000);
}
