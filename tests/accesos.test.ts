// Escaleras y rampa a la arena (src/scene/bahia-accesos.json, de tools/accesos-playa.py): la
// geometría medida en el LiDAR tiene que ser la de una escalera o una rampa de verdad.
import { describe, expect, it } from 'vitest';
import datos from '../src/scene/bahia-accesos.json';

describe('accesos a la playa', () => {
  const piezas = datos.accesos.flatMap((a) => a.piezas.map((p) => ({ ...p, id: a.id })));
  it('hay una sola «escalera 1»', () => {
    expect(datos.accesos.filter((a) => a.nombre === 'Escalera 1')).toHaveLength(1);
  });
  for (const p of piezas.filter((q) => q.clase !== 'rellano')) {
    const largo = Math.hypot(p.b[0] - p.a[0], p.b[2] - p.a[2]);
    const desnivel = Math.abs(p.b[1] - p.a[1]);
    it(`${p.id}: ${p.clase} con pendiente razonable (${(desnivel / largo * 100).toFixed(0)} %)`, () => {
      expect(desnivel).toBeGreaterThan(3);
      expect(desnivel).toBeLessThan(6);
      if (p.clase === 'escalera') { expect(desnivel / largo).toBeGreaterThan(0.35); expect(desnivel / largo).toBeLessThan(0.85); }
      else { expect(desnivel / largo).toBeLessThan(0.2); }
      expect(p.t1).toBeGreaterThan(p.t0);
    });
  }
});
