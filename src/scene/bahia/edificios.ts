// Edificios del Catastro (ver tools/bahia-edificios.ts): una sola malla con color por vértice.

import * as THREE from 'three';
import { CAPA_SOMBRA } from './sombras';
import { EDIFICIOS_FRAG, EDIFICIOS_LIMPIOS_FRAG, EDIFICIOS_LIMPIOS_VERT, EDIFICIOS_VERT } from './sombreado';

export async function cargarEdificios(url: string, nVertices: number, comunes: Record<string, THREE.IUniform>) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`No se pudieron cargar los edificios (${r.status})`);
  const buf = await r.arrayBuffer();
  const pos16 = new Int16Array(buf, 0, nVertices * 3);
  const col8 = new Uint8Array(buf, nVertices * 6, nVertices * 3);
  const pos = new Float32Array(nVertices * 3);
  for (let k = 0; k < pos.length; k++) pos[k] = pos16[k] / 10;
  // Los colores vienen en sRGB (de la ortofoto); el sombreador trabaja en lineal.
  const col = new Float32Array(nVertices * 3);
  const c = new THREE.Color();
  for (let k = 0; k < nVertices; k++) {
    c.setRGB(col8[k * 3] / 255, col8[k * 3 + 1] / 255, col8[k * 3 + 2] / 255, THREE.SRGBColorSpace);
    col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals(); // triángulos sueltos → normales planas
  geo.computeBoundingSphere();
  const mat = new THREE.ShaderMaterial({ vertexShader: EDIFICIOS_VERT, fragmentShader: EDIFICIOS_FRAG, uniforms: comunes, side: THREE.DoubleSide }); // fachadas de una cara, vistas por los dos lados
  const malla = new THREE.Mesh(geo, mat);
  malla.layers.enable(CAPA_SOMBRA);
  malla.name = 'edificios';
  return malla;
}

/** Edificios limpios (tools/edificios-limpios.ts): huella del Catastro, alturas y color del tejado
 *  medidos en el LiDAR, tejado plano o a cuatro aguas. Sustituyen a la malla de tools/edificios-lidar.py. */
export async function cargarEdificiosLimpios(url: string, nVertices: number, comunes: Record<string, THREE.IUniform>) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`No se pudieron cargar los edificios (${r.status})`);
  const buf = await r.arrayBuffer();
  const i16 = new Int16Array(buf, 0, nVertices * 6);
  const u8 = new Uint8Array(buf, nVertices * 12, nVertices * 6);
  const pos = new Float32Array(nVertices * 3), uvF = new Float32Array(nVertices * 3), datos = new Float32Array(nVertices * 3), col = new Float32Array(nVertices * 3);
  const c = new THREE.Color();
  for (let k = 0; k < nVertices; k++) {
    for (let q = 0; q < 3; q++) { pos[k * 3 + q] = i16[k * 6 + q] / 10; uvF[k * 3 + q] = i16[k * 6 + 3 + q] / 10; }
    // Los colores vienen en sRGB (de la nube); el sombreador trabaja en lineal.
    c.setRGB(u8[k * 6] / 255, u8[k * 6 + 1] / 255, u8[k * 6 + 2] / 255, THREE.SRGBColorSpace);
    col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
    datos[k * 3] = u8[k * 6 + 3]; datos[k * 3 + 1] = u8[k * 6 + 4] / 10; datos[k * 3 + 2] = u8[k * 6 + 5];
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('fachadaUv', new THREE.BufferAttribute(uvF, 3));
  geo.setAttribute('datos', new THREE.BufferAttribute(datos, 3));
  geo.computeVertexNormals(); // triángulos sueltos → normales planas
  geo.computeBoundingSphere();
  const mat = new THREE.ShaderMaterial({ vertexShader: EDIFICIOS_LIMPIOS_VERT, fragmentShader: EDIFICIOS_LIMPIOS_FRAG, uniforms: comunes, side: THREE.DoubleSide });
  const malla = new THREE.Mesh(geo, mat);
  malla.layers.enable(CAPA_SOMBRA);
  malla.name = 'edificios-limpios';
  return malla;
}
