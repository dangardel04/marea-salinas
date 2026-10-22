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
import { AJUSTE_GLSL } from './orilla';
import { ZONA_GLSL } from './zona';

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
${AJUSTE_GLSL}
attribute float medido;
attribute float oclusion;
varying vec2 vUv;
varying vec3 vPos;
varying vec3 vNor;
varying float vMed;
varying float vOcl;
varying float vAjuste;
void main() {
  vUv = uv;
  vMed = medido;
  vOcl = oclusion;
  vNor = normal;
  vec4 m = modelMatrix * vec4(position, 1.0);
  // La arena de la orilla, subida o bajada para que el agua corte donde la medida (orilla.ts).
  vAjuste = ajusteOrilla(m.xz);
  m.y += vAjuste;
  vPos = m.xyz;
  gl_Position = projectionMatrix * viewMatrix * m;
}
`;

export const TERRENO_FRAG = /* glsl */ `
${COMUNES}
${ZONA_GLSL}
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
uniform vec4 uZonaEdif;           // x, z, radio y transición de la zona mejorada del Club Náutico (zonaMejorada.ts)
uniform float uSetup;
varying vec2 vUv;
varying vec3 vPos;
varying vec3 vNor;
varying float vMed;
varying float vOcl;
varying float vAjuste;

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

/** Piedra de muro de contención (sillares de 0,5 m de alto y 0,9–1,6 m de largo) para las laderas muy
 *  inclinadas de la zona mejorada: la foto aérea estirada sobre un escalón del terreno se veía
 *  como un manchón borroso. DECORATIVO. uv = (m a lo largo de la curva de nivel, altura). */
vec3 piedraMuro(vec2 uv, float d) {
  float fila = floor(uv.y / 0.5);
  float largo = 0.9 + 0.7 * hash(vec2(fila, 2.0));
  float uu = uv.x / largo + hash(vec2(fila, 7.0));
  float du = (0.5 - abs(fract(uu) - 0.5)) * largo, dv = (0.5 - abs(fract(uv.y / 0.5) - 0.5)) * 0.5;
  vec3 c = mix(vec3(0.46, 0.4, 0.31), vec3(0.62, 0.56, 0.45), hash(vec2(floor(uu), fila))) * (0.88 + 0.24 * fbm(uv * 3.0));
  float junta = 1.0 - smoothstep(0.004, 0.02 + fwidth(uv.y) * 1.5, min(du, dv));
  return mix(c, vec3(0.3, 0.27, 0.23), junta * 0.6 * (1.0 - smoothstep(40.0, 150.0, d)));
}

void main() {
  float h = vPos.y;
  float d = length(vPos - cameraPosition);
  vec3 orto = uTieneOrto > 0.5 ? texture2D(uOrto, uUv.xy + vUv * uUv.zw).rgb : uArenaSeca * 0.7;
  float pendiente = 1.0 - vNor.y; // 0 llano, 1 vertical
  // Zona del Club Náutico: de cerca la foto (0,2 m/píxel) se ve borrosa; el césped (lo verde de la
  // foto) lleva hojas y manchas propias, y el suelo duro un grano fino. El color sigue siendo el de la
  // foto; el dibujo fino es DECORATIVO.
  float cercaClub = (1.0 - smoothstep(uZonaEdif.z - uZonaEdif.w, uZonaEdif.z, length(vPos.xz - uZonaEdif.xy))) * (1.0 - smoothstep(35.0, 150.0, d)) * uTieneOrto;
  if (cercaClub > 0.01) {
    float verde = smoothstep(0.015, 0.06, orto.g - max(orto.r, orto.b));
    float hojas = ruido(vPos.xz * 24.0) * 0.55 + ruido(vPos.xz * 61.0) * 0.45;
    vec3 cesped = orto * (0.74 + 0.5 * hojas) * (0.9 + 0.2 * fbm(vPos.xz * 0.7));
    vec3 duro = orto * (0.93 + 0.14 * ruido(vPos.xz * 33.0)) * (0.97 + 0.06 * fbm(vPos.xz * 2.0));
    orto = mix(orto, mix(duro, cesped, verde), cercaClub);
  }

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
  // (borde irregular, como lo deja el agua al secarse, no una curva de nivel)
  float mojada = 1.0 - smoothstep(rango + 0.08 - aa, rango + 0.08 + aa, h - uNivel + (fbm(vPos.xz * 0.12) - 0.5) * 0.16);
  // Empapada: la franja que lava el vaivén de las olas ahora (hasta el nivel + setup + R2) y un
  // poco más; transición suave. Con la cota de rebose (no la altura), así las hondonadas detrás de
  // un caballón no salen como manchas oscuras.
  float cotaMar = max(h, texture2D(uFondoAgua, uvP).g + vAjuste);
  float lavado = uSetup + uR2 + 0.08;
  float empapada = 1.0 - smoothstep(lavado - 0.06, lavado + 0.14, cotaMar - uNivel);
  // Grano y dibujo de la arena: fotos escaneadas (Poly Haven, CC0). Solo se usa su variación
  // relativa (la foto dividida por su color medio, el último mip), así el color sigue siendo el
  // elegido: la seca, la foto aérea de 30 m (huellas, marcas del viento); la mojada, la de 1,87 m.
  float mezclaT = fbm(vPos.xz * 0.04);
  vec3 fSeca = muestraArena(uTexArena, vPos.xz, mezclaT).rgb / max(textureLod(uTexArena, vec2(0.5), 12.0).rgb, vec3(0.02));
  vec3 fMoj = mix(texture2D(uTexMojada, vPos.xz / 1.87).rgb, texture2D(uTexMojada, GIRO * vPos.xz / 1.43 + 0.31).rgb, mezclaT)
            / max(textureLod(uTexMojada, vec2(0.5), 12.0).rgb, vec3(0.02));
  float verSeca = 0.6 * (1.0 - smoothstep(250.0, 900.0, d));
  float verMoj = 0.5 * (1.0 - smoothstep(12.0, 70.0, d));
  arenaSeca *= mix(vec3(1.0), clamp(fSeca, 0.45, 1.7), verSeca);
  arenaHumeda *= mix(vec3(1.0), clamp(mix(fSeca, fMoj, 0.6), 0.45, 1.7), max(verMoj, verSeca * 0.6));
  arenaEmpapada *= mix(vec3(1.0), clamp(fMoj, 0.45, 1.7), verMoj);
  vec3 arena = mix(arenaSeca, arenaHumeda, mojada);
  arena = mix(arena, arenaEmpapada, empapada);
  // Línea de la última pleamar: algas y restos que deja el mar en lo más alto (el dibujo es
  // DECORATIVO; la altura es la de la pleamar de las últimas 6 h más la subida de las olas).
  float cotaAlga = uNivelMax + uSetup + uR2 * 0.7;
  float dAlga = abs(h - cotaAlga + (fbm(vPos.xz * 0.07) - 0.5) * 0.3);
  float alga = (1.0 - smoothstep(0.02, 0.09 + fwidth(h) * 2.0, dAlga)) * smoothstep(0.42, 0.68, fbm(vPos.xz * 0.9 + 3.3));
  arena = mix(arena, vec3(0.11, 0.095, 0.06), alga * 0.8);
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
  // Zona mejorada: las laderas muy inclinadas, de piedra (no foto estirada)
  float zEd = (1.0 - smoothstep(uZonaEdif.z - uZonaEdif.w, uZonaEdif.z, length(vPos.xz - uZonaEdif.xy))) * (1.0 - smoothstep(60.0, 220.0, d));
  float muroZ = zEd * smoothstep(0.3, 0.45, pendiente) * (1.0 - playa);
  if (muroZ > 0.01) c = mix(c, piedraMuro(vec2(dot(vPos.xz, normalize(vec2(-vNor.z, vNor.x) + vec2(1e-5))), vPos.y), d), muroZ);
  // Fuera de la playa, donde no hay foto válida (fondo lejos de la costa), arena oscura del fondo.
  c = mix(c, arenaEmpapada * 0.6, (1.0 - usarFoto) * (1.0 - playa) * (1.0 - muro) * (1.0 - smoothstep(0.3, 0.95, vMed)));

  // ---------- Luz ----------
  vec3 n = normalize(vNor);
  vec3 v = normalize(cameraPosition - vPos);
  // Relieve fino de la arena (solo en la playa): normales de las fotos y, en lo que cubre la
  // marea, ripples (las marcas de las olas, de ~12 cm y ~70 cm) paralelos a la orilla. DECORATIVO.
  if (playa > 0.01) {
    vec3 tnS = texture2D(uTexArenaN, vPos.xz / 30.0).xyz * 2.0 - 1.0;
    vec3 tnM = texture2D(uTexMojadaN, vPos.xz / 1.87).xyz * 2.0 - 1.0;
    vec2 pert = tnS.xy * 0.55 * (1.0 - smoothstep(60.0, 400.0, d))
              + tnM.xy * 0.6 * (1.0 - smoothstep(6.0, 35.0, d)) * max(mojada, 0.35);
    float o2 = 1.0 / 1281.0;
    vec2 gF = vec2(texture2D(uFondoAgua, uvP + vec2(o2, 0.0)).r - texture2D(uFondoAgua, uvP - vec2(o2, 0.0)).r,
                   texture2D(uFondoAgua, uvP + vec2(0.0, o2)).r - texture2D(uFondoAgua, uvP - vec2(0.0, o2)).r);
    vec2 baja = -gF / max(length(gF), 1e-4);
    float sx = dot(vPos.xz, baja);
    float fase1 = sx * 52.0 + fbm(vPos.xz * 0.5) * 9.0;           // λ ≈ 0,12 m
    float fase2 = sx * 9.0 + fbm(vPos.xz * 0.15 + 2.0) * 7.0;     // λ ≈ 0,7 m
    float rip = cos(fase1) * 0.38 * (1.0 - smoothstep(4.0, 16.0, d)) + cos(fase2) * 0.2 * (1.0 - smoothstep(10.0, 50.0, d));
    pert += baja * rip * mojada * (1.0 - empapada * 0.6);
    n = normalize(n + vec3(pert.x, 0.0, pert.y) * playa);
  }
  float estilo = max(playa, muro);
  // (el mapa de sombras tiene la arena sin el ajuste de la orilla)
  float sSol = sombra(vPos - vec3(0.0, vAjuste, 0.0), n);
  // Oclusión de contacto (al pie del muro, en los pliegues), suave.
  float ao = 1.0 - smoothstep(0.12, 0.75, vOcl) * 0.5;
  // Arena: seca, mate (rugosidad 0,9); húmeda de la marea, 0,6; empapada por el vaivén, la
  // película de agua la hace lisa (0,2): brilla y refleja el cielo.
  // junto al agua, una película fina: casi un espejo (0,06 en el centro de la franja)
  float rug = mix(mix(0.9, 0.6, mojada), 0.2, empapada);
  rug = mix(rug, 0.06, empapada * empapada);
  rug = mix(rug, 0.88, muro);
  float f0 = mix(0.03, 0.02, empapada);
  vec3 dibujado = iluminar(c, n, v, rug, f0, sSol, ao);
  // Chispas del sol en el grano seco, de cerca (cuarzo y mica). DECORATIVO.
  if (d < 30.0 && playa > 0.5) {
    vec2 celda = floor(vPos.xz * 40.0);
    vec3 nG = normalize(vec3(hash(celda + 1.7) - 0.5, 0.9, hash(celda + 3.1) - 0.5));
    float chispa = step(0.993, hash(celda)) * pow(max(dot(nG, normalize(uDirSol + v)), 0.0), 400.0);
    dibujado += uColorSol * uLuzSol * chispa * 5.0 * (1.0 - smoothstep(10.0, 30.0, d)) * sSol * (1.0 - mojada);
  }
  // La foto ya trae su luz: se escala con la de ahora y con las sombras (a medias, que la foto
  // tiene las suyas del día del vuelo, más cortas o largas según la hora).
  vec3 foto = c * luz(n, mix(0.55, 0.45, usarFoto), mix(1.0, sSol, 0.85)) * mix(1.0, ao, 0.5);
  c = mix(foto, dibujado, estilo);
  // Fuera de la playa y lo cercano al paseo, la tierra se funde en la bruma (zona.ts).
  c = mix(c, uColorNiebla, brumaZona(vPos.xz) * smoothstep(0.5, 2.5, h - vAjuste));

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
${ZONA_GLSL}
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
  c = mix(c, uColorNiebla, brumaZona(vPos.xz));
  gl_FragColor = vec4(conNiebla(c, vPos), 1.0);
  #include <colorspace_fragment>
}
`;

/** Edificios limpios (tools/edificios-limpios.ts): huella del Catastro, alturas del LiDAR, tejado recto. */
export const EDIFICIOS_LIMPIOS_VERT = /* glsl */ `
attribute vec3 color;
attribute vec3 fachadaUv;   // u (m a lo largo del tramo), v (m sobre el suelo), largo del tramo (m)
attribute vec3 datos;       // tipo (0 fachada, 1 tejado, 2 pretil), altura de planta (m), plantas
varying vec3 vColor;
varying vec3 vPos;
varying vec3 vNor;
varying vec3 vUvF;
varying vec3 vDatos;
void main() {
  vColor = color; vUvF = fachadaUv; vDatos = datos; vNor = normal;
  vec4 m = modelMatrix * vec4(position, 1.0);
  vPos = m.xyz;
  gl_Position = projectionMatrix * viewMatrix * m;
}
`;

export const EDIFICIOS_LIMPIOS_FRAG = /* glsl */ `
${COMUNES}
${ZONA_GLSL}
varying vec3 vColor;
varying vec3 vPos;
varying vec3 vNor;
varying vec3 vUvF;
varying vec3 vDatos;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y);
}
/** Caja con bordes suaves: 1 dentro de [a, b] (en cada eje), con transición de ancho w. */
float caja(vec2 p, vec2 a, vec2 b, vec2 w) {
  vec2 s = smoothstep(a - w, a + w, p) * (1.0 - smoothstep(b - w, b + w, p));
  return s.x * s.y;
}
void main() {
  vec3 n = normalize(vNor) * (gl_FrontFacing ? 1.0 : -1.0);
  vec3 v = normalize(cameraPosition - vPos);
  float dcam = length(vPos - cameraPosition);
  // (los enteros llegan interpolados, con algo de error: se redondean)
  float tipo = floor(vDatos.x + 0.5);
  float alturaPlanta = clamp(vDatos.y, 2.6, 4.5), plantas = max(floor(vDatos.z + 0.5), 1.0);
  vec3 albedo = vColor;
  float rug = 0.85, f0 = 0.04, ao = 1.0, cristalLuz = 0.0;
  vec2 celdaLuz = vec2(0.0);

  if (tipo < 0.5) {
    // ---- Fachada: ventanas por planta y repartidas a lo ancho de cada tramo (DECORATIVO: el
    // Catastro da las plantas, no los huecos). Enfoscado con grano, chorreones, zócalo e imposta.
    float u = vUvF.x, y = vUvF.y, largo = vUvF.z;
    float nCol = floor(largo / 2.8);
    float paso = largo / max(nCol, 1.0);
    float col = floor(u / paso), fx = fract(u / paso) * paso;            // m dentro de la columna
    float piso = floor(y / alturaPlanta), fy = y - piso * alturaPlanta;  // m dentro de la planta
    float hay = step(0.5, nCol) * step(0.0, y) * step(piso, plantas - 0.5);
    float ancho = min(1.25, paso * 0.5), x0 = (paso - ancho) * 0.5, x1 = x0 + ancho;
    float baja = 1.0 - step(0.5, piso);                                 // planta baja: huecos más altos
    float y0 = mix(0.9, 0.35, baja), y1 = min(alturaPlanta - 0.45, y0 + mix(1.45, 2.05, baja));
    float w = max(fwidth(u), 0.004) * 1.2;
    float cristal = caja(vec2(fx, fy), vec2(x0 + 0.07, y0 + 0.07), vec2(x1 - 0.07, y1 - 0.07), vec2(w)) * hay;
    float hueco = caja(vec2(fx, fy), vec2(x0, y0), vec2(x1, y1), vec2(w)) * hay;
    float marco = max(hueco - cristal, 0.0);
    float alfeizar = caja(vec2(fx, fy), vec2(x0 - 0.06, y0 - 0.07), vec2(x1 + 0.06, y0), vec2(w)) * hay * (1.0 - hueco) * (1.0 - baja);
    float hv = h21(vec2(col, piso) + floor(vPos.xz * 0.1));
    float persiana = step(hv, 0.22) * (1.0 - baja), cortina = step(0.58, hv) * (1.0 - persiana);
    // el hueco está metido: sombra en la parte de arriba del cristal (DECORATIVO)
    float sombraHueco = cristal * smoothstep(y1 - 0.3, y1 - 0.08, fy);
    // enfoscado
    vec3 pared = vColor * (0.9 + 0.18 * vnoise(vec2(u * 1.1, y * 0.9) + vColor.r * 40.0)) * (0.95 + 0.1 * vnoise(vec2(u, y) * 8.0));
    pared *= 1.0 - 0.14 * smoothstep(0.5, 0.9, vnoise(vec2(u * 3.0, y * 0.25))) * (1.0 - baja * 0.5);
    float imposta = (1.0 - smoothstep(0.0, 0.06, abs(fy - alturaPlanta + 0.03))) * step(1.5, plantas - piso);
    float zocalo = 1.0 - smoothstep(0.55, 0.6, y);
    pared = mix(pared, pared * 1.08, imposta);
    pared = mix(pared, pared * vec3(0.72, 0.7, 0.68), zocalo);
    // hueco: vidrio oscuro con montante, persiana de lamas o cortina clara al fondo
    // detalles finos (montante, lamas) solo si caben en la pantalla; si no, parpadean
    float nitido = 1.0 - smoothstep(0.015, 0.05, fwidth(fy));
    float montante = nitido * max(1.0 - smoothstep(0.02, 0.035, abs(fx - (x0 + x1) * 0.5)), 1.0 - smoothstep(0.02, 0.035, abs(fy - (y0 + (y1 - y0) * 0.62))));
    vec3 vidrio = mix(vec3(0.03, 0.045, 0.06), vec3(0.16, 0.14, 0.11), cortina * smoothstep(y1, y0, fy) * 0.8);
    vec3 lamas = vec3(0.2, 0.25, 0.22) * (0.9 + 0.1 * nitido * (2.0 * step(0.5, fract(fy * 14.0)) - 1.0));
    vec3 hv3 = mix(mix(vidrio, lamas, persiana), vec3(0.78, 0.78, 0.75), montante * (1.0 - persiana));
    vec3 aN = mix(pared, vec3(0.8, 0.8, 0.77), marco);
    aN = mix(aN, vec3(0.74, 0.72, 0.66), alfeizar);
    aN = mix(aN, hv3, cristal);
    // de lejos (huecos más finos que un píxel), el tono medio de la fachada
    float lejos = smoothstep(0.25, 0.6, fwidth(u) / max(paso, 0.5) * 4.0);
    vec3 medio = mix(pared, vec3(0.06, 0.07, 0.08), 0.18 * hay);
    albedo = mix(aN, medio, lejos);
    rug = mix(mix(0.9, 0.5, marco), mix(0.14, 0.65, persiana), cristal);   // (más liso daba destellos inestables del sol en el cristal)
    f0 = mix(0.04, 0.06, cristal);
    ao = mix(1.0, 0.8, hueco) * (1.0 - 0.5 * sombraHueco);
    cristalLuz = cristal * (1.0 - persiana) * (1.0 - lejos);
    celdaLuz = vec2(col, piso) + floor(vPos.xz * 0.1);
  } else if (tipo < 1.5) {
    // ---- Tejado: color medio de la nube en él (MEDIDO); tejas curvas en los de aguas, lámina y
    // grava en los planos (DECORATIVO)
    float inclinado = 1.0 - smoothstep(0.93, 0.98, n.y);
    vec2 dir = n.xz; float ld = length(dir);
    dir = ld > 0.05 ? dir / ld : vec2(1.0, 0.0);
    float s = dot(vPos.xz, dir) / max(n.y, 0.4) / 0.34;
    vec2 rc = vec2(dot(vPos.xz, vec2(-dir.y, dir.x)) / 0.26 + 0.5 * mod(floor(s), 2.0), s);
    vec2 ct = floor(rc), ft = fract(rc);
    float fin = 1.0 - smoothstep(30.0, 140.0, dcam);
    float teja = (0.84 + 0.2 * h21(ct)) * (1.0 - 0.3 * (1.0 - smoothstep(0.0, 0.14, ft.y)));
    vec3 aT = vColor * mix(1.0, teja, fin);
    vec3 aP = vColor * (0.9 + 0.2 * vnoise(vPos.xz * 3.0)) * (1.0 - 0.12 * (1.0 - smoothstep(0.0, 0.04, abs(fract(vPos.x / 1.0) - 0.5) - 0.46)) * fin);
    albedo = mix(aP, aT, inclinado);
    n = normalize(n + vec3(-dir.y, 0.0, dir.x) * 0.18 * sin(6.2831853 * ft.x) * inclinado * fin);
    rug = mix(0.92, 0.75, inclinado);
  } else {
    // ---- Pretil y su remate: enfoscado algo más claro
    albedo = vColor * 1.05;
    rug = 0.9;
  }

  vec3 c = iluminar(albedo, n, v, rug, f0, sombra(vPos, n), ao);
  // De noche, algunas ventanas encendidas al azar (DECORATIVO).
  float encendida = step(0.72, h21(celdaLuz + 3.3));
  c += vec3(1.0, 0.72, 0.38) * 2.6 * cristalLuz * encendida * smoothstep(0.5, 0.9, uNoche);
  c = mix(c, uColorNiebla, brumaZona(vPos.xz));
  gl_FragColor = vec4(conNiebla(c, vPos), 1.0);
  #include <colorspace_fragment>
}
`;
