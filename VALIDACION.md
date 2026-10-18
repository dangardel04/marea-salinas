# Validación de la marea

Fecha de los cálculos: **18/10/2026**. Todos los números salen de `node tools/validar.ts` (resultado completo en `data/validacion.json`), `node tools/fuera-de-muestra.ts`, `node tools/residuo.ts` y `node tools/tabla-semana.ts`. Las fuentes están en `FUENTES.md`.

## Resumen

- **Horas**: el objetivo de ±10 min **se cumple** con el juego de constantes activo. Errores entre 0 y 6 min en la semana validada, y como mucho 8,8 min hasta el 31/12.
- **Alturas**: el objetivo de ±15 cm **no se cumple** con el juego activo. En la semana validada, 11 de las 31 pleamares/bajamares se pasan de 15 cm (máx. 16,9 cm). Hasta el 31/12 hay errores de hasta 23,8 cm y solo el 74,5 % de los extremos cumple los dos objetivos a la vez.
- **Causa**: no es falta de constituyentes. **La tabla oficial del IHM para Avilés y el mareógrafo REDMAR de Avilés no describen la misma marea.** El IHM da un rango un 4 % mayor y 6 min de retraso respecto a Gijón; los dos radares REDMAR dan un rango un 2 % menor y 0 min de retraso. Hay un juego de constantes, TICON‑4, que sí cumple frente a la tabla oficial (98,6 %), pero se aleja más de lo que se mide hoy en el puerto. Detalle en §3.
- **Decisión**: la aplicación usa las constantes ajustadas al mareógrafo de Avilés, porque con ellas la corrección en vivo funciona y el nivel mostrado queda a 3–6 cm de lo medido en las 24 h siguientes. Con TICON se quedaría a 13–15 cm. Cambiarlo es un comando (§6).

## 1. Método

- **Predicción**: `src/tide/motor.ts`, con la astronomía y las correcciones nodales IHO de `@neaps/tide-predictor` 0.11.0. Está comprobado que reproduce esa librería con un error menor de 1 mm y 30 s (`tests/motor.test.ts`).
- **Tabla oficial**: pleamares y bajamares del IHM, puerto id 7 «Avilés (San Juan de Nieva)», y su curva cada 5 min. Las horas están en UTC y las alturas, sobre el cero hidrográfico (FUENTES.md §3).
- **Emparejamiento**: cada extremo oficial se compara con el extremo predicho del mismo tipo más cercano, dentro de ±3 h. Ningún extremo quedó sin pareja en ningún juego.
- **Nivel medio sobre el CH (Z0)**: media de la curva oficial del IHM en el año natural 2026, que da **2,468 m** en Avilés (104 261 puntos) y 2,410 m en Gijón. La validación de **alturas en Avilés no es del todo independiente**: el nivel medio sale del propio IHM, así que el sesgo medio frente al IHM es casi cero por construcción. Lo que sí se mide es el error de amplitud y de forma.
- **Control independiente (Gijón)**: constantes ajustadas con 5,8 años del radar REDMAR de Gijón. El Z0 se pasa al CH con el datum **oficial** de Puertos del Estado (CH 0,350 m sobre el cero REDMAR), sin usar nada del IHM. Sirve para comprobar que el método funciona cuando las fuentes son coherentes.
- **Observaciones**: REDMAR minutal (QC = 1) promediado en ventanas de 10 min, del 01/10/2025 al 17/10/2026.

## 2. Juegos de constantes evaluados

| Juego | Constantes | Datos |
|---|---|---|
| **A, activo** | Ajuste propio por mínimos cuadrados, 55 constituyentes (Rayleigh R = 1) | Radar REDMAR Avilés 2, 01/10/2025–17/10/2026 (382 días). Residuo del ajuste: 10,3 cm RMS |
| B | TICON‑4 «Aviles», 50 constituyentes publicados | GESLA‑4/CMEMS, 27/04/2021–30/06/2025 (estación anterior del puerto) |
| C, control | Ajuste propio | Radar REDMAR Gijón 2, 2021–2026 (2116 días) |
| D | TICON‑4 «Gijon» | 2006–2025 |

M2 de cada juego: A 1,257 m / 92,2°; B 1,336 m / 95,8°; C 1,284 m / 91,7°; D 1,288 m / 91,1°.

## 3. Resultados frente a la tabla oficial del IHM

Error = predicción − IHM. Para los extremos, «dentro» significa que cumple los dos objetivos a la vez (±10 min y ±15 cm).

### Semana del 18 al 25/10/2026 (31 extremos, incluye el cambio de hora)

| Juego | Tiempo RMS (máx) | Altura RMS (máx) | Sesgo de pleamares / bajamares | Dentro |
|---|---|---|---|---|
| **A, Avilés, activo** | 3,9 min (5,8) | 12,3 cm (16,9) | −15,7 cm / −0,3 cm | **64,5 %** |
| B, TICON Avilés | 4,5 min (12,4) | 3,4 cm (6,8) | −2,7 cm / +2,0 cm | 96,8 % |
| C, Gijón control | 2,0 min (5,3) | 2,8 cm (5,5) | −0,7 cm / +2,5 cm | 100 % |
| D, TICON Gijón | 3,5 min (6,8) | 2,8 cm (5,4) | −1,5 cm / +2,3 cm | 100 % |

### Del 18/10 al 31/12/2026 (290 extremos, totalmente fuera del periodo de ajuste)

| Juego | Tiempo RMS (máx) | Altura RMS (máx) | Curva cada 5 min, RMS (máx) | Dentro |
|---|---|---|---|---|
| **A, Avilés, activo** | 4,9 min (8,8) | 12,0 cm (23,8) | 11,2 cm (27,4) | **74,5 %** |
| B, TICON Avilés | 4,0 min (12,4) | 5,4 cm (17,1) | 6,3 cm (20,8) | 98,6 % |
| C, Gijón control | 1,6 min (5,3) | 5,3 cm (9,8) | 6,7 cm (15,5) | 100 % |
| D, TICON Gijón | 3,1 min (8,4) | 4,8 cm (11,9) | 6,2 cm (16,9) | 100 % |

### Periodo completo, oct‑2025 a dic‑2026 (1766 extremos)

| Juego | Tiempo RMS (máx) | Altura RMS (máx) | Dentro |
|---|---|---|---|
| **A, Avilés, activo** | 4,4 min (10,7) | 11,2 cm (25,2) | 79,0 % |
| B, TICON Avilés | 4,8 min (14,9) | 5,0 cm (17,1) | 97,1 % |
| C, Gijón control | 1,8 min (5,4) | 4,6 cm (12,5) | 100 % |
| D, TICON Gijón | 3,2 min (11,9) | 4,5 cm (12,5) | 99,8 % |

### Por qué A falla en alturas: diagnóstico

1. **El método funciona.** En Gijón, el ajuste propio y el datum oficial (juego C) cumplen el 100 % frente a la tabla del IHM, sin usar nada del IHM.
2. **En Avilés las fuentes discrepan entre sí.** Comparación directa de las dos tablas IHM y de los dos radares REDMAR, del 01/10/2025 al 17/10/2026:

   | | Rango Avilés / Gijón | Retraso de Avilés respecto a Gijón |
   |---|---|---|
   | Tablas IHM | 1,041 | 6,2 min (desv. típ. 1,6) |
   | Radares REDMAR (regresión de 54 408 pares de 10 min) | 0,983 | 0 min (resolución de 10 min; con las fases de M2, unos 1 min). r = 0,9995 |

   La tabla IHM de Avilés coincide con TICON‑4 «Aviles», calculado con la estación **anterior** del puerto (2021–2025). El radar actual, instalado el 01/10/2025, mide un rango alrededor de un 6 % menor. **No dispongo de ese dato con certeza: cuál de los dos refleja mejor la marea real en Salinas.** Portus marca además el radar de Avilés como «Temporalmente fuera de servicio», aunque sirve datos con QC = 1 y coincide con el radar de Gijón con r = 0,9995.
3. **Se intentó iterar en la dirección que pide el objetivo.** Usar las constantes publicadas TICON‑4 (juego B) hace que se cumpla frente a la tabla oficial. Pero frente a lo que se mide hoy en el puerto es peor (§4) y estropea la corrección en vivo (§5). Añadir constituyentes al ajuste A no cambia nada: el error está en M2/S2/N2, no en los constituyentes menores.

### Tabla extremo a extremo, juego A (activo), 18–25/10/2026

Horas en Europe/Madrid. El domingo 25 cambia de CEST (UTC+2) a CET (UTC+1) y las horas siguen siendo coherentes a ambos lados del cambio.

| Día | Tipo | IHM oficial | Predicción | Δ tiempo (min) | IHM (m) | Predicción (m) | Δ altura (cm) |
|---|---|---|---|---:|---:|---:|---:|
| 18/10 | bajamar | 03:38 CEST | 03:34 | -3.8 | 1.96 | 1.89 | -7.5 |
| 18/10 | pleamar | 10:05 CEST | 10:01 | -3.5 | 3.34 | 3.18 | -16.2 **fuera** |
| 18/10 | bajamar | 16:31 CEST | 16:30 | -0.1 | 1.94 | 1.87 | -7.2 |
| 18/10 | pleamar | 22:56 CEST | 22:55 | -0.8 | 3.02 | 2.88 | -14.2 |
| 19/10 | bajamar | 04:59 CEST | 04:59 | 0.3 | 2.10 | 2.02 | -8.2 |
| 19/10 | pleamar | 11:31 CEST | 11:28 | -2.2 | 3.26 | 3.10 | -15.7 **fuera** |
| 19/10 | bajamar | 18:04 CEST | 18:05 | 1.4 | 1.97 | 1.89 | -8.2 |
| 20/10 | pleamar | 00:37 CEST | 00:35 | -1.3 | 3.05 | 2.91 | -13.7 |
| 20/10 | bajamar | 06:35 CEST | 06:34 | -0.3 | 2.06 | 1.98 | -8.4 |
| 20/10 | pleamar | 12:56 CEST | 12:54 | -1.4 | 3.34 | 3.18 | -15.9 **fuera** |
| 20/10 | bajamar | 19:25 CEST | 19:23 | -1.4 | 1.81 | 1.74 | -7.2 |
| 21/10 | pleamar | 01:49 CEST | 01:46 | -2.3 | 3.24 | 3.09 | -14.9 |
| 21/10 | bajamar | 07:46 CEST | 07:43 | -2.8 | 1.85 | 1.79 | -6.5 |
| 21/10 | pleamar | 13:59 CEST | 13:56 | -2.2 | 3.53 | 3.37 | -16.5 **fuera** |
| 21/10 | bajamar | 20:21 CEST | 20:16 | -4.3 | 1.56 | 1.52 | -3.8 |
| 22/10 | pleamar | 02:37 CEST | 02:34 | -2.6 | 3.48 | 3.32 | -16.5 **fuera** |
| 22/10 | bajamar | 08:36 CEST | 08:31 | -4.1 | 1.58 | 1.55 | -2.3 |
| 22/10 | pleamar | 14:47 CEST | 14:43 | -3.8 | 3.77 | 3.61 | -16.6 **fuera** |
| 22/10 | bajamar | 21:03 CEST | 20:57 | -5.6 | 1.27 | 1.29 | 2.0 |
| 23/10 | pleamar | 03:16 CEST | 03:12 | -4.0 | 3.73 | 3.57 | -16.6 **fuera** |
| 23/10 | bajamar | 09:17 CEST | 09:11 | -5.3 | 1.27 | 1.31 | 3.6 |
| 23/10 | pleamar | 15:27 CEST | 15:22 | -4.5 | 4.01 | 3.86 | -15.4 **fuera** |
| 23/10 | bajamar | 21:39 CEST | 21:33 | -5.7 | 0.99 | 1.07 | 7.9 |
| 24/10 | pleamar | 03:51 CEST | 03:46 | -4.7 | 3.98 | 3.82 | -16.1 **fuera** |
| 24/10 | bajamar | 09:54 CEST | 09:48 | -5.6 | 0.99 | 1.07 | 8.4 |
| 24/10 | pleamar | 16:05 CEST | 15:59 | -5.6 | 4.24 | 4.09 | -14.8 |
| 24/10 | bajamar | 22:14 CEST | 22:08 | -5.8 | 0.76 | 0.87 | 11.5 |
| 25/10 | pleamar | 03:26 CET | 03:20 | -5.8 | 4.21 | 4.04 | -16.9 **fuera** |
| 25/10 | bajamar | 09:30 CET | 09:24 | -5.2 | 0.76 | 0.86 | 10.1 |
| 25/10 | pleamar | 15:42 CET | 15:36 | -5.5 | 4.43 | 4.27 | -16.3 **fuera** |
| 25/10 | bajamar | 21:49 CET | 21:43 | -5.4 | 0.60 | 0.72 | 11.7 |

Con el juego B (TICON) solo un extremo de esta semana se sale del objetivo: la bajamar del 19/10 a las 18:04, con +12,4 min.

## 4. Resultados frente a las observaciones REDMAR (01/10/2025–17/10/2026)

Predicción sobre el cero del puerto (Z0 = 2,762 m, media observada). Los extremos observados son los máximos y mínimos de la serie suavizada (media móvil de 50 min) dentro de una ventana de ±3 h.

| Juego | Residuo RMS (máx) | Tiempo de los extremos, RMS | Altura de los extremos, RMS |
|---|---|---|---|
| **A, activo** | 10,3 cm (50,4) | 5,8 min | 10,3 cm |
| B, TICON Avilés | 15,0 cm (71,2) | 9,7 min (media +7,2 min) | 15,6 cm |

El juego A está ajustado con estas mismas observaciones. **Prueba fuera de muestra**: constantes ajustadas solo hasta el 01/07/2026 y evaluadas del 01/07 al 18/10/2026 (15 691 valores). Resultado: A da 9,5 cm RMS y B, 13,0 cm RMS.

El residuo de 10 cm que queda en A es sobre todo meteorológico (viento y presión): cambia despacio, con una autocorrelación horaria de 0,94 a 3 h y 0,73 a 24 h. Una predicción astronómica no puede recogerlo. Para eso está la fase 5.

## 5. Corrección en vivo (fase 5), backtest

`tools/residuo.ts` arranca cada hora del año. Toma r0 = mediana del residuo (observado − predicho) de la última hora y lo proyecta como r0·exp(−L/τ). El τ que menor error da en 1–12 h es **72 h**; el error apenas cambia entre 48 y 168 h.

Error RMS frente a lo observado según el plazo L (cm):

| Plazo | 1 h | 2 h | 3 h | 6 h | 9 h | 12 h | 24 h |
|---|---|---|---|---|---|---|---|
| A sin corrección | 10,3 | 10,3 | 10,3 | 10,3 | 10,3 | 10,3 | 10,3 |
| **A + corrección (τ = 72 h)** | **3,1** | **3,0** | **3,4** | **4,2** | **4,6** | **5,0** | **6,9** |
| A fuera de muestra (constantes hasta el 01/07, evaluación jul–oct), sin corrección | 12,1 | 12,0 | 12,0 | 12,0 | 12,0 | 11,9 | 11,8 |
| A fuera de muestra + corrección (τ = 72 h) | 3,3 | 3,8 | 4,7 | 5,7 | 4,9 | 4,4 | 5,9 |
| B (TICON) sin corrección | 15,0 | 15,0 | 15,0 | 15,0 | 15,0 | 15,0 | 15,0 |
| B + corrección (mejor τ = 24 h) | 6,8 | 10,2 | 13,1 | **16,0** | 11,6 | 7,9 | 10,6 |

En la aplicación la corrección se aplica también hacia atrás desde el último dato, con la misma atenuación: exp(−|t − t0|/τ). Así la curva del día no da un salto en t0. Esa parte hacia el pasado **no está validada con backtest**; se apoya en que la autocorrelación es simétrica en el tiempo.

Con B el residuo tiene **firma de marea**: la autocorrelación es 0,29 a 6 h y 0,89 a 12 h, señal de que es marea mal modelada y no meteorología. Por eso la corrección llega a empeorar el resultado a 6 h. Esta es la razón principal para usar A.

## 6. Cómo cambiar de juego de constantes

```bash
node tools/generar-constantes.ts ticon    # juego B: coincide con la tabla oficial del IHM
node tools/generar-constantes.ts ajuste   # juego A (activo): coincide con el mareógrafo de Avilés
```

Si se usa B, la corrección en vivo debería desactivarse (`src/tide/correccion.ts`), por lo explicado en §5.

## 7. Limitaciones

- Solo hay un año de radar en Avilés. SA y SSA, de origen sobre todo meteorológico, salen de un único año y varían de un año a otro.
- El Z0 sobre el CH de Avilés sale de la curva del IHM, porque no hay un esquema de datum publicado para Avilés. El desnivel cero del puerto → CH que se deduce de ahí, 0,295 m, es una **estimación**, no un dato oficial.
- La predicción es en el mareógrafo de San Juan de Nieva (bocana de la ría), a unos 3 km de la playa. No se ha medido la marea en la propia playa de Salinas; las diferencias de unos minutos o centímetros entre la bocana y la playa no están cuantificadas.
