// Muro del paseo de Salinas, su remate, la barandilla y el suelo del paseo, como piezas limpias
// (tools/paseo-muro.py: eje del «Paseo del Cantábrico» de OpenStreetMap; borde y pie del muro del
// LiDAR de 2024). La sillería (con relieve en las juntas), el color de cada sillar, los
// chorreones, el salitre, el verdín, las baldosas y la barandilla (1 m, postes cada 2 m) son
// DECORATIVOS; la línea y la altura del muro, medidas; la franja del verdín sigue la pleamar de
// las últimas horas. Luz física sencilla y sombras, como el terreno (sombreado.ts).

import * as THREE from 'three';
import { LUZ_GLSL } from './sombreado';
import { CAPA_SOMBRA } from './sombras';

export interface PuntoMuro { arriba: [number, number, number]; pie: [number, number, number]; eje: [number, number, number] }



const VERT = /* glsl */ `
attribute float tipo;   // 0 cara del muro, 1 albardilla, 2 suelo del paseo, 3 barandilla
varying vec2 vUv;
varying vec3 vPos;
varying vec3 vNor;
varying float vTipo;
void main() {
  vUv = uv; vTipo = tipo; vNor = normal;
  vec4 m = modelMatrix * vec4(position, 1.0);
  vPos = m.xyz;
  gl_Position = projectionMatrix * viewMatrix * m;
}
`;

const FRAG = /* glsl */ `
${LUZ_GLSL}
varying vec2 vUv;    // cara: u = metros a lo largo, v = metros desde el pie; suelo: metros (x, z)
varying vec3 vPos;
varying vec3 vNor;
varying float vTipo;
float hashP(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float ruidoP(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hashP(i), hashP(i + vec2(1, 0)), u.x), mix(hashP(i + vec2(0, 1)), hashP(i + vec2(1, 1)), u.x), u.y);
}
float fbmP(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * ruidoP(p); p = p * 2.07 + vec2(3.1, 1.7); a *= 0.5; }
  return s / 0.9375;
}
/** Sillar: distancia (m) a la junta más cercana en u y en v, e índice del bloque. */
vec4 sillar(vec2 uv) {
  float fila = floor(uv.y / 0.5);
  // cada hilada con su largo de sillar (0,9–1,6 m) y su desfase
  float largo = 0.9 + 0.7 * hashP(vec2(fila, 2.0));
  float u = uv.x / largo + hashP(vec2(fila, 7.0));
  float du = (0.5 - abs(fract(u) - 0.5)) * largo, dv = (0.5 - abs(fract(uv.y / 0.5) - 0.5)) * 0.5;
  return vec4(du, dv, floor(u), fila);
}
/** Altura del relieve de la piedra: el sillar abombado, más bajo en la junta, con grano. */
float relieveSillar(vec2 uv) {
  vec4 s = sillar(uv);
  float borde = min(s.x, s.y);
  return smoothstep(0.0, 0.06, borde) * 0.02 + smoothstep(0.0, 0.012, borde) * 0.008 + fbmP(uv * 9.0) * 0.004;
}
float linea(float x, float ancho) {     // líneas finas cada 1 (antialias)
  float f = abs(fract(x) - 0.5);
  float w = fwidth(x) * 1.2 + ancho;
  return 1.0 - smoothstep(0.5 - w, 0.5, f);
}
void main() {
  vec3 n = normalize(vNor) * (gl_FrontFacing ? 1.0 : -1.0);
  vec3 v = normalize(cameraPosition - vPos);
  float d = length(vPos - cameraPosition);
  float detalle = 1.0 - smoothstep(40.0, 220.0, d);
  vec3 c;
  float rug = 0.88, ao = 1.0;
  if (vTipo < 0.5) {
    // ---- Cara del muro: sillería (DECORATIVA; la línea y la altura del muro, medidas) ----
    vec4 s = sillar(vUv);
    vec2 bloque = s.zw;
    float hb = hashP(bloque), hb2 = hashP(bloque + 3.7);
    // piedra arenisca clara, cada sillar de un tono (algo más ocre, más gris, más claro)
    c = mix(vec3(0.46, 0.4, 0.31), vec3(0.62, 0.56, 0.45), hb) * mix(0.84, 1.1, hb2);
    c *= 0.86 + 0.24 * fbmP(vUv * vec2(3.0, 4.0) + bloque * 1.7) * detalle + 0.12 * (1.0 - detalle);
    c *= 0.94 + 0.12 * fbmP(vUv * vec2(14.0, 18.0)) * detalle;      // grano
    // relieve: normal con las pendientes del relieve del sillar (marco tangente de la cara)
    vec3 dp1 = dFdx(vPos), dp2 = dFdy(vPos);
    vec2 duv1 = dFdx(vUv), duv2 = dFdy(vUv);
    vec3 dp2p = cross(dp2, n), dp1p = cross(n, dp1);
    vec3 T = dp2p * duv1.x + dp1p * duv2.x, B = dp2p * duv1.y + dp1p * duv2.y;
    float inv = inversesqrt(max(max(dot(T, T), dot(B, B)), 1e-8));
    float e = 0.01;
    float h0 = relieveSillar(vUv);
    vec2 g = vec2(relieveSillar(vUv + vec2(e, 0.0)) - h0, relieveSillar(vUv + vec2(0.0, e)) - h0) / e;
    n = normalize(n - (T * inv) * g.x * 1.6 * detalle - (B * inv) * g.y * 1.6 * detalle);
    // junta hundida: mortero gris en sombra
    float junta = 1.0 - smoothstep(0.003, 0.014 + fwidth(vUv.y) * 1.2, min(s.x, s.y));
    c = mix(c, vec3(0.3, 0.27, 0.23), junta * 0.6);
    ao = 1.0 - junta * 0.4;
    float hMar = uNivelMax + 0.35;
    // chorreones de la lluvia desde la albardilla (más oscuros, en vertical)
    float chorro = smoothstep(0.55, 0.85, fbmP(vec2(vUv.x * 2.2, vPos.y * 0.25))) * smoothstep(hMar + 0.5, hMar + 2.5, vPos.y);
    c *= 1.0 - 0.18 * chorro;
    // salitre: velo blanquecino por encima de donde moja el mar
    float sal = smoothstep(0.45, 0.8, fbmP(vUv * vec2(1.3, 2.5) + 9.0)) * (1.0 - smoothstep(hMar + 0.3, hMar + 1.8, vPos.y)) * step(hMar, vPos.y);
    c = mix(c, vec3(0.86, 0.85, 0.8), sal * 0.35);
    // humedad: la piedra más oscura justo encima de la franja que moja el mar
    float humedad = 1.0 - smoothstep(hMar, hMar + 0.9 + 0.4 * fbmP(vUv * 1.5), vPos.y);
    c *= 1.0 - 0.25 * humedad;
    // franja que moja el mar: verdín y algas, oscuros, de borde irregular, y brillo de mojado
    float borde = hMar + (fbmP(vec2(vUv.x * 0.8, 0.0)) - 0.5) * 0.35;
    float verdin = 1.0 - smoothstep(borde - 0.04, borde + 0.04, vPos.y);
    vec3 alga = mix(vec3(0.16, 0.2, 0.12), vec3(0.24, 0.28, 0.16), fbmP(vUv * 4.0));
    c = mix(c, alga, verdin * 0.92);
    rug = mix(0.86, 0.35, verdin);
    // pie del muro, algo más oscuro (arena húmeda y sombra)
    c *= 1.0 - 0.35 * (1.0 - smoothstep(0.0, 0.35, vUv.y));
  } else if (vTipo < 1.5) {
    // ---- Albardilla: hormigón claro, tramos de 2 m, grano y algo de suciedad ----
    c = vec3(0.86, 0.84, 0.78) * (0.92 + 0.08 * fbmP(vUv * vec2(2.0, 6.0)));
    c = mix(c, c * 0.72, linea(vUv.x / 2.0, 0.015));
    rug = 0.8;
  } else if (vTipo < 2.5) {
    // ---- Suelo del paseo: baldosa de 1 m, cada una de un tono, gastada en el centro ----
    vec2 b = floor(vUv);
    float hb = hashP(b);
    c = mix(vec3(0.7, 0.67, 0.62), vec3(0.8, 0.77, 0.72), hb);
    c *= 0.93 + 0.1 * fbmP(vUv * 3.0 + b) * detalle;
    float jun = max(linea(vUv.x, 0.025), linea(vUv.y, 0.025));
    c = mix(c, c * 0.68, jun);
    ao = 1.0 - jun * 0.3;
    rug = 0.75 - 0.15 * fbmP(vUv * 0.4);   // zonas pulidas por el paso
  } else {
    // ---- Barandilla: pintura blanca satinada, con algo de suciedad abajo ----
    c = vec3(0.9, 0.92, 0.92) * (0.94 + 0.06 * fbmP(vPos.xz * 2.0 + vPos.y));
    rug = 0.38;
  }
  c = iluminar(c, n, v, rug, 0.04, sombra(vPos, n), ao);
  gl_FragColor = vec4(conNiebla(c, vPos), 1.0);
  #include <colorspace_fragment>
}
`;

export function crearPaseo(tramos: PuntoMuro[][], comunes: Record<string, THREE.IUniform>) {
  const pos: number[] = [], uv: number[] = [], tipo: number[] = [], idx: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[], ua: number[], ub: number[], uc: number[], ud: number[], t: number) => {
    const k = pos.length / 3;
    for (const [p, q] of [[a, ua], [b, ub], [c, uc], [d, ud]] as const) { pos.push(...p); uv.push(...q); tipo.push(t); }
    idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
  };
  // caja alargada de a a b (sección ancho × alto), para la barandilla
  const barra = (a: number[], b: number[], ancho: number, alto: number) => {
    const dx = b[0] - a[0], dz = b[2] - a[2], L = Math.hypot(dx, dz) || 1;
    const px = (-dz / L) * ancho / 2, pz = (dx / L) * ancho / 2;
    const v = (p: number[], sx: number, sy: number) => [p[0] + px * sx, p[1] + sy, p[2] + pz * sx];
    const lados: [number, number, number, number][] = [[-1, 1, 1, 1], [1, 1, 1, 0], [1, 0, -1, 0], [-1, 0, -1, 1]];
    for (const [s0, y0, s1, y1] of lados) {
      quad(v(a, s0, y0 * alto), v(b, s0, y0 * alto), v(b, s1, y1 * alto), v(a, s1, y1 * alto), [0, 0], [L, 0], [L, 1], [0, 1], 3);
    }
  };
  for (const tramo of tramos) {
    let largo = 0;
    for (let i = 0; i + 1 < tramo.length; i++) {
      const p = tramo[i], q = tramo[i + 1];
      const seg = Math.hypot(q.arriba[0] - p.arriba[0], q.arriba[2] - p.arriba[2]);
      // hacia tierra (del pie al borde), en horizontal y unitario
      const tierra = (r: PuntoMuro) => { const x = r.arriba[0] - r.pie[0], z = r.arriba[2] - r.pie[2], l = Math.hypot(x, z) || 1; return [x / l, z / l]; };
      const tp = tierra(p), tq = tierra(q);
      // Cara del muro: según el LiDAR es un talud inclinado de piedra (baja ~4 m en 6–12 m), así
      // que va del borde del paseo al pie, 0,4 m por encima del relieve para taparlo; el pie se
      // prolonga 1 m bajo la arena (v = metros desde el pie, medidos en vertical)
      const sobre = 0.4;
      const fp = [p.arriba[0], p.arriba[2]], fq = [q.arriba[0], q.arriba[2]];
      const piePr = [p.pie[0] - tp[0] * 1.0, p.pie[1] - 0.5, p.pie[2] - tp[1] * 1.0], pieQr = [q.pie[0] - tq[0] * 1.0, q.pie[1] - 0.5, q.pie[2] - tq[1] * 1.0];
      quad([piePr[0], piePr[1] + sobre, piePr[2]], [pieQr[0], pieQr[1] + sobre, pieQr[2]], [fq[0], q.arriba[1] + sobre * 0.5, fq[1]], [fp[0], p.arriba[1] + sobre * 0.5, fp[1]],
        [largo, -0.5], [largo + seg, -0.5], [largo + seg, q.arriba[1] - q.pie[1]], [largo, p.arriba[1] - p.pie[1]], 0);
      // albardilla: 0,6 m hacia tierra, 0,15 m por encima
      const alb = 0.15, ancho = 0.6;
      const pa = [fp[0], p.arriba[1] + sobre * 0.5 + alb, fp[1]], qa = [fq[0], q.arriba[1] + sobre * 0.5 + alb, fq[1]];
      const pi = [pa[0] + tp[0] * ancho, pa[1], pa[2] + tp[1] * ancho], qi = [qa[0] + tq[0] * ancho, qa[1], qa[2] + tq[1] * ancho];
      quad(pa, qa, qi, pi, [largo, 0], [largo + seg, 0], [largo + seg, 1], [largo, 1], 1);
      quad([pa[0], p.arriba[1] + sobre * 0.5, pa[2]], [qa[0], q.arriba[1] + sobre * 0.5, qa[2]], qa, pa, [largo, 0], [largo + seg, 0], [largo + seg, 1], [largo, 1], 1);
      // suelo del paseo: del remate hasta el eje y otro tanto más allá (ancho del paseo)
      const fin = (r: PuntoMuro, t: number[]) => {
        const dEje = Math.max(3, Math.hypot(r.eje[0] - r.arriba[0], r.eje[2] - r.arriba[2]) * 2);
        return [r.arriba[0] + t[0] * dEje, r.eje[1] + 0.06, r.arriba[2] + t[1] * dEje];
      };
      const pf = fin(p, tp), qf = fin(q, tq);
      quad(pi.map((v, k) => (k === 1 ? p.eje[1] + 0.06 : v)), qi.map((v, k) => (k === 1 ? q.eje[1] + 0.06 : v)), qf, pf,
        [pi[0], pi[2]], [qi[0], qi[2]], [qf[0], qf[2]], [pf[0], pf[2]], 2);
      // barandilla: postes cada 2 m y dos barras (a 0,5 y 1,0 m)
      const base = (r: number[], t: number[]) => [r[0] + t[0] * 0.25, r[1] + sobre * 0.5 + alb, r[2] + t[1] * 0.25];
      const bp = base(p.arriba, tp), bq = base(q.arriba, tq);
      // poste: dos planos cruzados de 6 cm × 1 m
      const poste = [bp[0], bp[1], bp[2]];
      quad([poste[0] - 0.03, poste[1], poste[2]], [poste[0] + 0.03, poste[1], poste[2]], [poste[0] + 0.03, poste[1] + 1.0, poste[2]], [poste[0] - 0.03, poste[1] + 1.0, poste[2]], [0, 0], [1, 0], [1, 1], [0, 1], 3);
      quad([poste[0], poste[1], poste[2] - 0.03], [poste[0], poste[1], poste[2] + 0.03], [poste[0], poste[1] + 1.0, poste[2] + 0.03], [poste[0], poste[1] + 1.0, poste[2] - 0.03], [0, 0], [1, 0], [1, 1], [0, 1], 3);
      barra([bp[0], bp[1] + 0.95, bp[2]], [bq[0], bq[1] + 0.95, bq[2]], 0.07, 0.07);
      barra([bp[0], bp[1] + 0.48, bp[2]], [bq[0], bq[1] + 0.48, bq[2]], 0.04, 0.04);
      largo += seg;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('tipo', new THREE.Float32BufferAttribute(tipo, 1));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: comunes, side: THREE.DoubleSide });
  const malla = new THREE.Mesh(geo, mat);
  malla.name = 'paseo';
  malla.layers.enable(CAPA_SOMBRA);
  return malla;
}
