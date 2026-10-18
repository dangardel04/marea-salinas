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
varying vec2 vUv;
varying vec3 vPos;
varying vec3 vNor;
varying float vMed;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float ruido(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}

void main() {
  float h = vPos.y;
  vec3 orto = uTieneOrto > 0.5 ? texture2D(uOrto, uUv.xy + vUv * uUv.zw).rgb : vec3(0.36, 0.34, 0.28);
  // Donde el LiDAR no midió (arena que cubre el mar, fondo): color procedural, no la foto,
  // que en esas zonas muestra el mar del día del vuelo.
  float grano = ruido(vPos.xz * 0.35) * 0.06 + ruido(vPos.xz * 0.05) * 0.08;
  vec3 arena = vec3(0.58, 0.47, 0.30) * (0.92 + grano);
  vec3 fondo = mix(vec3(0.34, 0.29, 0.20), vec3(0.05, 0.08, 0.09), smoothstep(-0.5, -14.0, h));
  vec3 proc = mix(fondo, arena, smoothstep(-1.5, 0.5, h));
  vec3 c = mix(proc, orto, smoothstep(0.3, 0.95, vMed));
  // Grano fino de cerca (la ortofoto da ~0,4 m por píxel): ruido que se desvanece a 60 m.
  float cerca = 1.0 - smoothstep(15.0, 60.0, length(vPos - cameraPosition));
  c *= 1.0 + cerca * ((ruido(vPos.xz * 6.0) - 0.5) * 0.16 + (ruido(vPos.xz * 1.7) - 0.5) * 0.1);

  // Arena mojada: lo que el agua ha cubierto en las últimas horas, más oscuro cuanto más reciente.
  float rango = max(uNivelMax - uNivel, 0.25);
  float humedad = clamp((uNivelMax + 0.12 - h) / rango, 0.0, 1.0);
  humedad = max(pow(humedad, 0.6) * 0.9, 1.0 - smoothstep(uNivel, uNivel + 0.35, h));
  humedad *= 1.0 - smoothstep(5.5, 7.5, h); // solo en la playa
  c *= mix(1.0, 0.58, humedad);

  c *= luz(vNor, 1.0 - vMed * 0.6);
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
  gl_FragColor = vec4(conNiebla(c, vPos), 1.0);
  #include <colorspace_fragment>
}
`;
