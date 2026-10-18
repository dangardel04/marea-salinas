import { describe, expect, it } from 'vitest';
import { stockdon } from '../src/oleaje/runup';
import { estadoEn, rumbo, type Serie } from '../src/oleaje/datos';

describe('run-up de Stockdon et al. (2006)', () => {
  it('reproduce la fórmula a mano para una playa intermedia', () => {
    // H0 = 2 m, T = 10 s, βf = 0,08 → L0 = 9,81·100/2π
    const l0 = (9.81 * 100) / (2 * Math.PI);
    const hl = Math.sqrt(2 * l0);
    const esperado = 1.1 * (0.35 * 0.08 * hl + Math.sqrt(2 * l0 * (0.563 * 0.08 ** 2 + 0.004)) / 2);
    const r = stockdon(2, 10, 0.08)!;
    expect(r.disipativa).toBe(false);
    expect(r.r2).toBeCloseTo(esperado, 10);
  });

  it('usa la expresión disipativa cuando ξ0 < 0,3', () => {
    const r = stockdon(3, 8, 0.01)!;
    expect(r.iribarren).toBeLessThan(0.3);
    expect(r.r2).toBeCloseTo(0.043 * Math.sqrt(3 * (9.81 * 64) / (2 * Math.PI)), 10);
  });

  it('crece con la altura y el periodo de las olas, y devuelve null sin datos', () => {
    expect(stockdon(3, 12, 0.05)!.r2).toBeGreaterThan(stockdon(1, 12, 0.05)!.r2);
    expect(stockdon(2, 14, 0.05)!.r2).toBeGreaterThan(stockdon(2, 8, 0.05)!.r2);
    expect(stockdon(0, 10, 0.05)).toBeNull();
  });
});

describe('interpolación del estado del mar', () => {
  const s: Serie = {
    t: [0, 3_600_000],
    e: [{ hs: 1, tp: 10, dir: 350 }, { hs: 2, tp: 12, dir: 10 }],
    fuente: 'prueba',
  };
  it('interpola altura y periodo linealmente y la dirección por el camino corto (350° → 10°)', () => {
    const m = estadoEn(s, 1_800_000)!;
    expect(m.hs).toBeCloseTo(1.5);
    expect(m.tp).toBeCloseTo(11);
    expect(m.dir).toBeCloseTo(0);
  });
  it('fuera de rango devuelve null', () => {
    expect(estadoEn(s, 4_000_000)).toBeNull();
  });
  it('nombra los rumbos en español', () => {
    expect(rumbo(315)).toBe('NO');
    expect(rumbo(0)).toBe('N');
    expect(rumbo(337.5)).toBe('NNO');
  });
});
