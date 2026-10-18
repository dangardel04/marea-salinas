import { describe, expect, it } from 'vitest';
import constantes from '../src/tide/constantes.json';
import { crearMotor } from '../src/tide/motor';
import { calcularCorreccion, correccionEn, DESNIVEL_CERO_PUERTO_SOBRE_CH, TAU_HORAS } from '../src/tide/correccion';

const motor = crearMotor({ z0: constantes.z0Ch, constituyentes: constantes.constituyentes });
const T0 = Date.UTC(2026, 9, 18, 12);

/** Observaciones sintéticas: predicción + un residuo fijo, cada minuto durante 3 h. */
function sinteticas(residuo: number, hasta = T0): [number, number][] {
  const out: [number, number][] = [];
  for (let t = hasta - 3 * 3_600_000; t <= hasta; t += 60_000) out.push([t, motor.altura(t) + DESNIVEL_CERO_PUERTO_SOBRE_CH + residuo]);
  return out;
}

describe('corrección en vivo', () => {
  it('recupera el residuo impuesto y lo aplica completo en t0', () => {
    const c = calcularCorreccion(sinteticas(0.23), motor, T0 + 5 * 60_000)!;
    expect(c.r0).toBeCloseTo(0.23, 6);
    expect(correccionEn(c, T0)).toBeCloseTo(0.23, 6);
  });

  it('decae con τ y no toca el pasado', () => {
    const c = calcularCorreccion(sinteticas(0.2), motor, T0)!;
    expect(correccionEn(c, T0 + TAU_HORAS * 3_600_000)).toBeCloseTo(0.2 / Math.E, 6);
    expect(correccionEn(c, T0 - 60_000)).toBe(0);
  });

  it('descarta datos viejos (más de 3 h) o escasos', () => {
    expect(calcularCorreccion(sinteticas(0.1), motor, T0 + 4 * 3_600_000)).toBeNull();
    expect(calcularCorreccion(sinteticas(0.1).slice(-5), motor, T0)).toBeNull();
    expect(calcularCorreccion([], motor, T0)).toBeNull();
  });

  it('la mediana resiste un pico aislado', () => {
    const obs = sinteticas(0.05);
    obs[obs.length - 3][1] += 2;
    expect(calcularCorreccion(obs, motor, T0)!.r0).toBeCloseTo(0.05, 6);
  });
});
