// Muro del paseo de Salinas, su remate, la barandilla y el suelo del paseo, como piezas limpias
// (tools/paseo-muro.py: eje del «Paseo del Cantábrico» de OpenStreetMap; borde y pie del muro del
// LiDAR de 2024). Estilo de animación, a juego con la playa: luz por bandas y contornos.
// La sillería, el color y la barandilla (1 m, postes cada 2 m) son DECORATIVOS; la línea y la
// altura del muro, medidas. Luz física sencilla y sombras, como el terreno (sombreado.ts).

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
float linea(float x, float ancho) {     // líneas finas cada 1 (antialias)
  float f = abs(fract(x) - 0.5);
  float w = fwidth(x) * 1.2 + ancho;
  return 1.0 - smoothstep(0.5 - w, 0.5, f);
}
void main() {
  vec3 n = normalize(vNor) * (gl_FrontFacing ? 1.0 : -1.0);
  vec3 c;
  if (vTipo < 0.5) {
    // Sillería: hiladas de 0,5 m, juntas verticales cada 1,2 m al tresbolillo.
    float fila = floor(vUv.y / 0.5);
    float u = vUv.x / 1.2 + mod(fila, 2.0) * 0.5;
    float juntas = max(linea(vUv.y / 0.5, 0.02), linea(u, 0.015));
    c = vec3(0.80, 0.76, 0.67);
    c *= 0.94 + 0.06 * fract(sin(dot(vec2(floor(u), fila), vec2(12.9898, 78.233))) * 43758.5453);
    c = mix(c, c * 0.72, juntas);
    // franja que moja el mar: verdín oscuro, de borde nítido
    float verdin = 1.0 - smoothstep(uNivelMax + 0.35 - 0.03, uNivelMax + 0.35 + 0.03, vPos.y);
    c = mix(c, vec3(0.30, 0.36, 0.26), verdin);
    // contorno en el pie y en lo alto de la cara
    float pie = 1.0 - smoothstep(0.0, 0.06 + fwidth(vUv.y) * 1.5, vUv.y);
    c = mix(c, vec3(0.12, 0.1, 0.09), pie * 0.8);
  } else if (vTipo < 1.5) {
    c = vec3(0.9, 0.88, 0.82);                    // albardilla clara
    c = mix(c, c * 0.75, linea(vUv.x / 2.0, 0.02));
  } else if (vTipo < 2.5) {
    // suelo del paseo: baldosa clara en cuadrícula de 1 m
    c = vec3(0.78, 0.75, 0.7);
    c = mix(c, c * 0.86, max(linea(vUv.x, 0.03), linea(vUv.y, 0.03)));
  } else {
    c = vec3(0.92, 0.95, 0.96);                   // barandilla blanca
  }
  // piedra y baldosa mates; la barandilla, pintura algo satinada
  float rug = vTipo > 2.5 ? 0.45 : 0.88;
  vec3 v = normalize(cameraPosition - vPos);
  c = iluminar(c, n, v, rug, 0.04, sombra(vPos, n), 1.0);
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
