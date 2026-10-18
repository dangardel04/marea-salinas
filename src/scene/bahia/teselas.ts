// Terreno de la bahía por teselas con nivel de detalle (árbol cuaternario).
//
// Cada tesela (nivel, i, j) es una malla de SEG×SEG cuadros que muestrea el relieve y lleva la
// ortofoto de su nivel; si esa imagen no existe o aún no ha llegado, usa la del antepasado más
// cercano que sí esté cargado (con su recorte de coordenadas UV). Los bordes llevan un faldón
// vertical que tapa las grietas entre teselas de distinto nivel.

import * as THREE from 'three';
import { LADO, NIVEL_MAX_ORTO, PASO_RELIEVE, recuadroTesela } from '../../bahia';
import type { Relieve } from './relieve';
import { TERRENO_FRAG, TERRENO_VERT } from './sombreado';

export interface UniformesComunes { [k: string]: THREE.IUniform }

interface Tesela {
  clave: string; nivel: number; i: number; j: number;
  caja: THREE.Box3;
  /** Cota mínima real del terreno en la tesela (m sobre el CH). */
  minAltura: number;
  malla?: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  usada: number;
  texturaNivel: number; // nivel de la ortofoto que lleva ahora (−1: ninguna)
}

const NIVEL_MAX_MALLA = NIVEL_MAX_ORTO;
const MAX_TEXTURAS = 260;
const MAX_MALLAS = 420;
const CARGAS_SIMULTANEAS = 6;

export function crearTeselas(opciones: {
  relieve: Relieve;
  indiceOrto: Record<string, string[]>;
  urlBase: string;
  escena: THREE.Scene;
  comunes: UniformesComunes;
  movil: boolean;
  anisotropia: number;
}) {
  const { relieve, escena, comunes, movil } = opciones;
  const SEG = movil ? 32 : 48;
  /** Una tesela se divide si la cámara está a menos de lado × FACTOR. */
  const FACTOR = movil ? 1.25 : 1.7;
  const existe = new Set<string>();
  for (const [n, lista] of Object.entries(opciones.indiceOrto)) for (const k of lista) existe.add(`${n}_${k}`);

  const teselas = new Map<string, Tesela>();
  const texturas = new Map<string, { tex: THREE.Texture | null; usada: number; cargando: boolean }>();
  const cola: string[] = [];
  let cargando = 0;
  let reloj = 0;
  const cargador = new THREE.TextureLoader();
  const grupo = new THREE.Group();
  grupo.name = 'terreno';
  escena.add(grupo);

  // ---------- Ortofoto ----------
  function pedirTextura(clave: string) {
    const t = texturas.get(clave);
    if (t) { t.usada = reloj; return; }
    texturas.set(clave, { tex: null, usada: reloj, cargando: false });
    cola.push(clave);
  }
  function bombear() {
    while (cargando < CARGAS_SIMULTANEAS && cola.length) {
      const clave = cola.shift()!;
      const ent = texturas.get(clave);
      if (!ent || ent.tex) continue;
      ent.cargando = true;
      cargando++;
      const [n, i, j] = clave.split('_');
      cargador.load(`${opciones.urlBase}bahia/orto/${n}/${i}_${j}.jpg`, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = opciones.anisotropia;
        tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
        ent.tex = tex; ent.cargando = false; cargando--;
        bombear();
      }, undefined, () => { ent.cargando = false; cargando--; bombear(); });
    }
  }
  /** Mejor textura cargada para la tesela: la suya o la del antepasado más cercano. */
  function mejorTextura(t: Tesela): { tex: THREE.Texture; nivel: number } | null {
    for (let m = Math.min(t.nivel, NIVEL_MAX_ORTO); m >= 0; m--) {
      const clave = `${m}_${t.i >> (t.nivel - m)}_${t.j >> (t.nivel - m)}`;
      if (!existe.has(clave)) continue;
      const ent = texturas.get(clave);
      if (m === Math.min(t.nivel, NIVEL_MAX_ORTO) || !ent) pedirTextura(clave);
      if (ent?.tex) { ent.usada = reloj; return { tex: ent.tex, nivel: m }; }
    }
    return null;
  }

  // ---------- Geometría ----------
  function cajaDe(nivel: number, i: number, j: number): THREE.Box3 & { minReal: number } {
    const r = recuadroTesela(nivel, i, j);
    let min = Infinity, max = -Infinity;
    const pasos = 8;
    for (let a = 0; a <= pasos; a++) for (let b = 0; b <= pasos; b++) {
      const h = relieve.altura(r.x0 + (a / pasos) * r.lado, r.z0 + (b / pasos) * r.lado);
      min = Math.min(min, h); max = Math.max(max, h);
    }
    // El agua (hasta +6 m con marea y olas) y los edificios (hasta ~60 m) también cuentan.
    const caja = new THREE.Box3(new THREE.Vector3(r.x0, Math.min(min, -2), r.z0), new THREE.Vector3(r.x1, Math.max(max + 60, 8), r.z1)) as THREE.Box3 & { minReal: number };
    caja.minReal = min;
    return caja;
  }

  function geometria(nivel: number, i: number, j: number): THREE.BufferGeometry {
    const r = recuadroTesela(nivel, i, j);
    const v = SEG + 1;
    const nPrin = v * v, nFald = 4 * v;
    const pos = new Float32Array((nPrin + nFald) * 3);
    const nor = new Float32Array((nPrin + nFald) * 3);
    const uv = new Float32Array((nPrin + nFald) * 2);
    const med = new Float32Array(nPrin + nFald);
    const e = PASO_RELIEVE;
    const poner = (k: number, x: number, z: number, y: number, a: number, b: number) => {
      pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
      const nx = relieve.altura(x - e, z) - relieve.altura(x + e, z);
      const nz = relieve.altura(x, z - e) - relieve.altura(x, z + e);
      const l = Math.hypot(nx, 2 * e, nz);
      nor[k * 3] = nx / l; nor[k * 3 + 1] = (2 * e) / l; nor[k * 3 + 2] = nz / l;
      uv[k * 2] = a / SEG; uv[k * 2 + 1] = 1 - b / SEG;
      med[k] = relieve.medidoEn(x, z);
    };
    for (let b = 0; b < v; b++) for (let a = 0; a < v; a++) {
      const x = r.x0 + (a / SEG) * r.lado, z = r.z0 + (b / SEG) * r.lado;
      poner(b * v + a, x, z, relieve.altura(x, z), a, b);
    }
    // Faldón: copia de cada borde, bajada unos metros.
    const caida = 2 + r.lado * 0.01;
    const bordes: [number, number][] = [];
    for (let a = 0; a < v; a++) bordes.push([a, 0]);
    for (let b = 0; b < v; b++) bordes.push([SEG, b]);
    for (let a = SEG; a >= 0; a--) bordes.push([a, SEG]);
    for (let b = SEG; b >= 0; b--) bordes.push([0, b]);
    const idx: number[] = [];
    for (let b = 0; b < SEG; b++) for (let a = 0; a < SEG; a++) {
      const k = b * v + a;
      idx.push(k, k + v, k + 1, k + 1, k + v, k + v + 1);
    }
    bordes.slice(0, nFald).forEach(([a, b], q) => {
      const k = nPrin + q, src = b * v + a;
      poner(k, pos[src * 3], pos[src * 3 + 2], pos[src * 3 + 1] - caida, a, b);
      if (q > 0) {
        const [pa, pb] = bordes[q - 1];
        const s0 = pb * v + pa, k0 = k - 1;
        idx.push(s0, k0, src, src, k0, k); // dos caras: el faldón se ve desde fuera
        idx.push(s0, src, k0, src, k, k0);
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('medido', new THREE.BufferAttribute(med, 1));
    g.setIndex(idx);
    g.boundingBox = cajaDe(nivel, i, j);
    g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
    return g;
  }

  function material(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      vertexShader: TERRENO_VERT,
      fragmentShader: TERRENO_FRAG,
      uniforms: {
        ...comunes,
        uOrto: { value: null },
        uUv: { value: new THREE.Vector4(0, 0, 1, 1) },
        uTieneOrto: { value: 0 },
      },
    });
  }

  function obtener(nivel: number, i: number, j: number): Tesela {
    const clave = `${nivel}_${i}_${j}`;
    let t = teselas.get(clave);
    if (!t) {
      const caja = cajaDe(nivel, i, j);
      t = { clave, nivel, i, j, caja, minAltura: caja.minReal, usada: 0, texturaNivel: -1 };
      teselas.set(clave, t);
    }
    return t;
  }

  // ---------- Selección por cuadro ----------
  const frustum = new THREE.Frustum();
  const matriz = new THREE.Matrix4();
  const visibles: Tesela[] = [];

  function recorrer(nivel: number, i: number, j: number, cam: THREE.Vector3) {
    const t = obtener(nivel, i, j);
    if (!frustum.intersectsBox(t.caja)) return;
    const lado = LADO / 2 ** nivel;
    if (nivel < NIVEL_MAX_MALLA && t.caja.distanceToPoint(cam) < lado * FACTOR) {
      for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) recorrer(nivel + 1, i * 2 + a, j * 2 + b, cam);
    } else visibles.push(t);
  }

  function actualizar(camara: THREE.Camera) {
    reloj++;
    matriz.multiplyMatrices(camara.projectionMatrix, camara.matrixWorldInverse);
    frustum.setFromProjectionMatrix(matriz);
    visibles.length = 0;
    recorrer(0, 0, 0, camara.position);

    for (const m of grupo.children) m.visible = false;
    for (const t of visibles) {
      t.usada = reloj;
      if (!t.malla) {
        t.malla = new THREE.Mesh(geometria(t.nivel, t.i, t.j), material());
        t.malla.frustumCulled = false;
        grupo.add(t.malla);
      }
      t.malla.visible = true;
      const m = mejorTextura(t);
      if (m && m.nivel !== t.texturaNivel) {
        const u = t.malla.material.uniforms;
        const d = t.nivel - m.nivel, s = 1 / 2 ** d;
        const ii = t.i % 2 ** d, jj = t.j % 2 ** d;
        u.uOrto.value = m.tex;
        u.uUv.value.set(ii * s, 1 - (jj + 1) * s, s, s);
        u.uTieneOrto.value = 1;
        t.texturaNivel = m.nivel;
      }
    }
    bombear();
    limpiar();
    return visibles.length;
  }

  function limpiar() {
    const conMalla = [...teselas.values()].filter((t) => t.malla);
    if (conMalla.length > MAX_MALLAS) {
      conMalla.sort((a, b) => a.usada - b.usada);
      for (const t of conMalla.slice(0, conMalla.length - MAX_MALLAS)) {
        if (t.usada === reloj) continue;
        grupo.remove(t.malla!);
        t.malla!.geometry.dispose();
        t.malla!.material.dispose();
        t.malla = undefined;
        t.texturaNivel = -1;
      }
    }
    if (texturas.size > MAX_TEXTURAS) {
      const enUso = new Set<THREE.Texture>();
      for (const t of teselas.values()) if (t.malla?.visible && t.malla.material.uniforms.uOrto.value) enUso.add(t.malla.material.uniforms.uOrto.value);
      const lista = [...texturas.entries()].filter(([, e]) => e.tex && !enUso.has(e.tex)).sort((a, b) => a[1].usada - b[1].usada);
      for (const [clave, e] of lista.slice(0, texturas.size - MAX_TEXTURAS)) {
        if (clave.startsWith('0_') || clave.startsWith('1_')) continue; // los niveles generales se quedan siempre
        e.tex!.dispose();
        texturas.delete(clave);
        for (const t of teselas.values()) if (t.malla && t.malla.material.uniforms.uOrto.value === e.tex) { t.texturaNivel = -1; t.malla.material.uniforms.uOrto.value = null; t.malla.material.uniforms.uTieneOrto.value = 0; }
      }
    }
  }

  // Arranque: los dos niveles generales se piden ya, para que nunca falte imagen.
  for (const n of [0, 1]) for (const k of opciones.indiceOrto[n] ?? []) pedirTextura(`${n}_${k}`);
  bombear();

  return {
    actualizar,
    grupo,
    /** Teselas visibles en el último cuadro (para colocar los parches de agua). */
    visibles: () => visibles.map((t) => { const r = recuadroTesela(t.nivel, t.i, t.j); return { clave: t.clave, x0: r.x0, z0: r.z0, lado: r.lado, minY: t.minAltura }; }),
    /** Teselas de ortofoto pendientes de cargar (para la barra de carga). */
    pendientes: () => cola.length + cargando,
  };
}
