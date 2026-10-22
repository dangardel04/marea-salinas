// Marco de coordenadas de la escena de la bahía de Salinas (lo comparten la web y tools/).
//
// Plano tangente local con origen en CENTRO: x hacia el este, z hacia el SUR (en three.js el
// norte queda en −z), y hacia arriba en metros sobre el cero hidrográfico de Avilés.
// Metros por grado con las series del elipsoide WGS84 (válidas en todo el recuadro de 6,4 km,
// donde el error de la aproximación plana es inferior a 1 m).

export const CENTRO = { lat: 43.589, lon: -5.955 } as const;

/** Lado del cuadrado que cubre la escena, en metros (raíz del árbol de teselas). */
export const LADO = 6400;
/** Paso de la rejilla de alturas, en metros, y número de nodos por lado. */
export const PASO_RELIEVE = 5;
export const N_RELIEVE = LADO / PASO_RELIEVE + 1;
/** Niveles del árbol de teselas de ortofoto: nivel n tiene 2^n × 2^n teselas. */
export const NIVEL_MAX_ORTO = 5;
/** Nivel de más detalle de la ortofoto, solo en la zona mejorada (tools/bahia-orto-detalle.ts): 0,195 m/píxel. */
export const NIVEL_ORTO_DETALLE = 6;
export const PIXELES_TESELA = 512;

const rad = Math.PI / 180;
const fi = CENTRO.lat * rad;
/** Metros por grado de latitud y de longitud en CENTRO.lat (series WGS84). */
export const M_POR_GRADO_LAT = 111132.92 - 559.82 * Math.cos(2 * fi) + 1.175 * Math.cos(4 * fi) - 0.0023 * Math.cos(6 * fi);
export const M_POR_GRADO_LON = 111412.84 * Math.cos(fi) - 93.5 * Math.cos(3 * fi) + 0.118 * Math.cos(5 * fi);

/** Geográficas → local (x este, z sur), en metros. */
export function aLocal(lat: number, lon: number): { x: number; z: number } {
  return { x: (lon - CENTRO.lon) * M_POR_GRADO_LON, z: -(lat - CENTRO.lat) * M_POR_GRADO_LAT };
}

/** Local → geográficas. */
export function aGeo(x: number, z: number): { lat: number; lon: number } {
  return { lat: CENTRO.lat - z / M_POR_GRADO_LAT, lon: CENTRO.lon + x / M_POR_GRADO_LON };
}

/** Recuadro (en local) de la tesela (nivel, i, j); i crece hacia el este y j hacia el sur. */
export function recuadroTesela(nivel: number, i: number, j: number) {
  const lado = LADO / 2 ** nivel;
  const x0 = -LADO / 2 + i * lado, z0 = -LADO / 2 + j * lado;
  return { x0, z0, x1: x0 + lado, z1: z0 + lado, lado };
}
