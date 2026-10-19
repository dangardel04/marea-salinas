// Cota de rebose: hasta dónde llega el mar (y qué charcos quedan aislados).
import { describe, expect, it } from 'vitest';
import { cotaRebose } from '../src/scene/bahia/campoOlas';

// Rejilla de 7 × 7, filas de norte a sur: mar al norte, playa que sube y, detrás de un caballón
// de +2,0 m, una hondonada a +1,2 m.
function rejilla(hueco: number | null) {
  const n = 7;
  const filas = [-2, 0.5, 1.0, 2.0, 1.2, 2.0, 3.0];
  const a = new Float32Array(n * n);
  for (let f = 0; f < n; f++) for (let c = 0; c < n; c++) {
    a[f * n + c] = f === 4 && (c === 0 || c === n - 1) ? 2.0 : filas[f];
  }
  if (hueco !== null) a[3 * n + 3] = hueco; // un paso en el caballón
  return { a, n };
}

describe('cota de rebose', () => {
  it('en la ladera que da al mar es la altura del propio nodo', () => {
    const { a, n } = rejilla(null);
    const cota = cotaRebose(a, n, 0.08);
    expect(cota[1 * n + 3]).toBeCloseTo(0.5, 6);
    expect(cota[2 * n + 3]).toBeCloseTo(1.0, 6);
    expect(cota[3 * n + 3]).toBeCloseTo(2.0, 6);
  });
  it('una hondonada detrás de un caballón no se llena hasta que el mar lo rebasa', () => {
    const { a, n } = rejilla(null);
    const cota = cotaRebose(a, n, 0.08);
    expect(a[4 * n + 3]).toBeCloseTo(1.2, 6);
    expect(cota[4 * n + 3]).toBeCloseTo(2.08, 6); // caballón + calado mínimo
  });
  it('un paso en el caballón la une al mar solo con calado suficiente', () => {
    const { a, n } = rejilla(1.15);
    const cota = cotaRebose(a, n, 0.08);
    expect(cota[4 * n + 3]).toBeCloseTo(1.23, 6);
    // con el mar a +1,21 el agua de la hondonada (fondo 1,2) sigue aislada; con +1,25, unida
    expect(1.21 > cota[4 * n + 3]).toBe(false);
    expect(1.25 > cota[4 * n + 3]).toBe(true);
  });
});
