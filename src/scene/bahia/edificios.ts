// Edificios del Catastro (ver tools/bahia-edificios.ts): una sola malla con color por vértice.

import * as THREE from 'three';
import { EDIFICIOS_FRAG, EDIFICIOS_VERT } from './sombreado';

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
  malla.name = 'edificios';
  return malla;
}

/** Edificios con altura y tejado del LiDAR 2024 (tools/edificios-lidar.py): malla indexada. */
export async function cargarEdificiosLidar(url: string, nVertices: number, nIndices: number, comunes: Record<string, THREE.IUniform>) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`No se pudieron cargar los edificios LiDAR (${r.status})`);
  const buf = await r.arrayBuffer();
  const pos16 = new Int16Array(buf, 0, nVertices * 3);
  const col8 = new Uint8Array(buf, nVertices * 6, nVertices * 3);
  const desplaz = Math.ceil((nVertices * 9) / 4) * 4;
  const indices = new Uint32Array(buf, desplaz, nIndices * 3);
  const pos = new Float32Array(nVertices * 3);
  for (let k = 0; k < pos.length; k++) pos[k] = pos16[k] / 10;
  const col = new Float32Array(nVertices * 3);
  const c = new THREE.Color();
  for (let k = 0; k < nVertices; k++) {
    c.setRGB(col8[k * 3] / 255, col8[k * 3 + 1] / 255, col8[k * 3 + 2] / 255, THREE.SRGBColorSpace);
    col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeVertexNormals(); // tejado suave entre sus triángulos; fachadas con vértices propios (aristas vivas)
  geo.computeBoundingSphere();
  const mat = new THREE.ShaderMaterial({ vertexShader: EDIFICIOS_VERT, fragmentShader: EDIFICIOS_FRAG, uniforms: comunes, side: THREE.DoubleSide });
  const malla = new THREE.Mesh(geo, mat);
  malla.name = 'edificios-lidar';
  return malla;
}
