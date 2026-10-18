// Relieve fino (1 m) por encima del de 5 m: muestreo, huecos y recuadros.
import { describe, expect, it } from 'vitest';
import { N_RELIEVE } from '../src/bahia';
import { crearRelieve } from '../src/scene/bahia/relieve';
import metaFino from '../src/scene/bahia-fino.json';

describe('relieve fino', () => {
  const grueso = new Int16Array(N_RELIEVE * N_RELIEVE).fill(300); // +3,00 m en toda la bahía
  const relieve = crearRelieve(grueso);
  const V = 101;
  const bloque = new Int16Array(V * V);
  for (let f = 0; f < V; f++) for (let c = 0; c < V; c++) bloque[f * V + c] = 100 + c; // sube 1 cm por metro hacia el este
  bloque[50 * V + 50] = -32768; // un nodo sin dato
  relieve.ponerFino({ bloque: 100, paso: 1, sinDato: -32768, bloques: [[2, 3]] }, bloque);

  it('dentro del bloque manda el fino, interpolado', () => {
    expect(relieve.altura(210.5, 320)).toBeCloseTo(1.105, 6);
    expect(relieve.pasoEn(210.5, 320)).toBe(1);
    expect(relieve.medidoEn(210.5, 320)).toBe(1);
  });
  it('junto a un nodo sin dato y fuera del bloque, el de 5 m', () => {
    expect(relieve.altura(250.5, 350.5)).toBeCloseTo(3, 6);
    expect(relieve.altura(150, 320)).toBeCloseTo(3, 6);
    expect(relieve.pasoEn(150, 320)).toBe(5);
  });
  it('junto al borde del LiDAR pasa poco a poco al de 5 m, sin escalón', () => {
    const borde = relieve.altura(200.01, 320), dentro = relieve.altura(208.5, 320), medio = relieve.altura(204, 320);
    expect(borde).toBeCloseTo(3, 2);
    expect(dentro).toBeCloseTo(1.085, 3);
    expect(medio).toBeGreaterThan(dentro);
    expect(medio).toBeLessThan(borde);
  });
  it('sabe qué recuadros tocan el relieve fino', () => {
    expect(relieve.hayFino(150, 250, 210, 310)).toBe(true);
    expect(relieve.hayFino(0, 0, 199, 299)).toBe(false);
  });
  it('el fichero real trae bloques de 101×101 nodos', () => {
    expect(metaFino.bloque).toBe(100);
    expect(metaFino.bloques.length).toBeGreaterThan(50);
  });
});
