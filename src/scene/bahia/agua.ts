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
varying vec2 vDir;
varying float vAlcance;
varying vec4 vRefl;
varying float vAlto;      // elevación de la ola respecto a su altura típica (−1 seno, +1 cresta)
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
  // Pendiente de la cresta por componente. Con 4 componentes por sistema y dos sistemas, la suma
  // debe quedar por debajo de 1 o la malla se pliega sobre sí misma en la cresta (dientes de sierra).
  float s = min(0.13, k * a * 1.6);
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
  float rotura = 0.0, fase = -10.0, vaiven = 0.0, ciclo = 0.5, alto = 0.0;
  float prof = uNivel - fondo(p.xz);
  if (uLejos < 0.5) {
    float h = max(prof, 0.08);
    float tA, tB, alcA, alcB;
    sistema(uSisA, uCampoA, p.xz, h, desp, nrm, rotura, fase, tA, alcA);
    sistema(uSisB, uCampoB, p.xz, h, desp, nrm, rotura, fase, tB, alcB);
    // Fase de la ola principal (para la espuma): siempre la misma componente, sin saltos entre
    // vértices vecinos aunque alguna componente se apague por el nivel de detalle.
    if (uSisA.x >= 0.02) fase = PI2 / max(uSisA.y, 1.0) * (tA - uTiempo);
    alto = desp.y / max(0.35 * (uSisA.x + uSisB.x), 0.03);
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
    float ola = floor((uTiempo - tA) / max(uSisA.y, 1.0) + 0.15);
    vaiven = uR2 * pulso * franja * mix(0.45, 1.0, fract(sin(ola * 12.9898) * 43758.5453));
    desp.y += uSetup * franja + vaiven;
    desp *= smoothstep(-uR2 - 0.3, 0.05, prof); // en seco solo queda el vaivén
  }
  p += desp;
  p.y += uNivel;
  vNormal = normalize(nrm);
  vRotura = rotura;
  vFase = fase;
  vAlto = clamp(alto, -1.5, 1.5);
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
varying vec2 vDir;
varying float vAlcance;
varying vec4 vRefl;
uniform sampler2D uNormAgua;
uniform sampler2D uReflejo;
uniform float uConReflejo;
uniform vec4 uSisA;
uniform sampler2D uCampoA;
uniform vec2 uCampo;

const float MEDIO = ${(LADO / 2).toFixed(1)};
vec2 uvNodo(vec2 xz, vec2 rej) { return ((xz + MEDIO) / rej.y + 0.5) / rej.x; }
/** Altura del fondo y cota de rebose (nivel al que llega el mar, ver campoOlas.ts); fuera, mar hondo. */
vec2 fondoMar(vec2 xz) {
  if (abs(xz.x) > MEDIO || abs(xz.y) > MEDIO) return vec2(-40.0);
  return texture(uRelieve, uvNodo(xz, uRel)).rg;
}
varying float vAlto;
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
  float fuerza = mix(0.5, 0.12, smoothstep(30.0, 1200.0, d)) * smoothstep(0.05, 1.2, prof);
  vec3 n = normalize(vNormal + vec3(g.x, 0.0, -g.y) * fuerza);
  vec3 v = normalize(cameraPosition - vPos);
  float ndv = max(dot(n, v), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  vec3 r = reflect(-v, n);
  r.y = abs(r.y); // la ola no refleja el suelo: siempre cielo
  vec3 cielo = mix(uCieloHorizonte, uCieloCenit, pow(clamp(r.y, 0.0, 1.0), 0.45));
  // Reflejo de la escena (acantilados, edificios) desde la cámara espejo, si está activo.
  vec2 uvR = vRefl.xy / vRefl.w + (n.xz - vNormal.xz) * mix(0.06, 0.02, smoothstep(30.0, 400.0, d));
  vec4 escenaR = texture2D(uReflejo, uvR);
  float dentroR = step(0.001, uvR.x) * step(uvR.x, 0.999) * step(0.001, uvR.y) * step(uvR.y, 0.999);
  vec3 reflejo = mix(cielo, escenaR.rgb / max(escenaR.a, 1e-3), clamp(escenaR.a, 0.0, 1.0) * dentroR * uConReflejo);
  // Destello del sol: un núcleo muy fino y brillante (los rizos lo rompen en chispas) y un halo.
  float rs = max(dot(r, uDirBrillo), 0.0);
  vec3 sol = uColorBrillo * (pow(rs, 1400.0) * 30.0 + pow(rs, 180.0) * 1.1 + pow(rs, 14.0) * 0.05) * step(0.0, uDirBrillo.y);

  // ---------- Cuerpo del agua ----------
  // Azul marino en lo hondo; sobre la arena, verde turquesa (la luz rebota en el fondo claro). La
  // luz que atraviesa la cresta de las olas la ilumina en turquesa (dispersión bajo la superficie).
  vec3 hondo = vec3(0.006, 0.05, 0.14);
  vec3 somero = vec3(0.03, 0.36, 0.38);
  vec3 turquesa = vec3(0.04, 0.4, 0.42);
  float kProf = 1.0 - exp(-max(prof, 0.0) / 1.3);
  vec3 cuerpo = mix(somero, hondo, kProf);
  float cresta = smoothstep(-0.1, 0.9, vAlto);
  vec3 dirLuz = normalize(uDirBrillo * vec3(1.0, 0.35, 1.0));
  float contraluz = pow(clamp(dot(v, -normalize(dirLuz + n * 0.55)), 0.0, 1.0), 3.0);
  float dispersa = (contraluz * 1.4 + (1.0 - ndv) * 0.35) * cresta * smoothstep(0.3, 2.0, prof);
  cuerpo += turquesa * dispersa * (0.55 + 0.45 * uLuzDia);
  // senos algo más oscuros que las crestas: se lee la forma de la ola
  cuerpo *= dia * mix(0.8, 1.1, cresta);
  // Transparencia: el agua somera deja ver la arena (absorción con la profundidad).
  // (con un mínimo, para que el agua somera se lea como agua y no como una sombra en la arena)
  float opaco = mix(0.3, 1.0, 1.0 - exp(-max(prof, 0.0) * 0.9)) * smoothstep(0.0, 0.04, prof);

  // ---------- Espuma ----------
  // Un patrón (ruido fractal con el dominio deformado: manchas y hebras orgánicas) y una
  // «cobertura» que dice cuánta espuma hay: con cobertura alta la espuma es densa; al bajar solo
  // quedan las hebras más altas del patrón y la espuma se deshilacha hasta desaparecer.
  vec2 perp = vec2(-uSisA.w, uSisA.z);
  float along = dot(vPos.xz, perp);
  // La espuma deriva con el oleaje de mar abierto (dirección única: con la dirección local, que
  // cambia algo de un vértice a otro, el dibujo se descolocaba entre triángulos).
  vec2 pe = vPos.xz - uSisA.zw * uTiempo * 0.5;
  float lejosE = smoothstep(60.0, 220.0, d);
  vec2 pw = pe * 0.16 + vec2(fbm(pe * 0.06), fbm(pe * 0.06 + 5.2)) * 2.4;
  float patron = smoothstep(0.2, 0.8, fbm(pw + vec2(fbm(pw * 1.7 + 1.3), fbm(pw * 1.7 + 8.1)) * 0.9));
  patron += (fbm(pe * 0.85 + 4.0) - 0.5) * 0.3 * cerca;                  // grumos finos, de cerca
  patron = mix(patron, 0.5, lejosE * 0.6);
  float anchoP = 0.06 + fwidth(patron);
  // Rompiente: espuma desde el frente de la ola hacia atrás, que se disuelve en el seno.
  // Fase de la ola principal y momento del vaivén calculados en cada píxel con el tiempo de
  // llegada: el ciclo del vaivén vuelve a 0 con cada ola, e interpolarlo entre vértices dibujaba
  // la espuma en dientes de sierra.
  float T = max(uSisA.y, 1.0);
  float tA = texture(uCampoA, uvNodo(vPos.xz, uCampo)).r;
  bool conOla = uLejos < 0.5 && uSisA.x >= 0.02;
  float fase = conOla ? 6.28318531 / T * (tA - uTiempo) + 0.6 : vFase + 0.6;
  float ciclo = conOla ? fract((uTiempo - tA) / T + 0.15) : 0.5;
  float prof0 = uNivel - fm.x;
  float franja = (1.0 - smoothstep(0.0, 1.6, prof0)) * step(-uR2 - 0.3, prof0) * vAlcance;
  float pulso = ciclo < 0.3 ? 1.0 - pow(1.0 - ciclo / 0.3, 2.0) : 1.0 - smoothstep(0.0, 1.0, (ciclo - 0.3) / 0.7);
  float ola = floor((uTiempo - tA) / T + 0.15);
  float vaiven = conOla ? uR2 * pulso * franja * mix(0.45, 1.0, fract(sin(ola * 12.9898) * 43758.5453)) : 0.0;
  float onda = 0.02 * sin(along * 0.31 + uTiempo * 1.3) + 0.03 * (fbm(pe * 0.07) - 0.5);
  float edad = 1.0 - fract(fase / 6.28318531 - 0.25 + onda); // 0 en el frente, 1 en la siguiente
  float cobertura = vRotura * exp(-edad * 4.0);
  float espumaOla = smoothstep(1.0 - cobertura - anchoP, 1.0 - cobertura + anchoP, patron);
  // Orilla: la lámina sube con un borde de espuma grueso y se retira dejando encaje.
  float subiendo = 1.0 - smoothstep(0.25, 0.4, ciclo);
  float aaP = fwidth(prof) * 1.5 + 0.004;
  float anchoOrilla = mix(0.035, 0.1, subiendo) + 0.04 * (patron - 0.5);
  float borde = (1.0 - smoothstep(anchoOrilla - aaP, anchoOrilla + aaP, prof)) * vAlcance;
  float lamina = smoothstep(0.02, 0.2, vaiven) * (1.0 - smoothstep(0.0, 0.35, prof)) * vAlcance;
  float coberturaOrilla = max(lamina * mix(0.1, 0.42, subiendo), borde);
  float espumaOrilla = smoothstep(1.0 - coberturaOrilla - anchoP, 1.0 - coberturaOrilla + anchoP, patron);
  float espuma = max(espumaOla, espumaOrilla) * (1.0 - smoothstep(900.0, 2400.0, d) * 0.6);
  // La espuma tiene cuerpo: más clara arriba y en lo denso, algo azulada en lo fino.
  float densa = smoothstep(0.5, 0.9, patron);
  float luzE = 0.72 + 0.28 * clamp(dot(n, normalize(uDirBrillo + vec3(0.0, 1.0, 0.0))), 0.0, 1.0);
  vec3 blanco = mix(vec3(0.72, 0.82, 0.86), vec3(0.96, 0.98, 0.98), densa) * luzE * dia;

  // ---------- Composición ----------
  // Mezcla física sencilla: reflejo (Fresnel) + cuerpo del agua (con su opacidad) + fondo.
  float a = fres + (1.0 - fres) * opaco;
  vec3 c = (reflejo * fres + cuerpo * (1.0 - fres) * opaco) / max(a, 1e-3);
  float lumSol = clamp(dot(sol, vec3(0.33)), 0.0, 1.0) * (1.0 - espuma);
  c += sol * (1.0 - espuma) / max(a, 0.05);
  a = max(a, lumSol);
  c = mix(c, blanco, espuma);
  a = max(a, espuma);
  a *= mar;
  c = mix(c, uColorNiebla, 1.0 - exp(-uDensidadNiebla * uDensidadNiebla * d * d));
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
