// Orilla dibujada = orilla medida.
//
// La medida de la arena (arena.ts) lleva el agua hasta donde la ve el satélite en 2025‑2026: el
// relieve LiDAR de 2024 más la subida medida de la orilla y una corrección por tramo de playa (en
// algunos tramos la arena ha crecido o menguado desde 2024 hasta ±40 m). El mar, en cambio, se
// dibujaba sobre el relieve de 2024 tal cual, así que la cinta de la medida podía acabar dentro
// del agua o antes de llegar a ella.
//
// Aquí se calcula, para el nivel del mar y la sobreelevación de las olas (setup) de cada momento,
// cuánto hay que subir o bajar la arena en la franja de la orilla para que el borde medio del agua
// dibujada caiga justo donde acaba la medida. El ajuste es una rejilla de 5 m sobre la playa que
// leen el terreno (lo desplaza en altura), el agua (su fondo y su cota de rebose) y la cinta.
//
// Se trabaja por «rayos» hacia el mar: a lo largo del paseo, las mismas rectas que sigue la cinta
// (desde el pie del muro, uno de cada 2 puntos, ~4,5 m), con la medida de arena.ts; más allá del
// paseo (El Espartal), los perfiles de la playa (cada 25 m), con la misma regla. En cada rayo:
//   dM = donde acaba la medida (nivel + subida medida + corrección, y nunca más arena al subir la
//        marea);
//   dR = donde acaba el agua dibujada sin ajuste (nivel + setup);
//   δ  = (nivel + setup) − cota del terreno en dM: con δ sumado, el agua corta la arena en dM.
// δ se aplica entre dR y dM (10 m más a cada lado), con una inclinación de 1 cm por metro hacia
// el mar (si dM cae en un rellano del relieve de 2024, sin ella todo el rellano quedaría a ras del
// agua, medio mojado), y se apaga en 40 m; los rayos se mezclan por la distancia a su línea, y
// cada uno solo cuenta cerca de su franja (las rectas de los perfiles de los extremos cruzan la
// bahía y, sin esto, «votaban» 0 lejos de su orilla). Por último, en cada punto de la rejilla
// manda el rayo más cercano: si queda antes de su dM, se seca (se sube justo por encima del agua
// si hace falta: canales entre la arena y una barra que el satélite no ve llenos); si queda entre
// dM y el final de su franja, se moja.
// Por encima de 5,5–6,5 m (pie del muro, paseo) no se toca.
// El vaivén de cada ola sigue subiendo y bajando por encima de ese borde medio.

import * as THREE from 'three';
import { perfiles, correccionPerfil, subidaOrilla } from './arena';

/** Recta hacia el mar donde se hace coincidir la orilla dibujada con la medida. */
export interface Rayo {
  x: number; z: number; dx: number; dz: number;
  /** Desde dónde (m a lo largo del rayo) se busca la orilla. */
  desde: number;
  /** Alcance lateral al mezclar rayos (m). */
  radio: number;
  /** Metros hasta donde acaba la arena medida con el mar a `nivel` (null: no se puede medir). */
  medida: (nivel: number) => number | null;
}

const PASO = 5;          // m, rejilla del ajuste
const DESDE = -80;       // m, inicio de la búsqueda de la orilla en cada perfil (tierra adentro)
const HASTA = 700;       // m, final (mar adentro), como en arena.ts
const BANDA = 10;        // m a cada lado de la franja entre las dos orillas, ajuste completo
const RAMPA = 40;        // m de transición hasta 0
const RADIO = 30;        // m: alcance lateral de cada perfil al mezclarlos
/** Alcance lateral de cada rayo del muro (están a ~4,5 m). */
export const RADIO_MURO = 10;
const LEJOS_MURO = 120;  // m: un perfil más cerca que esto de un rayo del muro lo cubren los del muro
const MAXIMO = 2.5;      // m: tope del ajuste
const INCLINA = 0.01;    // m por m, hacia el mar, dentro de la franja
const POR_TEXEL = 6;     // rayos que se mezclan como mucho en cada punto

/** GLSL: ajusteOrilla(xz) → metros que se suman a la altura de la arena (0 fuera de la playa). */
export const AJUSTE_GLSL = /* glsl */ `
uniform sampler2D uAjusteOrilla;
uniform vec4 uAjusteCaja;   // x0, z0 (centro del primer nodo), nodos en x, nodos en z
float ajusteOrilla(vec2 xz) {
  vec2 uv = ((xz - uAjusteCaja.xy) / ${PASO.toFixed(1)} + 0.5) / uAjusteCaja.zw;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 0.0;
  return texture2D(uAjusteOrilla, uv).r;
}
`;

export function crearAjusteOrilla(o: {
  /** Cota de rebose (sin ajuste): el mar llega a (x, z) si su nivel la supera. */
  cotaMar: (x: number, z: number) => number;
  /** Altura del relieve (sin ajuste). */
  altura: (x: number, z: number) => number;
}) {
  // ---------- Rejilla: la caja de todos los perfiles, de DESDE a HASTA, más la rampa ----------
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [px, pz, nx, nz] of perfiles) for (const s of [DESDE, HASTA]) {
    const x = px + nx * s, z = pz + nz * s;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
  }
  x0 = Math.floor((x0 - RAMPA - RADIO) / PASO) * PASO; z0 = Math.floor((z0 - RAMPA - RADIO) / PASO) * PASO;
  const nx = Math.ceil((x1 + RAMPA + RADIO - x0) / PASO) + 1, nz = Math.ceil((z1 + RAMPA + RADIO - z0) / PASO) + 1;
  const datos = new Float32Array(nx * nz);
  const textura = new THREE.DataTexture(datos, nx, nz, THREE.RedFormat, THREE.FloatType);
  textura.magFilter = textura.minFilter = THREE.LinearFilter;
  textura.wrapS = textura.wrapT = THREE.ClampToEdgeWrapping;
  textura.needsUpdate = true;
  const uniformes = {
    uAjusteOrilla: { value: textura as THREE.Texture },
    uAjusteCaja: { value: new THREE.Vector4(x0, z0, nx, nz) },
  };

  // Nodos que el mar puede mojar (de −5 a 6,5 m) y cuánto se dejan tocar según su altura.
  const compacto = new Int32Array(nx * nz).fill(-1);
  const nodos: number[] = [], tope: number[] = [];
  for (let f = 0; f < nz; f++) for (let c = 0; c < nx; c++) {
    const h = o.altura(x0 + c * PASO, z0 + f * PASO);
    if (h < -5 || h > 6.5) continue;
    compacto[f * nx + c] = nodos.length;
    nodos.push(f * nx + c);
    tope.push(1 - THREE.MathUtils.smoothstep(h, 5.5, 6.5));
  }
  const nNodos = nodos.length;
  const iNodo = Int32Array.from(nodos), tNodo = Float32Array.from(tope);
  // Para cada nodo, los POR_TEXEL rayos que más le afectan: índice, posición a lo largo, peso.
  const iRayo = new Int32Array(nNodos * POR_TEXEL), sRayo = new Float32Array(nNodos * POR_TEXEL), wRayo = new Float32Array(nNodos * POR_TEXEL);
  const prioridad = new Float32Array(nNodos * POR_TEXEL);
  const gNodo = new Float32Array(nNodos);   // cota de rebose de cada nodo, sin ajuste

  let rayos: Rayo[] = [];
  let lo = new Float32Array(0), hi = new Float32Array(0), delta = new Float32Array(0), fin = new Float32Array(0);

  /** Reparte los rayos por los nodos (al ponerlos: recorre solo la franja de cada uno). */
  function preparar() {
    iRayo.fill(-1); wRayo.fill(0); prioridad.fill(0);
    for (let q = 0; q < nNodos; q++) gNodo[q] = o.cotaMar(x0 + (iNodo[q] % nx) * PASO, z0 + Math.floor(iNodo[q] / nx) * PASO);
    rayos.forEach((r, i) => {
      const a = r.desde - RAMPA, b = HASTA + RAMPA;
      const xs = [r.x + r.dx * a, r.x + r.dx * b], zs = [r.z + r.dz * a, r.z + r.dz * b];
      const c0 = Math.max(0, Math.floor((Math.min(...xs) - r.radio - x0) / PASO)), c1 = Math.min(nx - 1, Math.ceil((Math.max(...xs) + r.radio - x0) / PASO));
      const f0 = Math.max(0, Math.floor((Math.min(...zs) - r.radio - z0) / PASO)), f1 = Math.min(nz - 1, Math.ceil((Math.max(...zs) + r.radio - z0) / PASO));
      for (let f = f0; f <= f1; f++) for (let c = c0; c <= c1; c++) {
        const q = compacto[f * nx + c];
        if (q < 0) continue;
        const x = x0 + c * PASO - r.x, z = z0 + f * PASO - r.z;
        const s = x * r.dx + z * r.dz;
        if (s < a || s > b) continue;
        const lat = Math.abs(x * r.dz - z * r.dx);
        if (lat >= r.radio) continue;
        const w = (1 - lat / r.radio) ** 3;
        // Se quedan los POR_TEXEL más cercanos, y antes los que están cerca del arranque del rayo
        // (la orilla está a decenas de metros, no a cientos).
        const pr = w / (1 + Math.max(0, s) / 200);
        let menor = 0;
        for (let t = 1; t < POR_TEXEL; t++) if (prioridad[q * POR_TEXEL + t] < prioridad[q * POR_TEXEL + menor]) menor = t;
        const k = q * POR_TEXEL + menor;
        if (pr > prioridad[k]) { iRayo[k] = i; sRayo[k] = s; wRayo[k] = w; prioridad[k] = pr; }
      }
    });
    lo = new Float32Array(rayos.length); hi = new Float32Array(rayos.length);
    delta = new Float32Array(rayos.length); fin = new Float32Array(rayos.length);
  }

  /** Primer punto del rayo (desde su inicio) donde la cota de rebose baja de `linea`; null si no hay. */
  function borde(r: Rayo, linea: number): number | null {
    const cota = (s: number) => o.cotaMar(r.x + r.dx * s, r.z + r.dz * s);
    for (let s = r.desde; s <= HASTA; s += 4) {
      if (cota(s) >= linea) continue;
      let t = Math.max(r.desde, s - 4);
      while (t < s && cota(t + 1) >= linea) t++;
      return t + 1;
    }
    return null;
  }

  /** Rayo de un perfil de la playa: la orilla medida con la misma regla que arena.ts. */
  function rayoPerfil([x, z, dx, dz]: [number, number, number, number], i: number): Rayo {
    const r: Rayo = { x, z, dx, dz, desde: DESDE, radio: RADIO, medida: () => null };
    r.medida = (nivel) => {
      const bruto = (n: number) => {
        const b = borde(r, n + subidaOrilla(n));
        return b == null ? null : b + correccionPerfil(i, n);
      };
      let m = bruto(nivel);
      for (let dn = 0.25; m != null && dn <= 1.5; dn += 0.25) {
        const v = bruto(nivel - dn);
        if (v != null) m = Math.min(m, v);
      }
      return m;
    };
    return r;
  }

  let hecho = { nivel: NaN, setup: NaN }, ultimo = -Infinity, coste = 0;

  /** Recalcula el ajuste para el nivel del mar y el setup de ahora (si han cambiado lo bastante). */
  function actualizar(nivel: number, setup: number, ahora = performance.now()) {
    if (Math.abs(nivel - hecho.nivel) < 0.02 && Math.abs(setup - hecho.setup) < 0.02) return false;
    // Al arrastrar la hora: como mucho 4 veces por segundo, y menos si cada cálculo tarda.
    if (ahora - ultimo < Math.max(250, 4 * coste)) return false;
    ultimo = ahora;
    const t0 = performance.now();
    hecho = { nivel, setup };
    const agua = nivel + setup;
    rayos.forEach((r, i) => {
      const dM = r.medida(nivel), dR = borde(r, agua);
      if (dM == null || dR == null) { delta[i] = lo[i] = hi[i] = fin[i] = 0; return; }
      delta[i] = THREE.MathUtils.clamp(agua - o.cotaMar(r.x + r.dx * dM, r.z + r.dz * dM), -MAXIMO, MAXIMO);
      fin[i] = dM;
      lo[i] = Math.min(dM, dR) - BANDA;
      hi[i] = Math.max(dM, dR) + BANDA;
    });
    for (let q = 0; q < nNodos; q++) {
      let suma = 0, peso = 0, manda = -1, sManda = 0, mayor = 0;
      for (let t = 0; t < POR_TEXEL; t++) {
        const k = q * POR_TEXEL + t, i = iRayo[k];
        if (i < 0) continue;
        const s = sRayo[k], w = wRayo[k];
        const sb = Math.min(hi[i], Math.max(lo[i], s));          // punto de la franja más cercano
        const fuera = Math.abs(s - sb);
        const cuenta = w * Math.max(0, 1 - fuera / (2 * RAMPA));  // solo cerca de su franja
        suma += cuenta * (delta[i] - INCLINA * (sb - fin[i])) * Math.max(0, 1 - fuera / RAMPA);
        peso += cuenta;
        if (cuenta > mayor && hi[i] > lo[i]) { mayor = cuenta; manda = i; sManda = s; }
      }
      let v = suma / (peso + 0.01);
      if (manda >= 0) {
        const g = gNodo[q];
        if (sManda >= lo[manda] && sManda < fin[manda] - 2) v = Math.max(v, agua + 0.04 - g);       // arena
        else if (sManda > fin[manda] + 2 && sManda <= hi[manda]) v = Math.min(v, agua - 0.04 - g);  // agua
        v = THREE.MathUtils.clamp(v, -MAXIMO, MAXIMO);
      }
      datos[iNodo[q]] = v * tNodo[q];
    }
    textura.needsUpdate = true;
    coste = performance.now() - t0;
    return true;
  }

  /** Ajuste en (x, z), interpolado como en el sombreador. */
  function en(x: number, z: number): number {
    const c = (x - x0) / PASO, f = (z - z0) / PASO;
    if (c < 0 || f < 0 || c > nx - 1 || f > nz - 1) return 0;
    const c0 = Math.min(nx - 2, Math.floor(c)), f0 = Math.min(nz - 2, Math.floor(f)), fx = c - c0, fy = f - f0;
    const k = f0 * nx + c0;
    return (datos[k] * (1 - fx) + datos[k + 1] * fx) * (1 - fy) + (datos[k + nx] * (1 - fx) + datos[k + nx + 1] * fx) * fy;
  }

  const invalidar = () => { hecho = { nivel: NaN, setup: NaN }; ultimo = -Infinity; };
  /** Pone los rayos: los del muro (de la medida de arena.ts) y los perfiles lejos del paseo. */
  function ponerRayos(muro: Rayo[]) {
    const lejos = perfiles.map((p, i) => ({ p, i })).filter(({ p }) => muro.every((r) => Math.hypot(r.x - p[0], r.z - p[1]) > LEJOS_MURO));
    rayos = [...muro, ...lejos.map(({ p, i }) => rayoPerfil(p, i))];
    preparar();
    invalidar();
  }
  // Mientras no hay rayos del muro, todos los perfiles.
  ponerRayos([]);

  return {
    uniformes, actualizar, en, invalidar, ponerRayos,
    /** para depurar */ rayo: (i: number) => ({ ...rayos[i], delta: delta[i], lo: lo[i], hi: hi[i], fin: fin[i] }),
    /** para depurar: rayos y pesos del nodo más cercano a (x, z) */
    nodo(x: number, z: number) {
      const q = compacto[Math.round((z - z0) / PASO) * nx + Math.round((x - x0) / PASO)];
      if (q < 0) return null;
      return { valor: datos[iNodo[q]], tope: tNodo[q], rayos: [0, 1, 2, 3].map((t) => ({ i: iRayo[q * POR_TEXEL + t], s: sRayo[q * POR_TEXEL + t], w: wRayo[q * POR_TEXEL + t] })) };
    },
  };
}
