import { describe, expect, it } from 'vitest';
import { estadoCielo, vectorEscena } from '../src/scene/astro';
import { PLAYA } from '../src/config';

describe('posición del sol en Salinas', () => {
  it('en el solsticio de junio la altura máxima es ≈ 90° − latitud + 23,44°', () => {
    let max = -90;
    for (let m = 0; m < 24 * 60; m += 2) max = Math.max(max, estadoCielo(Date.UTC(2026, 5, 21) + m * 60_000).sol.altura);
    // 23,44° = oblicuidad de la eclíptica; la refracción añade algo menos de 0,02° a esa altura.
    expect(max).toBeCloseTo(90 - PLAYA.lat + 23.44, 0);
  });

  it('a mediodía solar el sol está al sur (acimut ≈ 180°) y a medianoche bajo el horizonte', () => {
    let mejor = { alt: -90, az: 0 };
    for (let m = 0; m < 24 * 60; m += 1) {
      const s = estadoCielo(Date.UTC(2026, 9, 18) + m * 60_000).sol;
      if (s.altura > mejor.alt) mejor = { alt: s.altura, az: s.acimut };
    }
    expect(mejor.az).toBeGreaterThan(178);
    expect(mejor.az).toBeLessThan(182);
    expect(estadoCielo(Date.UTC(2026, 9, 18, 23, 30)).sol.altura).toBeLessThan(-20);
  });

  it('el vector de escena es unitario y un sol al NNO (mar) apunta a −z', () => {
    const v = vectorEscena({ altura: 0, acimut: PLAYA.ejeGrados + 270 });
    expect(Math.hypot(...v)).toBeCloseTo(1, 6);
    expect(v[2]).toBeCloseTo(-1, 6);
    const w = vectorEscena({ altura: 0, acimut: PLAYA.ejeGrados });
    expect(w[0]).toBeCloseTo(1, 6);
  });
});
