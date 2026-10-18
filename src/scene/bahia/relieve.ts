// Relieve de la bahía cargado en memoria (ver tools/bahia-relieve.ts para el formato).

import * as THREE from 'three';
import { LADO, N_RELIEVE, PASO_RELIEVE } from '../../bahia';

export interface Relieve {
  n: number;
  /** Alturas en m sobre el CH, filas de norte a sur. */
  alto: Float32Array;
  /** 1 si la altura la midió el MDT del IGN; 0 si es estimada (franja intermareal o fondo). */
  medido: Uint8Array;
  altura(x: number, z: number): number;
  medidoEn(x: number, z: number): number;
  /** Textura (float, un canal) submuestreada cada `paso` nodos, para el agua. */
  textura(paso: number): THREE.DataTexture;
}

export function crearRelieve(cm: Int16Array): Relieve {
  const n = N_RELIEVE;
  const alto = new Float32Array(n * n);
  const medido = new Uint8Array(n * n);
  for (let k = 0; k < n * n; k++) {
    alto[k] = cm[k] / 100;
    medido[k] = Math.abs(cm[k]) % 2;
  }
  function muestra(arr: ArrayLike<number>, x: number, z: number): number {
    const c = Math.min(n - 1.001, Math.max(0, (x + LADO / 2) / PASO_RELIEVE));
    const f = Math.min(n - 1.001, Math.max(0, (z + LADO / 2) / PASO_RELIEVE));
    const c0 = Math.floor(c), f0 = Math.floor(f), fx = c - c0, fy = f - f0;
    const k = f0 * n + c0;
    return (arr[k] * (1 - fx) + arr[k + 1] * fx) * (1 - fy) + (arr[k + n] * (1 - fx) + arr[k + n + 1] * fx) * fy;
  }
  return {
    n, alto, medido,
    altura: (x, z) => muestra(alto, x, z),
    medidoEn: (x, z) => muestra(medido, x, z),
    textura(paso) {
      const m = Math.floor((n - 1) / paso) + 1;
      const datos = new Float32Array(m * m);
      for (let f = 0; f < m; f++) for (let c = 0; c < m; c++) datos[f * m + c] = alto[f * paso * n + c * paso];
      const t = new THREE.DataTexture(datos, m, m, THREE.RedFormat, THREE.FloatType);
      t.magFilter = t.minFilter = THREE.LinearFilter;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      t.needsUpdate = true;
      return t;
    },
  };
}

export async function cargarRelieve(url: string): Promise<Relieve> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`No se pudo cargar el relieve (${r.status})`);
  return crearRelieve(new Int16Array(await r.arrayBuffer()));
}
