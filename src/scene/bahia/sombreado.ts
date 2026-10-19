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
uniform sampler2D uPlaya;       // máscara de playa (OpenStreetMap)
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
  usarFoto *= 1.0 - espumaFoto;

  // ---------- Arena ----------
  // Color medido en la ortofoto, un punto más cálido (estilizado), casi uniforme: solo una
  // variación muy suave de gran escala, para que no parezca plástico, y ninguna mancha.
  vec3 arena = uArenaSeca * vec3(1.07, 1.0, 0.84);
  arena *= 1.0 + (fbm(vPos.xz * 0.012) - 0.5) * 0.05;
  // Bajo el agua la arena se ve a través: el agua ya la tiñe; aquí solo se apaga con la hondura.
  float hondo = uNivel - h;
  arena = mix(arena, arena * vec3(0.55, 0.62, 0.6), smoothstep(0.0, 2.0, hondo));
  arena = mix(arena, vec3(0.04, 0.07, 0.08), smoothstep(2.0, 12.0, hondo));

  // Húmeda: la franja que ha cubierto el agua en las últimas horas, con un degradado limpio
  // (más oscura cuanto más reciente) y un borde nítido arriba.
  float rango = max(uNivelMax - uNivel, 0.25);
  float humedad = clamp((uNivelMax + 0.08 - h) / rango, 0.0, 1.0);
  humedad = smoothstep(0.0, 0.12, humedad) * (0.55 + 0.45 * humedad);
  humedad = max(humedad, 1.0 - smoothstep(uNivel, uNivel + 0.3, h));
  float lamina = 1.0 - smoothstep(uNivel + 0.02, uNivel + 0.35, h);
  vec3 arenaMojada = mix(arena, arena * vec3(0.6, 0.6, 0.63), humedad);

  // ---------- Muro del paseo ----------
  // Hormigón claro, limpio, con la parte que alcanza el mar más oscura y verdosa.
  vec3 hormigon = vec3(0.58, 0.57, 0.54) * (0.97 + 0.03 * fbm(vPos.xz * 0.2));
  hormigon = mix(hormigon * vec3(0.62, 0.68, 0.6), hormigon, smoothstep(uNivelMax - 0.2, uNivelMax + 1.0, h));

  vec3 c = mix(orto, arenaMojada, playa);
  c = mix(c, hormigon, muro);
  // Fuera de la playa, donde no hay foto válida (fondo marino lejos de la costa), la arena del fondo.
  c = mix(c, arena, (1.0 - usarFoto) * (1.0 - playa) * (1.0 - muro) * (1.0 - smoothstep(0.3, 0.95, vMed)));

  // Sombra de contacto: al pie del muro y en el fondo de los canales (vOcl, de la malla).
  c *= 1.0 - vOcl * 0.38;

  // ---------- Luz ----------
  // Ondulaciones de la arena muy suaves, solo de cerca y solo en la seca (la mojada es lisa).
  vec3 nA = texture2D(uTexArenaN, vPos.xz / 30.0).xyz * 2.0 - 1.0;
  float fuerzaN = 0.35 * (1.0 - smoothstep(15.0, 120.0, d)) * playa * (1.0 - humedad);
  vec3 n = normalize(vNor + vec3(nA.x, 0.0, -nA.y) * fuerzaN);
  c *= luz(n, mix(mix(0.55, 0.45, usarFoto), 1.0, muro));

  // Arena mojada: brillo del cielo y del sol; la lámina recién descubierta, casi un espejo.
  vec3 v = normalize(cameraPosition - vPos);
  float fres = pow(1.0 - max(dot(n, v), 0.0), 5.0);
  vec3 r = reflect(-v, n);
  vec3 cielo = mix(uCieloHorizonte, uCieloCenit, pow(clamp(r.y, 0.0, 1.0), 0.6));
  float brillo = (humedad * 0.25 + lamina * 0.75) * playa;
  c = mix(c, cielo, brillo * (0.04 + 0.7 * fres));
  float sol = pow(max(dot(r, uDirBrillo), 0.0), mix(80.0, 700.0, lamina)) * step(0.0, uDirBrillo.y);
  c += uColorBrillo * sol * brillo * mix(0.3, 2.5, lamina);

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
