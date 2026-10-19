// Cuánta arena hay entre el muro del paseo y el agua, en el punto que elija quien mira.
//
// Hasta dónde llega el agua: nivel del mar + lo que la sube el oleaje en la orilla. Esa subida está
// MEDIDA: es la mediana, por tramos de nivel, de 1.636 líneas de agua vistas por Sentinel‑2 en
// 2025‑2026 frente a la marea medida en Avilés (tools/validar-ancho.py, src/scene/bahia-orilla.json).
// Además, una corrección local por tramo de playa y nivel con lo observado en 2025‑2026 (la arena
// ha cambiado desde el LiDAR de 2024; tools/ancho-correccion.py). Validado dejando fuera cada
// imagen: sesgo de −7 a +4 m según la zona y margen típico de ±25 m, que es sobre todo lo que mueven
// la orilla las olas de cada momento (VALIDACION.md §11).
// El agua solo cuenta donde llega desde el mar (cota de rebose): los charcos no acortan la arena.
//
// En la escena: una cinta sobre la arena, del pie del muro al agua, a franjas de 10 m (sirve de
// regla), y un rótulo con los metros. Se elige un punto tocando la playa o de una lista de lugares.

import * as THREE from 'three';
import metaPaseo from '../bahia-paseo.json';
import metaOrilla from '../bahia-orilla.json';
import metaPerfiles from '../bahia-perfiles-playa.json';
import metaCorreccion from '../bahia-correccion-arena.json';
import type { PuntoMuro } from './paseo';
import type { Relieve } from './relieve';

/** Artículo de cada lugar, para escribir «frente al Balneario», «frente a las Torres Gauzón»… */
const ARTICULO: Record<string, string> = {
  'Club Náutico': 'el', Balneario: 'el', 'Torres Gauzón': 'las', 'Edificio Miramar': 'el', 'Iglesia del Carmen': 'la',
  'Museo de las Anclas': 'el', 'Mirador de Salinas': 'el', 'Paseo del Cantábrico': 'el', 'Dunas de El Espartal': 'las', 'La Peñona': '',
};
const frenteA = (n: string) => (ARTICULO[n] === 'el' ? `frente al ${n}` : ARTICULO[n] ? `frente a ${ARTICULO[n]} ${n}` : `frente a ${n}`);
const cercaDe = (n: string) => (ARTICULO[n] === 'el' ? `cerca del ${n}` : ARTICULO[n] ? `cerca de ${ARTICULO[n]} ${n}` : `cerca de ${n}`);

/** Subida de la orilla sobre el nivel (m), interpolada en la tabla medida; constante fuera. */
export function subidaOrilla(nivel: number): number {
  const xs = metaOrilla.nivel, ys = metaOrilla.subida;
  if (nivel <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) {
    if (nivel <= xs[i]) return ys[i - 1] + ((ys[i] - ys[i - 1]) * (nivel - xs[i - 1])) / (xs[i] - xs[i - 1]);
  }
  return ys[ys.length - 1];
}

export interface PuntoArena { id: string; nombre: string }

export function crearMedidaArena(o: {
  escena: THREE.Scene;
  camara: THREE.PerspectiveCamera;
  lienzo: HTMLCanvasElement;
  capa: HTMLElement;
  relieve: Relieve;
  /** Cota de rebose: el mar llega a (x, z) si su nivel la supera. */
  cotaMar: (x: number, z: number) => number;
}) {
  const pies = (metaPaseo.tramos as PuntoMuro[][]).flat();
  const lugares = metaPaseo.lugares;

  /** Dirección hacia el mar en el punto k: la de los perfiles de la playa (normales a la curva
   *  de +3,1 m de la arena medida, cada 25 m), media de los dos más cercanos pesada por la
   *  distancia. La línea del muro no sirve: en los extremos del paseo hace eses. */
  const perfiles = metaPerfiles.perfiles as [number, number, number, number][];
  function haciaMar(k: number): [number, number] {
    const [x0, , z0] = pies[k].arriba;
    const orden = perfiles.map((p) => ({ p, d: Math.hypot(p[0] - x0, p[1] - z0) })).sort((a, b) => a.d - b.d);
    const [a, b] = orden;
    const wa = 1 / Math.max(a.d, 1), wb = 1 / Math.max(b.d, 1);
    const nx = (a.p[2] * wa + b.p[2] * wb), nz = (a.p[3] * wa + b.p[3] * wb);
    const l = Math.hypot(nx, nz) || 1;
    return [nx / l, nz / l];
  }

  /** Pie del muro en el punto k, buscado en el relieve: desde el borde hacia el mar, el primer
   *  punto ya por debajo del borde (más de 1 m) donde acaba la cara del muro (pendiente
   *  menor del 25 %): ahí empieza la arena. (El pie guardado no vale en las bajadas y escaleras.) */
  const pieCache = new Map<number, [number, number]>();
  function pieEn(k: number): [number, number] {
    const c = pieCache.get(k);
    if (c) return c;
    const [x0, y0, z0] = pies[k].arriba;
    const [dx, dz] = haciaMar(k);
    const h = (d: number) => o.relieve.altura(x0 + dx * d, z0 + dz * d);
    let pie: [number, number] = [pies[k].pie[0], pies[k].pie[2]];
    for (let d = 0; d <= 45; d += 0.5) {
      if (h(d) < y0 - 1 && Math.abs(h(d + 2) - h(d)) < 0.5) { pie = [x0 + dx * d, z0 + dz * d]; break; }
    }
    pieCache.set(k, pie);
    return pie;
  }

  /** Corrección local (m) del perfil de playa más cercano al pie: lo que el satélite ve de más o
   *  de menos en 2025‑2026 respecto al relieve (la playa ha cambiado desde el LiDAR de 2024).
   *  Ver tools/ancho-correccion.py; 0 donde no hay datos suficientes. Por encima de lo observado
   *  (mareas vivas altas) se desvanece en 0,8 m. */
  const correcciones = metaCorreccion.perfiles as Record<string, (number | null)[]>;
  function correccion(px: number, pz: number, nivel: number): number {
    let i = 0, mejor = Infinity;
    perfiles.forEach((p, j) => { const d = Math.hypot(p[0] - px, p[1] - pz); if (d < mejor) { mejor = d; i = j; } });
    const fila = correcciones[String(i)];
    if (!fila) return 0;
    const xs: number[] = [], ys: number[] = [];
    fila.forEach((v, j) => { if (v != null) { xs.push(metaCorreccion.niveles[j]); ys.push(v); } });
    if (!xs.length) return 0;
    if (nivel <= xs[0]) return ys[0];
    for (let j = 1; j < xs.length; j++) if (nivel <= xs[j]) return ys[j - 1] + ((ys[j] - ys[j - 1]) * (nivel - xs[j - 1])) / (xs[j] - xs[j - 1]);
    return ys[ys.length - 1] * (1 - THREE.MathUtils.smoothstep(nivel, xs[xs.length - 1], xs[xs.length - 1] + 0.8));
  }

  /** Metros de arena desde el pie del muro k hasta donde llega el agua con el mar a `nivel`. Al
   *  subir la marea la arena no puede crecer: se toma el mínimo con los niveles algo más bajos
   *  (la corrección local va por tramos de nivel y, sin esto, podía dar un pequeño repunte). */
  const cacheMedida = new Map<string, number | null>();
  function medir(k: number, nivel: number): number | null {
    const clave = `${k}|${nivel.toFixed(2)}`;
    if (cacheMedida.has(clave)) return cacheMedida.get(clave)!;
    let m = medirBruto(k, nivel);
    for (let dn = 0.25; m != null && dn <= 1.5; dn += 0.25) {
      const v = medirBruto(k, nivel - dn);
      if (v != null) m = Math.min(m, v);
    }
    if (cacheMedida.size > 2000) cacheMedida.clear();
    cacheMedida.set(clave, m);
    return m;
  }

  function medirBruto(k: number, nivel: number): number | null {
    const [px, pz] = pieEn(k);
    const [dx, dz] = haciaMar(k);
    const linea = nivel + subidaOrilla(nivel);
    for (let d = 0; d <= 700; d += 1) {
      if (o.cotaMar(px + dx * d, pz + dz * d) < linea) return Math.max(0, d + correccion(px, pz, nivel));
    }
    return null;
  }

  const cercano = (x: number, z: number) => {
    let k = 0, mejor = Infinity;
    pies.forEach((p, i) => { const dd = Math.hypot(p.pie[0] - x, p.pie[2] - z); if (dd < mejor) { mejor = dd; k = i; } });
    return { k, d: mejor };
  };
  const lugarCercano = (x: number, z: number) => {
    let n = '', mejor = Infinity;
    for (const l of lugares) { const dd = Math.hypot(l.x - x, l.z - z); if (dd < mejor) { mejor = dd; n = l.nombre; } }
    return mejor < 400 ? n : '';
  };

  // Puntos con nombre: los lugares que están junto al muro, de oeste a este, y los dos extremos.
  const puntos: (PuntoArena & { k: number })[] = [];
  for (const l of lugares) {
    const c = cercano(l.x, l.z);
    if (c.d > 60) continue;
    puntos.push({ id: l.nombre, nombre: l.nombre === 'Paseo del Cantábrico' ? 'en el centro del paseo' : frenteA(l.nombre), k: c.k });
  }
  puntos.push({ id: 'oeste', nombre: 'en el extremo oeste del paseo', k: 0 });
  puntos.push({ id: 'este', nombre: 'en el extremo este del paseo, hacia El Espartal', k: pies.length - 1 });
  puntos.sort((a, b) => a.k - b.k);
  const balneario = puntos.find((p) => p.id === 'Balneario') ?? puntos[0];
  let sel: { id: string; nombre: string; k: number } = { ...balneario };
  const oyentes: (() => void)[] = [];

  // ---------- Cinta sobre la arena y rótulo ----------
  // Transparente (aunque opaca) para dibujarse después del agua: donde el satélite ve arena que el
  // relieve de 2024 deja bajo el agua, la cinta sigue viéndose encima.
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const cinta = new THREE.Mesh(new THREE.BufferGeometry(), material);
  cinta.frustumCulled = false;
  // En un grupo con su orden: el del grupo del agua manda sobre el de los objetos sueltos.
  const capaCinta = new THREE.Group();
  capaCinta.renderOrder = 3;
  capaCinta.add(cinta);
  o.escena.add(capaCinta);
  const rotulo = document.createElement('span');
  rotulo.className = 'etiqueta etiqueta-medida';
  o.capa.appendChild(rotulo);
  const posRotulo = new THREE.Vector3();
  const ACENTO = new THREE.Color('#ff7a45'), BLANCO = new THREE.Color('#fbf7f0');
  let hecho = '';

  function dibujar(metros: number | null) {
    const clave = `${sel.k}|${metros == null ? 'x' : Math.round(metros)}`;
    if (clave === hecho) return;
    hecho = clave;
    const [px, pz] = pieEn(sel.k);
    const [dx, dz] = haciaMar(sel.k);
    const largo = Math.max(metros ?? 0, 0);
    const pos: number[] = [], col: number[] = [], idx: number[] = [];
    const ANCHO = 2.4, nx = -dz * ANCHO / 2, nz = dx * ANCHO / 2;
    const n = Math.max(1, Math.ceil(largo / 2));
    for (let i = 0; i <= n; i++) {
      const d = (largo * i) / n;
      const x = px + dx * d, z = pz + dz * d, y = o.relieve.altura(x, z) + 0.25;
      const c = Math.floor(d / 10) % 2 === 0 ? ACENTO : BLANCO;   // franjas de 10 m
      pos.push(x + nx, y, z + nz, x - nx, y, z - nz);
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
      if (i < n) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    cinta.geometry.dispose();
    cinta.geometry = g;
    cinta.visible = largo >= 2;
    const m = largo / 2;
    posRotulo.set(px + dx * m, o.relieve.altura(px + dx * m, pz + dz * m) + 9, pz + dz * m);
    rotulo.textContent = metros == null ? '' : largo < 2 ? 'El agua llega al muro' : `${Math.round(largo)} m de arena`;
  }

  // ---------- Elegir un punto tocando la playa ----------
  // Un toque o clic sin arrastrar: el rayo se corta con el relieve (unas pocas iteraciones sobre
  // la altura) y se toma el punto del muro más cercano, si está a menos de 200 m.
  const rayo = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let abajo: { x: number; y: number; t: number } | null = null;
  o.lienzo.addEventListener('pointerdown', (e) => { abajo = e.isPrimary ? { x: e.clientX, y: e.clientY, t: performance.now() } : null; });
  o.lienzo.addEventListener('pointerup', (e) => {
    if (!abajo || e.button > 0) return;
    const movido = Math.hypot(e.clientX - abajo.x, e.clientY - abajo.y), dt = performance.now() - abajo.t;
    abajo = null;
    if (movido > 6 || dt > 500) return;
    const r = o.lienzo.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    rayo.setFromCamera(ndc, o.camara);
    const { origin: a, direction: v } = rayo.ray;
    if (v.y > -0.01) return;
    let y = 4, x = 0, z = 0;
    for (let i = 0; i < 5; i++) {
      const t = (y - a.y) / v.y;
      x = a.x + v.x * t; z = a.z + v.z * t;
      y = o.relieve.altura(x, z);
    }
    const c = cercano(x, z);
    if (c.d > 200) return;
    const conNombre = puntos.find((p) => Math.abs(p.k - c.k) <= 2);
    const lugar = lugarCercano(pies[c.k].pie[0], pies[c.k].pie[2]);
    sel = conNombre ?? { id: 'mapa', nombre: lugar ? `punto tocado, ${cercaDe(lugar)}` : 'punto tocado en la playa', k: c.k };
    oyentes.forEach((f) => f());
  });

  return {
    /** Rótulo para colocarlo con los demás (posición 3D que cambia). */
    etiqueta: { e: rotulo, p: posRotulo },
    /** Actualiza la cinta para el nivel del mar del momento. */
    actualizar(nivel: number) { dibujar(medir(sel.k, nivel)); },
    /** Metros de arena en el punto elegido con el mar a `nivel` (null si no se puede medir). */
    medir: (nivel: number) => medir(sel.k, nivel),
    margen: metaCorreccion.margen,
    puntos: puntos.map(({ id, nombre }) => ({ id, nombre })) as PuntoArena[],
    elegido: () => ({ id: sel.id, nombre: sel.nombre }),
    elegir(id: string) {
      const p = puntos.find((x) => x.id === id);
      if (p) { sel = { ...p }; oyentes.forEach((f) => f()); }
    },
    alCambiar(f: () => void) { oyentes.push(f); },
    /** Cuando llega el relieve fino: el pie del muro se vuelve a buscar en él. */
    rehacer() { pieCache.clear(); cacheMedida.clear(); hecho = ''; oyentes.forEach((f) => f()); },
    /** Para depurar: punto del muro elegido y su dirección hacia el mar. */
    depurar: () => ({ sel, pie: pieEn(sel.k), haciaMar: haciaMar(sel.k) }),
  };
}
