import { describe, expect, it } from 'vitest';
import constantes from '../src/tide/constantes.json';
import { crearMotor } from '../src/tide/motor';
import { nombresDesconocidos } from '../src/tide/armonicos';

const motor = crearMotor({ z0: constantes.z0Ch, constituyentes: constantes.constituyentes });

describe('constantes activas (src/tide/constantes.json)', () => {
  it('todos los constituyentes tienen definición astronómica', () => {
    expect(nombresDesconocidos(constantes.constituyentes)).toEqual([]);
  });

  it('M2 es el constituyente dominante, como corresponde al Cantábrico', () => {
    const m2 = constantes.constituyentes.find((c) => c.name === 'M2')!;
    for (const c of constantes.constituyentes) expect(m2.amplitude).toBeGreaterThanOrEqual(c.amplitude);
  });

  it('funciona sin red sobre la hora actual: altura, tendencia y próximos extremos', () => {
    const ahora = Date.now();
    const h = motor.altura(ahora);
    expect(h).toBeGreaterThan(-0.5);
    expect(h).toBeLessThan(5.5);
    const p = motor.proximos(ahora);
    expect(p.pleamar!.t).toBeGreaterThan(ahora);
    expect(p.bajamar!.t).toBeGreaterThan(ahora);
    expect(p.pleamar!.altura).toBeGreaterThan(p.bajamar!.altura);
  });

  it('la mayor bajamar astronómica de 2026 queda cerca del cero hidrográfico (±0,5 m)', () => {
    const ini = Date.UTC(2026, 0, 1), fin = Date.UTC(2027, 0, 1);
    const minimo = motor.extremos(ini, fin).filter((e) => e.tipo === 'bajamar').reduce((m, e) => Math.min(m, e.altura), Infinity);
    expect(Math.abs(minimo)).toBeLessThan(0.5);
  });
});
