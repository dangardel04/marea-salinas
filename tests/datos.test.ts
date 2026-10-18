// Comprobaciones sobre los datos descargados (fase 2). Requieren haber ejecutado
// node tools/descargar.ts; los ficheros derivados de data/ están versionados.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DATA = join(__dirname, '..', 'data');
const csv = (f: string) => readFileSync(join(DATA, f), 'utf8').trim().split('\n').slice(1).map((l) => l.split(','));

const curva = csv('ihm_aviles_5min.csv').map(([t, h]) => ({ t: Date.parse(t), h: +h }));
const extremos = JSON.parse(readFileSync(join(DATA, 'ihm_aviles_extremos.json'), 'utf8')).extremos
  .map((e: { utc: string; altura: number; tipo: string }) => ({ t: Date.parse(e.utc), h: e.altura, tipo: e.tipo }));
const obs = csv('obs_aviles_10min.csv').map(([, s, h]) => ({ t: +s * 1000, h: +h }));

describe('predicción oficial del IHM (Avilés)', () => {
  it('las pleamares/bajamares del JSON caen en los extremos de la curva «Horas UTC» (mismo huso)', () => {
    let comprobados = 0;
    for (const e of extremos.slice(0, 200)) {
      // Extremo de la curva en ±40 min alrededor de la hora del JSON.
      const vecinos = curva.filter((p) => Math.abs(p.t - e.t) <= 40 * 60_000);
      if (vecinos.length < 15) continue;
      const mejor = vecinos.reduce((a, b) => ((e.tipo === 'pleamar' ? b.h > a.h : b.h < a.h) ? b : a));
      expect(Math.abs(mejor.t - e.t)).toBeLessThanOrEqual(5 * 60_000);
      expect(Math.abs(mejor.h - e.h)).toBeLessThan(0.01);
      comprobados++;
    }
    expect(comprobados).toBeGreaterThan(150);
  });

  it('ninguna altura es negativa: coherente con un cero en la bajamar mínima astronómica', () => {
    expect(curva.reduce((m, p) => Math.min(m, p.h), Infinity)).toBeGreaterThanOrEqual(0);
  });
});

describe('observaciones REDMAR de Avilés frente a la curva del IHM', () => {
  // Desfase (min) que maximiza la correlación entre observación y predicción oficial.
  function mejorDesfase() {
    const porT = new Map(curva.map((p) => [p.t, p.h]));
    let mejor = { lag: 0, r: -2 };
    for (let lag = -180; lag <= 180; lag += 5) {
      const x: number[] = [], y: number[] = [];
      for (const o of obs) {
        const p = porT.get(o.t + lag * 60_000);
        if (p !== undefined) { x.push(o.h); y.push(p); }
      }
      const mx = x.reduce((s, v) => s + v, 0) / x.length, my = y.reduce((s, v) => s + v, 0) / y.length;
      let sxy = 0, sxx = 0, syy = 0;
      for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
      const r = sxy / Math.sqrt(sxx * syy);
      if (r > mejor.r) mejor = { lag, r };
    }
    return mejor;
  }
  const m = mejorDesfase();

  it('la serie observada no está invertida (correlación > 0,98)', () => {
    expect(m.r).toBeGreaterThan(0.98);
  });

  it('ambas están en UTC: el mejor desfase es de minutos, no de 1 o 2 horas', () => {
    expect(Math.abs(m.lag)).toBeLessThanOrEqual(15);
  });
});
