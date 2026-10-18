import { describe, expect, it } from 'vitest';
import { longitudOnda, celeridad, asomeramiento, tiemposLlegada } from '../src/oleaje/propagacion';

const G = 9.81;
/** Resolución exacta (Newton) de ω² = g·k·tanh(k·h) para comparar con la aproximación. */
function kExacto(t: number, h: number) {
  const w = (2 * Math.PI) / t;
  let k = (w * w) / G;
  for (let i = 0; i < 50; i++) {
    const f = G * k * Math.tanh(k * h) - w * w;
    const df = G * Math.tanh(k * h) + G * k * h / Math.cosh(k * h) ** 2;
    k -= f / df;
  }
  return k;
}

describe('dispersión (Fenton y McKee, 1990)', () => {
  it('error menor del 1,7 % frente a la solución exacta en todo el rango', () => {
    for (const t of [4, 8, 12, 16]) for (const h of [0.5, 2, 5, 10, 30, 100]) {
      const exacta = (2 * Math.PI) / kExacto(t, h);
      expect(Math.abs(longitudOnda(t, h) - exacta) / exacta).toBeLessThan(0.017);
    }
  });
  it('aguas someras: c → √(g·h); aguas profundas: c → g·T/2π', () => {
    expect(celeridad(14, 0.5) / Math.sqrt(G * 0.5)).toBeCloseTo(1, 1);
    expect(celeridad(6, 500) / ((G * 6) / (2 * Math.PI))).toBeCloseTo(1, 3);
  });
  it('el asomeramiento vale 1 en aguas profundas, baja ligeramente en profundidad intermedia y sube en poco fondo', () => {
    expect(asomeramiento(10, 1000)).toBeCloseTo(1, 3);
    expect(asomeramiento(10, 20)).toBeLessThan(1);
    expect(asomeramiento(10, 1)).toBeGreaterThan(1.2);
  });
});

describe('tiempo de llegada (fast marching)', () => {
  it('con fondo uniforme da frentes planos: T = distancia / c', () => {
    const n = 41, paso = 10, h = 20, t = 10;
    const prof = new Float32Array(n * n).fill(h);
    const campo = tiemposLlegada(prof, n, paso, t, { x: 0, z: 1 }); // de norte a sur
    const c = celeridad(t, h);
    // Una fila a 300 m del borde de entrada llega 300/c después que la del borde.
    const fila0 = campo.t[20], fila30 = campo.t[30 * n + 20];
    expect(fila30 - fila0).toBeCloseTo(300 / c, 1);
    // Frente plano: toda la fila llega a la vez.
    expect(Math.abs(campo.t[30 * n + 5] - campo.t[30 * n + 35])).toBeLessThan(0.05);
  });

  it('las olas llegan más tarde a la zona poco profunda (refracción)', () => {
    const n = 41, paso = 10;
    const prof = new Float32Array(n * n);
    for (let f = 0; f < n; f++) for (let c = 0; c < n; c++) prof[f * n + c] = c < 20 ? 20 : 3; // mitad este somera
    const campo = tiemposLlegada(prof, n, paso, 10, { x: 0, z: 1 });
    expect(campo.t[35 * n + 30]).toBeGreaterThan(campo.t[35 * n + 10]);
  });

  it('la tierra no recibe olas', () => {
    const n = 21;
    const prof = new Float32Array(n * n).fill(10);
    prof[10 * n + 10] = -1;
    expect(tiemposLlegada(prof, n, 10, 10, { x: 0, z: 1 }).t[10 * n + 10]).toBe(Infinity);
  });
});
