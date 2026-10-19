// Campo de oleaje para el sombreador del agua: tiempo de llegada del frente (fast marching) y
// dirección local de propagación, en una textura RGBA float sobre toda la bahía.
//   R = tiempo de llegada (s), relativo; G, B = dirección de propagación unitaria (x este, z sur);
//   A = 1 si el oleaje alcanza ese nodo. En tierra se copian los cuatro valores del agua más
//       cercana, para que el vaivén de la orilla tenga fase y alcance sobre la arena. El agua
//       que el oleaje no alcanza (charcos y canales aislados de bajamar) se queda con A = 0.

import * as THREE from 'three';
import { LADO, PASO_RELIEVE } from '../../bahia';
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

/**
 * Cota de rebose: el nivel más bajo al que el agua del mar abierto llega a cada nodo (inundación
 * por prioridad desde los nodos del borde que están bajo el cero hidrográfico). En una ladera es
 * la altura del propio nodo; en un charco detrás de un caballón de arena es la altura del
 * caballón. Para pasar de un nodo al siguiente el agua tiene que llevar al menos `margen` m de
 * calado: un charco unido al mar solo por un hilo de centímetros en la rejilla de 5 m (que en el
 * relieve de 1 m queda en seco) se trata como aislado.
 */
export function cotaRebose(alturas: Float32Array, n: number, margen: number): Float32Array {
  const N = n * n;
  const paso = new Float32Array(N).fill(Infinity); // nivel necesario para seguir desde el nodo
  const cota = new Float32Array(N).fill(Infinity);
  // Montículo binario de índices ordenados por `paso`.
  const monton = new Int32Array(N * 5); // un nodo entra como mucho una vez por vecino y otra de semilla
  let tam = 0;
  const meter = (k: number) => {
    let i = tam++;
    monton[i] = k;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (paso[monton[p]] <= paso[monton[i]]) break;
      const t = monton[p]; monton[p] = monton[i]; monton[i] = t;
      i = p;
    }
  };
  const sacar = () => {
    const r = monton[0];
    monton[0] = monton[--tam];
    let i = 0;
    for (;;) {
      const a = 2 * i + 1, b = a + 1;
      let m = i;
      if (a < tam && paso[monton[a]] < paso[monton[m]]) m = a;
      if (b < tam && paso[monton[b]] < paso[monton[m]]) m = b;
      if (m === i) break;
      const t = monton[m]; monton[m] = monton[i]; monton[i] = t;
      i = m;
    }
    return r;
  };
  for (let k = 0; k < N; k++) {
    const f = Math.floor(k / n), c = k % n;
    const borde = f === 0 || c === 0 || f === n - 1 || c === n - 1;
    if (borde && alturas[k] < 0) { cota[k] = alturas[k]; paso[k] = alturas[k] + margen; meter(k); }
  }
  const hecho = new Uint8Array(N);
  while (tam > 0) {
    const k = sacar();
    if (hecho[k]) continue;
    hecho[k] = 1;
    const c = k % n;
    const vecinos = [c > 0 ? k - 1 : -1, c < n - 1 ? k + 1 : -1, k - n, k + n];
    for (const kk of vecinos) {
      if (kk < 0 || kk >= N || hecho[kk]) continue;
      const llega = Math.max(alturas[kk], paso[k]);           // nivel al que el agua entra en kk
      if (llega < cota[kk]) {
        cota[kk] = llega;
        paso[kk] = Math.max(alturas[kk] + margen, paso[k]);
        meter(kk);
      }
    }
  }
  return cota;
}

/**
 * Fondo que ve el agua, en una textura RG float con la rejilla de 5 m:
 *   R = altura del fondo (m sobre el CH), con el relieve fino de la playa ya fundido, para que la
 *       orilla del agua caiga donde la arena (antes, cada 10 m y sin el LiDAR fino);
 *   G = cota de rebose (ver cotaRebose): el agua solo se dibuja donde su superficie la supera.
 *       Así los charcos aislados y las hondonadas de la arena no salen como mar, ni con la
 *       subida del vaivén, salvo que el agua rebase de verdad el caballón que los cierra.
 * No depende del nivel del mar: se calcula al cargar y otra vez cuando llega el relieve fino.
 */
export function crearFondoAgua(relieve: Relieve) {
  const n = relieve.n;
  const alturas = new Float32Array(n * n);
  const datos = new Float32Array(n * n * 2);
  const tex = new THREE.DataTexture(datos, n, n, THREE.RGFormat, THREE.FloatType);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;

  /** Lee las alturas de la rejilla y recalcula la cota de rebose (otra vez con el relieve fino). */
  function actualizar() {
    for (let f = 0; f < n; f++) for (let c = 0; c < n; c++) {
      alturas[f * n + c] = relieve.altura(-LADO / 2 + c * PASO_RELIEVE, -LADO / 2 + f * PASO_RELIEVE);
    }
    const cota = cotaRebose(alturas, n, 0.08);
    for (let k = 0; k < n * n; k++) {
      datos[k * 2] = alturas[k];
      datos[k * 2 + 1] = Number.isFinite(cota[k]) ? cota[k] : 1000;
    }
    tex.needsUpdate = true;
  }

  /** Cota de rebose en (x, z), interpolada: el mar llega ahí si su nivel la supera. */
  function cota(x: number, z: number): number {
    const c = Math.min(n - 1.001, Math.max(0, (x + LADO / 2) / PASO_RELIEVE));
    const f = Math.min(n - 1.001, Math.max(0, (z + LADO / 2) / PASO_RELIEVE));
    const c0 = Math.floor(c), f0 = Math.floor(f), fx = c - c0, fy = f - f0;
    const g = (ff: number, cc: number) => datos[(ff * n + cc) * 2 + 1];
    return (g(f0, c0) * (1 - fx) + g(f0, c0 + 1) * fx) * (1 - fy) + (g(f0 + 1, c0) * (1 - fx) + g(f0 + 1, c0 + 1) * fx) * fy;
  }

  actualizar();
  return { textura: tex, n, actualizar, cota };
}
