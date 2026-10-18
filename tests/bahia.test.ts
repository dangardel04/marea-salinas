import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { aGeo, aLocal, LADO, N_RELIEVE, PASO_RELIEVE } from '../src/bahia';
import { MAREOGRAFO_AVILES, PLAYA } from '../src/config';
import orto from '../src/scene/bahia-orto.json';
import edificios from '../src/scene/bahia-edificios.json';

const RAIZ = join(__dirname, '..');
const b = readFileSync(join(RAIZ, 'public', 'bahia', 'relieve.bin'));
const rel = new Int16Array(b.buffer, b.byteOffset, b.byteLength / 2);
const altura = (x: number, z: number) => rel[Math.round((z + LADO / 2) / PASO_RELIEVE) * N_RELIEVE + Math.round((x + LADO / 2) / PASO_RELIEVE)] / 100;

describe('marco de coordenadas de la bahía', () => {
  it('geográficas → local → geográficas vuelve al mismo punto (< 1 mm)', () => {
    const l = aLocal(PLAYA.lat, PLAYA.lon);
    const g = aGeo(l.x, l.z);
    expect(Math.abs(g.lat - PLAYA.lat) * 111_000).toBeLessThan(0.001);
    expect(Math.abs(g.lon - PLAYA.lon) * 80_000).toBeLessThan(0.001);
  });
  it('el norte es −z y el este +x', () => {
    expect(aLocal(43.6, -5.955).z).toBeLessThan(0);
    expect(aLocal(43.589, -5.94).x).toBeGreaterThan(0);
  });
  it('1 km de latitud mide 1 km (series WGS84, comparadas con un grado ≈ 111,1 km a 43,6°N)', () => {
    const d = aLocal(43.589 + 1 / 111.1, -5.955).z;
    expect(Math.abs(Math.abs(d) - 1000)).toBeLessThan(2);
  });
});

describe('relieve de la bahía', () => {
  it('tiene N×N nodos', () => {
    expect(rel.length).toBe(N_RELIEVE * N_RELIEVE);
  });
  it('el pueblo de Salinas (calle detrás del paseo) está en tierra medida y el centro de la bahía es mar', () => {
    const p = aLocal(43.5765, -5.9625);
    expect(altura(p.x, p.z)).toBeGreaterThan(5);
    expect(altura(0, 0)).toBeLessThan(-3);
  });
  it('la orilla del mareógrafo de Avilés queda a pocos metros del agua', () => {
    const p = aLocal(MAREOGRAFO_AVILES.lat, MAREOGRAFO_AVILES.lon);
    expect(Math.abs(altura(p.x, p.z))).toBeLessThan(12);
  });
});

describe('ortofoto y edificios', () => {
  it('existen todas las teselas del índice', () => {
    let faltan = 0;
    for (const [n, lista] of Object.entries(orto.indice as Record<string, string[]>)) {
      for (const k of lista) if (!existsSync(join(RAIZ, 'public', 'bahia', 'orto', n, `${k}.jpg`))) faltan++;
    }
    expect(faltan).toBe(0);
  });
  it('el binario de edificios cuadra con su índice (9 bytes por vértice) y son triángulos', () => {
    const e = readFileSync(join(RAIZ, 'public', 'bahia', 'edificios.bin'));
    expect(e.length).toBe(edificios.vertices * 9);
    expect(edificios.vertices % 3).toBe(0);
    expect(edificios.partes).toBeGreaterThan(5000);
  });
});
