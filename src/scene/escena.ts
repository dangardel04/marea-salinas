// Escena 3D de la playa de Salinas.
// Coordenadas: x a lo largo de la orilla (rumbo 57,8°), y altura en metros sobre el
// cero hidrográfico (CH) de Avilés, z hacia tierra (el mar queda en −z). Escala real, sin
// exagerar la vertical: la marea se ve sobre todo en cómo avanza y retrocede la orilla.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import meta from './terreno-meta.json';
import { NMMA_SOBRE_CH_APROX } from '../config';
import { estadoCielo, vectorEscena } from './astro';

export interface EstadoEscena {
  /** Instante simulado, ms UTC. */
  t: number;
  /** Nivel del mar ahora, m sobre el CH. */
  nivel: number;
  /** Nivel máximo de las últimas 6 horas, m sobre el CH (marca la arena mojada). */
  nivelMax6h: number;
}

const X_MIN = meta.u.min, X_MAX = meta.u.max; // a lo largo de la orilla, centrado
const V_MIN = meta.v.min, V_MAX = meta.v.max; // hacia el mar

const esMovil = () => matchMedia('(pointer: coarse)').matches || innerWidth < 768;

// ---------------- Shaders del agua ----------------
const AGUA_VERT = /* glsl */ `
uniform float uTiempo;
uniform float uNivel;
uniform sampler2D uRelieve;
uniform vec4 uLimites; // xMin, xMax, vMin, vMax
varying vec3 vPos;
varying float vProf;
varying vec3 vNormal;
varying float vCresta;

float relieve(vec2 xz) {
  vec2 uv = vec2((xz.x - uLimites.x) / (uLimites.y - uLimites.x), (-xz.y - uLimites.z) / (uLimites.w - uLimites.z));
  if (uv.y > 1.0) return -12.0; // mar abierto más allá del MDT
  return texture2D(uRelieve, clamp(uv, 0.0, 1.0)).r;
}

// Ola de Gerstner (GPU Gems 1, cap. 1): dirección d unitaria, longitud de onda L (m),
// amplitud a (m) y pendiente s = Q·k·a en [0, 1]. Acumula los términos de la normal en nrm.
vec3 gerstner(vec2 p, vec2 d, float L, float a, float s, inout vec3 nrm, inout float cresta) {
  float k = 6.2831853 / L;
  float w = sqrt(9.81 * k); // dispersión en aguas profundas
  float f = k * dot(d, p) - w * uTiempo;
  float sn = sin(f), cs = cos(f);
  float q = s / max(k * a, 1e-5);
  nrm.x -= d.x * k * a * cs;
  nrm.z -= d.y * k * a * cs;
  nrm.y -= q * k * a * sn;
  cresta += max(sn, 0.0) * s;
  return vec3(q * a * d.x * cs, a * sn, q * a * d.y * cs);
}

void main() {
  vec3 p = position;
  float fondo = relieve(p.xz);
  float prof = uNivel - fondo;
  // Las olas se atenúan al llegar a poca profundidad y casi desaparecen fuera del agua.
  float aten = clamp(prof / 3.0, 0.08, 1.0);
  vec3 nrm = vec3(0.0, 1.0, 0.0);
  float cresta = 0.0;
  vec3 desp = vec3(0.0);
  // Mar de fondo del NO entrando hacia la orilla (+z) y trenes secundarios. Oleaje DECORATIVO, no medido.
  desp += gerstner(p.xz, normalize(vec2(0.15, 1.0)), 62.0, 0.34 * aten, 0.45 * aten, nrm, cresta);
  desp += gerstner(p.xz, normalize(vec2(-0.25, 1.0)), 37.0, 0.18 * aten, 0.35 * aten, nrm, cresta);
  desp += gerstner(p.xz, normalize(vec2(0.4, 1.0)), 21.0, 0.08 * aten, 0.25 * aten, nrm, cresta);
  desp += gerstner(p.xz, normalize(vec2(-0.6, 1.0)), 11.0, 0.03 * aten, 0.15 * aten, nrm, cresta);
  p += desp;
  p.y += uNivel;
  vNormal = normalize(nrm);
  vCresta = cresta;
  vec4 mundo = modelMatrix * vec4(p, 1.0);
  vPos = mundo.xyz;
  vProf = uNivel - relieve(mundo.xz);
  gl_Position = projectionMatrix * viewMatrix * mundo;
}
`;

const AGUA_FRAG = /* glsl */ `
uniform float uTiempo;
uniform float uNivel;
uniform vec3 uDirSol;
uniform vec3 uColorSol;
uniform vec3 uCieloHorizonte;
uniform vec3 uCieloCenit;
uniform float uLuzDia;
uniform sampler2D uRelieve;
uniform vec4 uLimites;
uniform vec3 uColorNiebla;
uniform float uDensidadNiebla;
varying vec3 vPos;
varying float vProf;
varying vec3 vNormal;
varying float vCresta;

float relieve(vec2 xz) {
  vec2 uv = vec2((xz.x - uLimites.x) / (uLimites.y - uLimites.x), (-xz.y - uLimites.z) / (uLimites.w - uLimites.z));
  if (uv.y > 1.0) return -12.0;
  return texture2D(uRelieve, clamp(uv, 0.0, 1.0)).r;
}

// Ruido de valor 2D (dos octavas) para que la espuma no salga en cuadrícula.
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float ruidoValor(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float ruido(vec2 p) { return (ruidoValor(p) * 0.65 + ruidoValor(p * 2.7 + 13.1) * 0.35) * 2.0 - 1.0; }

void main() {
  float prof = uNivel - relieve(vPos.xz);
  // Rizos finos para el brillo (solo normal, no desplazan geometría).
  vec2 q = vPos.xz * 0.35;
  vec3 rizo = vec3(
    0.06 * cos(q.x * 1.7 + uTiempo * 1.3) + 0.04 * cos(q.x * 3.1 - q.y * 2.3 + uTiempo * 2.1),
    0.0,
    0.06 * cos(q.y * 1.9 + uTiempo * 1.1) + 0.04 * cos(q.y * 2.7 + q.x * 1.3 - uTiempo * 1.7));
  vec3 n = normalize(vNormal + rizo);
  vec3 v = normalize(cameraPosition - vPos);
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  vec3 r = reflect(-v, n);
  vec3 cielo = mix(uCieloHorizonte, uCieloCenit, clamp(r.y * 1.6, 0.0, 1.0));
  vec3 profundo = mix(vec3(0.01, 0.03, 0.05), vec3(0.02, 0.16, 0.22), uLuzDia);
  vec3 somero = mix(vec3(0.03, 0.07, 0.08), vec3(0.18, 0.42, 0.40), uLuzDia);
  vec3 agua = mix(somero, profundo, smoothstep(0.0, 6.0, prof));
  vec3 col = mix(agua, cielo, fres);
  float esp = pow(max(dot(r, uDirSol), 0.0), 220.0) * step(0.0, uDirSol.y);
  col += uColorSol * esp * 3.0;
  // Espuma: línea de orilla (poca profundidad, con vaivén) y crestas rompiendo en la rompiente.
  float vaiven = 0.12 * sin(uTiempo * 0.7 + vPos.x * 0.05) + 0.06 * sin(uTiempo * 1.9 + vPos.x * 0.13);
  float orilla = 1.0 - smoothstep(0.0, 0.22 + vaiven, prof);
  float rompiente = smoothstep(0.35, 0.65, vCresta) * (1.0 - smoothstep(1.0, 3.5, prof)) * step(0.15, prof);
  float patron = smoothstep(-0.35, 0.6, ruido(vPos.xz * vec2(0.35, 0.6) + vec2(uTiempo * 0.15, uTiempo * 0.4)));
  float espuma = clamp(max(orilla, rompiente) * patron, 0.0, 1.0);
  col = mix(col, vec3(0.92, 0.94, 0.95) * (0.25 + 0.75 * uLuzDia), espuma);
  // Transparencia en la lámina fina para que se vea la arena mojada debajo.
  float alfa = mix(0.25, 0.97, smoothstep(0.0, 1.2, prof));
  alfa = max(alfa, espuma * 0.9);
  // Niebla exponencial como la del resto de la escena.
  float d = length(vPos - cameraPosition);
  float niebla = 1.0 - exp(-uDensidadNiebla * uDensidadNiebla * d * d);
  col = mix(col, uColorNiebla, niebla);
  gl_FragColor = vec4(col, alfa);
  #include <colorspace_fragment>
}
`;

// ---------------- Paleta según la altura del sol ----------------
interface Paleta { horizonte: THREE.Color; cenit: THREE.Color; luzSol: THREE.Color; luzDia: number }
function paletaCielo(alturaSol: number): Paleta {
  // Puntos de control (grados de altura del sol). Valores estéticos, no físicos.
  const claves: [number, string, string, string][] = [
    [-18, '#05070d', '#020308', '#000000'],
    [-8, '#1b2238', '#070b18', '#2a2440'],
    [-2, '#c0705a', '#2a3556', '#ff8a5c'],
    [4, '#f0b27a', '#5b84b8', '#ffc58a'],
    [15, '#b9d3e6', '#4f8cc9', '#fff1dc'],
    [45, '#cfe2ef', '#3f7fc4', '#ffffff'],
  ];
  const a = THREE.MathUtils.clamp(alturaSol, claves[0][0], claves[claves.length - 1][0]);
  let i = 0;
  while (i < claves.length - 2 && a > claves[i + 1][0]) i++;
  const [a0, h0, c0, s0] = claves[i], [a1, h1, c1, s1] = claves[i + 1];
  const f = (a - a0) / (a1 - a0);
  return {
    horizonte: new THREE.Color(h0).lerp(new THREE.Color(h1), f),
    cenit: new THREE.Color(c0).lerp(new THREE.Color(c1), f),
    luzSol: new THREE.Color(s0).lerp(new THREE.Color(s1), f),
    luzDia: THREE.MathUtils.smoothstep(alturaSol, -10, 6),
  };
}

export async function crearEscena(lienzo: HTMLCanvasElement) {
  const movil = esMovil();
  const reducirMovimiento = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const render = new THREE.WebGLRenderer({ canvas: lienzo, antialias: !movil, powerPreference: 'high-performance' });
  render.setPixelRatio(Math.min(devicePixelRatio, movil ? 1.25 : 1.75));
  render.toneMapping = THREE.ACESFilmicToneMapping;
  render.outputColorSpace = THREE.SRGBColorSpace;

  const escena = new THREE.Scene();
  const camara = new THREE.PerspectiveCamera(50, 1, 1, 30000);
  camara.position.set(-210, 26, 190);

  const controles = new OrbitControls(camara, lienzo);
  controles.target.set(20, 1, 30);
  controles.enableDamping = true;
  controles.dampingFactor = 0.08;
  controles.minDistance = 25;
  controles.maxDistance = 900;
  controles.maxPolarAngle = THREE.MathUtils.degToRad(86);
  controles.minPolarAngle = THREE.MathUtils.degToRad(15);
  controles.screenSpacePanning = false;
  const limitesObjetivo = new THREE.Box3(new THREE.Vector3(X_MIN + 100, -2, -V_MAX + 40), new THREE.Vector3(X_MAX - 100, 15, -V_MIN - 60));

  // ---------- Relieve (MDT05 del IGN + pendiente genérica bajo el agua) ----------
  const bin = await fetch(`${import.meta.env.BASE_URL}terreno.bin`).then((r) => {
    if (!r.ok) throw new Error('No se pudo cargar terreno.bin');
    return r.arrayBuffer();
  });
  const cm = new Int16Array(bin);
  const nu = meta.nu, nv = meta.nv;
  const alturaCh = new Float32Array(nu * nv);
  for (let i = 0; i < cm.length; i++) alturaCh[i] = cm[i] / 100 + NMMA_SOBRE_CH_APROX;

  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(nu * nv * 3);
  const veg = new Float32Array(nu * nv);
  for (let a = 0; a < nu; a++) for (let b = 0; b < nv; b++) {
    const k = a * nv + b;
    pos[k * 3] = X_MIN + a * meta.paso;
    pos[k * 3 + 1] = alturaCh[k];
    pos[k * 3 + 2] = -(V_MIN + b * meta.paso);
    // Vegetación de duna: zonas altas del MDT, con algo de ruido para que no sea una franja lisa.
    const hN = cm[k] / 100;
    const r = Math.sin(a * 0.37) * Math.cos(b * 0.53) * 0.8 + Math.sin(a * 1.3 + b * 0.7) * 0.4;
    veg[k] = THREE.MathUtils.smoothstep(hN + r, 6.0, 8.5);
  }
  const idx: number[] = [];
  for (let a = 0; a < nu - 1; a++) for (let b = 0; b < nv - 1; b++) {
    const k = a * nv + b;
    // Sentido antihorario visto desde arriba (z crece hacia tierra, v hacia el mar).
    idx.push(k, k + nv, k + 1, k + 1, k + nv, k + nv + 1);
  }
  geo.setIndex(idx);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aVeg', new THREE.BufferAttribute(veg, 1));
  geo.computeVertexNormals();

  const uniformesArena = {
    uNivel: { value: 0 },
    uNivelMax: { value: 0 },
  };
  const arena = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
  arena.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniformesArena);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aVeg;\nvarying float vVeg;\nvarying float vAlt;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvVeg = aVeg;\nvAlt = position.y;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNivel;\nuniform float uNivelMax;\nvarying float vVeg;\nvarying float vAlt;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 seca = vec3(0.93, 0.79, 0.55);
        vec3 mojada = vec3(0.34, 0.26, 0.17);
        vec3 hierba = vec3(0.42, 0.47, 0.27);
        // Arena mojada: lo que el agua ha cubierto en las últimas horas; más oscura cuanto más reciente.
        float rango = max(uNivelMax - uNivel, 0.25);
        float humedad = clamp((uNivelMax + 0.12 - vAlt) / rango, 0.0, 1.0);
        humedad = max(pow(humedad, 0.6) * 0.9, 1.0 - smoothstep(uNivel, uNivel + 0.35, vAlt));
        vec3 c = mix(seca, mojada, humedad);
        c = mix(c, hierba, vVeg * (1.0 - humedad));
        diffuseColor.rgb = c;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(0.95, 0.35, clamp(1.0 - smoothstep(uNivel, uNivel + 0.6, vAlt), 0.0, 1.0));`);
  };
  const terreno = new THREE.Mesh(geo, arena);
  escena.add(terreno);

  // Textura de relieve para que el agua sepa su profundidad en cada punto.
  const datos = new Float32Array(nu * nv);
  for (let a = 0; a < nu; a++) for (let b = 0; b < nv; b++) datos[b * nu + a] = alturaCh[a * nv + b];
  const texRelieve = new THREE.DataTexture(datos, nu, nv, THREE.RedFormat, THREE.FloatType);
  texRelieve.magFilter = THREE.LinearFilter;
  texRelieve.minFilter = THREE.LinearFilter;
  texRelieve.needsUpdate = true;
  // Si el móvil no admite filtrado lineal de float, se queda en «nearest» (bordes algo más duros).
  if (!render.extensions.has('OES_texture_float_linear')) texRelieve.magFilter = texRelieve.minFilter = THREE.NearestFilter;

  // ---------- Agua ----------
  const seg = movil ? 110 : 190;
  const geoAgua = new THREE.PlaneGeometry(X_MAX - X_MIN + 400, 1500, seg, seg);
  geoAgua.rotateX(-Math.PI / 2);
  geoAgua.translate(0, 0, -(1500 / 2) + 480);
  const uniformesAgua = {
    uTiempo: { value: 0 },
    uNivel: { value: 0 },
    uRelieve: { value: texRelieve },
    uLimites: { value: new THREE.Vector4(X_MIN, X_MAX, V_MIN, V_MAX) },
    uDirSol: { value: new THREE.Vector3(0, 1, 0) },
    uColorSol: { value: new THREE.Color() },
    uCieloHorizonte: { value: new THREE.Color() },
    uCieloCenit: { value: new THREE.Color() },
    uLuzDia: { value: 1 },
    uColorNiebla: { value: new THREE.Color() },
    uDensidadNiebla: { value: 0.00045 },
  };
  const matAgua = new THREE.ShaderMaterial({
    vertexShader: AGUA_VERT, fragmentShader: AGUA_FRAG, uniforms: uniformesAgua,
    transparent: true, depthWrite: false,
  });
  const agua = new THREE.Mesh(geoAgua, matAgua);
  agua.renderOrder = 1;
  escena.add(agua);

  // Mar lejano hasta el horizonte (sin olas, misma sombra).
  const geoLejos = new THREE.RingGeometry(800, 14000, 64, 1);
  geoLejos.rotateX(-Math.PI / 2);
  const lejos = new THREE.Mesh(geoLejos, matAgua);
  lejos.position.z = -500;
  escena.add(lejos);

  // ---------- Cielo, sol, luna y estrellas ----------
  const cielo = new Sky();
  cielo.scale.setScalar(20000);
  escena.add(cielo);
  const uc = cielo.material.uniforms;
  uc.turbidity.value = 4;
  uc.rayleigh.value = 1.4;
  uc.mieCoefficient.value = 0.004;
  uc.mieDirectionalG.value = 0.85;

  // Cúpula de degradado para crepúsculo y noche (Preetham se apaga cuando el sol baja del horizonte).
  const uniformesCupula = {
    uHorizonte: { value: new THREE.Color() }, uCenit: { value: new THREE.Color() },
    uSol: { value: new THREE.Vector3() }, uColorSol: { value: new THREE.Color() }, uOpacidad: { value: 0 },
  };
  const cupula = new THREE.Mesh(
    new THREE.SphereGeometry(15000, 32, 16),
    new THREE.ShaderMaterial({
      uniforms: uniformesCupula, side: THREE.BackSide, transparent: true, depthWrite: false, fog: false,
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 uHorizonte; uniform vec3 uCenit; uniform vec3 uSol; uniform vec3 uColorSol; uniform float uOpacidad; varying vec3 vDir;
        void main(){
          vec3 d = normalize(vDir);
          vec3 c = mix(uHorizonte, uCenit, pow(clamp(d.y, 0.0, 1.0), 0.45));
          float halo = pow(max(dot(d, normalize(uSol)), 0.0), 6.0) * (1.0 - clamp(d.y * 3.0, 0.0, 1.0));
          c += uColorSol * halo * 0.6;
          gl_FragColor = vec4(c, uOpacidad);
          #include <colorspace_fragment>
        }`,
    }),
  );
  cupula.renderOrder = -2;
  escena.add(cupula);

  const estrellasGeo = new THREE.BufferGeometry();
  const nEstrellas = movil ? 900 : 1800;
  const pe = new Float32Array(nEstrellas * 3);
  // Distribución uniforme en la semiesfera (posiciones decorativas, no un catálogo real).
  let semilla = 7;
  const azar = () => ((semilla = (semilla * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < nEstrellas; i++) {
    const z = azar() * 0.98 + 0.02, fi = azar() * Math.PI * 2, r = Math.sqrt(1 - z * z);
    pe.set([r * Math.cos(fi) * 9000, z * 9000, r * Math.sin(fi) * 9000], i * 3);
  }
  estrellasGeo.setAttribute('position', new THREE.BufferAttribute(pe, 3));
  const matEstrellas = new THREE.PointsMaterial({ color: 0xdfe8ff, size: movil ? 1.6 : 1.3, sizeAttenuation: false, transparent: true, depthWrite: false, fog: false });
  const estrellas = new THREE.Points(estrellasGeo, matEstrellas);
  escena.add(estrellas);

  // Luna: esfera iluminada por la dirección real del sol, así la fase sale sola.
  const uniformesLuna = { uDirSol: { value: new THREE.Vector3() }, uVisible: { value: 1 } };
  const luna = new THREE.Mesh(
    new THREE.SphereGeometry(1, 48, 24),
    new THREE.ShaderMaterial({
      uniforms: uniformesLuna, transparent: true, depthWrite: false, fog: false,
      vertexShader: `varying vec3 vN; void main(){ vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 uDirSol; uniform float uVisible; varying vec3 vN;
        void main(){ float l = dot(normalize(vN), uDirSol);
          // El disco lunar tiene brillo casi uniforme (no lambertiano): terminador nítido.
          vec3 c = vec3(0.92, 0.91, 0.86) * smoothstep(-0.02, 0.05, l) + vec3(0.025, 0.03, 0.045);
          gl_FragColor = vec4(c, uVisible); }`,
    }),
  );
  const DIST_LUNA = 9000;
  // Diámetro aparente real ≈ 0,52°; se dibuja 3 veces mayor para que se distinga la fase (exagerado a propósito).
  luna.scale.setScalar(Math.tan(THREE.MathUtils.degToRad(0.26 * 3)) * DIST_LUNA);
  luna.renderOrder = -1;
  escena.add(luna);

  // ---------- Luces ----------
  const luzSol = new THREE.DirectionalLight(0xffffff, 2);
  escena.add(luzSol);
  const luzLuna = new THREE.DirectionalLight(0x9fb4d8, 0);
  escena.add(luzLuna);
  const luzCielo = new THREE.HemisphereLight(0xbfd8f0, 0x6b5a40, 0.6);
  escena.add(luzCielo);
  escena.fog = new THREE.FogExp2(0xcfe2ef, 0.00045);

  // ---------- Estado ----------
  const reloj = new THREE.Clock();
  let tiempoOlas = 0;
  let estado: EstadoEscena = { t: Date.now(), nivel: 2.5, nivelMax6h: 2.5 };
  let ultimoCielo = -Infinity;

  function actualizarCielo(t: number) {
    const c = estadoCielo(t);
    const vSol = new THREE.Vector3(...vectorEscena(c.sol));
    const vLuna = new THREE.Vector3(...vectorEscena(c.luna));
    uc.sunPosition.value.copy(vSol);
    const p = paletaCielo(c.sol.altura);
    render.toneMappingExposure = THREE.MathUtils.lerp(0.32, 0.68, p.luzDia);
    luzSol.position.copy(vSol).multiplyScalar(500);
    luzSol.color.copy(p.luzSol);
    luzSol.intensity = 2.6 * THREE.MathUtils.smoothstep(c.sol.altura, -1, 8);
    const noche = 1 - p.luzDia;
    const lunaArriba = THREE.MathUtils.smoothstep(c.luna.altura, -2, 3);
    luzLuna.position.copy(vLuna).multiplyScalar(500);
    luzLuna.intensity = 0.55 * noche * lunaArriba * c.luna.fraccion;
    luzCielo.intensity = 0.14 + 0.7 * p.luzDia;
    luzCielo.color.copy(p.cenit).lerp(new THREE.Color(0xffffff), 0.75);
    matEstrellas.opacity = THREE.MathUtils.smoothstep(noche, 0.55, 0.95);
    luna.position.copy(vLuna).multiplyScalar(DIST_LUNA);
    luna.lookAt(0, 0, 0);
    uniformesLuna.uDirSol.value.copy(vSol);
    uniformesLuna.uVisible.value = lunaArriba * THREE.MathUtils.lerp(0.35, 1, noche);
    uniformesAgua.uDirSol.value.copy(c.luna.altura > 0 && noche > 0.6 ? vLuna : vSol);
    uniformesAgua.uColorSol.value.copy(noche > 0.6 ? new THREE.Color(0x8fa4c8).multiplyScalar(c.luna.fraccion * lunaArriba) : p.luzSol);
    uniformesAgua.uCieloHorizonte.value.copy(p.horizonte);
    uniformesAgua.uCieloCenit.value.copy(p.cenit);
    uniformesAgua.uLuzDia.value = p.luzDia;
    uniformesAgua.uColorNiebla.value.copy(p.horizonte);
    (escena.fog as THREE.FogExp2).color.copy(p.horizonte);
    // Con el sol bajo, la cúpula de degradado sustituye poco a poco al cielo de Preetham.
    const relevo = 1 - THREE.MathUtils.smoothstep(c.sol.altura, -1, 5);
    uniformesCupula.uOpacidad.value = relevo;
    uniformesCupula.uHorizonte.value.copy(p.horizonte);
    uniformesCupula.uCenit.value.copy(p.cenit);
    uniformesCupula.uSol.value.copy(vSol);
    uniformesCupula.uColorSol.value.copy(p.luzSol).multiplyScalar(p.luzDia);
    cielo.visible = relevo < 0.999;
    escena.background = p.cenit.clone();
  }

  function ajustarTamano() {
    const w = lienzo.clientWidth, h = lienzo.clientHeight;
    if (!w || !h) return;
    render.setSize(w, h, false);
    camara.aspect = w / h;
    camara.updateProjectionMatrix();
  }
  const observador = new ResizeObserver(ajustarTamano);
  observador.observe(lienzo);
  ajustarTamano();

  // Acceso para depurar desde la consola, solo en desarrollo.
  if (import.meta.env.DEV) Object.assign(globalThis, { __escena: { escena, camara, controles, terreno, agua, uniformesAgua, uniformesArena } });

  let activo = true;
  function cuadro() {
    if (!activo) return;
    const dt = Math.min(reloj.getDelta(), 0.1);
    if (!reducirMovimiento) tiempoOlas += dt;
    controles.update();
    controles.target.clamp(limitesObjetivo.min, limitesObjetivo.max);
    uniformesAgua.uTiempo.value = tiempoOlas;
    uniformesAgua.uNivel.value = estado.nivel;
    uniformesArena.uNivel.value = estado.nivel;
    uniformesArena.uNivelMax.value = estado.nivelMax6h;
    // El cielo cambia despacio: basta recalcularlo cuando el reloj simulado avanza un minuto.
    if (Math.abs(estado.t - ultimoCielo) > 60_000) { actualizarCielo(estado.t); ultimoCielo = estado.t; }
    render.render(escena, camara);
    requestAnimationFrame(cuadro);
  }
  requestAnimationFrame(cuadro);

  return {
    actualizar(e: EstadoEscena) { estado = e; },
    destruir() {
      activo = false;
      observador.disconnect();
      controles.dispose();
      render.dispose();
    },
  };
}
