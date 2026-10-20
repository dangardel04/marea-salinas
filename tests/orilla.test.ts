// Orilla dibujada = orilla medida (src/scene/bahia/orilla.ts), sobre una playa inventada con
// pendiente constante: con el ajuste sumado, el agua dibujada (nivel + setup) debe cortar la arena
// donde acaba la medida de arena.ts (nivel + subida medida + corrección del tramo).
import { describe, expect, it } from 'vitest';
import { correccionPerfil, perfiles, subidaOrilla } from '../src/scene/bahia/arena';
import { crearAjusteOrilla } from '../src/scene/bahia/orilla';

// Playa inventada, lisa: baja un 3 % mar adentro desde la recta que une los dos extremos.
const PENDIENTE = 0.03;
const [ax, az] = perfiles[0], [bx, bz] = perfiles[perfiles.length - 1];
const L = Math.hypot(bx - ax, bz - az);
let NX = (bz - az) / L, NZ = -(bx - ax) / L;
if (NX * perfiles[0][2] + NZ * perfiles[0][3] < 0) { NX = -NX; NZ = -NZ; }
const cota = (x: number, z: number) => 3.1 - PENDIENTE * ((x - ax) * NX + (z - az) * NZ);
/** Primer metro del perfil i, desde −80, donde f baja de `linea`. */
function corte(i: number, f: (x: number, z: number) => number, linea: number) {
  const [px, pz, dx, dz] = perfiles[i];
  for (let s = -80; s <= 700; s++) if (f(px + dx * s, pz + dz * s) < linea) return s;
  return null;
}
function medida(i: number, nivel: number) {
  let m = Infinity;
  for (let dn = 0; dn <= 1.5; dn += 0.25) {
    const n = nivel - dn, s = corte(i, cota, n + subidaOrilla(n));
    if (s != null) m = Math.min(m, s + correccionPerfil(i, n));
  }
  return m;
}

describe('ajuste de la orilla', () => {
  const ajuste = crearAjusteOrilla({ cotaMar: cota, altura: cota });
  const vista = (x: number, z: number) => cota(x, z) + ajuste.en(x, z);
  for (const [nivel, setup] of [[1.2, 0.2], [2.2, 0.35], [3.0, 0.1]]) {
    it(`con el mar a ${nivel} m el agua dibujada llega donde acaba la medida`, () => {
      ajuste.invalidar();
      ajuste.actualizar(nivel, setup, 1e9);
      const errores: number[] = [];
      for (let i = 4; i < perfiles.length - 4; i += 5) {
        const m = medida(i, nivel), d = corte(i, vista, nivel + setup);
        if (d == null || !Number.isFinite(m)) continue;
        errores.push(Math.abs(d - m));
      }
      expect(errores.length).toBeGreaterThan(20);
      errores.sort((a, b) => a - b);
      expect(errores[Math.floor(errores.length / 2)]).toBeLessThanOrEqual(2);   // mediana
      // (con solo los perfiles, cada 25 m; en la web, a lo largo del paseo, rayos cada ~4,5 m)
      expect(errores[Math.floor(errores.length * 0.75)]).toBeLessThanOrEqual(5); // tres de cada cuatro
    });
  }
});
