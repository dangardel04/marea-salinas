// Pendiente del frente de playa (βf) medida con el MDT05 del IGN, para la fórmula de run-up.
// Uso: node tools/pendiente-playa.ts   → src/oleaje/playa.json
//
// Perfiles perpendiculares a la orilla (rumbo PLAYA.ejeGrados + 270) cada 25 m a lo largo de la
// playa. En cada uno: distancia horizontal entre las cotas COTA_BAJA y COTA_ALTA (m sobre el CH),
// solo con puntos MEDIDOS por el LiDAR. βf = desnivel / distancia. Se guardan mediana y cuartiles.
// El LiDAR solo trae arena por encima de ~+3,1 m sobre el CH (el vuelo fue con marea media-alta),
// así que se mide el tramo superior del frente de playa, alrededor de la pleamar (+3,3 a +4,6 m).
// La pendiente de la parte baja, que queda bajo el agua en pleamar, no la mide el LiDAR: se toma
// del perfil de la línea de agua de Sentinel‑2 (data/intermareal_s2.json) si existe.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LADO, N_RELIEVE, PASO_RELIEVE, aLocal } from '../src/bahia.ts';
import { PLAYA } from '../src/config.ts';

const RAIZ = join(import.meta.dirname, '..');
const N = N_RELIEVE;
const b = readFileSync(join(RAIZ, 'public', 'bahia', 'relieve.bin'));
const rel = new Int16Array(b.buffer, b.byteOffset, N * N);
const COTA_BAJA = 3.3, COTA_ALTA = 4.6;

function nodo(x: number, z: number) {
  const c = Math.round((x + LADO / 2) / PASO_RELIEVE), f = Math.round((z + LADO / 2) / PASO_RELIEVE);
  if (c < 0 || c >= N || f < 0 || f >= N) return null;
  const v = rel[f * N + c];
  return { h: v / 100, medido: Math.abs(v) % 2 === 1 };
}

// Eje de la playa desde el punto oficial: recorre 2,7 km hacia el NE (como el polígono OSM).
const p0 = aLocal(PLAYA.lat, PLAYA.lon);
const eje = (PLAYA.ejeGrados * Math.PI) / 180, mar = ((PLAYA.ejeGrados + 270) * Math.PI) / 180;
const ejeV = { x: Math.sin(eje), z: -Math.cos(eje) }, marV = { x: Math.sin(mar), z: -Math.cos(mar) };
const pendientes: number[] = [];
for (let s = -100; s <= 2700; s += 25) {
  const cx = p0.x + ejeV.x * s, cz = p0.z + ejeV.z * s;
  // De tierra (−400 m) al mar (+400 m) cada metro: primer cruce descendente de cada cota.
  let dAlta: number | null = null, dBaja: number | null = null;
  let previo: { h: number; medido: boolean } | null = null;
  for (let d = -400; d <= 400; d += 1) {
    const q = nodo(cx + marV.x * d, cz + marV.z * d);
    if (!q) continue;
    if (previo && previo.medido && q.medido) {
      if (dAlta === null && previo.h >= COTA_ALTA && q.h < COTA_ALTA) dAlta = d;
      if (dAlta !== null && dBaja === null && previo.h >= COTA_BAJA && q.h < COTA_BAJA) dBaja = d;
    }
    previo = q;
  }
  if (dAlta !== null && dBaja !== null && dBaja > dAlta) pendientes.push((COTA_ALTA - COTA_BAJA) / (dBaja - dAlta));
}
pendientes.sort((a, c) => a - c);
const q = (p: number) => pendientes[Math.floor(p * (pendientes.length - 1))];
const salida = {
  fuente: 'MDT05 IGN (LiDAR PNOA) sobre el CH de Avilés, ver tools/pendiente-playa.ts',
  cotas: [COTA_BAJA, COTA_ALTA],
  perfiles: pendientes.length,
  mediana: +q(0.5).toFixed(4),
  p25: +q(0.25).toFixed(4),
  p75: +q(0.75).toFixed(4),
  intermareal: null as null | { fuente: string; cotas: [number, number]; perfiles: number; mediana: number; p10: number; p90: number },
};
const rutaS2 = join(RAIZ, 'data', 'intermareal_s2.json');
if (existsSync(rutaS2)) {
  const r = JSON.parse(readFileSync(rutaS2, 'utf8')).resumen;
  salida.intermareal = {
    fuente: 'Línea de agua Sentinel-2 + mareógrafo de Avilés, ver tools/intermareal-s2.py (pendiente media de cada perfil válido)',
    cotas: [r.cotas[0], COTA_BAJA], perfiles: r.perfilesValidos,
    mediana: +r.pendienteMediana.toFixed(4), p10: +r.pendienteP10.toFixed(4), p90: +r.pendienteP90.toFixed(4),
  };
}
writeFileSync(join(RAIZ, 'src', 'oleaje', 'playa.json'), JSON.stringify(salida, null, 1));
console.log(`${pendientes.length} perfiles: βf mediana ${salida.mediana} (1:${(1 / salida.mediana).toFixed(0)}), cuartiles ${salida.p25}–${salida.p75}`);
if (salida.intermareal) console.log(`Intermareal (Sentinel‑2), ${salida.intermareal.perfiles} perfiles: βf mediana ${salida.intermareal.mediana} (1:${(1 / salida.intermareal.mediana).toFixed(0)})`);
