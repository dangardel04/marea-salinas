# Fuentes de datos

Todas las consultas se hicieron el **18/10/2026**, salvo que se indique otra fecha.
Las horas de todas las fuentes de marea se han comprobado y están en **UTC**.

## 1. Situación de la playa

| Dato | Valor | Fuente |
|---|---|---|
| Coordenadas de la playa de Salinas | 43.577406, −5.962143 | Turismo Asturias (portal oficial de turismo del Principado): https://www.turismoasturias.es/de/descubre/costa/playas/playa-de-salinas |
| Polígono de la arena (Salinas + El Espartal + San Juan) | caja 43.5770–43.5916 N, −5.9682 a −5.9390 E | OpenStreetMap, way 516073411, consultado con Nominatim: https://nominatim.openstreetmap.org/lookup?osm_ids=W516073411&format=json&polygon_geojson=1 (© colaboradores de OpenStreetMap, ODbL) |
| Orientación del eje de la playa | 57,8° (SO–NE); el mar queda hacia el NNO | Calculado por análisis de componentes principales del polígono OSM anterior (`tools/` no lo recalcula; se hizo una vez y el número se guardó en `src/config.ts`). Longitud del polígono a lo largo del eje: ≈2,7 km |

No conseguí la ficha de la Guía de Playas del MITECO: el conjunto de datos de datos.gob.es tiene los enlaces rotos. Las coordenadas de Turismo Asturias caen dentro del polígono de arena de OSM (comprobado en `tests/config.test.ts`).

## 2. Fuentes de marea cerca de Salinas

| Fuente | Qué da | Predicción u observación | API abierta | CORS desde navegador |
|---|---|---|---|---|
| **IHM**, API `ideihm.covam.es/api-ihm/getmarea`, puerto id 7 «Avilés (San Juan de Nieva)», 43.591667 N −5.93 E | Pleamares y bajamares diarias (hora y altura) y curva cada 5 min, 30 min o 1 h por meses | Predicción astronómica oficial | Sí, sin clave | Sí (`Access-Control-Allow-Origin: *`) |
| **IHM**, mismo servicio, puerto id 6 «Gijón» | Igual | Predicción astronómica oficial | Sí | Sí |
| **Puertos del Estado, REDMAR**: mareógrafo Avilés 2 (estación 3107), radar Miros, esquina del muelle oeste de San Juan de Nieva, 43.59138 N −5.92993 E | Nivel del mar cada minuto, con indicador de calidad | Observación | Sí: `https://poem.puertos.es/portus/StationData?code=3107&params=SeaLevel&from=AAAAMMDD@HHMM&to=AAAAMMDD@HHMM` (sin clave, límite de 300 peticiones por ventana) | Sí (`Access-Control-Allow-Origin: *`) |
| REDMAR, mareógrafo Gijón 2 (3108), 43.55803 N −5.69835 E | Igual, con histórico desde 1995 | Observación | Sí, mismo servicio | Sí |
| REDMAR, ficheros THREDDS a 2 Hz (`opendap.puertos.es/thredds/catalog/tidegauge_avi2/…`) | Señal bruta del radar a 2 Hz | Observación bruta | Sí (OPeNDAP) | No comprobado. **No sirve**: la variable `SLEV` sale invertida respecto al nivel del mar (correlación −1 con la predicción del IHM y +0,99 con la misma señal de Gijón), así que parece la distancia del radar al agua. No se usa. |
| **TICON‑4** (Hart‑Davis, Dettmering y Seitz, 2025), distribuido en el paquete npm `@neaps/tide-database` 0.10.20260924 | 50 constantes armónicas para «Aviles» (datos de 27/04/2021 a 30/06/2025) y «Gijon» (30/06/2006 a 30/06/2025), calculadas con registros de GESLA‑4/CMEMS | Constantes derivadas de observaciones | Fichero descargable: https://doi.org/10.17882/109129 | No aplica (se empaqueta offline) |
| **Open‑Meteo Marine API**, `sea_level_height_msl` | Nivel del mar horario respecto al nivel medio, de un modelo numérico global | Predicción de modelo (marea + parte meteorológica) | Sí, sin clave | Sí (`*`) |

Otras comprobaciones:

- **Constantes armónicas oficiales españolas**: no encontré constantes publicadas por Puertos del Estado ni por el IHM para Avilés o Gijón. Los informes REDMAR por puerto (p. ej. https://bancodatos.puertos.es/BD/informes/globales/GLOB_2_3_3853.pdf) dicen que las predicciones salen de constantes armónicas, pero no las listan. **No dispongo de constantes armónicas oficiales con certeza.**
- **Open‑Meteo**: la celda marina más cercana que devuelve está en 43.708 N, −5.958 E, a unos 14 km mar adentro, con resolución horaria y nivel referido al nivel medio, no al cero hidrográfico. No es una fuente de puerto. Se descarta como referencia.
- **Estado del mareógrafo de Avilés**: la ficha de Portus (`https://portus.puertos.es/portussvr/api/estaciones/hist?id=3107`) dice «Temporalmente fuera de servicio», pero el servicio `StationData` devuelve datos válidos (QC = 1) desde el 01/10/2025 hasta hoy. La estación anterior (Datamar 3000C, en la misma posición) funcionó hasta el 11/09/2025; sus datos no están en ese servicio.

### Puerto de referencia elegido: Avilés (San Juan de Nieva)

- Es el más cercano: el mareógrafo y el punto del IHM están a unos 3 km de la playa, en la bocana de la ría, abiertos al mismo tramo de costa. Gijón queda a 21 km, al otro lado del cabo Peñas.
- Tiene tabla oficial del IHM (para validar), observaciones minutales de REDMAR accesibles desde el navegador (para la corrección en vivo) y constantes publicadas en TICON‑4.
- Gijón se usa como **control independiente**: es el único de los dos con la relación entre ceros publicada oficialmente (ver §3).

## 3. Nivel de referencia (ceros)

| Dato | Valor | Fuente |
|---|---|---|
| Cero de las observaciones de Avilés 2 | «Cero del Puerto», 6,20 m bajo el clavo E2 | Portus, `https://portus.puertos.es/portussvr/api/mareografoDetalle/3107?locale=es` |
| Nivel medio local de Avilés 2 sobre su cero | 2,863 m (periodo no indicado) | Mismo recurso (`nivelmedio: 2863`) y `PortusData/rtChart?station=3107` (`nMed: -2.863`) |
| Relación cero del puerto de Avilés ↔ cero hidrográfico | **No publicada.** El esquema de datum de Avilés (`https://portus.puertos.es/Portus/pdf/datums/3107.pdf`) devuelve «DOCUMENTO NO DISPONIBLE» | — |
| Cero hidrográfico de Gijón | 0,350 m **por encima** del cero REDMAR (clavo NGU‑83: 6,026 m sobre el cero REDMAR y 5,676 m sobre el cero hidrográfico) | Esquema datum oficial: `https://portus.puertos.es/Portus/pdf/datums/3108.pdf` y `mareografoDetalle/3108` (`diffRedmarHidrografico: 0.35`) |
| Nivel medio de Gijón sobre el cero REDMAR | 2,734 m | Mismo esquema datum |
| Qué es el cero hidrográfico del IHM | La Mayor Bajamar Astronómica (LAT), calculada con una predicción de 19 años a partir de constantes de al menos un año de datos | IHM, «Cero Hidrográfico»: https://armada.defensa.gob.es/ihm/doc/Cero_Hidrografico.pdf |
| Referencia de las alturas de la API del IHM | El servicio no la indica en su respuesta. Se asume el cero hidrográfico porque el mínimo de toda la curva oct‑2025/dic‑2026 de Avilés es +0,254 m (nunca negativo, como corresponde a alturas sobre la LAT). **Es una inferencia, no una cita.** | `tests/datos.test.ts` |
| Huso de la API del IHM | UTC. La curva lo rotula «Horas UTC» y añade «Para obtener la hora local sumar dos horas en horario de verano y una en horario de invierno». Las pleamares/bajamares del JSON coinciden con los extremos de esa curva (±5 min, comprobado en 150+ casos) | Página `format=gra` del servicio; `tests/datos.test.ts` |
| Huso de Portus `StationData` | UTC (cabecera `"UTC"` y segundos UNIX). La correlación con la curva del IHM es máxima con desfase de minutos, no de horas | `tests/datos.test.ts` |

**Referencia que usa la aplicación:** todas las alturas se expresan sobre el **cero hidrográfico de Avilés que usa el IHM** en sus predicciones, porque es la referencia de la tabla oficial con la que se valida y la que entiende cualquier usuario de tablas de marea. Cómo se enlaza con las observaciones se documenta en la fase 3 (`VALIDACION.md`).
