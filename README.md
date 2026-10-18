# Marea en Salinas

Web estática (Vite + TypeScript + Three.js) con la bahía de Salinas (Castrillón, Asturias) en 3D: de Arnao a la ría de Avilés, con su relieve, el pueblo, la playa y el mar. El nivel del mar sigue la marea calculada para el puerto de Avilés y las olas, la previsión de oleaje propagada sobre el fondo de la bahía. Por defecto muestra la hora actual y permite moverse por el resto del día y los 7 días siguientes.

- **Marea**: altura sobre el cero hidrográfico, si sube o baja y a qué ritmo, próximas pleamar y bajamar (junto a las de la tabla oficial del IHM) y curva del día.
- **Corrección en vivo** con el mareógrafo REDMAR de Avilés cuando hay red. El panel indica siempre si es **«Predicción»** o **«Predicción + corrección»**.
- **Olas**: mar de fondo y mar de viento previstos, la medida de la boya de Gijón y hasta dónde sube el agua por la arena (fórmula de Stockdon, con su margen).
- **Escena 3D**:
  - Relieve LiDAR y ortofoto del IGN cargados por niveles de detalle (zoom libre a cualquier tramo, hasta ~0,4 m por píxel en la costa). En la playa, el paseo y las dunas, relieve de 1 m con el LiDAR de 2024.
  - Arena que cubre y descubre la marea, medida con la orilla vista desde satélite.
  - 12.905 partes de edificio del Catastro.
  - Fondo marino de EMODnet.
  - Olas que se refractan hacia la orilla, rompen y suben por la arena.
  - Sol, luna y fase lunar reales.
  - Vistas rápidas: Bahía, Salinas, El Espartal, San Juan y A pie de playa.
- **Sin conexión**: el motor de marea, la escena y las fuentes van empaquetados. Sin red solo se pierden la corrección en vivo, las olas y la comparación con el IHM.
- **Hora**: interna en UTC; todo lo que se muestra va en Europe/Madrid, incluido el cambio de hora del 25/10/2026 (ese domingo dura 25 horas).

## Ejecutar

Necesita Node 24 (los scripts de `tools/` usan TypeScript nativo de Node).

```bash
npm install
```

```bash
npm run dev
```

```bash
npm test
```

```bash
npm run build
```

`npm run build` deja la web estática en `dist/` (unos 53 MB, casi todo la ortofoto, los edificios y el relieve fino), con rutas relativas. La interfaz pesa unos 70 KB y aparece al momento; la escena 3D se carga después en su propio paquete.

## De dónde salen los datos

Detalle completo, con URL, fecha de consulta y licencia, en [FUENTES.md](FUENTES.md).

| Qué | Fuente |
|---|---|
| Constantes armónicas (activas) | Híbrido por mínimos cuadrados: constituyentes rápidas con un año (01/10/2025–17/10/2026) del mareógrafo REDMAR Avilés 2 y periodo largo (SA, SSA, MM…) con 5,8 años del de Gijón 2, ambos de Puertos del Estado. 55 constituyentes. Elegido por ser el más fiel a lo medido (VALIDACION.md §8) |
| Alternativa | TICON‑4 «Aviles» (Hart‑Davis et al., 2025, CC BY‑NC 4.0), vía `@neaps/tide-database` |
| Astronomía de la marea | `@neaps/tide-predictor` 0.11.0 (MIT): argumentos y correcciones nodales IHO |
| Nivel medio sobre el cero hidrográfico | Media de la predicción oficial del IHM (Avilés) en 2026 |
| Corrección en vivo | Puertos del Estado, `poem.puertos.es/portus/StationData`, estación 3107 |
| Tabla oficial para comparar | IHM, `ideihm.covam.es/api-ihm/getmarea`, puerto 7 «Avilés (San Juan de Nieva)» |
| Previsión de olas | Open‑Meteo Marine (modelo), celda a unos 14 km frente a Salinas |
| Olas medidas | Boya de Gijón de Puertos del Estado (id 1117) |
| Subida del agua por las olas | Stockdon et al. (2006), con la pendiente de la arena medida (LiDAR arriba, satélite en la franja intermareal) |
| Relieve en tierra y ortofoto | IGN: MDT de 5 m (LiDAR PNOA) y ortofoto PNOA de septiembre de 2023 |
| Relieve de la playa | IGN/CNIG: nube LiDAR PNOA 2024 (3ª cobertura), suelo a 1 m. Las teselas se bajan a mano (la descarga pide un reCAPTCHA) y van en `data/raw/lidar/` |
| Arena intermareal | Línea de agua en 15 imágenes Sentinel‑2 (Copernicus) de oct‑2025 a oct‑2026, con el nivel medido por el mareógrafo de Avilés |
| Fondo marino | EMODnet Bathymetry DTM 2024 (referido a la LAT) |
| Edificios | Catastro (INSPIRE Buildings): huella y número de plantas |
| Sol y luna | suncalc 2.1.1 |

Para regenerar los datos, en este orden. Los dos scripts de Python necesitan Python 3 con numpy, rasterio, matplotlib, laspy[lazrs] y pyproj. `tools/bahia-relieve.ts` se ejecuta tres veces: la primera baja el MDT05, la segunda mete el LiDAR de 2024 y la tercera, la franja del satélite:

```bash
node tools/descargar.ts
```

```bash
node tools/ajuste.ts gijon
```

```bash
node tools/ajuste.ts aviles
```

```bash
node tools/validar.ts
```

```bash
node tools/ajuste.ts aviles-hibrido
```

```bash
node tools/generar-constantes.ts hibrido
```

```bash
node tools/residuo.ts
```

```bash
python tools/lidar-fino.py
```

```bash
node tools/bahia-relieve.ts
```

```bash
python tools/intermareal-s2.py
```

```bash
node tools/bahia-relieve.ts
```

```bash
node tools/bahia-orto.ts
```

```bash
python tools/arena-color.py
```

```bash
node tools/bahia-edificios.ts
```

```bash
node tools/pendiente-playa.ts
```

```bash
node tools/oleaje-validar.ts
```

## Precisión medida

Números completos en [VALIDACION.md](VALIDACION.md).

### Marea frente a la realidad

Referencia: el mareógrafo de Avilés, evaluando cada mes con constantes que no lo vieron.

- **Marea astronómica sola**: 12,2 cm RMS. Es sobre todo el efecto del viento y la presión, que una predicción astronómica no puede conocer.
- **Con la corrección en vivo**: 3,2 cm a 1 h, 4,7 cm a 6 h y 7,2 cm a 24 h.
- **Pleamares y bajamares observadas**: 6,5 min y 12,3 cm RMS.
- Se compararon 4 juegos de constantes y el activo es el más fiel a lo medido. TICON‑4, que coincide con la tabla oficial, queda 3 cm peor, y con él la corrección en vivo empeora el resultado.

### Marea frente a la tabla oficial del IHM (Avilés)

Error = predicción − tabla oficial.

| Periodo | Horas, RMS (máx) | Alturas, RMS (máx) | Dentro de ±10 min y ±15 cm |
|---|---|---|---|
| 18–25/10/2026 (31 extremos) | 4,0 min (5,9) | 9,2 cm (15,1) | 96,8 % |
| 18/10–31/12/2026 (290 extremos) | 4,9 min (8,8) | 10,0 cm (19,6) | 90,3 % |

- **Horas**: cumplen ±10 min siempre.
- **Alturas**: cumplen ±15 cm casi siempre, pero no siempre. Las pleamares salen de media unos 9 cm por debajo de la tabla.
- **Por qué**: la tabla oficial de Avilés y el mareógrafo actual de Avilés discrepan. Según el IHM, Avilés tiene un 4 % más de rango que Gijón; según los dos radares REDMAR, un 2 % menos. En Gijón, donde las fuentes son coherentes, el mismo método cumple el 100 %.
- **Si se prefiere coincidir con la tabla oficial**: `node tools/generar-constantes.ts ticon` (98,6 % dentro frente al IHM, pero peor frente a lo medido).

### Arena intermareal (satélite)

- **Perfil de la franja que cubre y descubre la marea**, por debajo de lo que midió el LiDAR (unos +2 m) hasta +1,15 m: ±0,45 m RMS en vertical, validado dejando cada imagen fuera. La pendiente genérica fallaba 2,9 m RMS en esos mismos puntos.
- Frente al LiDAR de 2024, sin usarlo en el ajuste: 0,46 m RMS el perfil del satélite y 0,68 m la pendiente genérica.
- En bajamar se descubre más arena de la que mostraba la escena: la cota +1,5 m queda unos 25 m más hacia el mar.

### Olas

- **Altura en mar abierto**: comparando el modelo con la boya de Gijón en su mismo punto (2106 horas, jul–oct 2026), sesgo de −2 cm, error RMS de 17 cm (13 %) y correlación de 0,955.
- **Dirección**: el modelo viene de media 22° más del oeste que la boya.
- **Subida del agua por las olas**: los autores de la fórmula dan un error RMS de 38 cm. **No se ha medido en Salinas.**
- **Propagación dentro de la bahía** (refracción, rotura): comprobada frente a la teoría, no frente a medidas.

## Qué es real y qué es aproximado

| Real (medido u oficial) | Aproximado, supuesto o decorativo |
|---|---|
| Marea: constantes de observaciones reales, horas UTC verificadas | Desnivel entre el cero del puerto de Avilés y el cero hidrográfico (0,292 m, estimado; no hay datum oficial publicado) |
| Elección de constantes por validación fuera de muestra | Ciclo estacional (SA, SSA…) de Gijón aplicado a Avilés |
| Corrección con el mareógrafo en vivo | Corrección hacia el pasado (misma atenuación, sin backtest propio) |
| Relieve LiDAR de tierra, dunas y arena (1 m en la playa, vuelo de 2024); arena intermareal hasta +1,15 m desde satélite (±0,45 m); fondo marino EMODnet | Arena por debajo de +1,15 m y tramos sin perfil válido (los huecos de hasta 150 m, interpolados): pendiente 1:50 que pasa a EMODnet en 250 m |
| Ortofoto PNOA 2023, huellas y plantas del Catastro, color de los tejados | Altura de los edificios (3 m por planta, supuesta); fachadas y ventanas encendidas (decorativas) |
| Altura, periodo y dirección de las olas (previsión), pendiente de la arena alta (1:22) | Forma de cada ola y del vaivén, espuma, transparencia y reflejos del agua; grano y brillo de la arena mojada (el color de la arena sí es el medido en la foto); sombra tras espigón y cabos |
| Posición del sol y de la luna, fase lunar | NMMA → CH del relieve (2,095 m, tomado de la relación de Gijón); tamaño de la luna (×3); colores del cielo |

La marea se calcula en el mareógrafo de San Juan de Nieva, a unos 3 km de la playa. No se ha medido ni la marea ni la subida de las olas en la propia playa.

## Desplegar como web estática

El build usa `base: './'`, así que sirve igual en la raíz de un dominio y en una subruta.

### Cloudflare Pages

1. Sube el repositorio a GitHub o GitLab.
2. En Cloudflare: *Workers & Pages → Create → Pages → Connect to Git*.
3. Configura así:
   - *Framework preset*: Vite
   - *Build command*: `npm run build`
   - *Build output directory*: `dist`
   - Variable de entorno `NODE_VERSION` = `24`
4. Para subir el build a mano en lugar de conectar el repositorio:

```bash
npx wrangler pages deploy dist --project-name marea-salinas
```

Ningún fichero de `dist` pasa de 25 MB (el mayor, `edificios.bin`, ocupa 7,5 MB), que es el límite por fichero de Cloudflare Pages.

### GitHub Pages

El flujo [.github/workflows/pages.yml](.github/workflows/pages.yml) pasa las pruebas, construye y publica en cada push a `main`. En el repositorio: *Settings → Pages → Source: GitHub Actions*. La web queda en `https://<usuario>.github.io/<repositorio>/`.

## Estructura

```
src/config.ts         coordenadas y ceros (con su fuente)
src/bahia.ts          marco de coordenadas de la bahía
src/tiempo.ts         UTC ↔ Europe/Madrid
src/tide/             motor armónico, constantes activas, corrección en vivo
src/oleaje/           previsión, boya, propagación (fast marching) y subida del agua
src/scene/bahia/      escena 3D: teselas, edificios, agua, cielo, cámara
src/ui/               panel, curva, controles, tabla IHM
tools/                descarga, ajuste, validación, backtest, relieve, ortofoto, edificios
tests/                pruebas (vitest)
data/                 datos derivados y resultados de validación
public/bahia/         relieve, teselas de ortofoto y edificios
```

## Licencias de datos

- TICON‑4: CC BY‑NC 4.0 (uso no comercial).
- IGN (MDT y ortofoto PNOA) y EMODnet: CC BY 4.0, citando la fuente.
- Catastro y Puertos del Estado: reutilización libre citando la fuente.
- IHM y Open‑Meteo: se usan citando su origen.
- Sentinel‑2: contiene datos modificados de Copernicus Sentinel 2025–2026.
- LiDAR PNOA 2024: © Instituto Geográfico Nacional (CNIG), CC BY 4.0.
- Texturas de arena: Poly Haven (Aerial Beach 01, Damp Beach Sand 02), CC0. Rizado del agua: `waternormals.jpg` de three.js, MIT.
- Polígono de la playa: © colaboradores de OpenStreetMap (ODbL).
