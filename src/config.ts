// Configuración geográfica y de fuentes. Cada valor está citado en FUENTES.md.

/** Playa de Salinas (Castrillón, Asturias). Fuente: Turismo Asturias (ver FUENTES.md §1). */
export const PLAYA = {
  nombre: 'Playa de Salinas',
  municipio: 'Castrillón (Asturias)',
  lat: 43.577406,
  lon: -5.962143,
  /**
   * Orientación del eje mayor de la playa (grados desde el norte, sentido horario),
   * calculada por análisis de componentes principales del polígono OSM way 516073411.
   * El mar queda hacia el lado NNO (eje + 270°).
   */
  ejeGrados: 57.8,
} as const;

/** Mareógrafo REDMAR Avilés 2 (Puertos del Estado, estación 3107). */
export const MAREOGRAFO_AVILES = {
  id: 3107,
  nombre: 'Mareógrafo de Avilés 2 (REDMAR)',
  lat: 43.59138,
  lon: -5.92993,
} as const;

/** Puerto de referencia del IHM para las tablas oficiales: Avilés (San Juan de Nieva), id 7. */
export const PUERTO_IHM = {
  id: 7,
  nombre: 'Avilés (San Juan de Nieva)',
  lat: 43.591667,
  lon: -5.93,
} as const;

/**
 * Altura del NMMA (cero del MDT del IGN) sobre el cero hidrográfico de Avilés, en metros.
 * APROXIMADA, solo para colocar el relieve de la escena (no interviene en la marea):
 *   nivel medio sobre el CH en Avilés (media de la curva IHM 2026)            2,4675 m
 * − nivel medio local sobre el NMMA, tomado de Gijón (datum oficial Gijón 2:
 *   NM 2,734 m − NMMA 2,361 m sobre el cero REDMAR = 0,373 m)                 0,373 m
 * Para Avilés no hay esquema de datum publicado; se asume la misma diferencia que en Gijón.
 */
export const NMMA_SOBRE_CH_APROX = 2.4675 - 0.373;

/** Zona horaria en la que se muestra todo. Internamente se trabaja en UTC. */
export const ZONA_HORARIA = 'Europe/Madrid';
