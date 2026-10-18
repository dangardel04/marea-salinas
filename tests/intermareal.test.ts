// Franja intermareal medida con la línea de agua de Sentinel‑2 (tools/intermareal-s2.py).
import { describe, expect, it } from 'vitest';
import s2 from '../data/intermareal_s2.json';
import playa from '../src/oleaje/playa.json';

describe('intermareal Sentinel‑2', () => {
  it('cada perfil válido baja hacia el mar y se queda en su rango de cotas', () => {
    const validos = s2.perfiles.filter((p) => p.ajuste);
    expect(validos.length).toBe(s2.resumen.perfilesValidos);
    for (const p of validos) {
      const pts = p.ajuste!.puntos;
      for (let i = 1; i < pts.length; i++) {
        expect(pts[i][0]).toBeGreaterThan(pts[i - 1][0]);
        expect(pts[i][1]).toBeLessThan(pts[i - 1][1]);
      }
      expect(pts[pts.length - 1][1]).toBeGreaterThanOrEqual(s2.resumen.cotas[0] - 0.005); // cotas del resumen redondeadas a cm
      expect(pts[0][1]).toBeLessThanOrEqual(s2.cotaMax + 1e-6);
    }
  });

  it('dejando cada imagen fuera, falla menos que el relieve genérico en las mismas orillas', () => {
    const v = s2.resumen.validacionDejandoUnaFuera, g = s2.resumen.mismosPuntosRelieveGenerico;
    expect(v.casos).toBe(g.casos);
    expect(v.rms).toBeLessThan(g.rms);
    // Resultado del 19/10/2026 (con el LiDAR de 2024): 0,45 m frente a 2,86 m.
    expect(v.rms).toBeLessThan(0.6);
  });

  it('la subida del agua usa la pendiente del satélite entre la orilla más baja y la arena del LiDAR', () => {
    expect(playa.intermareal.cotas[1]).toBe(playa.cotas[0]);
    expect(playa.intermareal.mediana).toBeCloseTo(s2.resumen.pendienteMediana, 4);
  });
});
