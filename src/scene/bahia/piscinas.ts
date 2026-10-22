// Piscinas modeladas (no la foto aérea pegada al suelo): su forma y su sitio, medidos en la ortofoto
// PNOA a 0,195 m/píxel (tools/piscinas.py, src/scene/bahia-piscinas.json). El agua (color, fondo de
// azulejo con sus calles, ondas y cáusticas), el borde de piedra de 0,4 m y su altura son DECORATIVOS.
// Se dibujan sobre el terreno (a la cota más alta del relieve bajo la piscina), sin tocarlo: el
// relieve es de 5 m y un hueco en él se vería como una rampa.

import * as THREE from 'three';
import datos from '../bahia-piscinas.json';
import { LUZ_GLSL } from './sombreado';

const VERT = /* glsl */ `
attribute float tipo;   // 0 agua, 1 borde
varying vec2 vUv;       // agua: m a lo largo (x) y a lo ancho (y) de la piscina; borde: m en planta
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
uniform float uTiempo;
uniform vec2 uTam;        // largo y ancho de la piscina (m); el de esta malla
varying vec2 vUv;
varying vec3 vPos;
varying vec3 vNor;
varying float vTipo;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
}
/** Ondas de la superficie: desplazamiento (en m) del fondo que se ve a través y su pendiente. */
vec2 ondas(vec2 p, float t) {
  return vec2(vn(p * 1.3 + vec2(t * 0.35, t * 0.2)) - 0.5, vn(p * 1.1 - vec2(t * 0.25, -t * 0.3) + 7.0) - 0.5);
}
/** Cáusticas: red de líneas brillantes que se mueve despacio. */
float causticas(vec2 p, float t) {
  vec2 q = p * 1.6 + ondas(p * 0.7, t) * 1.5;
  float a = abs(sin(q.x * 2.1 + t * 0.6) + sin(q.y * 1.7 - t * 0.5) + sin((q.x + q.y) * 1.3 + t * 0.4));
  return pow(max(0.0, 1.0 - a * 0.45), 4.0);
}
void main() {
  vec3 v = normalize(cameraPosition - vPos);
  float d = length(vPos - cameraPosition);
  vec3 c;
  if (vTipo < 0.5) {
    // ---- Agua: se ve el fondo de azulejo con sus calles, deformado por las ondas, más oscuro y
    // más azul cuanto más hondo; encima, el reflejo del cielo (Fresnel) y el brillo del sol.
    float t = uTiempo;
    vec2 off = ondas(vUv, t) * 0.12;
    vec2 f = vUv + off;
    float borde = min(min(f.x, uTam.x - f.x), min(f.y, uTam.y - f.y));
    float hondo = smoothstep(0.0, 2.5, borde);
    // azulejo de 0,25 m con su junta
    vec2 az = fract(f / 0.25);
    float junta = 1.0 - smoothstep(0.0, 0.08, min(min(az.x, 1.0 - az.x), min(az.y, 1.0 - az.y)));
    vec3 fondo = mix(vec3(0.55, 0.78, 0.82), vec3(0.42, 0.66, 0.74), junta * (1.0 - smoothstep(10.0, 40.0, d)) * 0.6);
    // calles: líneas oscuras de 0,25 m a lo largo, cada 2,5 m (con su remate en T antes de la pared)
    float nCalles = max(1.0, floor(uTam.y / 2.5));
    float paso = uTam.y / nCalles;
    float yc = abs(fract(f.y / paso) - 0.5) * paso;
    float enLargo = step(2.0, f.x) * step(f.x, uTam.x - 2.0);
    float calle = (1.0 - smoothstep(0.1, 0.14, abs(yc - paso * 0.5))) * enLargo;
    float te = (1.0 - smoothstep(0.45, 0.5, abs(yc - paso * 0.5))) * (1.0 - smoothstep(0.1, 0.14, abs(f.x - 2.0))) + (1.0 - smoothstep(0.45, 0.5, abs(yc - paso * 0.5))) * (1.0 - smoothstep(0.1, 0.14, abs(f.x - uTam.x + 2.0)));
    fondo = mix(fondo, vec3(0.08, 0.16, 0.3), clamp(calle + te, 0.0, 1.0));
    fondo += vec3(0.9, 0.95, 0.85) * causticas(f, t) * 0.35 * (1.0 - smoothstep(15.0, 60.0, d));
    // el agua se come la luz: verde azulado y más oscuro hacia lo hondo (absorción, DECORATIVO)
    vec3 abs1 = mix(vec3(0.82, 0.95, 0.96), vec3(0.45, 0.72, 0.8), hondo);
    vec3 dentro = fondo * abs1 * (uAmbiente * 1.1 + uColorSol * uLuzSol * 0.9 * max(uDirSol.y, 0.0) * sombra(vPos, vec3(0.0, 1.0, 0.0)));
    // superficie: normal de las ondas, reflejo del cielo y destello del sol
    vec2 g = ondas(vUv * 2.0, t * 1.3) * 0.08 + ondas(vUv * 6.0, t * 2.0) * 0.03;
    vec3 n = normalize(vec3(g.x, 1.0, g.y));
    float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
    vec3 cielo = cieloEn(reflect(-v, n)) * (0.15 + 0.85 * uLuzDia);
    vec3 hv = normalize(uDirSol + v);
    float brillo = pow(max(dot(n, hv), 0.0), 600.0) * 8.0 * uLuzSol * sombra(vPos, n);
    c = mix(dentro, cielo, fres) + uColorSol * brillo;
  } else {
    // ---- Borde: piedra clara, losas de 0,5 m con su junta, algo gastada
    vec3 n = normalize(vNor) * (gl_FrontFacing ? 1.0 : -1.0);
    vec2 l = fract(vUv / 0.5);
    float junta = 1.0 - smoothstep(0.0, 0.06, min(min(l.x, 1.0 - l.x), min(l.y, 1.0 - l.y)));
    vec3 a = vec3(0.78, 0.76, 0.7) * (0.92 + 0.12 * vn(vUv * 5.0)) * (1.0 - 0.25 * junta * (1.0 - smoothstep(15.0, 50.0, d)));
    c = iluminar(a, n, v, 0.8, 0.04, sombra(vPos, n), 1.0);
  }
  gl_FragColor = vec4(conNiebla(c, vPos), 1.0);
  #include <colorspace_fragment>
}
`;

interface Piscina { esquinas: number[][]; largo: number; ancho: number }

/** Mallas de las piscinas. `altura`: cota del terreno dibujado en (x, z). */
export function crearPiscinas(altura: (x: number, z: number) => number, comunes: Record<string, THREE.IUniform>) {
  const grupo = new THREE.Group();
  grupo.name = 'piscinas';
  for (const p of datos.piscinas as Piscina[]) {
    const e = p.esquinas.map(([x, z]) => new THREE.Vector2(x, z));
    // ejes: el largo, de la esquina 0 a la del lado más largo
    const l01 = e[0].distanceTo(e[1]), l12 = e[1].distanceTo(e[2]);
    const [A, B, C, D] = l01 >= l12 ? e : [e[1], e[2], e[3], e[0]];
    const largo = A.distanceTo(B), ancho = B.distanceTo(C);
    const ex = B.clone().sub(A).normalize(), ey = D.clone().sub(A).normalize();
    // cota: la más alta del terreno bajo la piscina y su borde (+5 cm)
    let y = -Infinity;
    for (let a = -0.5; a <= largo + 0.5; a += 1) for (let b = -0.5; b <= ancho + 0.5; b += 1) {
      const q = A.clone().addScaledVector(ex, a).addScaledVector(ey, b);
      y = Math.max(y, altura(q.x, q.y));
    }
    y += 0.05;
    const pos: number[] = [], uv: number[] = [], tipo: number[] = [], idx: number[] = [];
    const quad = (pts: THREE.Vector3[], uvs: number[][], t: number) => {
      const k = pos.length / 3;
      pts.forEach((q, i) => { pos.push(q.x, q.y, q.z); uv.push(...uvs[i]); tipo.push(t); });
      idx.push(k, k + 2, k + 1, k, k + 3, k + 2);
    };
    const en = (a: number, b: number, h: number) => { const q = A.clone().addScaledVector(ex, a).addScaledVector(ey, b); return new THREE.Vector3(q.x, h, q.y); };
    // agua (un poco por debajo del borde)
    quad([en(0, 0, y - 0.04), en(largo, 0, y - 0.04), en(largo, ancho, y - 0.04), en(0, ancho, y - 0.04)], [[0, 0], [largo, 0], [largo, ancho], [0, ancho]], 0);
    // borde de 0,4 m y su canto exterior hasta 0,4 m por debajo (tapa el terreno)
    const b = 0.4;
    const anillo = [[0, 0], [largo, 0], [largo, ancho], [0, ancho]];
    const fuera = [[-b, -b], [largo + b, -b], [largo + b, ancho + b], [-b, ancho + b]];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      const p0 = en(anillo[i][0], anillo[i][1], y), p1 = en(anillo[j][0], anillo[j][1], y);
      const q0 = en(fuera[i][0], fuera[i][1], y), q1 = en(fuera[j][0], fuera[j][1], y);
      quad([q0, q1, p1, p0], [[q0.x, q0.z], [q1.x, q1.z], [p1.x, p1.z], [p0.x, p0.z]], 1);
      const s0 = q0.clone().setY(y - 0.4), s1 = q1.clone().setY(y - 0.4);
      quad([s0, s1, q1, q0], [[0, 0], [q0.distanceTo(q1), 0], [q0.distanceTo(q1), 0.4], [0, 0.4]], 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('tipo', new THREE.Float32BufferAttribute(tipo, 1));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide,
      uniforms: { ...comunes, uTam: { value: new THREE.Vector2(largo, ancho) } },
    });
    grupo.add(new THREE.Mesh(geo, mat));
  }
  return grupo;
}
