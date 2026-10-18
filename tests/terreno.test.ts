import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import meta from '../src/scene/terreno-meta.json';
import { NMMA_SOBRE_CH_APROX } from '../src/config';

const buf = readFileSync(join(__dirname, '..', 'public', 'terreno.bin'));
const cm = new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2);

describe('relieve de la escena (MDT05 del IGN)', () => {
  it('el binario tiene exactamente nu × nv celdas', () => {
    expect(cm.length).toBe(meta.nu * meta.nv);
  });

  it('cada perfil baja de las dunas (tierra) al mar', () => {
    for (let a = 0; a < meta.nu; a += 20) {
      const tierra = cm[a * meta.nv] / 100, mar = cm[a * meta.nv + meta.nv - 1] / 100;
      expect(tierra).toBeGreaterThan(mar);
      expect(mar).toBeLessThan(-2); // mar adentro, por debajo del NMMA
    }
  });

  it('la orilla en bajamar viva (≈0,6 m sobre el CH) queda dentro de la malla', () => {
    const umbralNmma = 0.6 - NMMA_SOBRE_CH_APROX;
    for (let a = 0; a < meta.nu; a += 20) {
      const perfil = Array.from({ length: meta.nv }, (_, b) => cm[a * meta.nv + b] / 100);
      const cruce = perfil.findIndex((h) => h < umbralNmma);
      expect(cruce).toBeGreaterThan(0);
      expect(cruce).toBeLessThan(meta.nv - 1);
    }
  });
});
