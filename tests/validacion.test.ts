// Fase 4: compara las constantes activas con la tabla oficial del IHM (18-25/10/2026).
// Estas pruebas registran el resultado real, incluido lo que NO cumple (ver VALIDACION.md).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import constantes from '../src/tide/constantes.json';
import { crearMotor } from '../src/tide/motor';

const oficiales = JSON.parse(readFileSync(join(__dirname, '..', 'data', 'ihm_aviles_extremos.json'), 'utf8')).extremos
  .map((e: { utc: string; altura: number; tipo: string }) => ({ t: Date.parse(e.utc), altura: e.altura, tipo: e.tipo }))
  .filter((e: { t: number }) => e.t >= Date.UTC(2026, 9, 18) && e.t < Date.UTC(2026, 9, 26));

const motor = crearMotor({ z0: constantes.z0Ch, constituyentes: constantes.constituyentes });
const predichos = motor.extremos(Date.UTC(2026, 9, 17, 18), Date.UTC(2026, 9, 26, 6));
const pares = oficiales.map((o: { t: number; altura: number; tipo: string }) => {
  const p = predichos.filter((x) => x.tipo === o.tipo).reduce((a, b) => (Math.abs(b.t - o.t) < Math.abs(a.t - o.t) ? b : a));
  return { dtMin: (p.t - o.t) / 60_000, dhCm: (p.altura - o.altura) * 100 };
});

describe(`validación frente al IHM, semana 18-25/10/2026 (constantes: ${constantes.opcion})`, () => {
  it('hay 31 pleamares/bajamares oficiales y todas tienen pareja', () => {
    expect(oficiales.length).toBe(31);
    expect(pares.length).toBe(31);
  });

  it('objetivo de horas (±10 min): se cumple en todas', () => {
    for (const p of pares) expect(Math.abs(p.dtMin)).toBeLessThanOrEqual(10);
  });

  it('objetivo de alturas (±15 cm): con el ajuste a REDMAR NO se cumple en todas; se registra el peor caso', () => {
    const peor = Math.max(...pares.map((p: { dhCm: number }) => Math.abs(p.dhCm)));
    if (constantes.opcion === 'ajuste') {
      // Resultado medido el 18/10/2026: 11 de 31 fuera de ±15 cm, máximo 16,9 cm.
      expect(pares.filter((p: { dhCm: number }) => Math.abs(p.dhCm) > 15).length).toBe(11);
      expect(peor).toBeLessThan(17);
    } else {
      expect(peor).toBeLessThanOrEqual(15);
    }
  });
});

describe('valor conocido el día del cambio de hora (25/10/2026)', () => {
  it('la pleamar oficial de las 02:26 UTC se muestra como 03:26 CET y la predicha cae a menos de 10 min', async () => {
    const { horaMadrid, zonaMadrid } = await import('../src/tiempo');
    const oficial = Date.parse('2026-10-25T02:26:00Z');
    expect(horaMadrid(oficial)).toBe('03:26');
    expect(zonaMadrid(oficial)).toMatch(/CET|GMT\+1/);
    const pred = motor.extremos(oficial - 3 * 3_600_000, oficial + 3 * 3_600_000).find((e) => e.tipo === 'pleamar')!;
    expect(Math.abs(pred.t - oficial) / 60_000).toBeLessThan(10);
  });
});
