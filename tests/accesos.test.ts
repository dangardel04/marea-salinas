// Escaleras y rampa a la arena (src/scene/bahia-accesos.json, de tools/accesos-playa.py): la
// geometría medida en el LiDAR tiene que ser la de una escalera o una rampa de verdad.
import { describe, expect, it } from 'vitest';
import datos from '../src/scene/bahia-accesos.json';
import { estadoPie } from '../src/scene/bahia/accesos';

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

describe('estado del pie de un acceso', () => {
  it('sin medida, nada', () => { expect(estadoPie(null, 25)).toBeNull(); });
  it('con menos de 3 m de arena, el agua llega al pie', () => { expect(estadoPie(1.2, 25)?.estado).toBe('agua'); });
  it('dentro del margen, el agua puede llegar', () => { expect(estadoPie(14, 25)).toEqual({ texto: 'agua cerca', estado: 'cerca' }); });
  it('fuera del margen, los metros de arena de 5 en 5', () => { expect(estadoPie(57.4, 25)).toEqual({ texto: '55 m de arena', estado: 'seco' }); });
});
