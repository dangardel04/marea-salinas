// Subida de la orilla por las olas según la marea (medida con Sentinel‑2, bahia-orilla.json).
import { describe, expect, it } from 'vitest';
import { subidaOrilla } from '../src/scene/bahia/arena';
import meta from '../src/scene/bahia-orilla.json';

describe('subida de la orilla', () => {
  it('en los niveles de la tabla da el valor medido', () => {
    meta.nivel.forEach((n, i) => expect(subidaOrilla(n)).toBeCloseTo(meta.subida[i], 10));
  });
  it('entre dos niveles interpola en línea recta', () => {
    const [a, b] = [meta.nivel[3], meta.nivel[4]], [ya, yb] = [meta.subida[3], meta.subida[4]];
    expect(subidaOrilla((a + b) / 2)).toBeCloseTo((ya + yb) / 2, 10);
  });
  it('fuera de lo observado se queda en el extremo', () => {
    expect(subidaOrilla(-1)).toBe(meta.subida[0]);
    expect(subidaOrilla(9)).toBe(meta.subida[meta.subida.length - 1]);
  });
});
