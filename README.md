# Marea en Salinas

Web estática (Vite + TypeScript + Three.js) con una escena 3D de la playa de Salinas (Castrillón, Asturias). El mar sube y baja con la marea calculada para el puerto de Avilés. Muestra la hora actual por defecto y permite moverse por el resto del día y los 7 días siguientes.

- Altura actual sobre el cero hidrográfico, si sube o baja y a qué ritmo, próximas pleamar y bajamar, y curva del día.
- Corrección en vivo con el mareógrafo REDMAR de Avilés cuando hay red. El panel indica siempre si es **«Predicción»** o **«Predicción + corrección»**.
- Al lado de cada pleamar y bajamar, la de la tabla oficial del IHM (cuando hay red) para comparar.
- Funciona sin internet: el motor de marea, el relieve y las fuentes van empaquetados. Sin red solo se pierden la corrección en vivo y la comparación con el IHM.
- Hora interna en UTC; todo lo que se muestra va en Europe/Madrid, incluido el cambio de hora del 25/10/2026 (ese domingo dura 25 horas).

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

`npm run build` deja la web estática en `dist/`, con rutas relativas.

## De dónde salen los datos

Detalle completo, con URL y fecha de consulta, en [FUENTES.md](FUENTES.md).

| Qué | Fuente |
|---|---|
| Constantes armónicas (activas) | Híbrido por mínimos cuadrados: constituyentes rápidas con un año (01/10/2025–17/10/2026) del mareógrafo REDMAR Avilés 2 y periodo largo (SA, SSA, MM…) con 5,8 años del mareógrafo REDMAR Gijón 2, ambos de Puertos del Estado. 55 constituyentes. Elegido por ser el más fiel a lo medido (VALIDACION.md §8) |
| Alternativa | TICON‑4 «Aviles» (Hart‑Davis et al., 2025, CC BY‑NC 4.0), vía `@neaps/tide-database` |
| Astronomía de la marea | `@neaps/tide-predictor` 0.11.0 (MIT): argumentos y correcciones nodales IHO |
| Nivel medio sobre el cero hidrográfico | Media de la predicción oficial del IHM (Avilés) en 2026 |
| Corrección en vivo | Puertos del Estado, `poem.puertos.es/portus/StationData`, estación 3107 |
| Tabla oficial para comparar | IHM, `ideihm.covam.es/api-ihm/getmarea`, puerto 7 «Avilés (San Juan de Nieva)» |
| Relieve | IGN, MDT de 5 m (LiDAR PNOA). La franja intermareal baja es una pendiente genérica **aproximada** |
| Sol y luna | suncalc 2.1.1 |

Para regenerar los datos:

```bash
node tools/descargar.ts
```

```bash
node tools/ajuste.ts gijon
```

```bash
node tools/ajuste.ts aviles-hibrido
```

```bash
node tools/validar.ts
```

```bash
node tools/generar-constantes.ts hibrido
```

```bash
node tools/residuo.ts
```

```bash
node tools/mdt.ts
```

## Precisión medida

Números completos en [VALIDACION.md](VALIDACION.md).

**Frente a la realidad** (mareógrafo de Avilés, cada mes evaluado con constantes que no lo vieron):

- Marea astronómica sola: 12,2 cm RMS. Es sobre todo el efecto del viento y la presión, que una predicción astronómica no puede conocer.
- Con la corrección en vivo: 3,2 cm a 1 h, 4,7 cm a 6 h y 7,2 cm a 24 h.
- Pleamares y bajamares observadas: 6,5 min y 12,3 cm RMS.

Se compararon 4 juegos de constantes (VALIDACION.md §8) y el activo es el más fiel a lo medido. TICON‑4, que coincide con la tabla oficial, queda 3 cm peor y con él la corrección en vivo empeora el resultado.

**Frente a la tabla oficial del IHM** (Avilés). Error = predicción − tabla oficial:

| Periodo | Horas, RMS (máx) | Alturas, RMS (máx) | Dentro de ±10 min y ±15 cm |
|---|---|---|---|
| 18–25/10/2026 (31 extremos) | 4,0 min (5,9) | 9,2 cm (15,1) | 96,8 % |
| 18/10–31/12/2026 (290 extremos) | 4,9 min (8,8) | 10,0 cm (19,6) | 90,3 % |

- **Horas**: cumplen ±10 min siempre.
- **Alturas**: cumplen ±15 cm casi siempre, pero no siempre. Las pleamares salen de media unos 9 cm por debajo de la tabla. La causa es que la tabla oficial de Avilés y el mareógrafo actual de Avilés discrepan: un 4 % más de rango que Gijón según el IHM, frente a un 2 % menos según los dos radares REDMAR. En Gijón, donde las fuentes son coherentes, el mismo método cumple el 100 %.
- Si se prefiere coincidir con la tabla oficial: `node tools/generar-constantes.ts ticon` (98,6 % dentro frente al IHM, pero peor frente a lo medido).

## Qué es real y qué es aproximado

| Real (medido u oficial) | Aproximado o decorativo |
|---|---|
| Marea: constantes de observaciones reales, horas UTC verificadas | Desnivel entre el cero del puerto de Avilés y el cero hidrográfico (0,292 m, estimado; no hay datum oficial publicado) |
| Elección de constantes por validación fuera de muestra frente al mareógrafo | Ciclo estacional (SA, SSA…) de Gijón aplicado a Avilés: supuesto igual en los dos puertos |
| Corrección con el mareógrafo en vivo | Corrección hacia el pasado (misma atenuación, sin backtest propio) |
| Dunas y arena seca del MDT del IGN | Franja intermareal baja y fondo (pendiente 1:50) |
| Posición del sol y de la luna, fase lunar | NMMA → CH del relieve (2,095 m, tomado de la relación de Gijón) |
| Orientación de la playa (polígono OSM) | Oleaje (Gerstner decorativo), tamaño de la luna (×3), colores del cielo |

La predicción se calcula en el mareógrafo de San Juan de Nieva, a unos 3 km. No se ha medido la marea en la propia playa.

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

### GitHub Pages

El flujo [.github/workflows/pages.yml](.github/workflows/pages.yml) pasa las pruebas, construye y publica en cada push a `main`. En el repositorio: *Settings → Pages → Source: GitHub Actions*. La web queda en `https://<usuario>.github.io/<repositorio>/`.

## Estructura

```
src/config.ts        coordenadas y ceros (con su fuente)
src/tiempo.ts        UTC ↔ Europe/Madrid
src/tide/            motor armónico, constantes activas, corrección en vivo
src/scene/           escena 3D, relieve, sol y luna
src/ui/              panel, curva, controles, tabla IHM
tools/               descarga, ajuste, validación, backtest, MDT
tests/               pruebas (vitest)
data/                datos derivados y resultados de validación
```

## Licencias de datos

TICON‑4 es CC BY‑NC 4.0 (uso no comercial). Los datos de Puertos del Estado son públicos y exigen citar la fuente. Los del IHM y el IGN se usan citando su origen. El polígono de la playa es © colaboradores de OpenStreetMap (ODbL).
