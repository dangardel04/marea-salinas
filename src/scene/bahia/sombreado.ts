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
varying vec2 vUv;
varying vec3 vPos;
varying vec3 vNor;
varying float vMed;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float ruido(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
// Suma de octavas que se apagan con la distancia (lo que sería más fino que un píxel, fuera).
float grano(vec2 p, float d) {
  float s = (ruido(p * 0.045) - 0.5) * 0.10;                                  // manchas de ~20 m
  s += (ruido(p * 0.4 + 3.1) - 0.5) * 0.07 * (1.0 - smoothstep(150.0, 400.0, d));  // ~2 m
  s += (ruido(p * 2.3 + 7.7) - 0.5) * 0.08 * (1.0 - smoothstep(25.0, 90.0, d));    // ~40 cm
  s += (ruido(p * 9.0 + 1.3) - 0.5) * 0.07 * (1.0 - smoothstep(6.0, 22.0, d));     // ~10 cm
  return s;
}

void main() {
  float h = vPos.y;
  float d = length(vPos - cameraPosition);
  vec3 orto = uTieneOrto > 0.5 ? texture2D(uOrto, uUv.xy + vUv * uUv.zw).rgb : uArenaSeca * 0.7;

  // ---------- Arena dibujada (donde la foto no sirve) ----------
  // Donde el LiDAR no midió (la arena que cubre la marea) la ortofoto enseña el mar del día del
  // vuelo; y en la playa medida, a veces la espuma o el agua de aquel momento. Ahí se dibuja la
  // arena con el color medido en la propia ortofoto (tools/arena-color.py).
  float playa = 1.0 - smoothstep(5.0, 6.5, h);
  float fotoAgua = smoothstep(0.012, 0.05, orto.b - orto.r);
  float fotoEspuma = smoothstep(0.66, 0.82, min(orto.r, min(orto.g, orto.b)));
  float usarFoto = smoothstep(0.3, 0.95, vMed) * (1.0 - playa * max(fotoAgua, fotoEspuma));
  float g = grano(vPos.xz, d);
  vec3 arena = uArenaSeca * (1.0 + g);
  // Bajo el agua la arena se va apagando y verdeando con la profundidad (lo que se ve a través).
  float hondo = uNivel - h;
  vec3 fondo = mix(arena * vec3(0.62, 0.68, 0.64), vec3(0.03, 0.06, 0.07), smoothstep(0.5, 10.0, hondo));
  vec3 c = mix(mix(arena, fondo, smoothstep(0.0, 1.5, hondo)), orto, usarFoto);
  // De cerca la foto (0,4 m por píxel) se ve borrosa: en la arena pasa a la dibujada, con el tono
  // local de la foto (más clara u oscura) para que no cambie el color al acercarse.
  float cerca = (1.0 - smoothstep(18.0, 70.0, d)) * playa * usarFoto;
  float tono = clamp(dot(orto, vec3(0.333)) / max(dot(uArenaSeca, vec3(0.333)), 1e-3), 0.55, 1.35);
  c = mix(c, arena * mix(1.0, tono, 0.7), cerca * 0.85);
  c *= 1.0 + usarFoto * playa * g * 0.6 * (1.0 - cerca);

  // ---------- Humedad ----------
  // Lo que el agua ha cubierto en las últimas horas está mojado, más cuanto más reciente; justo
  // por encima de la orilla queda una lámina de agua que brilla.
  float rango = max(uNivelMax - uNivel, 0.25);
  float humedad = clamp((uNivelMax + 0.12 - h) / rango, 0.0, 1.0);
  humedad = max(pow(humedad, 0.6) * 0.85, 1.0 - smoothstep(uNivel, uNivel + 0.35, h));
  humedad *= playa;
  float lamina = (1.0 - smoothstep(uNivel + 0.02, uNivel + 0.45, h)) * playa;
  // La arena mojada oscurece a la mitad y se vuelve algo más fría y saturada.
  c = mix(c, c * vec3(0.46, 0.49, 0.5), humedad);

  // ---------- Luz ----------
  // Relieve fino solo en la normal (de cerca): da textura a la luz rasante.
  vec2 e = vec2(0.08, 0.0);
  float b0 = ruido(vPos.xz * 2.3 + 7.7), bx = ruido((vPos.xz + e.xy) * 2.3 + 7.7), bz = ruido((vPos.xz + e.yx) * 2.3 + 7.7);
  vec3 n = normalize(vNor + vec3(b0 - bx, 0.0, b0 - bz) * 0.9 * (1.0 - smoothstep(10.0, 45.0, d)) * playa);
  // La foto ya trae la luz del vuelo: relieve suave. La arena dibujada, igual, para que casen.
  c *= luz(n, mix(0.55, 0.4, usarFoto));

  // Arena mojada: refleja el cielo y el sol (Fresnel), mucho más donde aún hay lámina de agua.
  vec3 v = normalize(cameraPosition - vPos);
  float fres = pow(1.0 - max(dot(n, v), 0.0), 5.0);
  vec3 r = reflect(-v, n);
  vec3 cielo = mix(uCieloHorizonte, uCieloCenit, clamp(r.y * 1.6, 0.0, 1.0));
  float brillo = humedad * 0.25 + lamina * 0.75;
  c = mix(c, cielo, brillo * (0.04 + 0.6 * fres));
  float sol = pow(max(dot(r, uDirBrillo), 0.0), mix(40.0, 400.0, lamina)) * step(0.0, uDirBrillo.y);
  c += uColorBrillo * sol * brillo * mix(0.25, 2.0, lamina);

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
