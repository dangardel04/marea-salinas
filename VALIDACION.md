# Validación de la marea

Fecha de los cálculos: **18/10/2026**. Todos los números salen de los scripts de `tools/` indicados en cada apartado. Los resultados completos están en `data/validacion.json`, `data/comparacion_realidad.json`, `data/generalizacion.json` y `data/residuo.json`. Las fuentes, en `FUENTES.md`.

## Resumen

- **Juego activo: E, híbrido.** Las constituyentes rápidas (M2, S2, N2…) se ajustan con un año del mareógrafo REDMAR de Avilés; las de periodo largo (SA, SSA, MM, MF, MSF, MTM, MSQM) salen de 5,8 años del mareógrafo de Gijón. Se eligió porque es **el más fiel a la marea medida** (§8): empata con el mejor dentro del año de datos y es el que mejor predice el año siguiente.
- **Horas**: el objetivo de ±10 min **se cumple**. Errores de hasta 5,9 min en la semana validada y de 8,8 min hasta el 31/12.
- **Alturas**: el objetivo de ±15 cm **se cumple casi siempre, pero no siempre**:
  - Semana 18–25/10: 30 de 31 extremos dentro; el que falla lo hace por 0,1 cm (15,1 cm).
  - Hasta el 31/12: el 90,3 % dentro, con errores de hasta 19,6 cm.
  - Las pleamares salen de media unos 9–10 cm por debajo de la tabla oficial y las bajamares, unos 5–8 cm por encima.
- **Causa del error que queda**: la tabla oficial del IHM para Avilés y el mareógrafo actual de Avilés no describen la misma marea. Según el IHM, Avilés tiene un 4 % más de rango que Gijón; según los dos radares REDMAR, un 2 % menos (§3). Hay un juego de constantes, TICON‑4, que coincide con la tabla oficial (98,6 % dentro), pero se aleja más de lo que se mide en el puerto (§8).
- **Frente a la realidad** (mareógrafo de Avilés, fuera de muestra): residuo de unos 12 cm de astronomía pura, sobre todo viento y presión. Con la corrección en vivo baja a 3–5 cm en las 6 h siguientes y a unos 7 cm a 24 h.

## 1. Método

- **Predicción**: `src/tide/motor.ts`, con la astronomía y las correcciones nodales IHO de `@neaps/tide-predictor` 0.11.0. Está comprobado que reproduce esa librería con un error menor de 1 mm y 30 s (`tests/motor.test.ts`).
- **Ajuste armónico**: `tools/lib/armonico.ts`, mínimos cuadrados con selección de constituyentes por el criterio de Rayleigh (R = 1).
- **Tabla oficial**: pleamares y bajamares del IHM, puerto id 7 «Avilés (San Juan de Nieva)», y su curva cada 5 min. Horas en UTC y alturas sobre el cero hidrográfico (FUENTES.md §3).
- **Emparejamiento**: cada extremo oficial se compara con el extremo predicho del mismo tipo más cercano, dentro de ±3 h. Ningún extremo quedó sin pareja.
- **Nivel medio sobre el CH (Z0)**: media de la curva oficial del IHM en el año natural 2026: **2,468 m** en Avilés, 2,410 m en Gijón. La validación de **alturas en Avilés no es del todo independiente**: el nivel medio sale del propio IHM, así que el sesgo medio es casi cero por construcción. Lo que sí se mide es el error de amplitud y de forma.
- **Control independiente (Gijón)**: constantes ajustadas con el radar de Gijón y Z0 pasado al CH con el datum **oficial** de Puertos del Estado (CH 0,350 m sobre el cero REDMAR), sin usar nada del IHM.
- **Observaciones**: REDMAR minutal (QC = 1) promediado en ventanas de 10 min, del 01/10/2025 al 17/10/2026.

## 2. Juegos de constantes evaluados

| Juego | Constantes | Datos |
|---|---|---|
| **E, híbrido (activo)** | 48 constituyentes ajustadas en Avilés + 7 de periodo largo de Gijón | Avilés 2: 01/10/2025–17/10/2026 (382 días). Gijón 2: 2021–2026 (2116 días) |
| A | Ajuste solo con Avilés, 55 constituyentes | Avilés 2, 382 días |
| B | TICON‑4 «Aviles», 50 constituyentes publicados | GESLA‑4/CMEMS, 27/04/2021–30/06/2025 (estación anterior del puerto) |
| C, control | Ajuste propio en Gijón | Gijón 2, 2021–2026 |
| D | TICON‑4 «Gijon» | 2006–2025 |

Constituyentes principales:

- **M2**: E y A 1,257 m / 92,2°; B 1,336 m / 95,8°; C 1,284 m / 91,7°; D 1,288 m / 91,1°.
- **SA**: E 0,058 m / 240,5° (5,8 años de Gijón); A 0,086 m / 269,5° (un solo año de Avilés).

## 3. Resultados frente a la tabla oficial del IHM (`node tools/validar.ts`)

Error = predicción − IHM. «Dentro» significa que el extremo cumple los dos objetivos a la vez (±10 min y ±15 cm).

### Semana del 18 al 25/10/2026 (31 extremos, incluye el cambio de hora)

| Juego | Tiempo RMS (máx) | Altura RMS (máx) | Sesgo de pleamares / bajamares | Dentro |
|---|---|---|---|---|
| **E, híbrido (activo)** | 4,0 min (5,9) | 9,2 cm (15,1) | −10,1 / +5,5 cm | **96,8 %** |
| A, solo Avilés | 3,9 min (5,8) | 12,3 cm (16,9) | −15,7 / −0,3 cm | 64,5 % |
| B, TICON Avilés | 4,5 min (12,4) | 3,4 cm (6,8) | −2,7 / +2,0 cm | 96,8 % |
| C, Gijón control | 2,0 min (5,3) | 2,8 cm (5,5) | −0,7 / +2,5 cm | 100 % |
| D, TICON Gijón | 3,5 min (6,8) | 2,8 cm (5,4) | −1,5 / +2,3 cm | 100 % |

### Del 18/10 al 31/12/2026 (290 extremos)

| Juego | Tiempo RMS (máx) | Altura RMS (máx) | Curva cada 5 min, RMS (máx) | Dentro |
|---|---|---|---|---|
| **E, híbrido (activo)** | 4,9 min (8,8) | 10,0 cm (19,6) | 8,8 cm (22,9) | **90,3 %** |
| A, solo Avilés | 4,9 min (8,8) | 12,0 cm (23,8) | 11,2 cm (27,4) | 74,5 % |
| B, TICON Avilés | 4,0 min (12,4) | 5,4 cm (17,1) | 6,3 cm (20,8) | 98,6 % |
| C, Gijón control | 1,6 min (5,3) | 5,3 cm (9,8) | 6,7 cm (15,5) | 100 % |
| D, TICON Gijón | 3,1 min (8,4) | 4,8 cm (11,9) | 6,2 cm (16,9) | 100 % |

### Periodo completo, oct‑2025 a dic‑2026 (1766 extremos)

| Juego | Tiempo RMS (máx) | Altura RMS (máx) | Dentro |
|---|---|---|---|
| **E, híbrido (activo)** | 4,4 min (10,8) | 9,7 cm (21,3) | 89,7 % |
| A, solo Avilés | 4,4 min (10,7) | 11,2 cm (25,2) | 79,0 % |
| B, TICON Avilés | 4,8 min (14,9) | 5,0 cm (17,1) | 97,1 % |
| C, Gijón control | 1,8 min (5,4) | 4,6 cm (12,5) | 100 % |
| D, TICON Gijón | 3,2 min (11,9) | 4,5 cm (12,5) | 99,8 % |

### Por qué E no llega al 100 % en alturas: diagnóstico

1. **El método funciona.** En Gijón, el ajuste propio con el datum oficial (C) cumple el 100 % frente a la tabla del IHM, sin usar nada del IHM.
2. **En Avilés las fuentes discrepan entre sí.** Comparación directa de las dos tablas IHM y de los dos radares REDMAR, del 01/10/2025 al 17/10/2026:

   | | Rango Avilés / Gijón | Retraso de Avilés respecto a Gijón |
   |---|---|---|
   | Tablas IHM | 1,041 | 6,2 min (desv. típ. 1,6) |
   | Radares REDMAR (regresión de 54 408 pares de 10 min) | 0,983 | 0 min (resolución de 10 min; con las fases de M2, unos 1 min). r = 0,9995 |

   La tabla IHM de Avilés coincide con TICON‑4 «Aviles», calculado con la estación **anterior** del puerto (2021–2025). El radar actual, instalado el 01/10/2025, mide un rango alrededor de un 6 % menor. **No dispongo de ese dato con certeza: cuál de los dos refleja mejor la marea real en Salinas.** Lo que sí está medido es que el radar actual coincide con el de Gijón (r = 0,9995) y que las constantes ajustadas a él predicen mejor lo que ese radar mide después (§8). Portus marca el radar de Avilés como «Temporalmente fuera de servicio», aunque sirve datos con QC = 1.
3. **Por qué E mejora tanto a A frente al IHM.** El SA ajustado con un solo año (0,086 m / 269,5°) recoge la anomalía meteorológica de ese año y bajaba las pleamares de otoño. El SA de 5,8 años (0,058 m / 240,5°) es el ciclo estacional medio. Los extremos dentro del objetivo suben del 64,5 % al 96,8 % en la semana.

### Tabla extremo a extremo, juego E (activo), 18–25/10/2026

Horas en Europe/Madrid. El domingo 25 cambia de CEST (UTC+2) a CET (UTC+1) y las horas siguen siendo coherentes a ambos lados del cambio.

| Día | Tipo | IHM oficial | Predicción | Δ tiempo (min) | IHM (m) | Predicción (m) | Δ altura (cm) |
|---|---|---|---|---:|---:|---:|---:|
| 18/10 | bajamar | 03:38 CEST | 03:34 | -3.9 | 1.96 | 1.98 | 1.5 |
| 18/10 | pleamar | 10:05 CEST | 10:01 | -3.7 | 3.34 | 3.27 | -7.4 |
| 18/10 | bajamar | 16:31 CEST | 16:31 | 0.1 | 1.94 | 1.95 | 1.3 |
| 18/10 | pleamar | 22:56 CEST | 22:54 | -1.2 | 3.02 | 2.96 | -6.0 |
| 19/10 | bajamar | 04:59 CEST | 04:59 | 0.4 | 2.10 | 2.10 | -0.2 |
| 19/10 | pleamar | 11:31 CEST | 11:28 | -2.4 | 3.26 | 3.18 | -7.9 |
| 19/10 | bajamar | 18:04 CEST | 18:05 | 1.6 | 1.97 | 1.97 | -0.5 |
| 20/10 | pleamar | 00:37 CEST | 00:35 | -1.8 | 3.05 | 2.99 | -6.4 |
| 20/10 | bajamar | 06:35 CEST | 06:34 | -0.1 | 2.06 | 2.05 | -1.1 |
| 20/10 | pleamar | 12:56 CEST | 12:54 | -1.6 | 3.34 | 3.25 | -8.8 |
| 20/10 | bajamar | 19:25 CEST | 19:23 | -1.2 | 1.81 | 1.81 | -0.3 |
| 21/10 | pleamar | 01:49 CEST | 01:46 | -2.6 | 3.24 | 3.15 | -8.3 |
| 21/10 | bajamar | 07:46 CEST | 07:43 | -2.6 | 1.85 | 1.85 | -0.0 |
| 21/10 | pleamar | 13:59 CEST | 13:56 | -2.3 | 3.53 | 3.43 | -10.2 |
| 21/10 | bajamar | 20:21 CEST | 20:16 | -4.2 | 1.56 | 1.58 | 2.3 |
| 22/10 | pleamar | 02:37 CEST | 02:34 | -2.9 | 3.48 | 3.37 | -10.7 |
| 22/10 | bajamar | 08:36 CEST | 08:31 | -4.0 | 1.58 | 1.61 | 3.2 |
| 22/10 | pleamar | 14:47 CEST | 14:43 | -3.9 | 3.77 | 3.66 | -11.4 |
| 22/10 | bajamar | 21:03 CEST | 20:57 | -5.5 | 1.27 | 1.34 | 6.9 |
| 23/10 | pleamar | 03:16 CEST | 03:11 | -4.1 | 3.73 | 3.61 | -11.9 |
| 23/10 | bajamar | 09:17 CEST | 09:11 | -5.2 | 1.27 | 1.35 | 7.9 |
| 23/10 | pleamar | 15:27 CEST | 15:22 | -4.6 | 4.01 | 3.90 | -11.3 |
| 23/10 | bajamar | 21:39 CEST | 21:33 | -5.6 | 0.99 | 1.10 | 11.6 |
| 24/10 | pleamar | 03:51 CEST | 03:46 | -4.8 | 3.98 | 3.85 | -12.5 |
| 24/10 | bajamar | 09:54 CEST | 09:48 | -5.6 | 0.99 | 1.11 | 11.8 |
| 24/10 | pleamar | 16:05 CEST | 15:59 | -5.6 | 4.24 | 4.12 | -11.5 |
| 24/10 | bajamar | 22:14 CEST | 22:08 | -5.9 | 0.76 | 0.90 | 14.6 |
| 25/10 | pleamar | 03:26 CET | 03:20 | -5.7 | 4.21 | 4.07 | -13.7 |
| 25/10 | bajamar | 09:30 CET | 09:24 | -5.2 | 0.76 | 0.89 | 13.3 |
| 25/10 | pleamar | 15:42 CET | 15:36 | -5.4 | 4.43 | 4.30 | -13.0 |
| 25/10 | bajamar | 21:49 CET | 21:43 | -5.5 | 0.60 | 0.75 | 15.1 **fuera** |

Con el juego B (TICON) también hay un extremo fuera esta semana: la bajamar del 19/10 a las 18:04, por +12,4 min.

## 4. Resultados frente a las observaciones REDMAR, dentro de muestra (`node tools/validar.ts`)

Predicción sobre el cero del puerto, comparada con los mismos datos con los que se ajustó. Los extremos observados son máximos y mínimos de la serie suavizada (media móvil de 50 min) dentro de ±3 h. **Ojo:** esta comparación favorece a los juegos ajustados con esos datos; la comparación justa es la del §8.

| Juego | Residuo RMS (máx) | Tiempo de los extremos, RMS | Altura de los extremos, RMS |
|---|---|---|---|
| **E, híbrido (activo)** | 11,6 cm (60,8) | 5,8 min | 11,7 cm |
| A, solo Avilés | 10,3 cm (50,4) | 5,8 min | 10,3 cm |
| B, TICON Avilés | 15,0 cm (71,2) | 9,7 min (media +7,2 min) | 15,6 cm |

## 5. Corrección en vivo (fase 5), backtest (`node tools/residuo.ts`)

Se arranca cada hora del año. Se toma r0 = mediana del residuo (observado − predicho) de la última hora y se proyecta como r0·exp(−L/τ). El τ que menor error da en 1–12 h es **72 h**; el error apenas cambia entre 48 y 168 h.

Error RMS frente a lo observado según el plazo L (cm), con el juego activo E:

| Plazo | 1 h | 2 h | 3 h | 6 h | 9 h | 12 h | 24 h |
|---|---|---|---|---|---|---|---|
| Sin corrección | 11,6 | 11,6 | 11,6 | 11,6 | 11,6 | 11,6 | 11,6 |
| **Con corrección (τ = 72 h)** | **3,1** | **3,0** | **3,4** | **4,2** | **4,6** | **5,1** | **7,1** |

Fuera de muestra (§8, cada mes evaluado con constantes que no lo vieron), el juego E con corrección da 3,2 / 3,8 / 4,7 / 5,2 / 7,2 cm a 1 / 3 / 6 / 12 / 24 h.

En la aplicación la corrección se aplica también hacia atrás desde el último dato, con la misma atenuación: exp(−|t − t0|/τ). Así la curva del día no da un salto en t0. Esa parte hacia el pasado **no está validada con backtest**; se apoya en que la autocorrelación es simétrica en el tiempo.

Con TICON (B) el residuo tiene **firma de marea**: la autocorrelación es 0,29 a 6 h y 0,89 a 12 h, señal de que es marea mal modelada y no meteorología. Por eso la corrección llega a empeorar el resultado (17 cm a 6 h, §8).

## 6. Cómo cambiar de juego de constantes

```bash
node tools/ajuste.ts aviles-hibrido
```

```bash
node tools/generar-constantes.ts hibrido
```

Otras opciones:

```bash
node tools/generar-constantes.ts ajuste
```

```bash
node tools/generar-constantes.ts ticon
```

`ajuste` usa solo el radar de Avilés. `ticon` coincide con la tabla oficial del IHM, pero con él la corrección en vivo debería desactivarse (`src/tide/correccion.ts`), por lo explicado en §5.

## 7. Limitaciones

- Solo hay un año de radar en Avilés. Las constituyentes de periodo largo se toman de Gijón (a 21 km). Ese mismo año, el SA de Avilés y el de Gijón salen casi iguales (0,086 m / 269,5° y 0,079 m / 263,2°), así que se asume que el ciclo estacional medio también es igual en los dos puertos. **Es una suposición, no una medida.**
- El Z0 sobre el CH de Avilés sale de la curva del IHM, porque no hay un esquema de datum publicado para Avilés. El desnivel cero del puerto → CH que se deduce de ahí, 0,292 m, es una **estimación**, no un dato oficial.
- La predicción es en el mareógrafo de San Juan de Nieva (bocana de la ría), a unos 3 km de la playa. No se ha medido la marea en la propia playa de Salinas.

## 8. ¿Qué juego se acerca más a la realidad?

### 8.1 Validación cruzada dejando un mes fuera (`node tools/comparar-realidad.ts`)

Para cada uno de los 13 meses con datos en Avilés (oct‑2025 a oct‑2026), cada candidato se ajusta **sin ese mes** y se evalúa en ese mes. Todos los errores son fuera de muestra. Referencia: el mareógrafo REDMAR de Avilés.

| Candidato | Residuo RMS | Extremos: tiempo / altura RMS | Con corrección a 1 / 3 / 6 / 12 / 24 h |
|---|---|---|---|
| **E, híbrido (activo)** | 12,17 cm | 6,5 min / 12,3 cm | **3,2 / 3,8 / 4,7 / 5,2 / 7,2 cm** |
| A, solo Avilés | **12,03 cm** | 6,6 min / 12,1 cm | 3,2 / 3,8 / 4,7 / 5,2 / 7,3 cm |
| G, constantes de Gijón aplicadas en Avilés | 12,35 cm | 6,5 min / 12,8 cm | 3,5 / 4,9 / 6,1 / 5,3 / 7,3 cm |
| B, TICON‑4 Avilés | 15,25 cm | 10,1 min / 15,8 cm | 6,9 / 13,5 / 17,0 / 6,6 / 7,9 cm |

A y E empatan: la diferencia, 0,14 cm, es menor que el ruido. B queda claramente atrás.

### 8.2 Predecir el año siguiente (`node tools/generalizacion.ts`)

La validación cruzada evalúa meses del mismo año con el que se ajusta. La aplicación, en cambio, predice el futuro. Como Avilés solo tiene un año, la prueba se hace con Gijón (2021–2026): para cada año Y se ajusta con datos **anteriores** a Y y se evalúa en Y.

| Año evaluado | Solo el año anterior (como A) | Híbrido (como E) | Todos los años anteriores |
|---|---|---|---|
| 2022 | 13,43 | 13,43 | 13,43 |
| 2023 | 14,22 | **13,37** | 13,48 |
| 2024 | **12,31** | 12,36 | 12,65 |
| 2025 | 11,43 | **11,19** | 11,67 |
| 2026 (hasta 17/10) | 12,37 | **11,35** | 11,43 |
| **Media** | 12,75 | **12,34** | 12,53 |

Residuo RMS en cm. En 2022 las tres columnas coinciden porque solo hay un año anterior. El ajuste de un solo año pierde hasta 1 cm en los años con un ciclo estacional anómalo (2023, 2026). El híbrido nunca pierde más de 0,05 cm.

### 8.3 Decisión

Se activa **E**:

- Empata con el mejor dentro del año de datos (§8.1).
- Es el que mejor predice el año siguiente (§8.2).
- Con la corrección en vivo es el mejor o empata en todos los plazos.
- Además, frente a la tabla oficial del IHM, el porcentaje de extremos dentro de ±10 min y ±15 cm sube del 64,5 % (A) al 96,8 % (§3).

## 9. Oleaje (`node tools/oleaje-validar.ts`)

**Qué se compara.** La previsión de Open‑Meteo Marine (un modelo) frente a la boya de Gijón de Puertos del Estado (medida). La comparación se hace en el punto de la boya, cada hora del 18/07 al 18/10/2026, con dato válido en las dos fuentes: **2106 horas**. La celda del modelo cae unos 10 km al norte de la boya (43,708 N −5,625 E), porque el modelo tiene una rejilla gruesa.

| Variable | Sesgo (modelo − boya) | Error RMS | Otros |
|---|---|---|---|
| Altura significante | −0,02 m | 0,17 m (13 % de la media, que es 1,26 m) | correlación 0,955 |
| Dirección de procedencia | −22° (el modelo viene más del oeste) | 27° | — |
| Periodo | +2,5 s | 2,7 s | **No comparable**: en el pasado el modelo solo da periodo medio y la boya, Tm02. Son definiciones distintas |

**Qué no se ha podido validar:**
- **Frente a Salinas**: el oleaje que usa la app es el de la celda del modelo frente a Salinas, a unos 14 km mar adentro. No hay boya allí.
- **Propagación hasta la playa**: el asomeramiento, la rotura y la refracción por fast marching están comprobados con pruebas unitarias frente a la teoría lineal (`tests/propagacion.test.ts`), pero **no frente a medidas** dentro de la bahía.
- **Subida del agua por las olas (R2)**: se calcula con la fórmula publicada de Stockdon et al. (2006) y la pendiente medida del frente de playa (1:22 con el LiDAR de 2024, por encima de +3,3 m). Entre +1,15 y +3,3 m usa la pendiente medida desde satélite (1:85, §10) y, por debajo, la aproximada (1:50). **No hay medidas de run‑up en Salinas para validarla.** Según el resumen del artículo (USGS, https://www.usgs.gov/publications/empirical-parameterization-setup-swash-and-runup), en sus 10 campañas de campo el error RMS de la fórmula fue de 38 cm, con un sesgo de −17 cm, para una subida media observada de 144 cm. La implementación reproduce el ejemplo de la documentación de py-wave-runup (Hs = 4 m, Tp = 11 s, β = 0,1 → R2 ≈ 2,54 m; https://py-wave-runup.readthedocs.io/en/stable/models.html), comprobado en `tests/oleaje.test.ts`.

## 10. Franja intermareal de la playa (`python tools/intermareal-s2.py`)

Cálculo del 19/10/2026. El método está en FUENTES.md §7 y los resultados completos, en `data/intermareal_s2.json`.

### 10.1 Validación dejando cada imagen fuera

**Qué se compara.** Para cada perfil y cada imagen, se rehace el perfil **sin esa imagen** y se mira qué cota da donde estaba su orilla. La referencia es la cota real del suelo en ese punto: el nivel medido por el mareógrafo más la subida de la orilla por las olas (0,50 m). Se compara con lo que da en esos mismos puntos el relieve genérico: lo medido por LiDAR y, por debajo, una pendiente de 1:50 que pasa a EMODnet.

| | Casos | Sesgo (mediana) | MAD | RMS | 90 % de los errores por debajo de |
|---|---|---|---|---|---|
| Perfil Sentinel‑2 (dejando la imagen fuera) | 458 | −0,10 m | 0,44 m | **0,45 m** | 0,71 m |
| Relieve genérico | 458 | +0,66 m | 1,17 m | **2,86 m** | 6,13 m |

### 10.2 Comprobación independiente con el LiDAR de 2024

Antes de usar la nube de 2024 (§8 de FUENTES), el perfil del satélite se calculó solo con el MDT05. Se comparó después con la nube en la arena que el MDT05 no había medido: 2853 nodos de 5 m entre +2,1 y +3,5 m. La nube es de agosto de 2024 y las imágenes, de oct‑2025 a oct‑2026, así que la diferencia mezcla el error del método con el cambio de la playa.

| Relieve (sin el LiDAR de 2024) − LiDAR 2024 | Mediana | MAD | RMS |
|---|---|---|---|
| Con el perfil Sentinel‑2 | −0,23 m | 0,42 m | **0,46 m** |
| Genérico (pendiente 1:50) | −0,59 m | 0,36 m | **0,68 m** |

Ahora la nube de 2024 forma parte del relieve y del ajuste (es la arena «medida»), así que esta comparación ya no se puede repetir de forma independiente.

### 10.3 Conclusiones

- **La arena de la franja intermareal está más alta de lo que suponía la pendiente genérica.** La cota +1,5 m queda, según el satélite, unos 25 m más hacia el mar (mediana; p10–p90 de −21 a 108 m). En bajamar se descubre más arena.
- **Pendiente media de la franja**: 1:85 (p10–p90 1:43–1:116). Es más llana que la genérica de 1:50, y mucho más que la de la arena alta, que es 1:22 con el LiDAR de 2024.
- **Error que queda**: unos ±0,45 m en vertical. En una pendiente de 1:85 equivale a unos ±40 m en horizontal. Vienen del píxel de 10–20 m, de la espuma y el vaivén de cada momento, y de que la playa cambia a lo largo del año.
- **Cobertura**: 102 de 189 perfiles válidos, más 25 interpolados en huecos de hasta 150 m (22,2 ha), de la arena medida por LiDAR a +1,15 m. En el resto, y por debajo de +1,15 m, sigue la pendiente genérica.

**Limitaciones.**
- Solo 6 de las 15 imágenes con poca ola caen por debajo de +2,5 m de nivel, y ninguna por debajo de +0,65 m.
- La subida de la orilla (0,50 m) se mide en la arena del LiDAR y se aplica en la franja baja, que es más llana. Su dispersión es grande (MAD 0,72 m).
- No hay medidas de campo (GPS o LiDAR en bajamar).

### 10.4 Relieve fino de 1 m

- **Uniones**: en los últimos 8 m antes de un hueco del LiDAR, el relieve de 1 m pasa poco a poco al de 5 m. En 75 cortes a lo largo de la playa, el mayor salto entre puntos separados 0,5 m es de 3,5 cm de mediana (p90 6 cm).
- **Franja del satélite bajo el borde del LiDAR**: no se deja que supere la cota del borde medido más cercano. Sin ese límite había escalones de hasta 0,5 m, por el cambio de la playa entre 2024 y 2025‑26.

## 11. Arena entre el muro del paseo y el agua (`python tools/validar-ancho.py`, `tools/ancho-correccion.py`, `tools/validar-puntos.py`)

Cálculo del 19/10/2026. Referencia: la línea de agua de cada imagen Sentinel‑2 (2025‑2026) en los perfiles de playa de §10, medida desde el pie del muro, frente al ancho que da la web con el nivel medido en Avilés a la hora de la imagen.

### 11.1 Hasta dónde llega el agua

El agua no se queda en el nivel en calma: las olas la suben por la arena. La subida se mide en cada caso como la cota del suelo donde el satélite ve la orilla menos el nivel medido. Depende de la marea (en pleamar la orilla queda más baja, sobre la arena más empinada):

| Nivel del mar (mediana del tramo) | 0,84 m | 1,31 m | 1,57 m | 2,19 m | 2,61 m | 3,28 m |
|---|---|---|---|---|---|---|
| Subida de la orilla | 0,46 m | 1,05 m | 0,83 m | 0,43 m | 0,17 m | -0,03 m |
| Casos | 436 | 237 | 155 | 166 | 246 | 396 |

Con una subida fija de 0,50 m, el ancho tenía sesgos de +5 a +8 m en marea baja y media y de −10 m en pleamar. Con la subida según la marea, dejando fuera cada imagen (1636 casos): sesgo -1,8 → **-0,4 m**. La dispersión es grande (MAD 34,9 m): es lo que varía de verdad la orilla con las olas de cada momento, más el píxel del satélite.

### 11.2 Corrección local (la playa ha cambiado desde el LiDAR de 2024)

En pleamar el ancho depende sobre todo de la arena alta, que es la del LiDAR de agosto de 2024. En 2025‑2026 el satélite ve más arena al oeste (Balneario, Club Náutico) y menos en el centro. Para cada perfil y tramo de nivel se suma a la web la mediana de (observado − web) de los perfiles vecinos (±3, 175 m de playa; al menos 15 casos; encogida hacia 0 con pocos datos y limitada a ±40 m). Validación dejando fuera cada imagen:

| Zona | Sin corrección: sesgo / MAD | Con corrección local: sesgo / MAD |
|---|---|---|
| todas (1400 casos) | +3,1 m / 30,1 m | **-0,2 m** / 25,1 m |
| Salinas oeste (x < −700) (210 casos) | -20,4 m / 34,5 m | **-7,1 m** / 28,7 m |
| centro (−700 a −200) (651 casos) | +10,5 m / 24,7 m | **+3,5 m** / 17,9 m |
| este (x > −200) (539 casos) | -2,1 m / 33,7 m | **-1,9 m** / 35,3 m |

(Se probó también pasar la corrección al relieve, subiendo o bajando la arena: con las barras y canales de bajamar la orilla salta y no fue robusto. La cinta de la medida, por eso, puede pasar por encima del agua dibujada, que sigue siendo la del relieve de 2024.)

### 11.3 En los puntos de la lista

Medianas por tramo de nivel, web (con todo lo anterior) frente a lo observado (dentro de muestra: la corrección se calculó con estas mismas imágenes):

| Punto | Marea 1,5–2,5 m: web / satélite | Marea 3,0–3,6 m: web / satélite |
|---|---|---|
| extremo oeste | 59 / 62 m | 38 / 44 m |
| Balneario | 59 / 62 m | 38 / 44 m |
| Club Náutico | 53 / 66 m | 34 / 35 m |
| Paseo del Cantábrico | 75 / 66 m | 46 / 40 m |
| Edificio Miramar | 68 / 65 m | 44 / 43 m |
| Torres Gauzón | 84 / 74 m | 51 / 43 m |
| extremo este | 82 / 82 m | 51 / 46 m |

### 11.4 Conclusiones

- **Margen que se muestra en la web: ±25 m** (MAD del error dejando fuera cada imagen). En marea baja la dispersión es mayor (la arena es casi llana: unos centímetros de ola mueven la orilla decenas de metros).
- **Antes de este cálculo, el panel daba demasiada arena**: medía hasta el agua en calma, sin la subida de las olas (en la arena de 1:85, cada 0,5 m de subida son unos 40 m) y, en el oeste, desde un «pie del muro» que caía encima del paseo en las bajadas y escaleras.
- **Limitaciones**: no hay medidas de campo; las imágenes son de hacia las 11:30 UTC; la playa cambia con los temporales y la corrección es la media de un año.

