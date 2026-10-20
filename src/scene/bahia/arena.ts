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

/** Perfiles de la playa: [x, z, dirección hacia el mar x, z], cada 25 m sobre la curva de
 *  +3,1 m de la arena medida (tools/validar-ancho.py). */
export const perfiles = metaPerfiles.perfiles as [number, number, number, number][];

/** Índice del perfil cuyo arranque está más cerca de (x, z). */
export function perfilCercano(x: number, z: number): number {
  let i = 0, mejor = Infinity;
  perfiles.forEach((p, j) => { const d = Math.hypot(p[0] - x, p[1] - z); if (d < mejor) { mejor = d; i = j; } });
  return i;
}

/** Corrección local (m) del perfil i: lo que el satélite ve de más o de menos en 2025‑2026
 *  respecto al relieve (la playa ha cambiado desde el LiDAR de 2024). Ver
 *  tools/ancho-correccion.py; 0 donde no hay datos suficientes. Por encima de lo observado
 *  (mareas vivas altas) se desvanece en 0,8 m. */
const correcciones = metaCorreccion.perfiles as Record<string, (number | null)[]>;
export function correccionPerfil(i: number, nivel: number): number {
  const fila = correcciones[String(i)];
  if (!fila) return 0;
  const xs: number[] = [], ys: number[] = [];
  fila.forEach((v, j) => { if (v != null) { xs.push(metaCorreccion.niveles[j]); ys.push(v); } });
  if (!xs.length) return 0;
  if (nivel <= xs[0]) return ys[0];
  for (let j = 1; j < xs.length; j++) if (nivel <= xs[j]) return ys[j - 1] + ((ys[j] - ys[j - 1]) * (nivel - xs[j - 1])) / (xs[j] - xs[j - 1]);
  return ys[ys.length - 1] * (1 - THREE.MathUtils.smoothstep(nivel, xs[xs.length - 1], xs[xs.length - 1] + 0.8));
}

export function crearMedidaArena(o: {
  escena: THREE.Scene;
  camara: THREE.PerspectiveCamera;
  lienzo: HTMLCanvasElement;
  capa: HTMLElement;
  relieve: Relieve;
  /** Cota de rebose: el mar llega a (x, z) si su nivel la supera. */
  cotaMar: (x: number, z: number) => number;
  /** Cuánto sube o baja la arena dibujada para que la orilla caiga donde la medida (orilla.ts). */
  ajuste?: (x: number, z: number) => number;
}) {
  const alturaVista = (x: number, z: number) => o.relieve.altura(x, z) + (o.ajuste?.(x, z) ?? 0);
  const pies = (metaPaseo.tramos as PuntoMuro[][]).flat();
  const lugares = metaPaseo.lugares;

  /** Dirección hacia el mar en el punto k: la de los perfiles de la playa (normales a la curva
   *  de +3,1 m de la arena medida, cada 25 m), media de los dos más cercanos pesada por la
   *  distancia. La línea del muro no sirve: en los extremos del paseo hace eses. */
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

  /** Metros de arena desde el pie del muro k hasta donde llega el agua con el mar a `nivel`. Al
   *  subir la marea la arena no puede crecer: se toma el mínimo con los niveles algo más bajos
   *  (la corrección local va por tramos de nivel y, sin esto, podía dar un pequeño repunte). */
  const cachePunto = new Map<string, number | null>();
  function medirPunto(k: number, nivel: number): number | null {
    const clave = `${k}|${nivel.toFixed(2)}`;
    if (cachePunto.has(clave)) return cachePunto.get(clave)!;
    let m = medirBruto(k, nivel);
    for (let dn = 0.25; m != null && dn <= 1.5; dn += 0.25) {
      const v = medirBruto(k, nivel - dn);
      if (v != null) m = Math.min(m, v);
    }
    if (cachePunto.size > 8000) cachePunto.clear();
    cachePunto.set(clave, m);
    return m;
  }
  /** La medida en k: mediana de la de los puntos vecinos (±VECINOS, ~10 m de muro). Donde hay un
   *  canal entre la arena y una barra, justo a la altura del agua, la de un solo punto podía saltar
   *  decenas de metros de un punto al siguiente. */
  const VECINOS = 4;
  const cacheMedida = new Map<string, number | null>();
  function medir(k: number, nivel: number): number | null {
    const clave = `${k}|${nivel.toFixed(2)}`;
    if (cacheMedida.has(clave)) return cacheMedida.get(clave)!;
    const v: number[] = [];
    for (let j = Math.max(0, k - VECINOS); j <= Math.min(pies.length - 1, k + VECINOS); j++) {
      const m = medirPunto(j, nivel);
      if (m != null) v.push(m);
    }
    v.sort((a, b) => a - b);
    const m = v.length ? (v.length % 2 ? v[v.length >> 1] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : null;
    if (cacheMedida.size > 2000) cacheMedida.clear();
    cacheMedida.set(clave, m);
    return m;
  }

  function medirBruto(k: number, nivel: number): number | null {
    const [px, pz] = pieEn(k);
    const [dx, dz] = haciaMar(k);
    const linea = nivel + subidaOrilla(nivel);
    for (let d = 0; d <= 700; d += 1) {
      if (o.cotaMar(px + dx * d, pz + dz * d) < linea) return Math.max(0, d + correccionPerfil(perfilCercano(px, pz), nivel));
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
  puntos.push({ id: 'este', nombre: 'en el extremo este del paseo', k: pies.length - 1 });
  puntos.sort((a, b) => a.k - b.k);
  const balneario = puntos.find((p) => p.id === 'Balneario') ?? puntos[0];
  let sel: { id: string; nombre: string; k: number } = { ...balneario };
  const oyentes: (() => void)[] = [];

  // ---------- Cinta sobre la arena y rótulo ----------
  // Una regla tendida en la arena, del pie del muro al agua: línea fina del color de acento con
  // borde claro y una sombra suave debajo (se lee igual sobre arena seca, mojada o en sombra),
  // marcas cada 10 m (más largas cada 50 m), un punto en el pie del muro y un anillo donde llega
  // el agua, con un pulso lento. Grosor casi constante en pantalla (crece con la distancia).
  // Al elegir otro punto o al mostrarla, se traza del muro al agua (explica qué se mide); al
  // ocultarla, se desvanece rápido. Con «reducir movimiento», sin trazado ni pulso.
  // Transparente para dibujarse después del agua (orden de grupo 3).
  const reducir = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const uCinta = {
    uLargo: { value: 0 },
    uProgreso: { value: 1 },
    uOpacidad: { value: 1 },
    uTiempo: { value: 0 },
    uPulso: { value: reducir ? 0 : 1 },
    uDir: { value: new THREE.Vector2(0, 1) },
    // Naranja de acento de la web, en lineal y más saturado: el tono ACES lo apaga y lo aclara.
    uAcento: { value: new THREE.Color(1.0, 0.17, 0.035).multiplyScalar(1.25) },
    uClaro: { value: new THREE.Color('#fbf7f0').multiplyScalar(1.1) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms: uCinta, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    vertexShader: /* glsl */ `
      attribute float lado;     // −1 / +1 a cada lado de la línea
      attribute float extremo;  // −1 en el pie, +1 en el agua, 0 en medio
      attribute float largo;    // metros desde el pie
      uniform vec2 uDir;
      varying vec2 vC;          // (a lo largo, de través) en metros
      varying float vW;         // medio ancho de la línea, en metros
      void main() {
        vec4 m = modelMatrix * vec4(position, 1.0);
        float w = max(0.5, distance(cameraPosition, m.xyz) * 0.014);
        vec2 perp = vec2(-uDir.y, uDir.x);
        float r = 2.6 * w;      // el anillo del agua cabe dentro
        m.xz += perp * lado * r + uDir * extremo * r;
        vC = vec2(largo + extremo * r, lado * r);
        vW = w;
        gl_Position = projectionMatrix * viewMatrix * m;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uLargo, uProgreso, uOpacidad, uTiempo, uPulso;
      uniform vec3 uAcento, uClaro;
      varying vec2 vC;
      varying float vW;
      // «Sobre»: pone una capa de color c y opacidad a encima de lo que hay.
      void sobre(inout vec4 base, vec3 c, float a) { base.rgb = mix(base.rgb, c, a); base.a = a + base.a * (1.0 - a); }
      float banda(float d, float r, float aa) { return 1.0 - smoothstep(r - aa, r + aa, d); }
      void main() {
        float a = vC.x, b = abs(vC.y), w = vW;
        float aa = fwidth(vC.y) * 0.75 + 1e-4;
        float hasta = uProgreso * uLargo;
        float dentro = step(0.0, a) * step(a, hasta);
        vec4 c = vec4(0.0);
        // sombra suave bajo la línea
        sobre(c, vec3(0.05, 0.04, 0.03), 0.22 * dentro * (1.0 - smoothstep(0.3 * w, 1.5 * w, b)));
        // marcas cada 10 m (cada 50 m, más largas), sin tocar los extremos
        float aaU = fwidth(a) * 0.75 + 1e-4;
        float t10 = abs(a - 10.0 * floor(a / 10.0 + 0.5));
        float mayor = step(abs(a - 50.0 * floor(a / 50.0 + 0.5)), 0.5);
        float marca = banda(t10, 0.14 * w, aaU) * banda(b, mix(0.95, 1.4, mayor) * w, aa)
                    * step(3.0, a) * step(a, uLargo - 3.0) * dentro;
        sobre(c, uClaro, marca * 0.95);
        // línea: borde claro y alma de acento
        sobre(c, uClaro, dentro * banda(b, 0.42 * w, aa));
        sobre(c, uAcento, dentro * banda(b, 0.27 * w, aa));
        // punta redonda mientras se traza
        float punta = length(vec2(a - hasta, vC.y));
        float trazando = step(uProgreso, 0.999);
        sobre(c, uClaro, trazando * banda(punta, 0.42 * w, aa));
        sobre(c, uAcento, trazando * banda(punta, 0.27 * w, aa));
        // pie del muro: punto claro con aro de acento
        float p0 = length(vec2(a, vC.y));
        sobre(c, uAcento, banda(p0, 0.78 * w, aa));
        sobre(c, uClaro, banda(p0, 0.5 * w, aa));
        // donde llega el agua: anillo, punto central y un pulso lento hacia fuera
        float fin = smoothstep(0.85, 1.0, uProgreso);
        float p1 = length(vec2(a - uLargo, vC.y));
        float fase = fract(uTiempo / 2.6);
        float rp = mix(1.2, 2.5, fase) * w;
        sobre(c, uClaro, fin * uPulso * (1.0 - fase) * 0.55 * banda(abs(p1 - rp), 0.09 * w, aa));
        sobre(c, uClaro, fin * banda(abs(p1 - 1.15 * w), 0.3 * w, aa));
        sobre(c, uAcento, fin * banda(abs(p1 - 1.15 * w), 0.17 * w, aa));
        sobre(c, uAcento, fin * banda(p1, 0.38 * w, aa));
        if (c.a < 0.003) discard;
        gl_FragColor = vec4(c.rgb, c.a * uOpacidad);
      }`,
  });
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
  let hecho = '', kDibujado = -1;
  /** Mostrar u ocultar la cinta (la medida sigue en el panel). */
  let mostrar = true, opacidad = 1, progreso = 1, previo = -1;

  function dibujar(metros: number | null, nivel: number) {
    const clave = `${sel.k}|${metros == null ? 'x' : Math.round(metros)}|${Math.round(nivel * 20)}`;
    if (clave === hecho) return;
    hecho = clave;
    const [px, pz] = pieEn(sel.k);
    const [dx, dz] = haciaMar(sel.k);
    const largo = Math.max(metros ?? 0, 0);
    const pos: number[] = [], lados: number[] = [], extremos: number[] = [], largos: number[] = [], idx: number[] = [];
    const n = Math.max(1, Math.ceil(largo));
    for (let i = 0; i <= n; i++) {
      const d = (largo * i) / n;
      const x = px + dx * d, z = pz + dz * d, y = alturaVista(x, z) + 0.12;
      const ext = i === 0 ? -1 : i === n ? 1 : 0;
      pos.push(x, y, z, x, y, z);
      lados.push(-1, 1); extremos.push(ext, ext); largos.push(d, d);
      if (i < n) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('lado', new THREE.Float32BufferAttribute(lados, 1));
    g.setAttribute('extremo', new THREE.Float32BufferAttribute(extremos, 1));
    g.setAttribute('largo', new THREE.Float32BufferAttribute(largos, 1));
    g.setIndex(idx);
    cinta.geometry.dispose();
    cinta.geometry = g;
    uCinta.uLargo.value = largo;
    uCinta.uDir.value.set(dx, dz);
    // Otro punto: se vuelve a trazar del muro al agua.
    if (sel.k !== kDibujado) { kDibujado = sel.k; if (!reducir) progreso = 0; }
    const m = largo / 2;
    posRotulo.set(px + dx * m, alturaVista(px + dx * m, pz + dz * m) + 4, pz + dz * m);
    rotulo.textContent = metros == null ? '' : largo < 2 ? 'El agua llega al muro' : `${Math.round(largo)} m de arena`;
  }

  /** Avanza el trazado, el pulso y el desvanecido (cada cuadro). */
  function animar(ahora: number) {
    const dt = previo < 0 ? 0 : Math.min(0.1, (ahora - previo) / 1000);
    previo = ahora;
    // Trazado: 0,7 s con salida suave (cúbica); desvanecido: entra en 0,2 s y sale en 0,15 s.
    if (progreso < 1) progreso = Math.min(1, progreso + dt / 0.7);
    opacidad = mostrar ? Math.min(1, opacidad + dt / 0.2) : Math.max(0, opacidad - dt / 0.15);
    uCinta.uProgreso.value = 1 - (1 - progreso) ** 3;
    uCinta.uOpacidad.value = opacidad;
    uCinta.uTiempo.value = ahora / 1000;
    const largo = uCinta.uLargo.value;
    cinta.visible = opacidad > 0.001 && largo >= 2;
    rotulo.style.display = opacidad > 0.001 && rotulo.textContent ? '' : 'none';
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
    /** Actualiza la cinta para el nivel del mar del momento (cada cuadro). */
    actualizar(nivel: number, ahora = performance.now()) { dibujar(medir(sel.k, nivel), nivel); animar(ahora); },
    /** Muestra u oculta la cinta en la playa (la medida sigue en el panel). */
    mostrar(v: boolean) { if (v && !mostrar && !reducir) progreso = 0; mostrar = v; },
    visible: () => mostrar,
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
    rehacer() { pieCache.clear(); cachePunto.clear(); cacheMedida.clear(); hecho = ''; kDibujado = -1; oyentes.forEach((f) => f()); },
    /** Para depurar: punto del muro elegido y su dirección hacia el mar. */
    depurar: () => ({ sel, pie: pieEn(sel.k), haciaMar: haciaMar(sel.k) }),
    /** Para comprobar la orilla: medida y recta de cualquier punto k del muro. */
    enPunto: (k: number, nivel: number) => ({ metros: medir(k, nivel), pie: pieEn(k), haciaMar: haciaMar(k) }),
    nPuntos: pies.length,
  };
}
