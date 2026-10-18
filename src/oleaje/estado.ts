// Estado del oleaje para la interfaz y la escena: previsión (Open-Meteo), boya de Gijón y
// subida del agua por las olas en la playa (Stockdon et al., 2006).

import playa from './playa.json';
import metaRelieve from '../scene/bahia-meta.json';
import { estadoEn, leerBoya, leerPrevision, type EstadoMar, type Serie } from './datos';
import { stockdon, type Runup } from './runup';

const REFRESCO = 30 * 60_000;

export interface OleajeEn {
  mar: EstadoMar | null;
  runup: Runup | null;
  /** Pendiente usada y si es medida (LiDAR) o aproximada (tramo bajo, sin datos). */
  pendiente: number;
  pendienteMedida: boolean;
  /** Última medida de la boya de Gijón (si hay y es de las últimas 3 h). */
  boya: (EstadoMar & { t: number }) | null;
}

export function crearOleaje() {
  let prevision: Serie | null = null;
  let boya: Serie | null = null;
  let estado: 'conectando' | 'ok' | 'sin-datos' = 'conectando';
  let celda: { lat: number; lon: number } | null = null;

  async function refrescar() {
    const [p, b] = await Promise.allSettled([
      leerPrevision(AbortSignal.timeout(20_000)),
      leerBoya(Date.now(), 48, AbortSignal.timeout(20_000)),
    ]);
    if (p.status === 'fulfilled' && p.value.t.length) { prevision = p.value; celda = p.value.celda; estado = 'ok'; }
    else if (!prevision) estado = 'sin-datos';
    if (b.status === 'fulfilled' && b.value.t.length) boya = b.value;
  }
  refrescar();
  setInterval(refrescar, REFRESCO);

  return {
    estado: () => estado,
    celda: () => celda,
    /** Oleaje y subida del agua en el instante t con el mar a `nivel` m sobre el CH. */
    en(t: number, nivel: number, ahoraReal: number): OleajeEn {
      const mar = estadoEn(prevision, t);
      // El LiDAR solo mide el frente de playa por encima de ~+3,3 m: por debajo, la pendiente
      // es la genérica del relieve (aproximada).
      const pendienteMedida = nivel >= playa.cotas[0];
      const pendiente = pendienteMedida ? playa.mediana : metaRelieve.pendienteGenerica;
      const runup = mar ? stockdon(mar.hs, mar.tp, pendiente) : null;
      let ultimaBoya: OleajeEn['boya'] = null;
      if (boya?.t.length) {
        const k = boya.t.length - 1;
        if (ahoraReal - boya.t[k] < 3 * 3_600_000) ultimaBoya = { ...boya.e[k], t: boya.t[k] };
      }
      return { mar, runup, pendiente, pendienteMedida, boya: ultimaBoya };
    },
  };
}
