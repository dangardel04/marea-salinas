// Escena 3D de toda la bahía de Salinas: terreno con ortofoto por niveles de detalle,
// edificios del Catastro, agua con oleaje propagado sobre el fondo, cielo con sol y luna reales.
// Coordenadas: ver src/bahia.ts (x este, y arriba sobre el CH, z sur).

import * as THREE from 'three';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';
import { LADO, PASO_RELIEVE } from '../../bahia';
import metaRelieve from '../bahia-meta.json';
import metaOrto from '../bahia-orto.json';
import metaEdificios from '../bahia-edificios.json';
import metaEdificiosLidar from '../bahia-edificios-lidar.json';
import metaFino from '../bahia-fino.json';
import metaArena from '../bahia-arena.json';
import metaPaseo from '../bahia-paseo.json';
import { crearPaseo, type PuntoMuro } from './paseo';
import { crearMedidaArena } from './arena';
import { crearSombras } from './sombras';
import { crearPostproceso } from './postproceso';
import { cargarFino, cargarRelieve } from './relieve';
import { crearTeselas } from './teselas';
import { cargarEdificios, cargarEdificiosLidar } from './edificios';
import { crearAgua } from './agua';
import { crearReflejo } from './reflejo';
import { calcularCampo, crearFondoAgua, PASO_CAMPO } from './campoOlas';
import { crearCielo } from './cielo';
import { siguienteCuadro } from '../../cuadro';
import type { EstadoMar } from '../../oleaje/datos';

export interface EstadoEscena {
  t: number;
  nivel: number;
  nivelMax6h: number;
  /** Oleaje en mar abierto (null si no hay datos: mar en calma). */
  mar: EstadoMar | null;
  /** Subida del agua por las olas (Stockdon): setup y R2, en m. */
  setup: number;
  r2: number;
}

export interface Vista { id: string; nombre: string; objetivo: [number, number]; rumbo: number; distancia: number; elevacion: number }

/** Vistas predefinidas (coordenadas locales; rumbo = hacia dónde mira la cámara). Los puntos de
 *  arena salen del polígono de la playa en OpenStreetMap (way 516073411). */
export const VISTAS: Vista[] = [
  { id: 'bahia', nombre: 'Bahía', objetivo: [100, 700], rumbo: 165, distancia: 3300, elevacion: 30 },
  { id: 'salinas', nombre: 'Salinas', objetivo: [-645, 1265], rumbo: 160, distancia: 520, elevacion: 20 },
  { id: 'espartal', nombre: 'El Espartal', objetivo: [-60, 1060], rumbo: 150, distancia: 520, elevacion: 18 },
  { id: 'sanjuan', nombre: 'San Juan', objetivo: [1030, 165], rumbo: 120, distancia: 520, elevacion: 20 },
  // A pie de playa: de pie en la arena alta de El Espartal (cota ≈ 3,6 m), mirando al mar.
  { id: 'pie', nombre: 'A pie de playa', objetivo: [-133, 1058], rumbo: 330, distancia: 70, elevacion: 2 },
];

const movilDetectado = () => matchMedia('(pointer: coarse)').matches || innerWidth < 768;

export async function crearEscenaBahia(lienzo: HTMLCanvasElement, alProgreso?: (texto: string) => void) {
  const movil = movilDetectado();
  const reducirMovimiento = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const render = new THREE.WebGLRenderer({ canvas: lienzo, antialias: !movil, powerPreference: 'high-performance' });
  // Resolución y tono los pone el postprocesado (crearPostproceso): ACES, como mucho 2× la de CSS.
  render.setPixelRatio(Math.min(devicePixelRatio, 2));
  render.outputColorSpace = THREE.SRGBColorSpace;

  const escena = new THREE.Scene();
  const camara = new THREE.PerspectiveCamera(48, 1, 1, 45000);
  const base = import.meta.env.BASE_URL;

  alProgreso?.('Cargando el relieve…');
  const relieve = await cargarRelieve(`${base}bahia/relieve.bin`);
  // Fondo del agua (rejilla de 5 m, con el relieve fino) y cota de rebose (hasta dónde llega el mar).
  const fondoAgua = crearFondoAgua(relieve);

  // ---------- Uniformes comunes ----------
  const comunes = {
    uDirSol: { value: new THREE.Vector3(0, 1, 0) },
    uColorSol: { value: new THREE.Color(1, 1, 1) },
    uLuzSol: { value: 0.6 },
    uAmbiente: { value: new THREE.Color(0.45, 0.45, 0.45) },
    uNivel: { value: 2.5 },
    uNivelMax: { value: 2.5 },
    uColorNiebla: { value: new THREE.Color() },
    uDensidadNiebla: { value: movil ? 0.00008 : 0.00006 },
    /** 0 de día, 1 de noche cerrada. */
    uNoche: { value: 0 },
  };
  const comunesAgua = {
    uTiempo: { value: 0 },
    uNivel: comunes.uNivel,
    uColorNiebla: comunes.uColorNiebla,
    uDensidadNiebla: comunes.uDensidadNiebla,
    uDirBrillo: { value: new THREE.Vector3(0, 1, 0) },
    uColorBrillo: { value: new THREE.Color() },
    uCieloHorizonte: { value: new THREE.Color() },
    uCieloCenit: { value: new THREE.Color() },
    uLuzDia: { value: 1 },
  };
  // El terreno también necesita el cielo y el brillo del sol (reflejo de la arena mojada) y el
  // color de la arena seca medido en la ortofoto (tools/arena-color.py, de sRGB a lineal).
  const [ar, ag, ab] = metaArena.secaSrgb;
  Object.assign(comunes, {
    uDirBrillo: comunesAgua.uDirBrillo, uColorBrillo: comunesAgua.uColorBrillo,
    uCieloHorizonte: comunesAgua.uCieloHorizonte, uCieloCenit: comunesAgua.uCieloCenit, uLuzDia: comunesAgua.uLuzDia,
    uArenaSeca: { value: new THREE.Color().setRGB(ar / 255, ag / 255, ab / 255, THREE.SRGBColorSpace) },
  });

  // ---------- Texturas fotográficas (Poly Haven, CC0; agua: three.js, MIT) ----------
  // Llegan después; mientras, unas neutras (gris medio y normal plana).
  const anisotropia = Math.min(8, render.capabilities.getMaxAnisotropy());
  const neutra = (r: number, g: number, b: number) => {
    const t = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1);
    t.needsUpdate = true;
    return t;
  };
  const cargadorTex = new THREE.TextureLoader();
  function textura(nombre: string, color: boolean, uniforme: THREE.IUniform) {
    cargadorTex.load(`${base}bahia/texturas/${nombre}`, (t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = anisotropia;
      uniforme.value = t;
    });
  }
  const texturas = {
    uTexArena: { value: neutra(128, 128, 128) as THREE.Texture },
    uTexArenaN: { value: neutra(128, 128, 255) as THREE.Texture },
    uTexArenaR: { value: neutra(200, 200, 200) as THREE.Texture },
    uTexMojada: { value: neutra(128, 128, 128) as THREE.Texture },
    uTexMojadaN: { value: neutra(128, 128, 255) as THREE.Texture },
  };
  Object.assign(comunes, texturas);
  // Sombras del sol y de la luna (sombras.ts): sus uniformes van con los comunes.
  const sombras = crearSombras(render, escena, movil ? 1024 : 2048);
  Object.assign(comunes, sombras.uniformes);
  let fuerzaSombra = 0;
  // Máscara de playa (OpenStreetMap, tools/playa-mascara.py): sin repetir, sin mipmaps.
  const uPlaya = { value: neutra(0, 0, 0) as THREE.Texture };
  Object.assign(comunes, { uPlaya, uFondoAgua: { value: fondoAgua.textura } });
  cargadorTex.load(`${base}bahia/playa.png`, (t) => {
    t.colorSpace = THREE.NoColorSpace; t.generateMipmaps = false;
    t.flipY = false; // filas de norte a sur, como la rejilla del relieve
    t.needsUpdate = true;
    t.minFilter = t.magFilter = THREE.LinearFilter;
    uPlaya.value = t;
  });
  textura('aerial_beach_01_diff_1k.jpg', true, texturas.uTexArena);
  textura('aerial_beach_01_nor_gl_1k.jpg', false, texturas.uTexArenaN);
  textura('aerial_beach_01_rough_1k.jpg', false, texturas.uTexArenaR);
  textura('damp_beach_sand_02_diff_1k.jpg', true, texturas.uTexMojada);
  textura('damp_beach_sand_02_nor_gl_1k.jpg', false, texturas.uTexMojadaN);

  const teselas = crearTeselas({
    relieve, indiceOrto: metaOrto.indice as Record<string, string[]>, urlBase: base, escena, comunes, movil,
    anisotropia: Math.min(8, render.capabilities.getMaxAnisotropy()),
  });
  // Relieve fino de la playa (LiDAR 2024, 1 m): llega después, sin bloquear el arranque.
  cargarFino(`${base}bahia/fino.bin`).then((datos) => {
    if (!datos) return;
    relieve.ponerFino(metaFino, datos);
    teselas.rehacerFino();
    fondoAgua.actualizar();
    arena.rehacer();
  });
  const agua = crearAgua({ escena, texRelieve: fondoAgua.textura, nRelieve: fondoAgua.n, pasoRelieve: PASO_RELIEVE, nCampo: Math.floor((relieve.n - 1) / PASO_CAMPO) + 1, comunes: comunesAgua, movil, normales: neutra(128, 128, 255) });
  textura('waternormals.jpg', false, agua.uniformes.uNormAgua);
  const reflejo = crearReflejo(render, movil ? 0.35 : 0.5);
  agua.uniformes.uReflejo.value = reflejo.textura;
  agua.uniformes.uMatReflejo.value = reflejo.matriz;
  // Estilo de animación: sin reflejo de la escena (colores planos); la cámara espejo no se dibuja.
  agua.uniformes.uConReflejo.value = 0;
  const cielo = crearCielo(escena, movil);
  // Muro, barandilla y suelo del paseo (tools/paseo-muro.py)
  escena.add(crearPaseo(metaPaseo.tramos as PuntoMuro[][], comunes));

  // ---------- Etiquetas de lugares (OpenStreetMap) ----------
  // Rótulos HTML sobre el lienzo, colocados cada cuadro en su punto 3D; se ocultan detrás de la
  // cámara y se desvanecen con la distancia. No capturan el ratón.
  const capa = document.createElement('div');
  capa.className = 'etiquetas';
  lienzo.insertAdjacentElement('afterend', capa); // justo encima del lienzo, debajo de los paneles
  const etiquetas = metaPaseo.lugares.map((l) => {
    const e = document.createElement('span');
    e.className = 'etiqueta';
    e.textContent = l.nombre;
    capa.appendChild(e);
    const y = (l.y ?? relieve.altura(l.x, l.z)) + 14;
    return { e, p: new THREE.Vector3(l.x, y, l.z) };
  });
  // Cuánta arena hay entre el muro y el agua en el punto elegido (tocando la playa o de la lista).
  const arena = crearMedidaArena({ escena, camara, lienzo, capa, relieve, cotaMar: fondoAgua.cota });
  etiquetas.push(arena.etiqueta);
  const proy = new THREE.Vector3();
  // Los paneles son translúcidos: un rótulo debajo de uno se leería a través y ensuciaría el texto.
  const paneles = ['.panel', '.vistas', '.ayuda-controles', '.barra'];
  function colocarEtiquetas() {
    const w = lienzo.clientWidth, h = lienzo.clientHeight;
    const lr = lienzo.getBoundingClientRect();
    const tapan = paneles.flatMap((s) => [...document.querySelectorAll<HTMLElement>(s)])
      .filter((el) => el.getClientRects().length > 0).map((el) => el.getBoundingClientRect()); // (fixed: sin offsetParent)
    for (const { e, p } of etiquetas) {
      const dist = camara.position.distanceTo(p);
      proy.copy(p).project(camara);
      const sx = lr.left + ((proy.x + 1) / 2) * w, sy = lr.top + ((1 - proy.y) / 2) * h;
      const tapada = tapan.some((r) => sx > r.left - 40 && sx < r.right + 40 && sy > r.top && sy < r.bottom + 30);
      const visible = proy.z < 1 && Math.abs(proy.x) < 1.1 && Math.abs(proy.y) < 1.1 && dist < 4500 && !tapada;
      if (!visible) { e.style.opacity = '0'; continue; }
      e.style.opacity = String(1 - THREE.MathUtils.smoothstep(dist, 2200, 4500));
      e.style.transform = `translate(${((proy.x + 1) / 2) * w}px, ${((1 - proy.y) / 2) * h}px) translate(-50%, -100%)`;
    }
  }

  // Tierra lejana al sur, fuera del área modelada: un anillo plano que la niebla funde con el cielo.
  const tierraLejana = new THREE.Mesh(
    new THREE.RingGeometry(LADO * 0.5, 40000, 64, 1, THREE.MathUtils.degToRad(192), THREE.MathUtils.degToRad(156)),
    new THREE.ShaderMaterial({
      uniforms: comunes,
      vertexShader: 'varying vec3 vPos; void main(){ vec4 m = modelMatrix * vec4(position,1.0); vPos = m.xyz; gl_Position = projectionMatrix * viewMatrix * m; }',
      fragmentShader: `uniform vec3 uAmbiente; uniform vec3 uColorSol; uniform float uLuzSol; uniform vec3 uColorNiebla; uniform float uDensidadNiebla; varying vec3 vPos;
        void main(){ if (abs(vPos.x) < ${(LADO / 2).toFixed(1)} && abs(vPos.z) < ${(LADO / 2).toFixed(1)}) discard;
          vec3 c = vec3(0.16, 0.2, 0.13) * (uAmbiente + uColorSol * uLuzSol);
          float d = length(vPos - cameraPosition);
          gl_FragColor = vec4(mix(c, uColorNiebla, 1.0 - exp(-uDensidadNiebla * uDensidadNiebla * d * d * 2.0)), 1.0);
          #include <colorspace_fragment>
        }`,
    }),
  );
  tierraLejana.geometry.rotateX(-Math.PI / 2);
  tierraLejana.position.y = 25;
  escena.add(tierraLejana);

  alProgreso?.('Levantando los edificios…');
  try {
    const [cajas, lidar] = await Promise.all([
      cargarEdificios(`${base}bahia/edificios.bin`, metaEdificios.vertices, comunes),
      cargarEdificiosLidar(`${base}bahia/edificios-lidar.bin`, metaEdificiosLidar.vertices, metaEdificiosLidar.indices, comunes),
    ]);
    escena.add(cajas, lidar);
  } catch (e) {
    console.warn(e); // sin edificios la escena sigue siendo útil
  }

  // ---------- Cámara ----------
  const controles = new MapControls(camara, lienzo);
  controles.enableDamping = true;
  controles.dampingFactor = 0.05;
  controles.screenSpacePanning = false;
  controles.zoomToCursor = true;
  controles.minDistance = 6;
  controles.maxDistance = 9000;
  controles.maxPolarAngle = THREE.MathUtils.degToRad(86);
  const LIMITE = LADO / 2 - 150;

  function posicionVista(v: Vista) {
    const r = THREE.MathUtils.degToRad(v.rumbo), e = THREE.MathUtils.degToRad(v.elevacion);
    const adelante = new THREE.Vector3(Math.sin(r), 0, -Math.cos(r));
    const objetivo = new THREE.Vector3(v.objetivo[0], 0, v.objetivo[1]);
    objetivo.y = Math.max(relieve.altura(objetivo.x, objetivo.z), comunes.uNivel.value) + 1.5;
    const pos = objetivo.clone().addScaledVector(adelante, -v.distancia * Math.cos(e));
    pos.y = objetivo.y + v.distancia * Math.sin(e);
    pos.y = Math.max(pos.y, relieve.altura(pos.x, pos.z) + 1.8, comunes.uNivel.value + 1.8);
    return { pos, objetivo };
  }

  let vuelo: { desdeP: THREE.Vector3; desdeO: THREE.Vector3; aP: THREE.Vector3; aO: THREE.Vector3; t0: number; dur: number } | null = null;
  function volarA(id: string) {
    const v = VISTAS.find((x) => x.id === id);
    if (!v) return;
    const { pos, objetivo } = posicionVista(v);
    if (reducirMovimiento) { camara.position.copy(pos); controles.target.copy(objetivo); vuelo = null; return; }
    vuelo = { desdeP: camara.position.clone(), desdeO: controles.target.clone(), aP: pos, aO: objetivo, t0: performance.now(), dur: 1400 };
  }
  controles.addEventListener('start', () => { vuelo = null; }); // el usuario manda: se corta el vuelo
  { const { pos, objetivo } = posicionVista(VISTAS[0]); camara.position.copy(pos); controles.target.copy(objetivo); }

  // ---------- Estado ----------
  let estado: EstadoEscena = { t: Date.now(), nivel: 2.5, nivelMax6h: 2.5, mar: null, setup: 0, r2: 0 };
  let ultimoCielo = -Infinity;
  let claveCampo = '';
  let calculando = false;

  function actualizarLuz(t: number) {
    const c = cielo.actualizar(t);
    const p = c.paleta;
    render.toneMappingExposure = THREE.MathUtils.lerp(0.62, 0.78, p.luzDia);
    const solArriba = THREE.MathUtils.smoothstep(c.estado.sol.altura, -2, 8);
    const brilloLuna = 0.3 * c.noche * c.lunaArriba * c.estado.luna.fraccion;
    // Sombras: plenas con el sol (también las largas del amanecer y el atardecer) y suaves con luna.
    fuerzaSombra = solArriba > 0.02 ? THREE.MathUtils.smoothstep(c.estado.sol.altura, -1, 4) * 0.92 : Math.min(1, brilloLuna * 4) * 0.5;
    if (solArriba > 0.02 || brilloLuna < 0.01) {
      comunes.uDirSol.value.copy(c.vSol.y > 0 ? c.vSol : new THREE.Vector3(c.vSol.x, 0.05, c.vSol.z).normalize());
      comunes.uColorSol.value.copy(p.luzSol);
      comunes.uLuzSol.value = 0.62 * solArriba;
    } else {
      comunes.uDirSol.value.copy(c.vLuna);
      comunes.uColorSol.value.setRGB(0.62, 0.7, 0.9);
      comunes.uLuzSol.value = brilloLuna;
    }
    comunes.uAmbiente.value.copy(p.cenit).lerp(new THREE.Color(1, 1, 1), 0.7).multiplyScalar(0.03 + 0.43 * p.luzDia);
    comunes.uNoche.value = c.noche;
    comunes.uColorNiebla.value.copy(p.horizonte);
    const noche = c.noche > 0.6 && c.estado.luna.altura > 0;
    comunesAgua.uDirBrillo.value.copy(noche ? c.vLuna : c.vSol);
    comunesAgua.uColorBrillo.value.copy(noche ? new THREE.Color(0x8fa4c8).multiplyScalar(c.estado.luna.fraccion * c.lunaArriba) : p.luzSol);
    comunesAgua.uCieloHorizonte.value.copy(p.horizonte);
    comunesAgua.uCieloCenit.value.copy(p.cenit);
    comunesAgua.uLuzDia.value = p.luzDia;
    escena.background = p.cenit.clone();
    return c.vLuna;
  }
  let vLuna = new THREE.Vector3(0, -1, 0);

  /** Recalcula los campos de llegada del oleaje si han cambiado periodo, dirección o nivel. */
  function revisarCampos() {
    const m = estado.mar;
    const a = m?.fondo && m.fondo.hs > 0.05 ? m.fondo : m;
    const b = m?.viento && m.viento.hs > 0.05 ? m.viento : null;
    const ua = agua.uniformes.uSisA.value as THREE.Vector4, ub = agua.uniformes.uSisB.value as THREE.Vector4;
    const hacia = (dir: number) => { const r = THREE.MathUtils.degToRad(dir); return [-Math.sin(r), Math.cos(r)]; };
    if (a) ua.set(a.hs, a.tp, ...hacia(a.dir) as [number, number]); else ua.set(0, 10, 0, 1);
    if (b) ub.set(b.hs, b.tp, ...hacia(b.dir) as [number, number]); else ub.set(0, 6, 0, 1);
    agua.uniformes.uSetup.value = estado.setup;
    agua.uniformes.uR2.value = estado.r2;
    if (!a || calculando) return;
    const clave = [Math.round(a.tp * 2), Math.round(a.dir / 5), b ? Math.round(b.tp * 2) : 0, b ? Math.round(b.dir / 5) : 0, Math.round(estado.nivel * 2)].join('|');
    if (clave === claveCampo) return;
    claveCampo = clave;
    calculando = true;
    // Fuera del cuadro actual para no trabar la animación.
    setTimeout(() => {
      const nivel = estado.nivel;
      agua.ponerCampos(calcularCampo(relieve, nivel, a.tp, a.dir), b ? calcularCampo(relieve, nivel, b.tp, b.dir) : null);
      calculando = false;
    }, 0);
  }

  const post = crearPostproceso({
    render, escena, camara, movil,
    ocultarEnAO: () => [...agua.objetos, ...cielo.objetos, tierraLejana],
    tamanoSombras: (t) => sombras.tamano(t),
  });
  function ajustarTamano() {
    const w = lienzo.clientWidth, h = lienzo.clientHeight;
    if (!w || !h) return;
    post.ajustar(w, h);
    camara.aspect = w / h;
    camara.updateProjectionMatrix();
  }
  const observador = new ResizeObserver(ajustarTamano);
  observador.observe(lienzo);
  ajustarTamano();



  let activo = true;
  let previo = performance.now();
  let tiempoOlas = 0;
  function cuadro(ahora: number) {
    if (!activo) return;
    const dt = Math.min((ahora - previo) / 1000, 0.1);
    previo = ahora;
    if (!reducirMovimiento) tiempoOlas += dt;
    comunesAgua.uTiempo.value = tiempoOlas;

    if (vuelo) {
      const f = Math.min(1, (ahora - vuelo.t0) / vuelo.dur);
      const e = f < 0.5 ? 4 * f * f * f : 1 - Math.pow(-2 * f + 2, 3) / 2; // ease-in-out
      camara.position.lerpVectors(vuelo.desdeP, vuelo.aP, e);
      controles.target.lerpVectors(vuelo.desdeO, vuelo.aO, e);
      if (f >= 1) vuelo = null;
    }
    controles.update();
    // Límites: objetivo dentro del recuadro y cámara siempre por encima del suelo y del agua.
    const tg = controles.target;
    tg.x = THREE.MathUtils.clamp(tg.x, -LIMITE, LIMITE);
    tg.z = THREE.MathUtils.clamp(tg.z, -LIMITE, LIMITE);
    const suelo = Math.max(relieve.altura(camara.position.x, camara.position.z), estado.nivel + (estado.mar?.hs ?? 0) * 0.6);
    if (camara.position.y < suelo + 1.6) camara.position.y = suelo + 1.6;
    // Plano cercano según la altura sobre el suelo: precisión de profundidad en todo el rango.
    const altura = camara.position.y - suelo;
    const cerca = THREE.MathUtils.clamp(altura * 0.25, 0.3, 40);
    if (Math.abs(cerca - camara.near) > camara.near * 0.2) { camara.near = cerca; camara.updateProjectionMatrix(); }

    comunes.uNivel.value = estado.nivel;
    comunes.uNivelMax.value = estado.nivelMax6h;
    if (Math.abs(estado.t - ultimoCielo) > 60_000) { vLuna = actualizarLuz(estado.t); ultimoCielo = estado.t; }
    cielo.seguir(camara.position, vLuna);
    arena.actualizar(estado.nivel);
    colocarEtiquetas();
    teselas.actualizar(camara);
    agua.actualizar(teselas.visibles(), estado.nivel + estado.r2 + 1, camara.position);
    if (agua.uniformes.uConReflejo.value > 0) reflejo.actualizar(escena, camara, estado.nivel, [...agua.objetos, ...cielo.objetos]);
    // Sombras alrededor de lo que se mira: más terreno cuanto más lejos está la cámara.
    const semilado = THREE.MathUtils.clamp(camara.position.distanceTo(controles.target) * 0.9, 120, 2200);
    sombras.actualizar(controles.target, semilado, comunes.uDirSol.value, fuerzaSombra);
    post.dibujar(ahora);
    siguienteCuadro(cuadro);
  }
  siguienteCuadro(cuadro);

  if (import.meta.env.DEV) Object.assign(globalThis, { __bahia: { escena, camara, controles, relieve, teselas, agua, comunes, volarA, render, arena, fondoAgua, post, sombras } });

  return {
    actualizar(e: EstadoEscena) { estado = e; revisarCampos(); },
    volarA,
    pendientes: () => teselas.pendientes(),
    relieve,
    meta: metaRelieve,
    /** Arena entre el muro y el agua en el punto elegido (ver arena.ts). */
    arena: {
      medir: arena.medir, margen: arena.margen, puntos: arena.puntos,
      elegido: arena.elegido, elegir: arena.elegir, alCambiar: arena.alCambiar,
    },
    destruir() {
      capa.remove();
      activo = false;
      observador.disconnect();
      controles.dispose();
      render.dispose();
    },
  };
}
