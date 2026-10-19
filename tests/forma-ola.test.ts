// Forma de la ola cerca de la costa (Ruessink et al., 2012 + Abreu et al., 2010).
import { describe, expect, it } from 'vitest';
import { abreuDesdeRuessink, formaOla, ruessink, ursell } from '../src/oleaje/formaOla';

const N = 20000;
const muestras = (r: number, phi: number) => Array.from({ length: N }, (_, i) => formaOla((2 * Math.PI * i) / N, r, phi));
const media = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
function asimetria(v: number[]) {
  const m = media(v);
  const m2 = media(v.map((x) => (x - m) ** 2)), m3 = media(v.map((x) => (x - m) ** 3));
  return m3 / m2 ** 1.5;
}

describe('forma de la ola', () => {
  it('Ursell y la sigmoide de Ruessink: B = 0,857/(1 + e^(−0,471/0,297)) con Ur = 1', () => {
    expect(ursell(1, 1, 1)).toBeCloseTo(0.375, 12);
    const { B, psi } = ruessink(1);
    expect(B).toBeCloseTo(0.857 / (1 + Math.exp(-0.471 / 0.297)), 12);
    expect((psi * 180) / Math.PI).toBeCloseTo(-90 + 90 * Math.tanh(0.815), 10);
  });
  it('en aguas hondas (Ur pequeño) la ola es casi un seno; en la orilla, B tiende a 0,857 y ψ a −90°', () => {
    expect(ruessink(0.001).B).toBeLessThan(0.001);
    const somera = ruessink(1000);
    expect(somera.B).toBeCloseTo(0.857, 3);
    expect((somera.psi * 180) / Math.PI).toBeLessThan(-85);
  });
  it('con φ = −π/2 la asimetría vertical de la forma de Abreu es igual a B (así se eligió b)', () => {
    for (const B of [0.2, 0.5, 0.857]) {
      const { r } = abreuDesdeRuessink(B, 0);
      expect(asimetria(muestras(r, -Math.PI / 2))).toBeCloseTo(B, 3);
    }
  });
  it('media cero y media cuadrática √((1 − b²)/2), que el sombreador compensa', () => {
    const { r, phi, b } = abreuDesdeRuessink(0.8, (-60 * Math.PI) / 180);
    const v = muestras(r, phi);
    expect(media(v)).toBeCloseTo(0, 6);
    expect(Math.sqrt(media(v.map((x) => x * x)))).toBeCloseTo(Math.sqrt((1 - b * b) / 2), 4);
  });
  it('con φ = 0 la cara delantera (la subida en el tiempo) es más empinada que la espalda', () => {
    const { r } = abreuDesdeRuessink(0.857, -Math.PI / 2); // φ = 0
    const v = muestras(r, 0);
    const d = v.map((x, i) => v[(i + 1) % N] - x);
    expect(Math.max(...d)).toBeGreaterThan(-Math.min(...d) * 2);
  });
});
