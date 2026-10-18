// Posición del sol y de la luna para la playa, con suncalc 2.x
// (ojo: en la versión 2 los ángulos van en grados y el acimut se mide desde el norte).

import * as SunCalc from 'suncalc';
import { PLAYA } from '../config';

export interface Direccion {
  /** Altura sobre el horizonte, grados. */
  altura: number;
  /** Acimut en grados desde el norte, sentido horario. */
  acimut: number;
}

export interface EstadoCielo {
  sol: Direccion;
  luna: Direccion & { fraccion: number; fase: number; anguloLimbo: number; creciente: boolean };
}

export function estadoCielo(t: number): EstadoCielo {
  const d = new Date(t);
  const s = SunCalc.getPosition(d, PLAYA.lat, PLAYA.lon);
  const m = SunCalc.getMoonPosition(d, PLAYA.lat, PLAYA.lon);
  const il = SunCalc.getMoonIllumination(d);
  return {
    sol: { altura: s.altitude, acimut: s.azimuth },
    luna: {
      altura: m.altitude, acimut: m.azimuth,
      fraccion: il.fraction, fase: il.phase, anguloLimbo: il.angle, creciente: il.waxing,
    },
  };
}

/**
 * Pasa una dirección del cielo a un vector unitario en coordenadas de la escena:
 * x a lo largo de la orilla (rumbo PLAYA.ejeGrados), y hacia arriba, z hacia tierra
 * (el mar queda en −z, rumbo eje + 270°).
 */
export function vectorEscena(dir: Direccion): [number, number, number] {
  const r = Math.PI / 180;
  const alt = dir.altura * r, az = dir.acimut * r;
  const este = Math.cos(alt) * Math.sin(az), norte = Math.cos(alt) * Math.cos(az);
  const eje = PLAYA.ejeGrados * r, mar = (PLAYA.ejeGrados + 270) * r;
  const x = este * Math.sin(eje) + norte * Math.cos(eje);
  const haciaMar = este * Math.sin(mar) + norte * Math.cos(mar);
  return [x, Math.sin(alt), -haciaMar];
}

const NOMBRES_FASE = ['Luna nueva', 'Luna creciente', 'Cuarto creciente', 'Gibosa creciente', 'Luna llena', 'Gibosa menguante', 'Cuarto menguante', 'Luna menguante'];
/** Nombre de la fase lunar (fase 0..1 de suncalc, en 8 tramos centrados). */
export function nombreFase(fase: number): string {
  return NOMBRES_FASE[Math.round(fase * 8) % 8];
}
