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

const AGUA_VERT = /* glsl */ `
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
  float k = PI2 / longitud(T, h);
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
  float rotura = 0.0, fase = -10.0, vaiven = 0.0;
  float prof = uNivel - fondo(p.xz);
  if (uLejos < 0.5) {
    float h = max(prof, 0.08);
    float tA, tB, alcA, alcB;
    sistema(uSisA, uCampoA, p.xz, h, desp, nrm, rotura, fase, tA, alcA);
    sistema(uSisB, uCampoB, p.xz, h, desp, nrm, rotura, fase, tB, alcB);
    // Orilla: setup y vaivén hasta R2 (solo en la franja de lavado).
    float franja = (1.0 - smoothstep(0.0, 1.6, prof)) * step(-uR2 - 0.3, prof) * alcA;
    float pulso = 0.5 + 0.5 * sin(PI2 / max(uSisA.y, 1.0) * (tA - uTiempo) + 0.8);
    vaiven = uR2 * pulso * pulso * franja;
    desp.y += uSetup * franja + vaiven;
    desp *= smoothstep(-uR2 - 0.3, 0.05, prof); // en seco solo queda el vaivén
  }
  p += desp;
  p.y += uNivel;
  vNormal = normalize(nrm);
  vRotura = rotura;
  vFase = fase;
  vVaiven = vaiven;
  vec4 m = modelMatrix * vec4(p, 1.0);
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

uniform float uLejos;
void main() {
  // El anillo de mar lejano no se dibuja dentro del cuadrado modelado (allí están los parches).
  if (uLejos > 0.5 && abs(vPos.x) < MEDIO && abs(vPos.z) < MEDIO) discard;
  float prof = vPos.y - fondo(vPos.xz);
  vec2 q = vPos.xz * 0.45;
  vec3 rizo = vec3(0.05 * cos(q.x * 1.7 + uTiempo * 1.3) + 0.035 * cos(q.x * 3.1 - q.y * 2.3 + uTiempo * 2.1), 0.0,
                   0.05 * cos(q.y * 1.9 + uTiempo * 1.1) + 0.035 * cos(q.y * 2.7 + q.x * 1.3 - uTiempo * 1.7));
  vec3 n = normalize(vNormal + rizo);
  vec3 v = normalize(cameraPosition - vPos);
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  vec3 r = reflect(-v, n);
  vec3 cielo = mix(uCieloHorizonte, uCieloCenit, clamp(r.y * 1.6, 0.0, 1.0));
  vec3 profundo = mix(vec3(0.008, 0.02, 0.035), vec3(0.015, 0.11, 0.16), uLuzDia);
  vec3 somero = mix(vec3(0.02, 0.05, 0.06), vec3(0.13, 0.33, 0.31), uLuzDia);
  vec3 agua = mix(somero, profundo, smoothstep(0.0, 9.0, prof));
  vec3 c = mix(agua, cielo, fres);
  c += uColorBrillo * pow(max(dot(r, uDirBrillo), 0.0), 260.0) * 3.0 * step(0.0, uDirBrillo.y);

  // Espuma: borde del agua (con el vaivén), crestas que rompen en la rompiente y estela del lavado.
  float patron = smoothstep(0.25, 0.75, ruido(vPos.xz * vec2(0.22, 0.3) + vec2(uTiempo * 0.12, uTiempo * 0.3)));
  float borde = 1.0 - smoothstep(0.0, 0.18 + 0.1 * patron, prof);
  float cresta = vRotura * smoothstep(0.35, 0.95, sin(vFase + 0.6)) * (0.55 + 0.45 * patron);
  float lavado = smoothstep(0.02, 0.4, vVaiven) * (1.0 - smoothstep(0.0, 0.5, prof)) * patron;
  float espumaRemanente = vRotura * 0.35 * patron;
  float espuma = clamp(max(max(borde * (0.6 + 0.4 * patron), cresta), max(lavado, espumaRemanente)), 0.0, 1.0);
  c = mix(c, vec3(0.9, 0.93, 0.94) * (0.18 + 0.82 * uLuzDia), espuma);

  // Lámina fina transparente para ver la arena mojada debajo.
  float alfa = max(mix(0.2, 0.96, smoothstep(0.0, 1.0, prof)), espuma * 0.92);
  float d = length(vPos - cameraPosition);
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
  };
  const base = new THREE.ShaderMaterial({
    vertexShader: AGUA_VERT, fragmentShader: AGUA_FRAG,
    uniforms: { ...u, uTesela: { value: new THREE.Vector3() }, uLejos: { value: 0 } },
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
      const mat = base.clone();
      // Los uniformes comunes se comparten por referencia; solo uTesela es propio.
      for (const [k, v] of Object.entries(u)) mat.uniforms[k] = v;
      mat.uniforms.uTesela = { value: new THREE.Vector3(x0, z0, lado) };
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
  const matLejos = base.clone();
  for (const [k, v] of Object.entries(u)) matLejos.uniforms[k] = v;
  matLejos.uniforms.uLejos = { value: 1 };
  matLejos.uniforms.uTesela = { value: new THREE.Vector3() };
  const lejos = new THREE.Mesh(anillo, matLejos);
  lejos.renderOrder = 1;
  opciones.escena.add(lejos);

  return {
    uniformes: u,
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
