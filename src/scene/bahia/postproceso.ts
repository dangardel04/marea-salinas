// Postprocesado de la escena y calidad automática.
//
// Cadena (EffectComposer, en coma flotante de 16 bits):
//   1. la escena;
//   2. GTAO: oclusión ambiental en pantalla (sombra de contacto entre edificios, muro y terreno);
//      para su pasada de profundidad y normales se ocultan el agua (su malla se monta en el
//      sombreador y con el material genérico saldría mal) y el cielo;
//   3. bloom suave: solo lo muy brillante (destellos del sol en el agua, luces de noche);
//   4. salida: tono fílmico ACES y paso a sRGB.
// Calidad automática: si la escena va a menos de 30 imágenes por segundo durante unos segundos,
// baja un escalón (resolución, oclusión, bloom, tamaño del mapa de sombras); si va holgada (más de
// 55) durante un rato, sube. La resolución nunca pasa de 2 veces la de CSS.

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/** GTAO que oculta ciertos objetos durante su pasada (el resultado se mezcla con la escena completa). */
class GTAOSelectivo extends GTAOPass {
  ocultar: () => THREE.Object3D[] = () => [];
  override render(...args: Parameters<GTAOPass['render']>) {
    const objs = this.ocultar();
    const antes = objs.map((o) => o.visible);
    objs.forEach((o) => { o.visible = false; });
    super.render(...args);
    objs.forEach((o, i) => { o.visible = antes[i]; });
  }
}

interface Nivel { pr: number; ao: boolean; bloom: boolean; sombra: number }
export const NIVELES: Nivel[] = [
  { pr: 0.75, ao: false, bloom: false, sombra: 1024 },
  { pr: 1.0, ao: false, bloom: true, sombra: 2048 },
  { pr: 1.5, ao: true, bloom: true, sombra: 2048 },
  { pr: 2.0, ao: true, bloom: true, sombra: 4096 },
];

export function crearPostproceso(o: {
  render: THREE.WebGLRenderer;
  escena: THREE.Scene;
  camara: THREE.PerspectiveCamera;
  movil: boolean;
  /** Objetos que no entran en la oclusión ambiental (agua, cielo). */
  ocultarEnAO: () => THREE.Object3D[];
  /** Cambia la resolución del mapa de sombras. */
  tamanoSombras: (t: number) => void;
}) {
  const { render, escena, camara } = o;
  render.toneMapping = THREE.ACESFilmicToneMapping;
  const composer = new EffectComposer(render);
  composer.addPass(new RenderPass(escena, camara));
  const ao = new GTAOSelectivo(escena, camara, 256, 256);
  ao.ocultar = o.ocultarEnAO;
  ao.blendIntensity = 0.85;
  // Radio en metros: el contacto entre un edificio y el suelo, el pie del muro.
  ao.updateGtaoMaterial({ radius: 4, distanceExponent: 1.6, thickness: 3, distanceFallOff: 1, scale: 1.1, samples: 12 });
  ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
  composer.addPass(ao);
  // Umbral alto (en luz lineal, antes del tono): solo destellos del sol en el agua y luces de
  // noche; con 1,0 el cielo pasaba del umbral y todo quedaba velado.
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.18, 0.35, 2.2);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  let ancho = 1, alto = 1;
  const maximo = o.movil ? 2 : 3;
  let nivel = o.movil ? 1 : 2;
  // ?calidad=0…3 en la dirección fija el escalón (para comparar o en equipos que lo necesiten).
  const fijado = /[?&]calidad=([0-3])/.exec(location.search);
  if (fijado) nivel = Number(fijado[1]);
  function aplicar() {
    const n = NIVELES[nivel];
    const pr = Math.min(devicePixelRatio, n.pr);
    render.setPixelRatio(pr);
    composer.setPixelRatio(pr);
    composer.setSize(ancho, alto);
    render.setSize(ancho, alto, false);
    ao.enabled = n.ao;
    bloom.enabled = n.bloom;
    o.tamanoSombras(n.sombra);
  }

  // Medida del ritmo: ventanas de 2 s.
  let cuadros = 0, inicio = performance.now(), lentas = 0, holgadas = 0;
  function medir(ahora: number) {
    cuadros++;
    const dt = ahora - inicio;
    if (dt < 2000) return;
    const fps = (cuadros * 1000) / dt;
    cuadros = 0; inicio = ahora;
    if (document.hidden || fijado) return;
    if (fps < 30) { lentas++; holgadas = 0; } else if (fps > 55) { holgadas++; lentas = 0; } else { lentas = 0; holgadas = 0; }
    if (lentas >= 2 && nivel > 0) { nivel--; lentas = 0; aplicar(); }
    else if (holgadas >= 8 && nivel < maximo) { nivel++; holgadas = 0; aplicar(); }
  }

  return {
    composer,
    /** Dibuja un cuadro con todo el postprocesado. */
    dibujar(ahora: number) { composer.render(); medir(ahora); },
    ajustar(w: number, h: number) { ancho = w; alto = h; aplicar(); },
    /** Escalón de calidad actual (0–3) y forzarlo (pruebas). */
    nivel: () => nivel,
    fijarNivel(n: number) { nivel = Math.max(0, Math.min(NIVELES.length - 1, n)); aplicar(); },
  };
}
