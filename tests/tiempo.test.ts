import { describe, expect, it } from 'vitest';
import {
  horaMadrid, zonaMadrid, desfaseMadridMin, inicioDiaMadrid, inicioDiaSiguienteMadrid, utcDesdeMadrid, partesMadrid,
} from '../src/tiempo';

const H = 3_600_000;

describe('cambio de hora del domingo 25 de octubre de 2026', () => {
  // En la UE el horario de verano termina el último domingo de octubre a las 01:00 UTC.
  const cambio = Date.UTC(2026, 9, 25, 1, 0);

  it('a las 00:59 UTC aún es verano (CEST, UTC+2) y a las 01:00 UTC ya es invierno (CET, UTC+1)', () => {
    expect(desfaseMadridMin(cambio - 60_000)).toBe(120);
    expect(desfaseMadridMin(cambio)).toBe(60);
    expect(horaMadrid(cambio - 60_000)).toBe('02:59');
    expect(horaMadrid(cambio)).toBe('02:00');
    expect(zonaMadrid(cambio - H)).toMatch(/CEST|GMT\+2/);
    expect(zonaMadrid(cambio + H)).toMatch(/CET|GMT\+1/);
  });

  it('el domingo 25 dura 25 horas en Madrid', () => {
    const ini = inicioDiaMadrid(Date.UTC(2026, 9, 25, 12));
    const fin = inicioDiaSiguienteMadrid(ini);
    expect(ini).toBe(Date.UTC(2026, 9, 24, 22)); // 00:00 CEST
    expect(fin).toBe(Date.UTC(2026, 9, 25, 23)); // 00:00 CET del lunes
    expect((fin - ini) / H).toBe(25);
  });

  it('el sábado 24 dura 24 horas y el lunes 26 también', () => {
    const sab = inicioDiaMadrid(Date.UTC(2026, 9, 24, 12));
    expect((inicioDiaSiguienteMadrid(sab) - sab) / H).toBe(24);
    const lun = inicioDiaMadrid(Date.UTC(2026, 9, 26, 12));
    expect((inicioDiaSiguienteMadrid(lun) - lun) / H).toBe(24);
  });

  it('una hora civil de Madrid se convierte a UTC con el desfase correcto a cada lado del cambio', () => {
    expect(utcDesdeMadrid(2026, 10, 24, 12, 0)).toBe(Date.UTC(2026, 9, 24, 10, 0));
    expect(utcDesdeMadrid(2026, 10, 26, 12, 0)).toBe(Date.UTC(2026, 9, 26, 11, 0));
  });

  it('las 02:30 se repiten: la primera es CEST y una hora después CET', () => {
    const primera = Date.UTC(2026, 9, 25, 0, 30);
    const segunda = Date.UTC(2026, 9, 25, 1, 30);
    expect(horaMadrid(primera)).toBe('02:30');
    expect(horaMadrid(segunda)).toBe('02:30');
    expect(utcDesdeMadrid(2026, 10, 25, 2, 30)).toBe(primera);
  });
});

describe('límites del año', () => {
  it('Nochevieja 23:30 en Madrid es 22:30 UTC y el día siguiente es 1 de enero', () => {
    const t = utcDesdeMadrid(2026, 12, 31, 23, 30);
    expect(t).toBe(Date.UTC(2026, 11, 31, 22, 30));
    const p = partesMadrid(t + H);
    expect([p.anio, p.mes, p.dia]).toEqual([2027, 1, 1]);
    expect(inicioDiaSiguienteMadrid(t)).toBe(Date.UTC(2026, 11, 31, 23));
  });

  it('cambio de hora de primavera 2027: el domingo 28 de marzo dura 23 horas', () => {
    const ini = inicioDiaMadrid(Date.UTC(2027, 2, 28, 12));
    expect((inicioDiaSiguienteMadrid(ini) - ini) / H).toBe(23);
  });
});
