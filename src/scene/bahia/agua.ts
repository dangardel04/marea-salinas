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
//   - Forma: la de Abreu et al. (2010) con la no linealidad de Ruessink et al. (2012) según el
//     número de Ursell (crestas picudas y, más cerca, cara delantera empinada); al romper, la cara
//     se empina más (ilustrativo). La pendiente de la ola principal se calcula también en cada
//     píxel (ver src/oleaje/formaOla.ts y tests/forma-ola.test.ts).
//   - «Exposición»: las olas que llegan tras girar mucho respecto al mar abierto se atenúan
//     (aproximación de la sombra detrás de espigón y cabos; no es difracción rigurosa).
//   - Orilla: sobreelevación media (setup) y vaivén hasta la cota R2 de Stockdon (2006), al ritmo
//     del periodo de pico y con la fase del agua contigua. El dibujo del vaivén es ilustrativo;
//     la cota máxima sale de la fórmula.
//
// Aspecto (sombreador de fragmentos), realista: azul marino en lo hondo y turquesa sobre la
// arena, transparencia según la profundidad, reflejo del cielo con Fresnel, destello del sol,
// luz que atraviesa las crestas y espuma con forma (manchas y hebras que se deshilachan). El
// rizado fino del viento y el dibujo de la espuma son DECORATIVOS.
// Dónde hay mar: donde la superficie supera la cota de rebose (campoOlas.ts, crearFondoAgua);
// los charcos aislados y las hondonadas de la arena no se dibujan como mar.

import * as THREE from 'three';
import { LADO, PASO_RELIEVE } from '../../bahia';
import { PASO_CAMPO } from './campoOlas';
import { SOMBRA_GLSL } from './sombras';
import { AJUSTE_GLSL } from './orilla';
import { ZONA_GLSL } from './zona';

/**
 * Forma de la ola cerca de la costa (Abreu et al., 2010, ec. de la velocidad orbital; en aguas
 * someras la superficie va en fase con ella, η ≈ u·h/c). s es la fase «temporal» (crece con el
 * tiempo en un punto fijo); r, la no linealidad (0 = seno); φ, la fase: −π/2 da crestas
 * picudas y senos largos y planos, 0 da diente de sierra con la cara delantera empinada.
 * Media cero; su derivada, analítica.
 */
const FORMA_OLA = /* glsl */ `
float formaOla(float s, float r, float phi) {
  float f = sqrt(1.0 - r * r);
  return f * (sin(s) + r * sin(phi) / (1.0 + f)) / (1.0 - r * cos(s + phi));
}
float dFormaOla(float s, float r, float phi) {
  float f = sqrt(1.0 - r * r);
  float N = sin(s) + r * sin(phi) / (1.0 + f), D = 1.0 - r * cos(s + phi);
  return f * (cos(s) * D - N * r * sin(s + phi)) / (D * D);
}
`;

/** Lado de los parches de agua gruesos (las teselas agrupadas del terreno) y de los finos, que
 *  los sustituyen cerca de la cámara para que la ola tenga relieve al romper. */
const LADO_GRUESO = 200, LADO_FINO = 50;

const crearAguaVert = (segmentos: number, radioFino: number) => /* glsl */ `
#define SEGMENTOS ${segmentos.toFixed(1)}
#define ESP_FINO ${(LADO_FINO / segmentos).toFixed(4)}
#define ESP_GRUESO ${(LADO_GRUESO / segmentos).toFixed(4)}
#define ESP_K ${(LADO_GRUESO / segmentos / radioFino).toFixed(6)}
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
varying vec2 vDir;
varying float vAlcance;
varying vec4 vRefl;
varying vec4 vOla;        // ola principal: r, φ (forma completa), k, escala de la amplitud
varying vec2 vPendOla;    // su pendiente tal como la dibuja la malla (se cambia por la de cada píxel)
varying float vBeta;      // ola principal: altura / altura máxima que admite el fondo (rompe en 1)
varying float vCresta;    // fase «temporal» de su cresta
uniform mat4 uMatReflejo;

const float G = 9.81;
const float PI2 = 6.28318531;
const float MEDIO = ${(LADO / 2).toFixed(1)};

vec2 uvNodo(vec2 xz, vec2 rej) { return ((xz + MEDIO) / rej.y + 0.5) / rej.x; }
${AJUSTE_GLSL}
float fondo(vec2 xz) {
  if (abs(xz.x) > MEDIO || abs(xz.y) > MEDIO) return -40.0;
  return texture(uRelieve, uvNodo(xz, uRel)).r + ajusteOrilla(xz);
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

${FORMA_OLA}

/** No linealidad de la ola según el número de Ursell (Ruessink et al., 2012): r y φ de la forma
 *  de Abreu et al. (2010). Ur = 3/8·Hs·k/(kh)³ (con Hrms = Hs/√2). */
vec2 noLinealidad(float hs, float k, float h) {
  float kh = k * h;
  float ur = max(0.375 * hs * k / (kh * kh * kh), 1e-12);
  float B = 0.857 / (1.0 + exp((-0.471 - log(ur) / log(10.0)) / 0.297));
  float psi = radians(-90.0 + 90.0 * tanh(0.815 / pow(ur, 0.672)));
  float b = sqrt(2.0 * B * B / (9.0 + 2.0 * B * B));
  return vec2(2.0 * b / (1.0 + b * b), -psi - 0.25 * PI2);   // φ = −ψ − π/2
}

/** r máxima que la malla puede dibujar: la cara de la ola (del 10 % al 90 % de su altura) ocupa
 *  una fracción del periodo ≈ 0,295·(1 − r)^0,62 (ajuste numérico de la forma de Abreu con φ = 0);
 *  se pide que abarque al menos 3 separaciones de vértice. */
float rDibujable(float esp, float L) {
  return 1.0 - pow(clamp(3.0 * esp / L / 0.295, 0.0, 1.0), 1.613);
}

/** Fase «temporal» de la cresta de la forma de Abreu (entre ~0,3 y π/2 según r y φ). */
float faseCresta(float r, float phi) {
  float mejor = 1.5708, alto = -9.0;
  for (int i = 0; i <= 28; i++) {
    float s = 0.2 + 0.05 * float(i);
    float v = formaOla(s, r, phi);
    if (v > alto) { alto = v; mejor = s; }
  }
  return mejor;
}

/** Separación de vértices con la que se dibujan las olas en este punto. Depende de la distancia a
 *  la cámara, no del parche: así dos parches vecinos de distinto tamaño (finos cerca de la cámara,
 *  gruesos lejos) dibujan lo mismo en su borde y no se abren grietas. */
float espMalla(vec2 xz) {
  float dc = length(xz - cameraPosition.xz);
  return max(clamp(dc * ESP_K, ESP_FINO, ESP_GRUESO), uTesela.z / SEGMENTOS);
}

void componente(float a, float T, float psi, float abanico, vec2 d, vec2 p, float tLlegada, float h,
                vec2 nl, float beta, float principal, vec2 xz, inout vec3 desp, inout vec3 nrm,
                inout float fase, inout vec4 ola, inout vec2 pendOla) {
  if (a < 0.002) return;
  float w = PI2 / T;
  float L = longitud(T, h);
  float k = PI2 / L;
  // Nivel de detalle de las olas: una ola más corta que ~4 separaciones de vértice no se puede
  // dibujar en esta malla (aliasing); se desvanece. Lejos, las olas cortas no se distinguirían.
  float esp = espMalla(xz);
  if (uLejos < 0.5) a *= smoothstep(2.5 * esp, 5.0 * esp, L);
  if (a < 0.002) return;
  // ---- Rotura (ILUSTRATIVA, para que se vea cómo rompe; no es un modelo de la ola real) ----
  // beta = altura que tendría la ola / altura máxima que admite el fondo (0,78·h): rompe en 1.
  // Al acercarse a 1 la ola crece y se empina; al pasar, la cresta se desploma y sigue como una
  // resaca de espuma (menos alta).
  float rot = principal * smoothstep(0.6, 1.0, beta);
  a *= 1.0 + principal * 0.8 * smoothstep(0.55, 1.0, beta) * (1.0 - smoothstep(1.0, 1.45, beta));
  // Forma: la de Ruessink/Abreu y, al romper, una cara delantera mucho más empinada (r → 0,95,
  // φ → 0: la pared de agua que se derrama; ILUSTRATIVO, la fórmula publicada no llega a eso).
  float r = mix(nl.x, 0.95, rot);
  float phi = mix(nl.y, 0.0, rot);
  // La malla solo dibuja la cara si cabe; el sombreado de cada píxel la dibuja entera.
  float rMalla = min(r, rDibujable(esp, L));
  float th = w * (tLlegada - uTiempo) + psi + k * abanico * dot(p, xz);
  // Pendiente de la cresta por componente. Con 4 componentes por sistema y dos sistemas, la suma
  // debe quedar por debajo de 1 o la malla se pliega sobre sí misma en la cresta (dientes de sierra).
  float s = min(0.13, k * a * 1.6);
  float Q = s / max(k * a, 1e-4);
  // Elevación con la forma de Abreu (en la fase «temporal» −th), escalada para conservar la
  // energía (su media cuadrática es √((1 − b²)/2) en lugar de 1/√2).
  float bb = rMalla / (1.0 + sqrt(1.0 - rMalla * rMalla));
  float escala = a / sqrt(1.0 - bb * bb);
  float eta = escala * formaOla(-th, rMalla, phi);
  float deta = -escala * dFormaOla(-th, rMalla, phi);   // dη/dth
  desp.xz -= Q * a * d * cos(th);
  desp.y += eta;
  // Labio: justo al romper, lo alto de la cresta avanza más deprisa que la base y la cara se pone
  // vertical y se vence hacia delante (ILUSTRATIVO).
  float vence = principal * smoothstep(0.85, 1.02, beta) * (1.0 - smoothstep(1.12, 1.5, beta));
  if (vence > 0.001) {
    float alto = clamp(eta / max(escala * formaOla(faseCresta(rMalla, phi), rMalla, phi), 1e-3), 0.0, 1.0);
    desp.xz += d * vence * 1.8 * escala * alto * alto * alto;
  }
  nrm.xz -= d * k * deta;
  nrm.y += Q * k * a * sin(th);
  if (fase < -9.0) {
    // Ola principal: forma completa (para el sombreado por píxel) y su pendiente en la malla.
    fase = th;
    float bp = r / (1.0 + sqrt(1.0 - r * r));
    ola = vec4(r, phi, k, a / sqrt(1.0 - bp * bp));
    pendOla = -d * k * deta;
  }
}

void sistema(vec4 S, sampler2D campo, vec2 xz, float h, inout vec3 desp, inout vec3 nrm,
             inout float rotura, inout float fase, inout vec4 ola, inout vec2 pendOla,
             out float tLlegada, out float alcance, out float beta) {
  vec4 c = texture(campo, uvNodo(xz, uCampo));
  tLlegada = c.r;
  alcance = c.a;
  beta = 0.0;
  if (S.x < 0.02) return;
  vec2 d = normalize(c.gb + vec2(1e-5));
  vec2 p = vec2(-d.y, d.x);
  float exposicion = smoothstep(-0.2, 0.75, dot(d, S.zw));
  float Ks = asomeramiento(S.y, h);
  float hLocal = S.x * Ks * exposicion * c.a;
  float hMax = 0.78 * h;
  float limite = hLocal > hMax ? hMax / hLocal : 1.0;
  beta = hLocal / max(hMax, 1e-3) * step(0.05, hLocal);
  float rot = smoothstep(0.6, 1.0, beta);
  rotura = max(rotura, rot);
  float f = Ks * exposicion * c.a * limite;
  // Reparto de energía en 4 componentes: pesos 0,35 / 0,3 / 0,2 / 0,15.
  float a0 = S.x / 4.0 * f;
  // Forma de la ola con la altura local (ya limitada por la rotura) y el periodo de pico.
  vec2 nl = noLinealidad(S.x * f, PI2 / longitud(S.y, h), h);
  // Al acercarse a la rotura la altura la limita el fondo (0,78·h) y las olas se igualan: la
  // energía pasa a la componente principal (tren casi regular, ILUSTRATIVO), con la misma Hs.
  float orden = smoothstep(0.35, 0.9, hLocal / max(hMax, 1e-3));
  vec4 pesos = mix(vec4(0.35, 0.30, 0.20, 0.15), vec4(1.0, 0.0, 0.0, 0.0), orden);
  componente(a0 * sqrt(2.0 * pesos.x), S.y * 1.0,  0.0, 0.00, d, p, tLlegada, h, nl, beta, 1.0, xz, desp, nrm, fase, ola, pendOla);
  componente(a0 * sqrt(2.0 * pesos.y), S.y * 0.88, 1.7, 0.09, d, p, tLlegada, h, nl, beta, 0.0, xz, desp, nrm, fase, ola, pendOla);
  componente(a0 * sqrt(2.0 * pesos.z), S.y * 1.14, 4.1, -0.07, d, p, tLlegada, h, nl, beta, 0.0, xz, desp, nrm, fase, ola, pendOla);
  componente(a0 * sqrt(2.0 * pesos.w), S.y * 0.76, 2.6, 0.16, d, p, tLlegada, h, nl, beta, 0.0, xz, desp, nrm, fase, ola, pendOla);
}

void main() {
  vec3 p = vec3(uTesela.x + position.x * uTesela.z, 0.0, uTesela.y + position.z * uTesela.z);
  if (uLejos > 0.5) p = position;
  vec3 desp = vec3(0.0);
  vec3 nrm = vec3(0.0, 1.0, 0.0);
  float rotura = 0.0, fase = -10.0, vaiven = 0.0, ciclo = 0.5, beta = 0.0;
  vec4 ola = vec4(0.0);
  vec2 pendOla = vec2(0.0);
  float prof = uNivel - fondo(p.xz);
  if (uLejos < 0.5) {
    float h = max(prof, 0.08);
    float tA, tB, alcA, alcB, betaB;
    sistema(uSisA, uCampoA, p.xz, h, desp, nrm, rotura, fase, ola, pendOla, tA, alcA, beta);
    sistema(uSisB, uCampoB, p.xz, h, desp, nrm, rotura, fase, ola, pendOla, tB, alcB, betaB);
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
    // Cada ola sube distinto: R2 es la cota que solo supera el 2 % de las olas, así que la
    // mayoría se queda por debajo (reparto ILUSTRATIVO entre 0,45·R2 y R2, fijo para cada ola).
    float nOla = floor((uTiempo - tA) / max(uSisA.y, 1.0) + 0.15);
    vaiven = uR2 * pulso * franja * mix(0.45, 1.0, fract(sin(nOla * 12.9898) * 43758.5453));
    desp.y += uSetup * franja + vaiven;
    desp *= smoothstep(-uR2 - 0.3, 0.05, prof); // en seco solo queda el vaivén
  }
  p += desp;
  p.y += uNivel;
  vNormal = nrm; // sin normalizar: el fragmento le cambia la pendiente de la ola principal
  vRotura = rotura;
  vFase = fase;
  vOla = ola;
  vPendOla = pendOla;
  vCresta = faseCresta(ola.x, ola.y);
  vBeta = beta;
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
${ZONA_GLSL}
uniform float uDensidadNiebla;
varying vec3 vPos;
varying vec3 vNormal;
varying float vRotura;
varying float vFase;
varying vec2 vDir;
varying float vAlcance;
varying vec4 vRefl;
uniform sampler2D uNormAgua;
uniform sampler2D uReflejo;
uniform float uConReflejo;
uniform vec4 uSisA;
uniform sampler2D uCampoA;
uniform vec2 uCampo;
// Refracción (refraccion.ts): la escena sin el agua, color y profundidad.
uniform sampler2D uRefraccion;
uniform sampler2D uProfEscena;
uniform vec2 uTamDibujo;
uniform vec2 uCercaLejos;
uniform float uConRefraccion;
${SOMBRA_GLSL}
/** Distancia a lo largo del eje de la cámara de una profundidad del búfer (perspectiva). */
float vistaZ(float prof) {
  float z = prof * 2.0 - 1.0;
  return 2.0 * uCercaLejos.x * uCercaLejos.y / (uCercaLejos.y + uCercaLejos.x - z * (uCercaLejos.y - uCercaLejos.x));
}

const float MEDIO = ${(LADO / 2).toFixed(1)};
vec2 uvNodo(vec2 xz, vec2 rej) { return ((xz + MEDIO) / rej.y + 0.5) / rej.x; }
/** Altura del fondo y cota de rebose (nivel al que llega el mar, ver campoOlas.ts); fuera, mar hondo. */
${AJUSTE_GLSL}
vec2 fondoMar(vec2 xz) {
  if (abs(xz.x) > MEDIO || abs(xz.y) > MEDIO) return vec2(-40.0);
  return texture(uRelieve, uvNodo(xz, uRel)).rg + ajusteOrilla(xz);
}
varying vec4 vOla;
varying vec2 vPendOla;
varying float vCresta;
varying float vBeta;
${FORMA_OLA}
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float ruidoV(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float t = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { t += a * ruidoV(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return t / 0.9375;
}
/** Celdas de Worley: distancia al centro más cercano (x) y al segundo (y). Los centros se mueven
 *  despacio: las burbujas de la espuma se juntan y revientan. */
vec2 celdas(vec2 p, float t) {
  vec2 i = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 o = vec2(float(x), float(y));
    vec2 h = vec2(hash(i + o), hash(i + o + 17.31));
    vec2 c = o + 0.5 + 0.4 * sin(t * (0.5 + h) + 6.2831853 * h);
    float dd = length(c - f);
    if (dd < d1) { d2 = d1; d1 = dd; } else if (dd < d2) { d2 = dd; }
  }
  return vec2(d1, d2);
}
/** Espuma con estructura de burbujas: con cobertura alta llena las celdas; al bajar quedan los
 *  hilos entre burbujas (un encaje con agua en los huecos) y al final, hebras sueltas. De lejos,
 *  donde las celdas serían más pequeñas que un píxel, un velo con la misma cobertura. */
float encaje(vec2 p, float cob, float lejos) {
  if (cob < 0.005) return 0.0;
  // dominio deformado: juntas curvas y burbujas de tamaños distintos, no un mosaico
  vec2 w = vec2(ruidoV(p * 0.9), ruidoV(p * 0.9 + 5.3)) - 0.5;
  vec2 c1 = celdas(p * 0.85 + w * 0.9, uTiempo * 0.35);
  vec2 c2 = celdas(p * 2.7 + 3.7 + w * 2.2, uTiempo * 0.6);
  float b1 = c1.y - c1.x, b2 = c2.y - c2.x;           // 0 en la junta entre dos burbujas
  float aa1 = fwidth(b1) + 0.03, aa2 = fwidth(b2) + 0.03;
  // grosor de los hilos variable: unos se cierran antes que otros
  float var = ruidoV(p * 0.35 + 2.1);
  float k = clamp(cob * (0.7 + 0.6 * var), 0.0, 1.0);
  float g1 = 0.02 + 0.8 * k * k, g2 = 0.015 + 0.5 * k;
  // con poca espuma los hilos se rompen en trozos (no una red continua, que parece barro seco)
  float trozos = smoothstep(0.62 - 0.7 * k, 0.8 - 0.7 * k, ruidoV(p * 1.4 + 9.0));
  float hilo1 = (1.0 - smoothstep(g1 - aa1, g1 + aa1, b1)) * trozos;
  float hilo2 = (1.0 - smoothstep(g2 - aa2, g2 + aa2, b2)) * smoothstep(0.1, 0.5, k);
  // los hilos finos son algo translúcidos; las juntas gruesas, blancas
  float red = max(hilo1 * mix(0.7, 1.0, smoothstep(0.1, 0.5, k)), hilo2 * 0.75);
  red = max(red, smoothstep(0.85, 0.99, k));             // espuma densa: blanca y llena
  float velo = pow(cob, 0.8) * 0.8;
  return mix(red * smoothstep(0.0, 0.08, cob), velo, lejos);
}

uniform float uLejos;
void main() {
  // El anillo de mar lejano no se dibuja dentro del cuadrado modelado (allí están los parches).
  if (uLejos > 0.5 && abs(vPos.x) < MEDIO && abs(vPos.z) < MEDIO) discard;
  vec2 fm = fondoMar(vPos.xz);
  // Solo hay mar donde la superficie del agua supera la cota de rebose: los charcos aislados y
  // las hondonadas de la arena no se llenan (se quedan en arena mojada) salvo que el agua rebase
  // de verdad el caballón que los cierra.
  // En una hondonada (fondo por debajo de su caballón) el vaivén no cuenta: lo que rebosa por
  // arriba en cada ola no llena una cubeta de decenas de metros; se llena cuando sube la marea.
  float hoya = smoothstep(0.03, 0.08, fm.y - fm.x);
  float mar = uLejos > 0.5 ? 1.0 : smoothstep(-0.02, 0.03, mix(vPos.y, uNivel, hoya) - fm.y);
  if (mar < 0.01) discard;
  float prof = vPos.y - fm.x;
  float d = length(vPos - cameraPosition);
  float dia = 0.1 + 0.9 * uLuzDia;

  // ---------- Ola principal en este píxel ----------
  // Fase y momento del vaivén calculados en cada píxel con el tiempo de llegada (interpolarlos
  // entre vértices dibujaba la espuma en dientes de sierra). s es la fase «temporal» de la forma
  // de Abreu; «edad» es el tiempo (en periodos) desde que pasó la cresta: 0 en la cresta, poco
  // detrás de ella, cerca de 1 en la cara delantera de la ola que llega.
  float T = max(uSisA.y, 1.0);
  float tA = texture(uCampoA, uvNodo(vPos.xz, uCampo)).r;
  bool conOla = uLejos < 0.5 && uSisA.x >= 0.02;
  float sOla = conOla ? 6.28318531 / T * (uTiempo - tA) : -vFase;
  vec2 pe = vPos.xz - uSisA.zw * uTiempo * 0.5;  // la espuma deriva con el oleaje de mar abierto
  vec2 perp = vec2(-uSisA.w, uSisA.z);
  float along = dot(vPos.xz, perp);
  float onda = 0.012 * sin(along * 0.31 + uTiempo * 1.3) + 0.02 * (fbm(pe * 0.07) - 0.5);
  // en la rompiente, el frente de la ola rota (el «bore» de espuma) no es una recta: avanza a
  // trompicones, con lenguas y entrantes de unos metros
  float frente = smoothstep(0.9, 1.04, vBeta) * 0.06 * (fbm(pe * 0.22 + 11.0) - 0.5 + 0.5 * (fbm(pe * 0.9 + 4.0) - 0.5));
  float edad = fract((sOla - vCresta) / 6.28318531 + onda + frente);
  // Pendiente de la ola principal calculada en este píxel con su forma completa: la malla no
  // tiene vértices para dibujar una cara de pocos metros, el sombreado sí. Se cambia la pendiente
  // que dibujó la malla por esta. Cara delantera: donde la ola sube al llegar (dF/ds > 0).
  float dF = dFormaOla(sOla, vOla.x, vOla.y);
  vec3 nOla = vNormal;
  if (conOla) {
    vec2 pendPix = vDir * vOla.z * vOla.w * dF;   // −d·k·(dη/dth), con dη/dth = −escala·dF
    nOla = vNormal + vec3(pendPix.x - vPendOla.x, 0.0, pendPix.y - vPendOla.y);
  }
  // Altura relativa en la ola (1 en la cresta, ~−1 en el seno) y cara delantera: donde la ola
  // sube al llegar. La parte baja de la cara, fina y empinada, se ve oscura y turquesa (la luz la
  // atraviesa); la espuma de la rotura solo ocupa lo alto (la cresta que se derrama).
  float altoOla = formaOla(sOla, vOla.x, vOla.y) / max(formaOla(vCresta, vOla.x, vOla.y), 1e-3);
  float subeOla = smoothstep(0.0, 0.05, dF);
  float cara = conOla ? smoothstep(0.06, 0.25, vOla.z * vOla.w * dF) * (1.0 - smoothstep(0.2, 0.55, altoOla)) : 0.0;


  // ---------- Superficie ----------
  // Las olas del vértice (con la altura, periodo y dirección de los datos) dan la forma grande; el
  // rizado del viento solo va en la normal: mapa de normales de agua (three.js,
  // examples/textures/waternormals.jpg) a tres escalas que derivan en direcciones distintas.
  // El rizado es DECORATIVO (no sale de los datos).
  vec2 q = vPos.xz;
  float cerca = 1.0 - smoothstep(20.0, 90.0, d);
  vec3 nA = texture2D(uNormAgua, q / 34.0 + vec2(uTiempo * 0.010, uTiempo * 0.006)).xyz * 2.0 - 1.0;
  vec3 nB = texture2D(uNormAgua, q / 12.5 + vec2(-uTiempo * 0.017, uTiempo * 0.013)).xyz * 2.0 - 1.0;
  vec3 nC = texture2D(uNormAgua, q / 3.9 + vec2(uTiempo * 0.031, -uTiempo * 0.025)).xyz * 2.0 - 1.0;
  vec2 g = nA.xy + nB.xy * 0.75 + nC.xy * 0.5 * cerca;
  // En la lámina fina de la orilla apenas hay rizado: es un espejo mojado.
  // Rizado moderado y menos aún en vista rasante: ahí cada rizo refleja un trozo distinto de cielo
  // y sale grano que tapa lo importante, la forma de la ola (cara delantera, que se ve de frente y
  // refleja poco cielo, más oscura; espalda, rasante, más clara).
  vec3 v = normalize(cameraPosition - vPos);
  float rasante = 1.0 - clamp(dot(normalize(nOla), v), 0.0, 1.0);
  float fuerza = mix(0.3, 0.08, smoothstep(30.0, 1200.0, d)) * smoothstep(0.05, 1.2, prof) * mix(1.0, 0.35, rasante * rasante);
  vec3 n = normalize(normalize(nOla) + vec3(g.x, 0.0, -g.y) * fuerza);
  float ndv = max(dot(n, v), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  vec3 r = reflect(-v, n);
  r.y = abs(r.y); // la ola no refleja el suelo: siempre cielo
  vec3 cielo = mix(uCieloHorizonte, uCieloCenit, pow(clamp(r.y, 0.0, 1.0), 0.45));
  // Reflejo de la escena (acantilados, edificios) desde la cámara espejo, si está activo.
  vec2 uvR = vRefl.xy / vRefl.w + (n.xz - normalize(vNormal).xz) * mix(0.06, 0.02, smoothstep(30.0, 400.0, d));
  vec4 escenaR = texture2D(uReflejo, uvR);
  float dentroR = step(0.001, uvR.x) * step(uvR.x, 0.999) * step(0.001, uvR.y) * step(uvR.y, 0.999);
  vec3 reflejo = mix(cielo, escenaR.rgb / max(escenaR.a, 1e-3), clamp(escenaR.a, 0.0, 1.0) * dentroR * uConReflejo);
  // Destello del sol (o de la luna): especular GGX de una superficie lisa (rugosidad 0,06–0,12;
  // los rizos de la normal lo rompen en chispas, doradas con el sol bajo) y un halo ancho. Se
  // apaga a la sombra (de los acantilados al atardecer, de los edificios).
  // (el mapa de sombras tiene la arena sin el ajuste de la orilla)
  float sombraAgua = sombra(vPos - vec3(0.0, ajusteOrilla(vPos.xz), 0.0), vec3(0.0, 1.0, 0.0));
  vec3 hv = normalize(uDirBrillo + v);
  float ndh = max(dot(n, hv), 0.0), ndl = max(dot(n, uDirBrillo), 0.0);
  float rugA = mix(0.06, 0.12, smoothstep(40.0, 600.0, d));
  float a2 = rugA * rugA * rugA * rugA;
  float dd = ndh * ndh * (a2 - 1.0) + 1.0;
  float Fs = 0.02 + 0.98 * pow(1.0 - max(dot(v, hv), 0.0), 5.0);
  float ggx = min(a2 / (3.14159265 * dd * dd) * Fs / (4.0 * max(ndv, 0.05)) * ndl, 60.0);
  float rs = max(dot(r, uDirBrillo), 0.0);
  vec3 sol = uColorBrillo * (ggx * 0.6 + pow(rs, 14.0) * 0.05) * step(0.0, uDirBrillo.y) * sombraAgua;

  // ---------- Cuerpo del agua ----------
  // Color según la profundidad, sin franjas: azul marino en lo hondo; sobre la arena, verde
  // turquesa (la luz rebota en el fondo claro). La cara de una ola empinada, más fina, deja pasar
  // la luz y se ve turquesa (dispersión bajo la superficie), sobre todo a contraluz.
  vec3 hondo = vec3(0.006, 0.05, 0.14);
  vec3 somero = vec3(0.03, 0.36, 0.38);
  vec3 turquesa = vec3(0.04, 0.4, 0.42);
  float kProf = 1.0 - exp(-max(prof, 0.0) / 1.3);
  vec3 cuerpo = mix(somero, hondo, kProf);
  vec3 dirLuz = normalize(uDirBrillo * vec3(1.0, 0.35, 1.0));
  float contraluz = pow(clamp(dot(v, -normalize(dirLuz + n * 0.55)), 0.0, 1.0), 3.0);
  float dispersa = (contraluz * 1.2 + 0.35) * cara * smoothstep(0.3, 1.5, prof);
  cuerpo = mix(cuerpo, turquesa * (0.7 + 0.3 * uLuzDia), clamp(dispersa, 0.0, 0.85));
  cuerpo *= dia * mix(0.8, 1.0, sombraAgua);
  // Transparencia: el agua somera deja ver la arena (absorción con la profundidad).
  // (con un mínimo, para que el agua somera se lea como agua y no como una sombra en la arena)
  float opaco = mix(0.3, 1.0, 1.0 - exp(-max(prof, 0.0) * 0.9)) * smoothstep(0.0, 0.04, prof);

  // ---------- Refracción y absorción (si hay pasada de refracción) ----------
  // Espesor de agua que atraviesa la mirada hasta el fondo: profundidad de la escena sin agua
  // menos la de la superficie, a lo largo del rayo. El fondo se ve desplazado por las olas (más
  // cuanto más agua hay) y atenuado según Beer–Lambert: el rojo se apaga antes que el verde y el
  // azul, así que la arena se ve turquesa con poca agua y el mar, azul marino donde es hondo.
  // Coeficientes ESTÉTICOS (agua costera del Cantábrico, menos clara que la del trópico), no medidos.
  vec3 cuerpoRefr = cuerpo;
  if (uConRefraccion > 0.5) {
    vec2 uvP = gl_FragCoord.xy / uTamDibujo;
    float zAgua = vistaZ(gl_FragCoord.z);
    float rayo = d / max(zAgua, 1e-3);
    float espesor = max(vistaZ(texture2D(uProfEscena, uvP).r) - zAgua, 0.0) * rayo;
    vec2 uvRf = uvP + n.xz * 0.03 * clamp(espesor, 0.0, 4.0) / (1.0 + d * 0.004);
    float zF2 = vistaZ(texture2D(uProfEscena, uvRf).r);
    if (zF2 < zAgua) uvRf = uvP; else espesor = max(zF2 - zAgua, 0.0) * rayo;
    vec3 fondo = texture2D(uRefraccion, uvRf).rgb;
    vec3 T = exp(-vec3(0.55, 0.19, 0.16) * espesor);
    // luz que el agua devuelve por dispersión: turquesa en los primeros metros, azul marino al fondo
    vec3 difunde = mix(vec3(0.02, 0.17, 0.18), hondo, 1.0 - exp(-espesor / 3.5)) * dia * mix(0.8, 1.0, sombraAgua);
    cuerpoRefr = fondo * T + difunde * (1.0 - T);
    cuerpoRefr = mix(cuerpoRefr, turquesa * dia * (0.7 + 0.3 * uLuzDia), clamp(dispersa, 0.0, 0.7));
  }

  // ---------- Espuma ----------
  // Un patrón (ruido fractal con el dominio deformado: manchas y hebras orgánicas) y una
  // «cobertura» que dice cuánta espuma hay: con cobertura alta la espuma es densa; al bajar solo
  // quedan las hebras más altas del patrón y la espuma se deshilacha hasta desaparecer.
  // (deriva en una dirección única: con la dirección local, que cambia algo de un vértice a otro,
  // el dibujo se descolocaba entre triángulos)
  float lejosE = smoothstep(60.0, 220.0, d);
  float lejosC = smoothstep(35.0, 110.0, d);            // las burbujas se ven hasta ~100 m
  vec2 pw = pe * 0.16 + vec2(fbm(pe * 0.06), fbm(pe * 0.06 + 5.2)) * 2.4;
  // la espuma de la rompiente se revuelve (agua que cae y da vueltas)
  float revuelve = smoothstep(0.9, 1.1, vBeta);
  pw += vec2(sin(uTiempo * 1.9 + pe.x * 0.31), cos(uTiempo * 1.6 + pe.y * 0.29)) * 0.3 * revuelve;
  float patron = smoothstep(0.2, 0.8, fbm(pw + vec2(fbm(pw * 1.7 + 1.3), fbm(pw * 1.7 + 8.1)) * 0.9));
  patron += (fbm(pe * 0.85 + 4.0) - 0.5) * 0.3 * cerca;                  // grumos finos, de cerca
  patron = mix(patron, 0.5, lejosE * 0.6);
  float ciclo = conOla ? fract((uTiempo - tA) / T + 0.15) : 0.5;
  float prof0 = uNivel - fm.x;
  float franja = (1.0 - smoothstep(0.0, 1.6, prof0)) * step(-uR2 - 0.3, prof0) * vAlcance;
  float pulso = ciclo < 0.3 ? 1.0 - pow(1.0 - ciclo / 0.3, 2.0) : 1.0 - smoothstep(0.0, 1.0, (ciclo - 0.3) / 0.7);
  float ola = floor((uTiempo - tA) / T + 0.15);
  float vaiven = conOla ? uR2 * pulso * franja * mix(0.45, 1.0, fract(sin(ola * 12.9898) * 43758.5453)) : 0.0;
  // Rompiente, por fases según beta (altura / altura máxima que admite el fondo; rompe en 1).
  // ILUSTRATIVO: (1) la cresta empieza a blanquear en lo alto; (2) al romper, la espuma cae por la
  // cara de arriba abajo, como una cascada, a medida que la ola entra en menos fondo; (3) queda una
  // resaca blanca y detrás un manto que se deshilacha hasta el siguiente seno.
  // (sin el ondulado del borde: con él, justo en la cresta quedaba una raya sin espuma)
  float e0 = fract((sOla - vCresta) / 6.28318531);
  float romp = smoothstep(0.9, 1.04, vBeta);
  float caida = smoothstep(1.0, 1.3, vBeta);
  float labio = smoothstep(0.45, 0.85, altoOla) * max(step(0.5, e0), 1.0 - smoothstep(0.03, 0.09, e0)) * romp;
  float cascada = caida * subeOla * smoothstep(1.0 - 1.7 * caida, 1.15 - 1.7 * caida, altoOla);
  float manto = exp(-edad * 5.0) * (1.0 - subeOla) * romp;
  float cobertura = max(labio, max(cascada, manto));
  // el dibujo grande (manchas y hebras) reparte la cobertura; las burbujas dan la textura
  float cobOla = clamp(cobertura * (0.45 + 1.1 * patron) - 0.08 * (1.0 - cobertura), 0.0, 1.0);
  float espumaOla = encaje(pe, cobOla, lejosC);
  // Orilla: la lámina sube con un borde de espuma grueso y se retira dejando encaje.
  float subiendo = 1.0 - smoothstep(0.25, 0.4, ciclo);
  float aaP = fwidth(prof) * 1.5 + 0.004;
  // ancho del borde en metros de arena, no en centímetros de agua: en la arena casi llana de
  // Salinas unos centímetros de agua son varios metros; el borde de espuma real es de 1–2 m
  float pendFondo = 0.5 * length(vec2(fondoMar(vPos.xz + vec2(1.0, 0.0)).x - fondoMar(vPos.xz - vec2(1.0, 0.0)).x,
                                      fondoMar(vPos.xz + vec2(0.0, 1.0)).x - fondoMar(vPos.xz - vec2(0.0, 1.0)).x));
  float anchoOrilla = min(mix(0.035, 0.1, subiendo), max(pendFondo, 0.004) * mix(0.8, 2.0, subiendo)) * (0.75 + 0.5 * patron);
  float borde = (1.0 - smoothstep(anchoOrilla - aaP, anchoOrilla + aaP, prof)) * vAlcance;
  float lamina = smoothstep(0.02, 0.2, vaiven) * (1.0 - smoothstep(0.0, 0.35, prof)) * vAlcance;
  float coberturaOrilla = max(lamina * mix(0.05, 0.3, subiendo), borde * 0.97);
  float cobOrilla = clamp(coberturaOrilla * (0.5 + patron), 0.0, 1.0);
  float espumaOrilla = encaje(pe * 1.3 + 7.1, cobOrilla, lejosC);
  float espuma = max(espumaOla, espumaOrilla) * (1.0 - smoothstep(900.0, 2400.0, d) * 0.6);
  // La espuma tiene cuerpo: más clara arriba y en lo denso, algo azulada en lo fino.
  float densa = smoothstep(0.45, 0.95, max(cobOla, cobOrilla));
  float luzE = 0.72 + 0.28 * clamp(dot(n, normalize(uDirBrillo + vec3(0.0, 1.0, 0.0))), 0.0, 1.0);
  vec3 blanco = mix(vec3(0.66, 0.78, 0.82), vec3(0.95, 0.97, 0.97), densa) * luzE * dia * mix(0.85, 1.0, sombraAgua);
  // Volumen: la espuma es un colchón de burbujas con bultos y hoyos; los hoyos, en sombra y algo
  // azulados (luz que pasa por el agua de debajo). Dos escalas de ruido que se mueven despacio.
  float bulto = fbm(pe * 0.9 + uTiempo * 0.05) * 0.6 + fbm(pe * 3.1 - uTiempo * 0.08) * 0.4;
  blanco *= mix(vec3(0.72, 0.8, 0.86), vec3(1.0), smoothstep(0.25, 0.75, bulto)) * mix(1.0, 0.9, lejosC);

  // ---------- Composición ----------
  vec3 c;
  float a;
  if (uConRefraccion > 0.5) {
    // Con refracción el agua es opaca (ya lleva dentro lo que se ve a través): reflejo según
    // Fresnel sobre el cuerpo refractado, y el destello del sol encima.
    c = mix(cuerpoRefr, reflejo, fres) + sol * (1.0 - espuma);
    a = 1.0;
  } else {
    // Sin ella (calidad mínima): mezcla con transparencia, como antes.
    a = fres + (1.0 - fres) * opaco;
    c = (reflejo * fres + cuerpo * (1.0 - fres) * opaco) / max(a, 1e-3);
    float lumSol = clamp(dot(sol, vec3(0.33)), 0.0, 1.0) * (1.0 - espuma);
    c += sol * (1.0 - espuma) / max(a, 0.05);
    a = max(a, lumSol);
  }
  c = mix(c, blanco, espuma);
  a = max(a, espuma);
  a *= mar;
  c = mix(c, uColorNiebla, 1.0 - exp(-uDensidadNiebla * uDensidadNiebla * d * d));
  // La ría y el puerto, lejos de la playa, se funden en la bruma como la tierra (zona.ts).
  float brumaA = brumaZonaAgua(vPos.xz);
  c = mix(c, uColorNiebla, brumaA);
  a = mix(a, 1.0, brumaA);
  gl_FragColor = vec4(c, a);
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
  // Radio (m) alrededor de la cámara con parches finos: hasta ahí la malla tiene ~0,7 m entre
  // vértices (1,25 m en el móvil); más allá, la de siempre.
  const RADIO_FINO = opciones.movil ? 120 : 200;
  const vert = crearAguaVert(SEG, RADIO_FINO);
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
    actualizar(teselas: { clave: string; x0: number; z0: number; lado: number; minY: number }[], nivelMax: number, camara: THREE.Vector3) {
      for (const m of grupo.children) m.visible = false;
      // El tamaño del parche lo decide la distancia a la cámara, no la tesela del terreno: la
      // separación entre vértices cambia lo que se dibuja (qué olas caben, cuánto se empinan) y
      // un parche grande junto a uno fino dejaba un borde recto en la espuma. Lo que esté cerca
      // se parte en parches de 200 m (a menos de 1,5 lados) y, junto a la cámara, en los finos.
      const poner = (clave: string, x0: number, z0: number, lado: number) => {
        const dx = Math.max(x0 - camara.x, 0, camara.x - (x0 + lado));
        const dz = Math.max(z0 - camara.z, 0, camara.z - (z0 + lado));
        const dist = Math.hypot(dx, dz);
        const nuevo = lado > LADO_GRUESO + 1 ? (dist < lado * 1.5 ? lado / 2 : 0) : lado > LADO_FINO + 1 && dist < RADIO_FINO ? LADO_FINO : 0;
        if (!nuevo) { parche(clave, x0, z0, lado).visible = true; return; }
        const n = Math.round(lado / nuevo);
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) poner(`${clave}/${i}${j}`, x0 + i * nuevo, z0 + j * nuevo, nuevo);
      };
      for (const t of teselas) {
        if (t.minY > nivelMax + 4) continue;
        poner(t.clave, t.x0, t.z0, t.lado);
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
