// Lo que hay debajo del agua, para la refracción.
//
// Antes de cada cuadro se dibuja la escena SIN el agua en un objetivo aparte (color y
// profundidad). El sombreador del agua lo lee: el fondo se ve desplazado por las olas y atenuado
// según el espesor de agua que atraviesa la mirada (de la profundidad de la escena menos la de la
// superficie), en lugar de una lámina semitransparente.

import * as THREE from 'three';

export function crearRefraccion(render: THREE.WebGLRenderer, escena: THREE.Scene, camara: THREE.PerspectiveCamera) {
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  rt.depthTexture = new THREE.DepthTexture(1, 1);
  rt.depthTexture.type = THREE.FloatType;
  const tam = new THREE.Vector2();
  const uniformes = {
    uRefraccion: { value: rt.texture as THREE.Texture },
    uProfEscena: { value: rt.depthTexture as THREE.Texture },
    uTamDibujo: { value: new THREE.Vector2(1, 1) },
    uCercaLejos: { value: new THREE.Vector2(1, 1000) },
    uConRefraccion: { value: 1 },
  };
  let escala = 1;
  return {
    uniformes,
    /** Fracción de la resolución de pantalla (calidad automática); 0 la apaga. */
    escala(e: number) { escala = e; uniformes.uConRefraccion.value = e > 0 ? 1 : 0; },
    /** Dibuja la escena sin los objetos `ocultar` (el agua). */
    dibujar(ocultar: THREE.Object3D[]) {
      render.getDrawingBufferSize(tam);
      uniformes.uTamDibujo.value.copy(tam);
      uniformes.uCercaLejos.value.set(camara.near, camara.far);
      if (escala <= 0) return;
      const w = Math.max(1, Math.round(tam.x * escala)), h = Math.max(1, Math.round(tam.y * escala));
      if (rt.width !== w || rt.height !== h) rt.setSize(w, h);
      const antes = ocultar.map((o) => o.visible);
      ocultar.forEach((o) => { o.visible = false; });
      const previo = render.getRenderTarget();
      render.setRenderTarget(rt);
      render.clear();
      render.render(escena, camara);
      render.setRenderTarget(previo);
      ocultar.forEach((o, i) => { o.visible = antes[i]; });
    },
  };
}
