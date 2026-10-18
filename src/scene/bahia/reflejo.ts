// Reflejo del agua: la escena vista por una cámara espejo bajo el plano del mar (y = nivel), en
// una textura de media resolución que el agua muestra deformada por el oleaje. Es el método del
// Reflector de three.js (examples/jsm/objects/Reflector.js), con el plano de recorte oblicuo de
// Lengyel para que no se refleje nada de lo que queda bajo el agua. Solo se dibuja lo que tapa el
// cielo (relieve, edificios), con alfa 1; el cielo queda transparente (alfa 0) y el agua pone en
// su lugar el reflejo de su propio degradado de cielo, que casa con el resto de la escena.

import * as THREE from 'three';

export function crearReflejo(render: THREE.WebGLRenderer, escala: number) {
  const destino = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType });
  destino.texture.generateMipmaps = false;
  const camEspejo = new THREE.PerspectiveCamera();
  const matriz = new THREE.Matrix4();
  const tam = new THREE.Vector2();
  const dir = new THREE.Vector3(), arriba = new THREE.Vector3(), mira = new THREE.Vector3();
  const plano = new THREE.Plane(), recorte = new THREE.Vector4(), q = new THREE.Vector4();
  const sesgo = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);

  /** Dibuja el reflejo para la cámara y el nivel del mar dados, sin los objetos de `ocultar`. */
  function actualizar(escena: THREE.Scene, camara: THREE.PerspectiveCamera, nivel: number, ocultar: THREE.Object3D[]) {
    render.getDrawingBufferSize(tam);
    const w = Math.max(2, Math.round(tam.x * escala)), h = Math.max(2, Math.round(tam.y * escala));
    if (destino.width !== w || destino.height !== h) destino.setSize(w, h);

    // Cámara simétrica respecto al plano y = nivel.
    camara.updateMatrixWorld();
    camEspejo.position.set(camara.position.x, 2 * nivel - camara.position.y, camara.position.z);
    dir.set(0, 0, -1).applyQuaternion(camara.quaternion); dir.y = -dir.y;
    arriba.set(0, 1, 0).applyQuaternion(camara.quaternion); arriba.y = -arriba.y;
    camEspejo.up.copy(arriba);
    camEspejo.lookAt(mira.copy(camEspejo.position).add(dir));
    camEspejo.near = camara.near; camEspejo.far = camara.far;
    camEspejo.updateMatrixWorld();
    camEspejo.projectionMatrix.copy(camara.projectionMatrix);

    // Matriz para llevar un punto del mundo a coordenadas de la textura (0–1).
    matriz.copy(sesgo).multiply(camEspejo.projectionMatrix).multiply(camEspejo.matrixWorldInverse);

    // Plano de recorte oblicuo: el plano cercano pasa a ser la superficie del agua.
    plano.set(new THREE.Vector3(0, 1, 0), -nivel).applyMatrix4(camEspejo.matrixWorldInverse);
    recorte.set(plano.normal.x, plano.normal.y, plano.normal.z, plano.constant);
    const p = camEspejo.projectionMatrix.elements;
    q.set((Math.sign(recorte.x) + p[8]) / p[0], (Math.sign(recorte.y) + p[9]) / p[5], -1, (1 + p[10]) / p[14]);
    recorte.multiplyScalar(2 / recorte.dot(q));
    p[2] = recorte.x; p[6] = recorte.y; p[10] = recorte.z + 1; p[14] = recorte.w;
    camEspejo.projectionMatrixInverse.copy(camEspejo.projectionMatrix).invert();

    const visibles = ocultar.map((o) => o.visible);
    ocultar.forEach((o) => { o.visible = false; });
    const previo = render.getRenderTarget();
    const fondo = escena.background, colorPrevio = render.getClearColor(new THREE.Color()), alfaPrevio = render.getClearAlpha();
    escena.background = null;
    render.setClearColor(0x000000, 0);
    render.setRenderTarget(destino);
    render.clear();
    render.render(escena, camEspejo);
    render.setRenderTarget(previo);
    render.setClearColor(colorPrevio, alfaPrevio);
    escena.background = fondo;
    ocultar.forEach((o, k) => { o.visible = visibles[k]; });
  }

  return { textura: destino.texture, matriz, actualizar };
}
