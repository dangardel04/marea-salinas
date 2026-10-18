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

## 4. Escena 3D de la primera versión (un solo tramo de playa)

> **Sustituida por la sección 5** (bahía completa). Se conserva por trazabilidad: el desnivel NMMA → CH aproximado sigue en uso, `tools/mdt.ts` y `public/terreno.bin` se han retirado del código.

| Dato | Valor | Fuente |
|---|---|---|
| Relieve de dunas y arena seca | MDT de 5 m (LiDAR PNOA), alturas sobre el NMMA (Alicante) | IGN, servicio WCS INSPIRE `https://servicios.idee.es/wcs-inspire/mdt`, cobertura `Elevacion4258_5`, formato `application/asc` (el formato TIFF del servicio redondea a metros enteros). Procesado con `tools/mdt.ts` |
| Franja intermareal y fondo | **APROXIMADOS**: el MDT pone 0 en el agua y no incluye la arena que estaba cubierta durante el vuelo. Desde el último punto emergido se prolonga una pendiente genérica de 1:50 hasta −9 m NMMA. No se ha medido | `tools/mdt.ts`, `src/scene/terreno-meta.json` |
| NMMA sobre el CH de Avilés | 2,095 m, **APROXIMADO**: nivel medio sobre el CH en Avilés (2,4675 m, curva IHM 2026) menos el nivel medio local sobre el NMMA medido en Gijón (0,373 m, esquema datum oficial Gijón 2). Solo sirve para colocar el relieve; no interviene en el cálculo de la marea | `src/config.ts` |
| Sol y luna | suncalc 2.1.1. La fase de la luna sale de iluminar la esfera lunar con la dirección real del sol | https://github.com/mourner/suncalc |
| Oleaje | **Decorativo**: cuatro trenes de Gerstner con longitudes y alturas fijas, sin datos de oleaje real | `src/scene/escena.ts` |
| Tamaño de la luna | Dibujada 3 veces mayor que su diámetro aparente real (0,52°) para que se aprecie la fase | `src/scene/escena.ts` |

## 5. Bahía completa en 3D (consultado el 18/10/2026)

| Dato | Valor | Fuente y licencia |
|---|---|---|
| Recuadro de la escena | Cuadrado de 6,4 km centrado en 43,589 N −5,955 E (de Arnao a la ría de Avilés) | `src/bahia.ts` |
| Relieve en tierra | MDT de 5 m (LiDAR PNOA) sobre el NMMA, pasado al CH con el desnivel aproximado de §4. En la playa, el paseo y las dunas manda la nube LiDAR de 2024 (§8) | IGN, WCS INSPIRE `servicios.idee.es/wcs-inspire/mdt`, cobertura `Elevacion4258_5`. © Instituto Geográfico Nacional, CC BY 4.0 |
| Fondo marino | EMODnet Bathymetry DTM 2024, rejilla de 1/16′ (~115 m), referido a la LAT (*«published for viewing and downloading in LAT»*) | https://emodnet.ec.europa.eu/en/bathymetry, WCS `ows.emodnet-bathymetry.eu`, cobertura `emodnet__mean`. CC BY 4.0 |
| Franja intermareal de la playa | **Medida desde satélite** por debajo de lo que midió el LiDAR de 2024, donde el perfil es válido (22,2 ha, hasta +1,15 m sobre el CH): ver §7 | `tools/intermareal-s2.py`, `data/intermareal_s2.json` |
| Resto de la franja intermedia | **APROXIMADA**: transición en 250 m de una pendiente 1:50 desde lo último conocido (arena medida o franja de §7) a EMODnet | `tools/bahia-relieve.ts` |
| Ortofoto | PNOA máxima actualidad, vuelo de **septiembre de 2023** en la playa, 0,25 m/píxel. Servida en teselas de 12,5 a 0,39 m/píxel | IGN, WMS `www.ign.es/wms-inspire/pnoa-ma`, capa `OI.OrthoimageCoverage`. Fecha consultada con `GetFeatureInfo` de la capa `OI.MosaicElement`. CC BY 4.0, © IGN |
| Edificios | Huella y número de plantas sobre rasante de 12.905 partes de edificio | Dirección General del Catastro, INSPIRE Buildings, `ovc.catastro.meh.es/INSPIRE/wfsBU.aspx`, `BU:BuildingPart`. Reutilización libre citando la fuente |
| Altura de los edificios | **SUPUESTO**: 3 m por planta. El Catastro no da alturas | `tools/bahia-edificios.ts` |
| Color de tejados | Media de la ortofoto dentro de cada huella | — |
| Color de la arena dibujada | **Medido**: arena seca de la ortofoto, sRGB (199, 199, 193) de mediana en 15.833 píxeles (nodos de LiDAR entre +3,4 y +5,5 m con poca pendiente). Se usa donde la foto no sirve (arena que cubre la marea, o agua y espuma del día del vuelo sobre la playa) y de cerca, donde la foto se ve borrosa, con el tono local de la foto. El grano, el oscurecimiento al mojarse, el brillo de la lámina de agua y la línea de pleamar con restos son **ilustrativos**. Las caras casi verticales junto al mar (el muro del paseo) se dibujan de piedra, porque la ortofoto cenital se estira en ellas | `tools/arena-color.py`, `src/scene/bahia-arena.json` |
| Fachadas | **Decorativas** (color neutro y bandas de plantas) | — |
| Puntos de arena de las vistas | Polígono de la playa en OpenStreetMap (way 516073411), © colaboradores de OpenStreetMap, ODbL | `src/scene/bahia/escena.ts` |
| Pendiente del frente de playa | **Medida**: 1:22 (mediana de 85 perfiles; cuartiles 0,045–0,065) entre +3,3 y +4,6 m sobre el CH, con el LiDAR de 2024 (§8). Con el MDT05 salía 1:14: la playa ha cambiado entre los dos vuelos. Entre +1,15 y +3,3 m, **medida desde satélite**: 1:85 (mediana de 102 perfiles; p10–p90 1:43–1:116), ver §7 | LiDAR (§5 y §8) y §7, `tools/pendiente-playa.ts` |

## 6. Oleaje (consultado el 18/10/2026)

| Dato | Valor | Fuente |
|---|---|---|
| Previsión de oleaje | Altura significante, periodo de pico, dirección, separados en mar de fondo y mar de viento, cada hora, de −2 a +8 días. Punto pedido 43,60 N −5,96 E; el modelo devuelve la celda marina 43,708 N −5,958 E (unos 14 km mar adentro) | Open‑Meteo Marine API, `marine-api.open-meteo.com/v1/marine` (CORS abierto). Modelo, no medida |
| Oleaje medido | Hm0, Tp y dirección media cada hora, con control de calidad | Puertos del Estado, Boya de Gijón (REDCOS, id 1117, Triaxys, 43,615 N −5,664 E), `poem.puertos.es/portus/StationData?code=1117`. **Ojo:** su ficha de Portus dice «En tierra», aunque sigue dando datos horarios con QC = 1 |
| Subida del agua por las olas | R2 = 1,1·(0,35·βf·√(H0·L0) + ½·√(H0·L0·(0,563·βf² + 0,004))); si ξ0 < 0,3, R2 = 0,043·√(H0·L0) | Stockdon, H.F., Holman, R.A., Howd, P.A., Sallenger, A.H. (2006). *Empirical parameterization of setup, swash, and runup*. Coastal Engineering 53, 573–588. Resumen: https://www.usgs.gov/publications/empirical-parameterization-setup-swash-and-runup |
| Dispersión | L = L0·tanh^{2/3}((ω√(h/g))^{3/2}), error < 1,7 % (comprobado frente a la solución exacta en `tests/propagacion.test.ts`) | Fenton, J.D. y McKee, W.D. (1990). *On calculating the lengths of water waves*. Coastal Engineering 14, 499–513 |
| Rotura | La ola rompe cuando H > 0,78·h (índice de rotura de McCowan, 1894) | Valor clásico de la teoría de la ola solitaria |
| Refracción | Tiempo de llegada del frente con la ecuación eikonal \|∇T\| = 1/c, resuelta por fast marching | Sethian, J.A. (1996). *A fast marching level set method for monotonically advancing fronts*. PNAS 93, 1591–1595 |
| Sombra tras espigón y cabos | **APROXIMADA**: se atenúan las olas que llegan girando mucho respecto al mar abierto. No es difracción rigurosa | `src/scene/bahia/agua.ts` |
| Forma de las olas y del vaivén en la orilla | **Ilustrativa**: 4 componentes de Gerstner por sistema con la energía de Hs; la cota máxima del vaivén sí sale de R2. En la franja de rompientes, la fase se calcula con una profundidad mínima de 1 m (el frente roto avanza como una resaca) | `src/scene/bahia/agua.ts`, `src/scene/bahia/campoOlas.ts` |
| Texturas de arena | Fotos escaneadas «Aerial Beach 01» (30 × 30 m, Rob Tuytel) y «Damp Beach Sand 02» (1,87 m, Dimitrios Savva): color, normales y rugosidad a 1k. El dibujo es el de la foto; el color se lleva al medido en la ortofoto | Poly Haven, https://polyhaven.com/a/aerial_beach_01 y https://polyhaven.com/a/damp_beach_sand_02, CC0. `public/bahia/texturas/` |
| Rizado del agua | Mapa de normales `waternormals.jpg` | three.js r186, `examples/textures/waternormals.jpg` (licencia MIT del repositorio) |
| Aspecto del agua | **Ilustrativo**: reflejo de la escena con una cámara espejo bajo el plano del mar (método del Reflector de three.js, con recorte oblicuo); el cielo reflejado es el degradado del propio cielo. transparencia según la profundidad (se ve el fondo en poca agua), reflejo del cielo con Fresnel, rizado de ruido, espuma con forma de ruido fractal deformado: línea rota en el frente de cada ola rota, parches que se deshacen detrás y borde fino en la orilla; de cerca, encaje de burbujas (ruido celular). Dónde rompe y hasta dónde sube sí salen del modelo de oleaje | `src/scene/bahia/agua.ts` |

## 7. Franja intermareal con la línea de agua de Sentinel‑2 (consultado el 19/10/2026)

La arena que el mar cubre y descubre no la capturó el LiDAR del MDT05, y la nube de 2024 (§8) solo llega a +2,0 m. Se reconstruye con el método de la línea de agua: en cada imagen de satélite se localiza la orilla y se le asigna el nivel del mar medido en ese momento. Juntando imágenes tomadas con mareas distintas sale el perfil de la playa.

| Dato | Valor | Fuente |
|---|---|---|
| Imágenes | Sentinel‑2 L2A (reflectancia de superficie), bandas B03 (verde, 10 m) y B11 (infrarrojo de onda corta, 20 m), y la clasificación SCL para descartar nubes y sombras. Tesela 29TQJ, del 01/10/2025 al 18/10/2026; todas pasan hacia las 11:30 UTC | Copernicus Sentinel‑2 (ESA), en formato COG del catálogo STAC Earth Search de Element 84: `earth-search.aws.element84.com/v1`, colección `sentinel-2-l2a`. Contiene datos modificados de Copernicus Sentinel 2025–2026 (uso libre citando la fuente) |
| Orilla | Índice MNDWI = (B03 − B11)/(B03 + B11), umbral de Otsu de cada imagen y borde de la arena más hacia el mar, en perfiles cada 25 m normales a la curva de +3,1 m de la arena medida | Xu, H. (2006). *Modification of normalised difference water index (NDWI) to enhance open water features in remotely sensed imagery*. International Journal of Remote Sensing 27, 3025–3033. Otsu, N. (1979). *A threshold selection method from gray-level histograms*. IEEE Trans. SMC 9, 62–66 |
| Nivel en cada imagen | Medido por el mareógrafo REDMAR de Avilés a la hora de la imagen, pasado al CH igual que en §3 | `data/obs_aviles_10min.csv`, Puertos del Estado |
| Oleaje en cada imagen | Hs del modelo Open‑Meteo Marine en la celda de §6. Solo se usan imágenes con Hs < 1,3 m (15 de las 26 sin nubes) | Open‑Meteo Marine API (histórico) |
| Subida de la orilla por las olas | La orilla de la imagen queda de mediana **0,50 m por encima** del nivel en reposo. Se mide donde la orilla cae sobre arena del LiDAR (582 casos, MAD 0,72 m) y se corrige con ese valor. Mezcla el efecto de las olas con el cambio de la playa entre el vuelo (agosto de 2024) y las imágenes | `tools/intermareal-s2.py` |
| Perfil | Por perfil, con dos vecinos a cada lado (125 m de playa): mediana de la orilla de cada imagen y perfil que solo baja hacia el mar (regresión isotónica). No se impone ninguna forma. Solo hasta +1,15 m (la orilla más baja observada); por encima de +3,0 m no se usa. Se aplica solo por debajo de la arena medida por LiDAR y sin superar la cota de su borde | `tools/intermareal-s2.py`, `data/intermareal_s2.json` |
| Validez | 102 de 189 perfiles. El resto se descarta por pocas imágenes, por pendiente impropia de arena (roca de La Peñona) o porque no mejora el relieve genérico. Validación en VALIDACION.md §10 | — |
| Huecos entre perfiles válidos | **INTERPOLADOS**: entre dos perfiles válidos separados por hasta 6 descartados (150 m), la distancia de cada cota se interpola; después se suaviza a lo largo de la playa (1‑2‑1, dos pasadas). 25 perfiles interpolados | `tools/bahia-relieve.ts` |

**Lo que no da:**
- La arena por debajo de +1,15 m: las bajamares vivas bajan más, pero ninguna imagen útil del año las pilló.
- Los canales y las barras de bajamar: el píxel es de 10–20 m.
- Los cambios de la playa a lo largo del año: es un perfil medio de oct‑2025 a oct‑2026.

## 8. Nube LiDAR PNOA 2024 de la playa (consultado el 19/10/2026)

| Dato | Valor | Fuente |
|---|---|---|
| Teselas | `PNOA_2024_AST_260-4829`, `260-4830`, `261-4829`, `261-4830`, `262-4829`, `262-4830` y `262-4831` (`_H30_NPC01.LAZ`), de 1×1 km. El nombre da la esquina noroeste en km UTM (la 260‑4829 cubre de 4828 a 4829 km norte) | Centro de Descargas del CNIG (`centrodedescargas.cnig.es`), «LiDAR 3ª cobertura». La descarga pide un reCAPTCHA y se hizo a mano. © Instituto Geográfico Nacional, CC BY 4.0 |
| Formato | LAS 1.4, formato de punto 8 (con RGB e infrarrojo), clasificada. ETRS89 UTM 30N (EPSG:25830) | Cabeceras de los ficheros |
| Sistema vertical | **No lo declaran los ficheros.** Comprobado frente al MDT05 (NMMA): diferencia mediana de +0,03 m en 316.846 nodos de tierra por encima de +6 m. Se trata como altitud ortométrica y se pasa al CH con el mismo desnivel que el resto | `tools/lidar-fino.py`, `data/lidar2024.json` |
| Fecha y hora del vuelo | 11/08/2024, de 15:08 a 15:18 UTC, según el tiempo GPS de los puntos (tiempo GPS ajustado menos 18 s) | `data/lidar2024.json` |
| Marea durante el vuelo | Unos +1,85 a +1,95 m sobre el CH, subiendo. El mareógrafo de Avilés no tiene datos de ese día: es la predicción para Avilés más el residuo medido en Gijón a esa hora (+0,01 a +0,04 m) | Constantes de este proyecto y `data/obs_gijon_10min.csv` |
| Uso | Puntos de clase 2 (suelo), media por metro cuadrado en el marco local, rejilla de 1 m. 123 bloques de 100 m sobre la playa, el paseo, el club, las dunas y la primera línea de casas (967.772 nodos con dato, 2,5 MB). En el relieve de 5 m sustituye al MDT05 donde hay dato | `tools/lidar-fino.py`, `public/bahia/fino.bin`, `tools/bahia-relieve.ts` |
| Arena más baja medida | +2,03 m sobre el CH (percentil 0,1) | `data/lidar2024.json` |

