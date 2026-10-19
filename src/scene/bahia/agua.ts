// Agua de la bahía: parches que acompañan a las teselas visibles del terreno + anillo de mar
// abierto hasta el horizonte.
//
// Oleaje (todo en el sombreador de vértices):
//   - Dos sistemas (mar de fondo y mar de viento) con altura Hs, periodo Tp y dirección de los
//     datos; cada uno se reparte en 4 componentes de Gerstner (periodos 0,82-1,22·Tp) que suman
//     la misma energía: Hs = 4·√(Σ aᵢ²/2).
//   - Fase φ = ω·(T(x) − t), con T(x) el tiempo de llegada calculado por fast marching sobre el
//     fondo (refracción); longitud de onda local por dispersión lineal (Fenton y McKee, 1990).
//   - Altura local = Hs·Ks (asomeramiento), limitada por rotura a 0,78·h.
//   - «Exposición»: las olas que llegan tras girar mucho respecto al mar abierto se atenúan
//     (aproximación de la sombra detrás de espigón y cabos; no es difracción rigurosa).
//   - Orilla: sobreelevación media (setup) y vaivén hasta la cota R2 de Stockdon (2006), al ritmo
//     del periodo de pico y con la fase del agua contigua. El dibujo del vaivén es ilustrativo;
//     la cota máxima sale de la fórmula.

import * as THREE from 'three';
import { LADO, PASO_RELIEVE } from '../../bahia';
import { PASO_CAMPO } from './campoOlas';

const crearAguaVert = (segmentos: number) => /* glsl */ `
#define SEGMENTOS ${segmentos.toFixed(1)}
uniform vec3 uTesela;     // x0, z0, lado
uniform float uLejos;
uniform sampler2D uRelieve;
uniform vec2 uRel;        // nodos por lado, paso (m)
uniform sampler2D uCampoA;
uniform sampler2D uCampoB;
uniform vec2 uCampo;      // nodos por lado, paso (m)
uniform vec4 uSisA;       // Hs, Tp, dirección hacia (x, z) en mar abierto
uniform vec4 uSisB;
uniform float uTiempo;
uniform float uNivel;
uniform float uSetup;
uniform float uR2;
varying vec3 vPos;
varying vec3 vNormal;
varying float vRotura;
varying float vFase;
varying float vVaiven;
varying float vCiclo;
varying vec2 vDir;
varying float vAlcance;
varying vec4 vRefl;
uniform mat4 uMatReflejo;

const float G = 9.81;
const float PI2 = 6.28318531;
const float MEDIO = ${(LADO / 2).toFixed(1)};

vec2 uvNodo(vec2 xz, vec2 rej) { return ((xz + MEDIO) / rej.y + 0.5) / rej.x; }
float fondo(vec2 xz) {
  if (abs(xz.x) > MEDIO || abs(xz.y) > MEDIO) return -40.0;
  return texture(uRelieve, uvNodo(xz, uRel)).r;
}
float longitud(float T, float h) {
  float L0 = G * T * T / PI2;
  float w = PI2 / T;
  return L0 * pow(tanh(pow(w * sqrt(h / G), 1.5)), 2.0 / 3.0);
}
float asomeramiento(float T, float h) {
  float L = longitud(T, h);
  float kh = min(PI2 * h / L, 10.0);
  float n = 0.5 * (1.0 + 2.0 * kh / sinh(2.0 * kh));
  float cg0 = G * T / (2.0 * PI2);
  return sqrt(cg0 / max(L / T * n, 1e-3));
}

void componente(float a, float T, float psi, float abanico, vec2 d, vec2 p, float tLlegada, float h,
                vec2 xz, inout vec3 desp, inout vec3 nrm, inout float fase) {
  if (a < 0.002) return;
  float w = PI2 / T;
  float L = longitud(T, h);
  float k = PI2 / L;
  // Nivel de detalle de las olas: una ola más corta que ~4 separaciones de vértice no se puede
  // dibujar en esta malla (aliasing); se desvanece. Lejos, las olas cortas no se distinguirían.
  float esp = uTesela.z / SEGMENTOS;
  if (uLejos < 0.5) a *= smoothstep(2.5 * esp, 5.0 * esp, L);
  if (a < 0.002) return;
  float th = w * (tLlegada - uTiempo) + psi + k * abanico * dot(p, xz);
  float s = min(0.42, k * a * 1.6);           // pendiente efectiva de la cresta
  float Q = s / max(k * a, 1e-4);
  float sn = sin(th), cs = cos(th);
  desp.xz += Q * a * d * cs;
  desp.y += a * sn;
  nrm.xz -= d * k * a * cs;
  nrm.y -= Q * k * a * sn;
  if (fase < -9.0) fase = th;
}

void sistema(vec4 S, sampler2D campo, vec2 xz, float h, inout vec3 desp, inout vec3 nrm,
             inout float rotura, inout float fase, out float tLlegada, out float alcance) {
  vec4 c = texture(campo, uvNodo(xz, uCampo));
  tLlegada = c.r;
  alcance = c.a;
  if (S.x < 0.02) return;
  vec2 d = normalize(c.gb + vec2(1e-5));
  vec2 p = vec2(-d.y, d.x);
  float exposicion = smoothstep(-0.2, 0.75, dot(d, S.zw));
  float Ks = asomeramiento(S.y, h);
  float hLocal = S.x * Ks * exposicion * c.a;
  float hMax = 0.78 * h;
  float limite = hLocal > hMax ? hMax / hLocal : 1.0;
  rotura = max(rotura, smoothstep(0.6, 1.0, hLocal / max(hMax, 1e-3)) * step(0.05, hLocal));
  float f = Ks * exposicion * c.a * limite;
  // Reparto de energía en 4 componentes: pesos 0,2 / 0,35 / 0,3 / 0,15.
  float a0 = S.x / 4.0 * f;
  componente(a0 * sqrt(2.0 * 0.35), S.y * 1.0,  0.0, 0.00, d, p, tLlegada, h, xz, desp, nrm, fase);
  componente(a0 * sqrt(2.0 * 0.30), S.y * 0.88, 1.7, 0.09, d, p, tLlegada * 1.0, h, xz, desp, nrm, fase);
  componente(a0 * sqrt(2.0 * 0.20), S.y * 1.14, 4.1, -0.07, d, p, tLlegada * 1.0, h, xz, desp, nrm, fase);
  componente(a0 * sqrt(2.0 * 0.15), S.y * 0.76, 2.6, 0.16, d, p, tLlegada * 1.0, h, xz, desp, nrm, fase);
}

void main() {
  vec3 p = vec3(uTesela.x + position.x * uTesela.z, 0.0, uTesela.y + position.z * uTesela.z);
  if (uLejos > 0.5) p = position;
  vec3 desp = vec3(0.0);
  vec3 nrm = vec3(0.0, 1.0, 0.0);
  float rotura = 0.0, fase = -10.0, vaiven = 0.0, ciclo = 0.5;
  float prof = uNivel - fondo(p.xz);
  if (uLejos < 0.5) {
    float h = max(prof, 0.08);
    float tA, tB, alcA, alcB;
    sistema(uSisA, uCampoA, p.xz, h, desp, nrm, rotura, fase, tA, alcA);
    sistema(uSisB, uCampoB, p.xz, h, desp, nrm, rotura, fase, tB, alcB);
    // Fase de la ola principal (para la espuma): siempre la misma componente, sin saltos entre
    // vértices vecinos aunque alguna componente se apague por el nivel de detalle.
    if (uSisA.x >= 0.02) fase = PI2 / max(uSisA.y, 1.0) * (tA - uTiempo);
    // Orilla: setup y vaivén hasta R2 (solo en la franja de lavado).
    float franja = (1.0 - smoothstep(0.0, 1.6, prof)) * step(-uR2 - 0.3, prof) * alcA;
    // Vaivén asimétrico, como en la orilla real: el agua sube deprisa (30 % del periodo, frenando
    // al llegar arriba) y se retira despacio (70 %). La cota máxima es R2 (forma ilustrativa).
    ciclo = fract((uTiempo - tA) / max(uSisA.y, 1.0) + 0.15);
    float subida = 1.0 - pow(1.0 - clamp(ciclo / 0.3, 0.0, 1.0), 2.0);
    float bajada = clamp((ciclo - 0.3) / 0.7, 0.0, 1.0);
    bajada = bajada * bajada * (3.0 - 2.0 * bajada);
    float pulso = ciclo < 0.3 ? subida : 1.0 - bajada;
    vaiven = uR2 * pulso * franja;
    desp.y += uSetup * franja + vaiven;
    desp *= smoothstep(-uR2 - 0.3, 0.05, prof); // en seco solo queda el vaivén
  }
  p += desp;
  p.y += uNivel;
  vNormal = normalize(nrm);
  vRotura = rotura;
  vFase = fase;
  vVaiven = vaiven;
  vCiclo = ciclo;
  vec4 cA = texture(uCampoA, uvNodo(p.xz - desp.xz, uCampo));
  vDir = normalize(cA.gb + vec2(1e-5));
  vAlcance = uLejos > 0.5 ? 1.0 : cA.a;
  vec4 m = modelMatrix * vec4(p, 1.0);
  vRefl = uMatReflejo * m;
  vPos = m.xyz;
  gl_Position = projectionMatrix * viewMatrix * m;
}
`;

const AGUA_FRAG = /* glsl */ `
uniform float uTiempo;
uniform float uNivel;
uniform float uR2;
uniform sampler2D uRelieve;
uniform vec2 uRel;
uniform vec3 uDirBrillo;
uniform vec3 uColorBrillo;
uniform vec3 uCieloHorizonte;
uniform vec3 uCieloCenit;
uniform float uLuzDia;
uniform vec3 uColorNiebla;
uniform float uDensidadNiebla;
varying vec3 vPos;
varying vec3 vNormal;
varying float vRotura;
varying float vFase;
varying float vVaiven;
varying float vCiclo;
varying vec2 vDir;
varying float vAlcance;
varying vec4 vRefl;
uniform sampler2D uNormAgua;
uniform sampler2D uReflejo;
uniform float uConReflejo;
uniform vec4 uSisA;

const float MEDIO = ${(LADO / 2).toFixed(1)};
vec2 uvNodo(vec2 xz, vec2 rej) { return ((xz + MEDIO) / rej.y + 0.5) / rej.x; }
float fondo(vec2 xz) {
  if (abs(xz.x) > MEDIO || abs(xz.y) > MEDIO) return -40.0;
  return texture(uRelieve, uvNodo(xz, uRel)).r;
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float ruidoV(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float ruido(vec2 p) { return ruidoV(p) * 0.6 + ruidoV(p * 2.3 + 7.1) * 0.4; }
float fbm(vec2 p) {
  float t = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { t += a * ruidoV(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return t / 0.9375;
}
vec2 hash2(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
/** Ruido celular: distancia entre los dos puntos más cercanos (F2 − F1). Vale ~0 en los bordes
 *  entre celdas, que es donde se dibujan las paredes de las burbujas. */
float celdas(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 o = vec2(float(x), float(y));
    vec2 c = o + hash2(i + o) - f;
    float dd = dot(c, c);
    if (dd < d1) { d2 = d1; d1 = dd; } else if (dd < d2) { d2 = dd; }
  }
  return sqrt(d2) - sqrt(d1);
}

uniform float uLejos;
void main() {
  // El anillo de mar lejano no se dibuja dentro del cuadrado modelado (allí están los parches).
  if (uLejos > 0.5 && abs(vPos.x) < MEDIO && abs(vPos.z) < MEDIO) discard;
  float prof = vPos.y - fondo(vPos.xz);
  float d = length(vPos - cameraPosition);
  // ---------- Superficie ----------
  // Rizado fino del viento (solo en la normal): mapa de normales fotográfico de agua (three.js,
  // examples/textures/waternormals.jpg) a dos escalas que se desplazan en direcciones distintas.
  // Con mipmaps, de lejos se suaviza solo.
  vec2 q = vPos.xz;
  vec3 nA = texture2D(uNormAgua, q / 21.0 + vec2(uTiempo * 0.011, uTiempo * 0.007)).xyz * 2.0 - 1.0;
  vec3 nB = texture2D(uNormAgua, q / 7.3 + vec2(-uTiempo * 0.019, uTiempo * 0.015)).xyz * 2.0 - 1.0;
  vec3 nC = texture2D(uNormAgua, q / 2.1 + vec2(uTiempo * 0.035, -uTiempo * 0.028)).xyz * 2.0 - 1.0;
  vec2 g = nA.xy + nB.xy * 0.8 + nC.xy * 0.5 * (1.0 - smoothstep(10.0, 40.0, d));
  float fuerza = mix(0.14, 0.05, smoothstep(30.0, 600.0, d)); // poco rizado: estilo limpio
  vec3 n = normalize(vNormal + vec3(g.x, 0.0, -g.y) * fuerza);
  vec3 v = normalize(cameraPosition - vPos);
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  vec3 r = reflect(-v, n);
  r.y = abs(r.y); // la ola no refleja el suelo: siempre cielo
  vec3 cielo = mix(uCieloHorizonte, uCieloCenit, pow(clamp(r.y, 0.0, 1.0), 0.6));
  // Reflejo de la escena (acantilados, edificios, cielo) desde la cámara espejo, deformado por
  // el rizado; donde la deformación saca la muestra de la imagen, el cielo.
  vec2 uvR = vRefl.xy / vRefl.w + (n.xz - vNormal.xz) * mix(0.06, 0.02, smoothstep(30.0, 400.0, d));
  vec4 escenaR = texture2D(uReflejo, uvR);
  float dentroR = step(0.001, uvR.x) * step(uvR.x, 0.999) * step(0.001, uvR.y) * step(uvR.y, 0.999);
  // Alfa 0 en la textura = cielo (no se dibuja en el reflejo): ahí, el degradado de cielo.
  vec3 reflejo = mix(cielo, escenaR.rgb / max(escenaR.a, 1e-3), clamp(escenaR.a, 0.0, 1.0) * dentroR * uConReflejo);
  float sol = pow(max(dot(r, uDirBrillo), 0.0), 900.0) * 6.0 + pow(max(dot(r, uDirBrillo), 0.0), 90.0) * 0.25;
  sol *= step(0.0, uDirBrillo.y);

  // ---------- Cuerpo del agua (estilo de animación) ----------
  // Franjas de color planas según la profundidad, con bordes nítidos (antialias con fwidth).
  float dia = 0.12 + 0.88 * uLuzDia;
  float aa = fwidth(prof) * 1.2 + 0.01;
  vec3 c1 = vec3(0.30, 0.78, 0.72);  // sRGB ≈ (148, 228, 220)
  vec3 c2 = vec3(0.06, 0.50, 0.52);  // ≈ (70, 188, 190)
  vec3 c3 = vec3(0.02, 0.24, 0.34);  // ≈ (40, 134, 158)
  vec3 c4 = vec3(0.01, 0.09, 0.20);  // ≈ (20, 84, 124)
  vec3 cuerpo = c1;
  cuerpo = mix(cuerpo, c2, smoothstep(0.45 - aa, 0.45 + aa, prof));
  cuerpo = mix(cuerpo, c3, smoothstep(2.2 - aa, 2.2 + aa, prof));
  cuerpo = mix(cuerpo, c4, smoothstep(7.0 - aa * 2.0, 7.0 + aa * 2.0, prof));

  // ---------- Olas que llegan ----------
  // Con la fase de la ola principal: la cara de la ola (antes de la cresta) un tono más clara y
  // verdosa, el seno un tono más oscuro. Bandas nítidas que avanzan hacia la orilla con cada ola.
  float fase = vFase + 0.6;
  float s = sin(fase);
  float aaS = fwidth(s) * 1.5 + 0.02;
  float cara = smoothstep(0.45 - aaS, 0.45 + aaS, s);
  float seno = 1.0 - smoothstep(-0.55 - aaS, -0.55 + aaS, s);
  float hayOla = smoothstep(0.02, 0.15, uSisA.x) * smoothstep(0.4, 1.2, prof) * (1.0 - smoothstep(900.0, 2200.0, d));
  cuerpo = mix(cuerpo, cuerpo * vec3(1.18, 1.28, 1.2) + vec3(0.0, 0.02, 0.015), cara * hayOla * 0.9);
  cuerpo = mix(cuerpo, cuerpo * vec3(0.78, 0.84, 0.9), seno * hayOla * 0.8);
  cuerpo *= dia;

  // Trazos de agua: líneas onduladas sueltas que derivan despacio (en vez de una red de celdas).
  vec2 qt = vPos.xz * 0.045 + vec2(uTiempo * 0.012, -uTiempo * 0.008);
  float ft = fbm(qt);
  float aaT = fwidth(ft) * 1.3;
  float trazo = 1.0 - smoothstep(0.0, aaT + 0.004, abs(ft - 0.5));
  trazo *= smoothstep(0.55, 0.62, fbm(qt * 0.6 + 4.7));                   // solo a ratos
  trazo *= smoothstep(1.2, 2.5, prof) * (1.0 - smoothstep(120.0, 380.0, d)) * (1.0 - vRotura);
  cuerpo = mix(cuerpo, vec3(0.72, 0.93, 0.92) * dia, trazo * 0.55);

  // ---------- Espuma de la rompiente ----------
  // Al romper, el frente de la ola es una banda blanca de borde ondulado y vivo; detrás quedan
  // burbujas redondeadas (umbral de un ruido suave) que se encogen hasta desaparecer.
  vec2 perp = vec2(-vDir.y, vDir.x);
  float along = dot(vPos.xz, perp);
  vec2 deriva = vDir * uTiempo * 0.6;
  vec2 pe = vPos.xz - deriva;
  float edad = 1.0 - fract(fase / 6.28318531 - 0.25);            // 0 en el frente, 1 antes de la siguiente
  float onda = 0.025 * sin(along * 0.33 + uTiempo * 1.7) + 0.02 * sin(along * 0.9 - uTiempo * 2.3) + 0.03 * (fbm(pe * 0.06) - 0.5);
  float anchoFrente = 0.07 + onda;
  float aaE = fwidth(edad) * 1.5 + 0.004;
  float frenteOla = vRotura * (1.0 - smoothstep(anchoFrente - aaE, anchoFrente + aaE, edad));
  // pequeña sombra azulada justo debajo del frente (da volumen al rizo)
  float bajoFrente = vRotura * (1.0 - smoothstep(anchoFrente + 0.02, anchoFrente + 0.05, edad)) * (1.0 - frenteOla);
  // el detalle fino de las burbujas solo de cerca: de lejos haría motitas
  float finas = mix(fbm(pe * 0.6 + 9.0), 0.5, smoothstep(40.0, 140.0, d));
  float burbujas = fbm(pe * 0.22 + 3.0) * 0.65 + finas * 0.35;
  float umbral = mix(0.5, 0.92, smoothstep(anchoFrente, 0.5, edad));
  float aaB = fwidth(burbujas) * 1.5 + 0.004;
  float estela = vRotura * smoothstep(umbral - aaB, umbral + aaB, burbujas) * (1.0 - smoothstep(0.45, 0.6, edad));

  // ---------- Orilla ----------
  // El agua sube con un frente de espuma grueso y se retira dejando una línea fina; a media
  // retirada, una segunda línea más atrás (la espuma que se queda).
  float subiendo = 1.0 - smoothstep(0.25, 0.4, vCiclo);
  float aaP = fwidth(prof) * 1.5 + 0.003;
  float anchoOrilla = mix(0.035, 0.11, subiendo) + 0.03 * (fbm(pe * 0.15) - 0.5);
  float borde = (1.0 - smoothstep(anchoOrilla - aaP, anchoOrilla + aaP, prof)) * vAlcance;
  float linea2 = (1.0 - smoothstep(0.012, 0.012 + aaP, abs(prof - 0.2 - 0.05 * sin(along * 0.2 + uTiempo * 0.9)))) * vAlcance
               * (1.0 - subiendo) * (1.0 - smoothstep(0.0, 0.6, vRotura));
  float lamina = smoothstep(0.02, 0.2, vVaiven) * (1.0 - smoothstep(0.0, 0.25, prof)) * vAlcance;
  float burbujasOrilla = lamina * smoothstep(0.62 - aaB, 0.62 + aaB, burbujas) * mix(0.5, 1.0, subiendo);

  float espuma = max(max(frenteOla, estela * 0.95), max(borde, max(linea2 * 0.8, burbujasOrilla * 0.85)));
  espuma *= 1.0 - smoothstep(700.0, 2000.0, d) * 0.6;
  float ndl = dot(n, uDirBrillo);
  vec3 blanco = vec3(0.95, 0.98, 0.98) * dia;
  // la espuma por bandas: la parte de abajo de las burbujas, un pelín azulada
  blanco = mix(blanco * vec3(0.82, 0.92, 0.95), blanco, smoothstep(0.55, 0.7, burbujas + frenteOla));

  // ---------- Composición ----------
  float alfa = mix(0.5, 1.0, smoothstep(0.0, 0.1, prof));
  vec3 c = cuerpo;
  c = mix(c, cuerpo * vec3(0.7, 0.82, 0.9), bajoFrente * 0.6);
  // brillo del sol: destello de borde nítido
  float brillo = smoothstep(0.985, 0.99, dot(r, uDirBrillo)) * step(0.0, uDirBrillo.y);
  c = mix(c, uColorBrillo + 0.3, brillo * (1.0 - espuma));
  // la lámina que sube por la arena: casi transparente, con un brillo claro
  c = mix(c, vec3(0.8, 0.95, 0.95) * dia, lamina * 0.35);
  alfa = mix(alfa, 0.45, lamina * (1.0 - espuma));
  c = mix(c, blanco, espuma);
  alfa = max(alfa, espuma);
  c = mix(c, uColorNiebla, 1.0 - exp(-uDensidadNiebla * uDensidadNiebla * d * d));
  gl_FragColor = vec4(c, alfa);
  #include <colorspace_fragment>
}
`;

export interface UniformesAgua { [k: string]: THREE.IUniform }

export function crearAgua(opciones: {
  escena: THREE.Scene;
  texRelieve: THREE.DataTexture;
  nRelieve: number;
  pasoRelieve: number;
  nCampo: number;
  comunes: UniformesAgua;
  movil: boolean;
  normales: THREE.Texture;
}) {
  const SEG = opciones.movil ? 40 : 72;
  const geo = new THREE.PlaneGeometry(1, 1, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0.5, 0, 0.5); // de 0 a 1 en x y z
  const vacia = new THREE.DataTexture(new Float32Array([0, 1, 0, 0]), 1, 1, THREE.RGBAFormat, THREE.FloatType);
  vacia.needsUpdate = true;
  const u: UniformesAgua = {
    ...opciones.comunes,
    uRelieve: { value: opciones.texRelieve },
    uRel: { value: new THREE.Vector2(opciones.nRelieve, opciones.pasoRelieve) },
    uCampoA: { value: vacia },
    uCampoB: { value: vacia },
    uCampo: { value: new THREE.Vector2(opciones.nCampo, PASO_RELIEVE * PASO_CAMPO) },
    uSisA: { value: new THREE.Vector4() },
    uSisB: { value: new THREE.Vector4() },
    uSetup: { value: 0 },
    uR2: { value: 0 },
    uNormAgua: { value: opciones.normales },
    uReflejo: { value: null as THREE.Texture | null },
    uMatReflejo: { value: new THREE.Matrix4() },
    uConReflejo: { value: 0 },
  };
  // Material nuevo con los uniformes comunes compartidos por referencia (clonarlo copiaría la
  // textura del reflejo, que three.js no puede clonar); solo uTesela y uLejos son propios.
  const vert = crearAguaVert(SEG);
  const materialAgua = (tesela: THREE.Vector3, lejos: number) => new THREE.ShaderMaterial({
    vertexShader: vert, fragmentShader: AGUA_FRAG,
    uniforms: { ...u, uTesela: { value: tesela }, uLejos: { value: lejos } },
    transparent: true, depthWrite: false,
  });
  const grupo = new THREE.Group();
  grupo.name = 'agua';
  grupo.renderOrder = 2;
  opciones.escena.add(grupo);

  const parches = new Map<string, THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>>();
  function parche(clave: string, x0: number, z0: number, lado: number) {
    let m = parches.get(clave);
    if (!m) {
      const mat = materialAgua(new THREE.Vector3(x0, z0, lado), 0);
      mat.uniforms.uLejos = { value: 0 };
      m = new THREE.Mesh(geo, mat);
      m.frustumCulled = false;
      m.renderOrder = 2;
      parches.set(clave, m);
      grupo.add(m);
    }
    return m;
  }

  // Mar abierto hasta el horizonte, solo en el sector norte (la costa va de oeste a este; al sur
  // hay tierra). Sin oleaje: a esa distancia no se distingue.
  const anillo = new THREE.RingGeometry(LADO * 0.5, 40000, 96, 1, THREE.MathUtils.degToRad(-12), THREE.MathUtils.degToRad(204));
  anillo.rotateX(-Math.PI / 2);
  const matLejos = materialAgua(new THREE.Vector3(), 1);
  const lejos = new THREE.Mesh(anillo, matLejos);
  lejos.renderOrder = 1;
  opciones.escena.add(lejos);

  return {
    uniformes: u,
    /** Lo que no debe salir en el reflejo (el agua misma). */
    objetos: [grupo, lejos] as THREE.Object3D[],
    /** Muestra un parche por cada tesela visible que pueda tener agua; oculta el resto. */
    actualizar(teselas: { clave: string; x0: number; z0: number; lado: number; minY: number }[], nivelMax: number) {
      for (const m of grupo.children) m.visible = false;
      for (const t of teselas) {
        if (t.minY > nivelMax + 4) continue;
        parche(t.clave, t.x0, t.z0, t.lado).visible = true;
      }
      if (parches.size > 500) {
        for (const [k, m] of parches) if (!m.visible) { grupo.remove(m); m.material.dispose(); parches.delete(k); }
      }
    },
    ponerCampos(a: THREE.DataTexture | null, b: THREE.DataTexture | null) {
      const previoA = u.uCampoA.value as THREE.DataTexture, previoB = u.uCampoB.value as THREE.DataTexture;
      if (a) { u.uCampoA.value = a; if (previoA !== vacia && previoA !== a) previoA.dispose(); }
      if (b) { u.uCampoB.value = b; if (previoB !== vacia && previoB !== b) previoB.dispose(); }
    },
  };
}
