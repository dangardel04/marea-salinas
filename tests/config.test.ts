import { describe, expect, it } from 'vitest';
import { PLAYA, MAREOGRAFO_AVILES } from '../src/config';

// Caja envolvente del polígono OSM de la playa (way 516073411), ver FUENTES.md §1.
const BBOX = { latMin: 43.5770184, latMax: 43.5915619, lonMin: -5.9682292, lonMax: -5.9389589 };

describe('configuración geográfica', () => {
  it('las coordenadas de la playa caen dentro del polígono de arena de OSM (caja envolvente)', () => {
    expect(PLAYA.lat).toBeGreaterThanOrEqual(BBOX.latMin);
    expect(PLAYA.lat).toBeLessThanOrEqual(BBOX.latMax);
    expect(PLAYA.lon).toBeGreaterThanOrEqual(BBOX.lonMin);
    expect(PLAYA.lon).toBeLessThanOrEqual(BBOX.lonMax);
  });

  it('el mareógrafo de Avilés está a menos de 5 km de la playa', () => {
    const R = 6371;
    const rad = Math.PI / 180;
    const dLat = (MAREOGRAFO_AVILES.lat - PLAYA.lat) * rad;
    const dLon = (MAREOGRAFO_AVILES.lon - PLAYA.lon) * rad;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(PLAYA.lat * rad) * Math.cos(MAREOGRAFO_AVILES.lat * rad) * Math.sin(dLon / 2) ** 2;
    const km = 2 * R * Math.asin(Math.sqrt(a));
    expect(km).toBeLessThan(5);
  });
});
