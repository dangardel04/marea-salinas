// Sombreadores del terreno y de los edificios de la bahía.
//
// Uniformes comunes (los comparten todas las mallas, se actualizan una vez por cuadro):
//   uDirSol, uColorSol, uLuzSol   dirección (unitaria), color e intensidad (0-1) de la luz principal
//   uAmbiente                     luz de ambiente (cielo); de día, ambiente + sol ≈ 1
//   uNivel, uNivelMax             nivel del mar ahora y máximo de las últimas 6 h (m sobre el CH)
//   uColorNiebla, uDensidadNiebla niebla exponencial al cuadrado (igual que FogExp2)
//
// La ortofoto ya lleva las sombras y la luz del día en que se voló, así que no se ilumina con
// un modelo físico completo: solo se escala con la luz del momento y algo con el relieve.

const COMUNES = /* glsl */ `
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
vec3 luz(vec3 n, float relieve) {
  float ndl = max(dot(normalize(n), uDirSol), 0.0);
  return uAmbiente + uColorSol * uLuzSol * mix(1.0, 0.45 + 0.75 * ndl, relieve);
}
`;

export const TERRENO_VERT = /* glsl */ `
attribute float medido;
varying vec2 vUv;
varying vec3 vPos;
varying vec3 vNor;
varying float vMed;
void main() {
  vUv = uv;
  vMed = medido;
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
uniform vec3 uCieloHorizonte;
uniform vec3 uCieloCenit;
uniform vec3 uDirBrillo;
uniform vec3 uColorBrillo;
uniform float uLuzDia;
uniform sampler2D uTexArena;   // arena (Poly Haven «Aerial Beach 01», 30 × 30 m, CC0)
uniform sampler2D uTexArenaN;
uniform sampler2D uTexArenaR;
uniform sampler2D uTexMojada;  // arena húmeda (Poly Haven «Damp Beach Sand 02», 1,87 m, CC0)
uniform sampler2D uTexMojadaN;
varying vec2 vUv;
varying vec3 vPos;
varying vec3 vNor;
varying float vMed;

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

  // ---------- Dónde no sirve la foto ----------
  // La ortofoto enseña el mar y la espuma del día del vuelo donde el LiDAR no midió, y a veces
  // también sobre la playa y al pie del muro del paseo. Ahí se dibuja.
  float playa = 1.0 - smoothstep(5.0, 6.5, h);
  float costa = 1.0 - smoothstep(8.5, 10.5, h);  // playa + muro del paseo
  float lumO = dot(orto, vec3(0.333));
  float satO = max(orto.r, max(orto.g, orto.b)) - min(orto.r, min(orto.g, orto.b));
  float fotoAgua = smoothstep(0.012, 0.05, orto.b - orto.r);
  float fotoEspuma = smoothstep(0.62, 0.74, lumO) * (1.0 - smoothstep(0.06, 0.12, satO));
  float usarFoto = smoothstep(0.3, 0.95, vMed) * (1.0 - costa * max(fotoAgua, fotoEspuma));
  // Caras casi verticales junto al mar (el muro del paseo): la foto, que es cenital, se estiraría
  // en rayas; se dibujan de piedra y hormigón.
  float muro = smoothstep(0.45, 0.75, pendiente) * costa;

  // ---------- Arena dibujada ----------
  // Textura fotográfica de arena, normalizada a su media (el último nivel de mipmap) y llevada al
  // color medido en la ortofoto: el dibujo es de la foto; el color, el de Salinas.
  float mezcla = smoothstep(0.35, 0.65, fbm(vPos.xz * 0.03));
  vec3 texA = muestraArena(uTexArena, vPos.xz, mezcla).rgb;
  vec3 mediaA = textureLod(uTexArena, vec2(0.5), 12.0).rgb;
  vec3 detalle = texA / max(mediaA, vec3(1e-3));
  // De muy cerca, el grano de la arena húmeda (1,87 m) encima, solo en luz.
  float muyCerca = 1.0 - smoothstep(4.0, 18.0, d);
  float lumM = dot(texture2D(uTexMojada, vPos.xz / 1.87).rgb, vec3(0.333)) / max(dot(textureLod(uTexMojada, vec2(0.5), 12.0).rgb, vec3(0.333)), 1e-3);
  detalle *= mix(1.0, lumM, muyCerca * 0.6);
  vec3 arena = uArenaSeca * mix(vec3(1.0), detalle, 0.9) * variacion(vPos.xz, 1e4);
  float hondo = uNivel - h;
  vec3 fondo = mix(arena * vec3(0.6, 0.67, 0.63), vec3(0.03, 0.06, 0.07), smoothstep(0.5, 10.0, hondo));
  vec3 c = mix(mix(arena, fondo, smoothstep(0.0, 1.5, hondo)), orto, usarFoto);
  // De cerca la foto (0,4 m por píxel) se ve borrosa: en la arena pasa a la dibujada, con el tono
  // local de la foto para que el color no cambie al acercarse.
  float cerca = (1.0 - smoothstep(18.0, 70.0, d)) * playa * usarFoto;
  float tono = clamp(lumO / max(dot(uArenaSeca, vec3(0.333)), 1e-3), 0.6, 1.3);
  c = mix(c, arena * mix(1.0, tono, 0.7), cerca * 0.85);
  // Muro: piedra gris con vetas verticales de agua y algas oscuras en la parte baja.
  vec2 pm = vec2(vPos.x + vPos.z, vPos.y);
  float bloques = fbm(pm * vec2(0.9, 1.6)) * 0.5 + fbm(pm * 4.0 + 2.0) * 0.5;
  vec3 piedra = vec3(0.34, 0.33, 0.31) * (0.75 + 0.5 * bloques);
  piedra = mix(piedra * vec3(0.55, 0.6, 0.5), piedra, smoothstep(uNivelMax - 0.3, uNivelMax + 1.2, h));
  c = mix(c, piedra, muro);

  // ---------- Humedad ----------
  // Lo que el agua ha cubierto en las últimas horas sigue mojado, más cuanto más reciente; justo
  // por encima de la orilla queda una lámina de agua que brilla.
  float rango = max(uNivelMax - uNivel, 0.25);
  float humedad = clamp((uNivelMax + 0.12 - h) / rango, 0.0, 1.0);
  humedad = max(pow(humedad, 0.6) * 0.85, 1.0 - smoothstep(uNivel, uNivel + 0.35, h));
  // El borde de lo mojado no es una curva de nivel perfecta: lo rompe el vaivén.
  humedad *= smoothstep(0.0, 0.25, humedad + (fbm(vPos.xz * 0.15) - 0.5) * 0.35);
  humedad *= playa * (1.0 - muro);
  float lamina = (1.0 - smoothstep(uNivel + 0.02, uNivel + 0.4 + 0.15 * fbm(vPos.xz * 0.3), h)) * playa * (1.0 - muro);
  c = mix(c, c * vec3(0.44, 0.47, 0.49), humedad);
  // Línea de pleamar: donde llegó el agua hace unas horas queda una franja más oscura con restos
  // (algas, conchas), rota e irregular.
  float marca = 1.0 - smoothstep(0.0, 0.07, abs(h - uNivelMax - 0.04 - (fbm(vPos.xz * 0.08) - 0.5) * 0.12));
  float restos = smoothstep(0.55, 0.8, fbm(vPos.xz * vec2(0.6, 0.6) + 11.0));
  c = mix(c, c * vec3(0.55, 0.5, 0.42), marca * restos * playa * (1.0 - muro) * step(uNivel + 0.3, uNivelMax) * (1.0 - smoothstep(150.0, 500.0, d)));

  // ---------- Luz ----------
  // Relieve fino de la arena (ondulaciones del viento y del agua) con los mapas de normales de
  // las texturas; en lo mojado, el de la arena húmeda, más liso.
  vec3 nA = muestraArena(uTexArenaN, vPos.xz, mezcla).xyz * 2.0 - 1.0;
  vec3 nM = texture2D(uTexMojadaN, vPos.xz / 1.87).xyz * 2.0 - 1.0;
  vec2 rel = mix(nA.xy, nM.xy * muyCerca, humedad * 0.7) * (1.0 - lamina * 0.8);
  float fuerzaN = mix(0.9, 0.25, smoothstep(20.0, 250.0, d)) * playa * (1.0 - usarFoto * (1.0 - cerca)) * (1.0 - muro);
  vec3 n = normalize(vNor + vec3(rel.x, 0.0, -rel.y) * fuerzaN);
  // La foto ya trae la luz del vuelo: relieve suave; la arena dibujada, igual, para que casen. El
  // muro, con su luz completa.
  c *= luz(n, mix(mix(0.55, 0.4, usarFoto), 1.0, muro));

  // Arena mojada: refleja el cielo y el sol (Fresnel); con lámina de agua, casi un espejo.
  vec3 v = normalize(cameraPosition - vPos);
  float fres = pow(1.0 - max(dot(n, v), 0.0), 5.0);
  vec3 r = reflect(-v, n);
  vec3 cielo = mix(uCieloHorizonte, uCieloCenit, pow(clamp(r.y, 0.0, 1.0), 0.6));
  float aspereza = muestraArena(uTexArenaR, vPos.xz, mezcla).r;
  float brillo = (humedad * 0.3 + lamina * 0.7) * mix(1.0, 1.0 - aspereza * 0.6, humedad);
  c = mix(c, cielo, brillo * (0.05 + 0.75 * fres));
  float sol = pow(max(dot(r, uDirBrillo), 0.0), mix(60.0, 700.0, lamina)) * step(0.0, uDirBrillo.y);
  c += uColorBrillo * sol * brillo * mix(0.3, 3.0, lamina);

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
  // Las fachadas reciben la luz con más contraste que los tejados (que ya traen la de la foto).
  float fachada = 1.0 - abs(n.y);
  // Bandas de plantas (cada 3 m, la misma altura por planta supuesta en el modelo) y huecos de
  // ventana: DECORATIVO, solo para dar escala; el Catastro no da fachadas.
  float planta = fract(vPos.y / 3.0);
  float hueco = step(0.35, planta) * step(planta, 0.8) * step(0.45, fract((vPos.x + vPos.z) / 2.6));
  vec3 base = mix(vColor, vColor * vec3(0.55, 0.6, 0.66), hueco * fachada * 0.8);
  vec3 c = base * luz(n, mix(0.5, 1.0, fachada));
  // De noche, algunas ventanas encendidas al azar (DECORATIVO).
  vec2 celda = floor(vec2((vPos.x + vPos.z) / 2.6, vPos.y / 3.0));
  float encendida = step(0.72, fract(sin(dot(celda, vec2(12.9898, 78.233))) * 43758.5453));
  c += vec3(1.0, 0.72, 0.38) * 0.55 * hueco * fachada * encendida * smoothstep(0.5, 0.9, uNoche);
  gl_FragColor = vec4(conNiebla(c, vPos), 1.0);
  #include <colorspace_fragment>
}
`;
