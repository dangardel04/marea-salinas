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
