import { describe, expect, it } from 'vitest';
import { createTidePredictor } from '@neaps/tide-predictor';
import { crearMotor } from '../src/tide/motor';
import type { ConjuntoArmonico } from '../src/tide/armonicos';

// Juego de prueba: los 8 mayores constituyentes de TICON-4 «Aviles» (FUENTES.md §2).
// Solo sirve para comprobar que el motor reproduce a la librería de referencia.
const PRUEBA: ConjuntoArmonico = {
  z0: 2.5,
  constituyentes: [
    { name: 'M2', amplitude: 1.3357, phase: 95.78 },
    { name: 'S2', amplitude: 0.4646, phase: 127.89 },
    { name: 'N2', amplitude: 0.2842, phase: 76.03 },
    { name: 'K2', amplitude: 0.1341, phase: 125.71 },
    { name: 'O1', amplitude: 0.0716, phase: 326.28 },
    { name: 'K1', amplitude: 0.0704, phase: 74.31 },
    { name: 'SA', amplitude: 0.0621, phase: 244.91 },
    { name: 'M4', amplitude: 0.0196, phase: 323.66 },
  ],
};

const motor = crearMotor(PRUEBA);
const ref = createTidePredictor(PRUEBA.constituyentes, { offset: PRUEBA.z0 });

describe('motor armónico frente a @neaps/tide-predictor', () => {
  it('la altura coincide en menos de 1 mm cada 10 min durante 8 días', () => {
    const start = new Date('2026-10-18T00:00:00Z');
    const end = new Date('2026-10-26T00:00:00Z');
    const linea = ref.getTimelinePrediction({ start, end, timeFidelity: 600 });
    let peor = 0;
    for (const p of linea) peor = Math.max(peor, Math.abs(motor.altura(p.time.getTime()) - p.level));
    expect(peor).toBeLessThan(0.001);
  });

  it('pleamares y bajamares coinciden en menos de 30 s y 1 mm', () => {
    const start = new Date('2026-10-18T00:00:00Z');
    const end = new Date('2026-10-26T00:00:00Z');
    const suyos = ref.getExtremesPrediction({ start, end });
    const mios = motor.extremos(start.getTime(), end.getTime());
    expect(mios.length).toBe(suyos.length);
    mios.forEach((e, i) => {
      expect(Math.abs(e.t - suyos[i].time.getTime())).toBeLessThan(30_000);
      expect(Math.abs(e.altura - suyos[i].level)).toBeLessThan(0.001);
      expect(e.tipo === 'pleamar').toBe(suyos[i].high);
    });
  });

  it('alterna pleamar y bajamar y hay ~4 por día', () => {
    const t0 = Date.UTC(2026, 9, 18);
    const ex = motor.extremos(t0, t0 + 7 * 86_400_000);
    for (let i = 1; i < ex.length; i++) expect(ex[i].tipo).not.toBe(ex[i - 1].tipo);
    expect(ex.length).toBeGreaterThanOrEqual(26);
    expect(ex.length).toBeLessThanOrEqual(28);
  });

  it('la tendencia es coherente con la pleamar/bajamar siguiente', () => {
    const t0 = Date.UTC(2026, 9, 18, 12);
    const sig = motor.extremos(t0, t0 + 13 * 3_600_000)[0];
    expect(motor.tendencia(t0).sentido).toBe(sig.tipo === 'pleamar' ? 'subiendo' : 'bajando');
  });

  it('es continua al cruzar la medianoche UTC (cambio de parámetros diarios)', () => {
    const t = Date.UTC(2026, 9, 25);
    expect(Math.abs(motor.altura(t - 1) - motor.altura(t))).toBeLessThan(0.0005);
  });

  it('funciona en los límites del año (31/12 → 01/01)', () => {
    const t = Date.UTC(2027, 0, 1);
    expect(Math.abs(motor.altura(t - 1) - motor.altura(t))).toBeLessThan(0.0005);
    const ex = motor.extremos(t - 12 * 3_600_000, t + 12 * 3_600_000);
    expect(ex.length).toBeGreaterThanOrEqual(3);
  });
});
