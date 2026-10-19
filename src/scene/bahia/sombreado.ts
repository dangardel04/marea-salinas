// Sombreadores del terreno y de los edificios de la bahía.
//
// Uniformes comunes (los comparten todas las mallas, se actualizan una vez por cuadro):
//   uDirSol, uColorSol, uLuzSol   dirección (unitaria), color e intensidad (0-1) de la luz principal
//   uAmbiente                     luz de ambiente (cielo); de día, ambiente + sol ≈ 1
//   uNivel, uNivelMax             nivel del mar ahora y máximo de las últimas 6 h (m sobre el CH)
//   uColorNiebla, uDensidadNiebla niebla exponencial al cuadrado (igual que FogExp2)
//
// La ortofoto ya lleva las sombras y la luz del día en que se voló, así que no se ilumina con
// un modelo físico completo: solo se escala con la luz del momento, algo con el relieve y con las
// sombras de ahora (a medias). Lo dibujado (arena, muro, edificios) sí: luz física sencilla.

import { SOMBRA_GLSL } from './sombras';

const COMUNES = /* glsl */ `
uniform vec3 uCieloHorizonte;
uniform vec3 uCieloCenit;
uniform float uLuzDia;
uniform vec3 uDirSol;
uniform vec3 uColorSol;
uniform float uLuzSol;
uniform vec3 uAmbiente;
uniform float uNivel;
uniform float uNivelMax;
uniform vec3 uColorNiebla;
uniform float uDensidadNiebla;
uniform float uNoche;
vec3 conNiebla(vec3 c, vec3 pos) {
  float d = length(pos - cameraPosition);
  float f = 1.0 - exp(-uDensidadNiebla * uDensidadNiebla * d * d);
  return mix(c, uColorNiebla, f);
}
vec3 luz(vec3 n, float relieve, float s) {
  float ndl = max(dot(normalize(n), uDirSol), 0.0);
  return uAmbiente + uColorSol * uLuzSol * mix(1.0, 0.45 + 0.75 * ndl, relieve) * s;
}
${SOMBRA_GLSL}
vec3 cieloEn(vec3 r) { return mix(uCieloHorizonte, uCieloCenit, pow(clamp(r.y, 0.0, 1.0), 0.45)); }
/** Luz física sencilla: difusa de Lambert, especular GGX (Smith, Fresnel de Schlick), ambiente
 *  del cielo (arriba) y del rebote en el suelo (abajo), y reflejo del cielo según la rugosidad.
 *  s = sombra del sol (0–1); ao = oclusión ambiental (0–1). */
vec3 iluminar(vec3 albedo, vec3 n, vec3 v, float rugosidad, float f0, float s, float ao) {
  vec3 l = uDirSol;
  vec3 hv = normalize(l + v);
  float ndl = max(dot(n, l), 0.0), ndv = max(dot(n, v), 1e-3), ndh = max(dot(n, hv), 0.0), vdh = max(dot(v, hv), 0.0);
  float a = rugosidad * rugosidad, a2 = a * a;
  float dd = ndh * ndh * (a2 - 1.0) + 1.0;
  float D = a2 / (3.14159265 * dd * dd);
  float k = (rugosidad + 1.0) * (rugosidad + 1.0) / 8.0;
  float G = (ndv / (ndv * (1.0 - k) + k)) * (ndl / (ndl * (1.0 - k) + k));
  float F = f0 + (1.0 - f0) * pow(1.0 - vdh, 5.0);
  vec3 sol = uColorSol * uLuzSol * 1.5 * s;
  vec3 difusa = albedo * (1.0 - F) * ndl * sol;
  vec3 especular = sol * D * G * F / (4.0 * ndv + 1e-3);
  vec3 cielo = uAmbiente * 1.15, suelo = uAmbiente * 0.42 * vec3(1.0, 0.95, 0.86);
  vec3 ambiente = albedo * mix(suelo, cielo, n.y * 0.5 + 0.5) * ao;
  float Fv = f0 + (1.0 - f0) * pow(1.0 - ndv, 5.0);
  vec3 reflejo = cieloEn(reflect(-v, n)) * (0.15 + 0.85 * uLuzDia) * Fv * (1.0 - rugosidad) * (1.0 - rugosidad) * ao;
  return difusa + especular + ambiente + reflejo;
}
`;

/** Lo mismo para otros sombreadores de la escena (el muro del paseo). */
export const LUZ_GLSL = COMUNES;

export const TERRENO_VERT = /* glsl */ `
attribute float medido;
attribute float oclusion;
varying vec2 vUv;
varying vec3 vPos;
varying vec3 vNor;
varying float vMed;
varying float vOcl;
void main() {
  vUv = uv;
  vMed = medido;
  vOcl = oclusion;
  vNor = normal;
  vec4 m = modelMatrix * vec4(position, 1.0);
  vPos = m.xyz;
  gl_Position = projectionMatrix * viewMatrix * m;
}
`;

export const TERRENO_FRAG = /* glsl */ `
${COMUNES}
uniform sampler2D uOrto;
uniform vec4 uUv;
uniform float uTieneOrto;
uniform vec3 uArenaSeca;       // color de la arena seca medido en la ortofoto (lineal)
uniform vec3 uDirBrillo;
uniform vec3 uColorBrillo;
uniform sampler2D uTexArena;   // arena (Poly Haven «Aerial Beach 01», 30 × 30 m, CC0)
uniform sampler2D uTexArenaN;
uniform sampler2D uTexArenaR;
uniform sampler2D uTexMojada;  // arena húmeda (Poly Haven «Damp Beach Sand 02», 1,87 m, CC0)
uniform sampler2D uTexMojadaN;
uniform sampler2D uPlaya;       // máscara de playa (OpenStreetMap)
uniform sampler2D uFondoAgua;   // G: cota de rebose, hasta dónde llega el mar (ver campoOlas.ts)
uniform float uR2;             // subida del agua por las olas (Stockdon), m
uniform float uSetup;
varying vec2 vUv;
varying vec3 vPos;
varying vec3 vNor;
varying float vMed;
varying float vOcl;

const float MEDIO = 3200.0;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float ruido(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
// Ruido fractal (0–1) y deformación del dominio: formas orgánicas, sin cuadrícula.
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * ruido(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return s / 0.9375;
}
// Variación de la arena: de luz (poca) y de tono (algo más cálida o más gris), a varias escalas,
// apagando lo que sería más fino que un píxel.
vec3 variacion(vec2 p, float d) {
  float grande = fbm(p * 0.02 + vec2(fbm(p * 0.01) * 3.0));                        // ~50 m
  float medio = fbm(p * 0.25 + 3.1) * (1.0 - smoothstep(150.0, 400.0, d));          // ~4 m
  float fino = (ruido(p * 2.3 + 7.7) - 0.5) * (1.0 - smoothstep(25.0, 90.0, d))
             + (ruido(p * 9.0 + 1.3) - 0.5) * 0.8 * (1.0 - smoothstep(6.0, 22.0, d));
  float luzV = (grande - 0.5) * 0.06 + (medio - 0.5) * 0.06 * (1.0 - smoothstep(150.0, 400.0, d)) + fino * 0.08;
  vec3 calida = vec3(1.03, 1.0, 0.95), gris = vec3(0.97, 0.99, 1.02);
  return mix(gris, calida, smoothstep(0.3, 0.7, grande)) * (1.0 + luzV);
}

// Muestra sin repetición visible: dos lecturas a escalas y giros distintos mezcladas con ruido.
const mat2 GIRO = mat2(0.8, -0.6, 0.6, 0.8);
vec4 muestraArena(sampler2D t, vec2 p, float mezcla) {
  return mix(texture2D(t, p / 30.0), texture2D(t, GIRO * p / 23.0 + 0.37), mezcla);
}

void main() {
  float h = vPos.y;
  float d = length(vPos - cameraPosition);
  vec3 orto = uTieneOrto > 0.5 ? texture2D(uOrto, uUv.xy + vUv * uUv.zw).rgb : uArenaSeca * 0.7;
  float pendiente = 1.0 - vNor.y; // 0 llano, 1 vertical

  // ---------- Qué es playa ----------
  // Arena de playa: dentro de los polígonos de playa de OpenStreetMap (bahia/playa.png), o
  // cualquier cosa que cubra la marea. Ahí NO se usa la ortofoto (trae gente, algas, sombras y el
  // mar del día del vuelo): se dibuja una arena limpia, estilizada.
  float enPlaya = texture2D(uPlaya, ((vPos.xz + MEDIO) / 5.0 + 0.5) / 1281.0).r;
  float cubre = 1.0 - smoothstep(uNivelMax + 0.4, uNivelMax + 1.2, h);
  float muro = smoothstep(0.42, 0.62, pendiente) * (1.0 - smoothstep(9.0, 11.0, h));
  float playa = max(enPlaya, cubre) * (1.0 - muro) * (1.0 - smoothstep(7.0, 8.5, h));
  float usarFoto = smoothstep(0.3, 0.95, vMed) * (1.0 - playa) * (1.0 - muro);
  // En el borde del paseo la foto trae a veces la espuma de las olas de aquel día contra el muro:
  // ahí, hormigón.
  float lumO = dot(orto, vec3(0.333));
  float satO = max(orto.r, max(orto.g, orto.b)) - min(orto.r, min(orto.g, orto.b));
  float espumaFoto = smoothstep(0.6, 0.72, lumO) * (1.0 - smoothstep(0.05, 0.1, satO)) * (1.0 - smoothstep(9.0, 11.0, h));
  muro = max(muro, espumaFoto * (1.0 - playa));
  // Entre la arena y el paseo (escollera, rampas, pie del muro): a menos de ~8 m de la playa y por
  // debajo del paseo, también piedra dibujada, no la foto.
  vec2 uvP = ((vPos.xz + MEDIO) / 5.0 + 0.5) / 1281.0;
  float o = 1.6 / 1281.0;
  float cercaPlaya = max(max(texture2D(uPlaya, uvP + vec2(o, 0.0)).r, texture2D(uPlaya, uvP - vec2(o, 0.0)).r),
                         max(texture2D(uPlaya, uvP + vec2(0.0, o)).r, texture2D(uPlaya, uvP - vec2(0.0, o)).r));
  float pieMuro = smoothstep(0.2, 0.5, cercaPlaya) * (1.0 - playa) * (1.0 - smoothstep(8.5, 10.0, h)) * step(uNivelMax - 0.5, h);
  // ahí, lo llano es arena alta (el polígono de OSM no siempre llega al muro) y lo empinado, piedra
  float empinado = smoothstep(0.12, 0.25, pendiente);
  playa = max(playa, pieMuro * (1.0 - empinado));
  muro = max(muro, pieMuro * empinado);
  usarFoto *= (1.0 - espumaFoto) * (1.0 - pieMuro);

  // ---------- Playa y muro dibujados ----------
  // Colores elegidos (no el medido en la foto), con luz física: la arena seca es mate; la mojada,
  // más oscura, lisa y con reflejo; transiciones suaves entre ellas.
  vec3 arenaSeca = vec3(0.86, 0.66, 0.38);     // sRGB ≈ (239, 213, 166)
  vec3 arenaHumeda = vec3(0.64, 0.5, 0.3);     // sRGB ≈ (209, 189, 149)
  vec3 arenaEmpapada = vec3(0.48, 0.38, 0.25); // ≈ (184, 166, 137), justo encima de la orilla
  // Franja mojada (lo que cubrió la marea en las últimas horas) y empapada (junto al agua).
  float rango = max(uNivelMax - uNivel, 0.25);
  float aa = fwidth(h) * 1.5 + 0.05;
  float mojada = 1.0 - smoothstep(rango + 0.08 - aa, rango + 0.08 + aa, h - uNivel);
  // Empapada: la franja que lava el vaivén de las olas ahora (hasta el nivel + setup + R2) y un
  // poco más; transición suave. Con la cota de rebose (no la altura), así las hondonadas detrás de
  // un caballón no salen como manchas oscuras.
  float cotaMar = max(h, texture2D(uFondoAgua, uvP).g);
  float lavado = uSetup + uR2 + 0.08;
  float empapada = 1.0 - smoothstep(lavado - 0.06, lavado + 0.14, cotaMar - uNivel);
  vec3 arena = mix(arenaSeca, arenaHumeda, mojada);
  arena = mix(arena, arenaEmpapada, empapada);
  // Bajo el mar (se ve a través del agua somera), algo más oscura; en los charcos aislados de
  // bajamar, que no se dibujan como mar, se queda en arena empapada.
  float esMar = smoothstep(-0.03, 0.03, uNivel - cotaMar);
  arena = mix(arena, arenaHumeda * 0.85, smoothstep(-0.05, 0.05, uNivel - h) * esMar);

  // Muro del paseo: piedra clara, con la franja que moja el mar más oscura y verdosa (borde nítido).
  vec3 piedra = vec3(0.74, 0.7, 0.62);
  float verdin = 1.0 - smoothstep(uNivelMax + 0.4 - aa * 3.0, uNivelMax + 0.4 + aa * 3.0, h);
  piedra = mix(piedra, vec3(0.32, 0.36, 0.28), verdin);

  vec3 c = mix(orto, arena, playa);
  c = mix(c, piedra, muro);
  // Fuera de la playa, donde no hay foto válida (fondo lejos de la costa), arena oscura del fondo.
  c = mix(c, arenaEmpapada * 0.6, (1.0 - usarFoto) * (1.0 - playa) * (1.0 - muro) * (1.0 - smoothstep(0.3, 0.95, vMed)));

  // ---------- Luz ----------
  vec3 n = normalize(vNor);
  vec3 v = normalize(cameraPosition - vPos);
  float estilo = max(playa, muro);
  float sSol = sombra(vPos, n);
  // Oclusión de contacto (al pie del muro, en los pliegues), suave.
  float ao = 1.0 - smoothstep(0.12, 0.75, vOcl) * 0.5;
  // Arena: seca, mate (rugosidad 0,9); húmeda de la marea, 0,6; empapada por el vaivén, la
  // película de agua la hace lisa (0,2): brilla y refleja el cielo.
  float rug = mix(mix(0.9, 0.6, mojada), 0.2, empapada);
  rug = mix(rug, 0.88, muro);
  float f0 = mix(0.03, 0.02, empapada);
  vec3 dibujado = iluminar(c, n, v, rug, f0, sSol, ao);
  // La foto ya trae su luz: se escala con la de ahora y con las sombras (a medias, que la foto
  // tiene las suyas del día del vuelo, más cortas o largas según la hora).
  vec3 foto = c * luz(n, mix(0.55, 0.45, usarFoto), mix(1.0, sSol, 0.85)) * mix(1.0, ao, 0.5);
  c = mix(foto, dibujado, estilo);

  gl_FragColor = vec4(conNiebla(c, vPos), 1.0);
  #include <colorspace_fragment>
}
`;

export const EDIFICIOS_VERT = /* glsl */ `
attribute vec3 color;
varying vec3 vColor;
varying vec3 vPos;
varying vec3 vNor;
void main() {
  vColor = color;
  vNor = normal;
  vec4 m = modelMatrix * vec4(position, 1.0);
  vPos = m.xyz;
  gl_Position = projectionMatrix * viewMatrix * m;
}
`;

export const EDIFICIOS_FRAG = /* glsl */ `
${COMUNES}
varying vec3 vColor;
varying vec3 vPos;
varying vec3 vNor;
void main() {
  vec3 n = normalize(vNor) * (gl_FrontFacing ? 1.0 : -1.0);
  vec3 v = normalize(cameraPosition - vPos);
  float fachada = 1.0 - abs(n.y);
  // Bandas de plantas (cada 3 m, la misma altura por planta supuesta en el modelo) y huecos de
  // ventana: DECORATIVO, solo para dar escala; el Catastro no da fachadas.
  float planta = fract(vPos.y / 3.0);
  float hueco = step(0.35, planta) * step(planta, 0.8) * step(0.45, fract((vPos.x + vPos.z) / 2.6)) * step(0.5, fachada);
  // Materiales (PBR sencillo): tejado algo rugoso, enfoscado de fachada mate, vidrio liso que
  // refleja el cielo. Albedo: el color de cada edificio (del LiDAR en Salinas) y el vidrio, oscuro.
  vec3 albedo = mix(vColor, vColor * vec3(0.22, 0.26, 0.3), hueco);
  float rug = mix(mix(0.72, 0.9, fachada), 0.1, hueco);
  float f0 = mix(0.04, 0.05, hueco);
  // Los tejados del LiDAR traen ya la luz de la foto aérea: menos contraste de sol en ellos.
  vec3 c = iluminar(albedo, n, v, rug, f0, sombra(vPos, n), mix(0.8, 1.0, fachada));
  // De noche, algunas ventanas encendidas al azar (DECORATIVO).
  vec2 celda = floor(vec2((vPos.x + vPos.z) / 2.6, vPos.y / 3.0));
  float encendida = step(0.72, fract(sin(dot(celda, vec2(12.9898, 78.233))) * 43758.5453));
  c += vec3(1.0, 0.72, 0.38) * 2.6 * hueco * encendida * smoothstep(0.5, 0.9, uNoche);
  gl_FragColor = vec4(conNiebla(c, vPos), 1.0);
  #include <colorspace_fragment>
}
`;
