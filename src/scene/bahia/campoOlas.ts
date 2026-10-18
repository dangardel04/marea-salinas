// Campo de oleaje para el sombreador del agua: tiempo de llegada del frente (fast marching) y
// dirección local de propagación, en una textura RGBA float sobre toda la bahía.
//   R = tiempo de llegada (s), relativo; G, B = dirección de propagación unitaria (x este, z sur);
//   A = 1 si el oleaje alcanza ese nodo. En tierra se copian los cuatro valores del agua más
//       cercana, para que el vaivén de la orilla tenga fase y alcance sobre la arena. El agua
//       que el oleaje no alcanza (charcos y canales aislados de bajamar) se queda con A = 0.

import * as THREE from 'three';
import { PASO_RELIEVE } from '../../bahia';
import { tiemposLlegada } from '../../oleaje/propagacion';
import type { Relieve } from './relieve';

export const PASO_CAMPO = 4; // nodos del relieve → 20 m

export function calcularCampo(relieve: Relieve, nivel: number, periodo: number, dirDesde: number): THREE.DataTexture {
  const n = Math.floor((relieve.n - 1) / PASO_CAMPO) + 1;
  const paso = PASO_RELIEVE * PASO_CAMPO;
  const prof = new Float32Array(n * n);
  // En la franja de rompientes la ola ya es una resaca (bore) que avanza a ~√(g·(h + H)), no a
  // √(g·h): con h de pocos centímetros sobre la terraza de bajamar, √(g·h) haría que la fase
  // saltara de una celda a otra y el vaivén saldría en dedos. Para la fase, profundidad mínima de
  // PROF_MIN_FASE donde hay agua.
  const PROF_MIN_FASE = 1;
  for (let f = 0; f < n; f++) for (let c = 0; c < n; c++) {
    const h = nivel - relieve.alto[f * PASO_CAMPO * relieve.n + c * PASO_CAMPO];
    prof[f * n + c] = h > 0.05 ? Math.max(h, PROF_MIN_FASE) : h;
  }
  // Dirección hacia la que viaja (opuesta a la de procedencia), en x este / z sur.
  const r = (dirDesde * Math.PI) / 180;
  const hacia = { x: -Math.sin(r), z: Math.cos(r) };
  const { t } = tiemposLlegada(prof, n, paso, periodo, hacia);

  const datos = new Float32Array(n * n * 4);
  const valido = (k: number) => Number.isFinite(t[k]);
  for (let f = 0; f < n; f++) for (let c = 0; c < n; c++) {
    const k = f * n + c;
    datos[k * 4] = valido(k) ? t[k] : NaN;
    // Gradiente centrado de T → dirección de propagación.
    const tx = (valido(k + 1) && c < n - 1 ? t[k + 1] : t[k]) - (valido(k - 1) && c > 0 ? t[k - 1] : t[k]);
    const tz = (valido(k + n) && f < n - 1 ? t[k + n] : t[k]) - (valido(k - n) && f > 0 ? t[k - n] : t[k]);
    const l = Math.hypot(tx, tz);
    datos[k * 4 + 1] = valido(k) && l > 0 ? tx / l : hacia.x;
    datos[k * 4 + 2] = valido(k) && l > 0 ? tz / l : hacia.z;
    datos[k * 4 + 3] = valido(k) ? 1 : 0;
  }
  // Rellenar tierra y sombras con el valor del agua alcanzada más cercana (barrido en anchura).
  const cola: number[] = [];
  for (let k = 0; k < n * n; k++) if (datos[k * 4 + 3] === 1) cola.push(k);
  const hecho = new Uint8Array(n * n);
  for (const k of cola) hecho[k] = 1;
  for (let q = 0; q < cola.length; q++) {
    const k = cola[q], f = Math.floor(k / n), c = k % n;
    for (const kk of [k - 1, k + 1, k - n, k + n]) {
      if (kk < 0 || kk >= n * n || hecho[kk]) continue;
      if (Math.abs((kk % n) - c) > 1 || Math.abs(Math.floor(kk / n) - f) > 1) continue;
      hecho[kk] = 1;
      datos[kk * 4] = datos[k * 4]; // misma fase que el agua contigua
      datos[kk * 4 + 1] = datos[k * 4 + 1];
      datos[kk * 4 + 2] = datos[k * 4 + 2];
      datos[kk * 4 + 3] = prof[kk] > 0.05 ? 0 : datos[k * 4 + 3];
      cola.push(kk);
    }
  }
  // Tiempos relativos al mínimo, para que la precisión float sea buena en la GPU.
  let min = Infinity;
  for (let k = 0; k < n * n; k++) if (Number.isFinite(datos[k * 4])) min = Math.min(min, datos[k * 4]);
  for (let k = 0; k < n * n; k++) datos[k * 4] = Number.isFinite(datos[k * 4]) ? datos[k * 4] - min : 0;

  const tex = new THREE.DataTexture(datos, n, n, THREE.RGBAFormat, THREE.FloatType);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}
