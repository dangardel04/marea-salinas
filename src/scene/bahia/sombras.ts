// Sombras del sol (o de la luna) sobre el terreno, los edificios y el muro.
//
// Mapa de sombras propio (en vez de las luces de three.js: los materiales de la escena son
// sombreadores a medida): profundidad vista desde la luz, en un DepthTexture con comparación por
// hardware, y muestreo suave (PCF con disco de Vogel girado por píxel) en los sombreadores.
// La cámara de la luz sigue a lo que se mira: cubre un cuadrado alrededor del objetivo de la
// cámara, más grande cuanto más lejos se mira, con el centro ajustado a la rejilla de texels para
// que las sombras no tiemblen al moverse.

import * as THREE from 'three';

/** Capa de los objetos que proyectan sombra (terreno, edificios, muro). */
export const CAPA_SOMBRA = 1;

/** GLSL: función sombra(posMundo, normal) → 1 al sol, 0 a la sombra. */
export const SOMBRA_GLSL = /* glsl */ `
uniform sampler2DShadow uSombraMapa;
uniform mat4 uSombraMatriz;
uniform float uSombraTexel;    // lado de un texel, en m
uniform float uSombraSesgo;    // sesgo de profundidad (unidades del mapa)
uniform float uSombraTam;      // texels por lado
uniform float uSombraFuerza;   // 0 sin sombras (de noche sin luna, calidad baja)
float sombra(vec3 p, vec3 n) {
  if (uSombraFuerza < 0.01) return 1.0;
  vec4 c = uSombraMatriz * vec4(p + n * uSombraTexel * 1.5, 1.0);
  c.xyz /= c.w;
  if (c.x <= 0.0 || c.x >= 1.0 || c.y <= 0.0 || c.y >= 1.0 || c.z >= 1.0) return 1.0;
  float z = c.z - uSombraSesgo;
  float r = 1.8 / uSombraTam;
  float giro = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) * 6.2831853;
  float s = 0.0;
  for (int i = 0; i < 8; i++) {
    float fi = float(i);
    float rad = sqrt((fi + 0.5) / 8.0);
    float a = fi * 2.3999632 + giro;
    s += texture(uSombraMapa, vec3(c.xy + vec2(cos(a), sin(a)) * rad * r, z));
  }
  s /= 8.0;
  float borde = smoothstep(0.0, 0.06, min(min(c.x, 1.0 - c.x), min(c.y, 1.0 - c.y)));
  return mix(1.0, s, uSombraFuerza * borde);
}
`;

export function crearSombras(render: THREE.WebGLRenderer, escena: THREE.Scene, tam: number) {
  const crearRT = (t: number) => {
    const rt = new THREE.WebGLRenderTarget(t, t);
    rt.depthTexture = new THREE.DepthTexture(t, t);
    rt.depthTexture.type = THREE.UnsignedIntType;
    rt.depthTexture.compareFunction = THREE.LessEqualCompare;
    rt.depthTexture.minFilter = rt.depthTexture.magFilter = THREE.LinearFilter;
    return rt;
  };
  let rt = crearRT(tam);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 9000);
  cam.layers.set(CAPA_SOMBRA);
  const material = new THREE.MeshDepthMaterial({ side: THREE.DoubleSide });
  const sesgo = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
  const uniformes = {
    uSombraMapa: { value: rt.depthTexture as THREE.Texture },
    uSombraMatriz: { value: new THREE.Matrix4() },
    uSombraTexel: { value: 1 },
    uSombraSesgo: { value: 0 },
    uSombraTam: { value: tam },
    uSombraFuerza: { value: 0 },
  };
  const derecha = new THREE.Vector3(), arriba = new THREE.Vector3(), centro = new THREE.Vector3();
  const LEJOS = 4500;

  return {
    uniformes,
    /** Cambia la resolución del mapa (calidad automática). */
    tamano(t: number) {
      if (t === uniformes.uSombraTam.value) return;
      rt.dispose();
      rt = crearRT(t);
      uniformes.uSombraMapa.value = rt.depthTexture!;
      uniformes.uSombraTam.value = t;
    },
    /**
     * Dibuja el mapa de sombras.
     * @param objetivo punto que se mira (centro del cuadrado de sombras)
     * @param semilado medio lado del cuadrado cubierto, en m
     * @param dirLuz dirección HACIA la luz (unitaria)
     * @param fuerza 0–1 (0: no se dibuja)
     */
    actualizar(objetivo: THREE.Vector3, semilado: number, dirLuz: THREE.Vector3, fuerza: number) {
      uniformes.uSombraFuerza.value = fuerza;
      if (fuerza < 0.01) return;
      const t = uniformes.uSombraTam.value;
      const texel = (2 * semilado) / t;
      // Base de la vista de la luz; el centro se ajusta a la rejilla de texels en ese plano.
      const dir = dirLuz.clone().normalize();
      derecha.set(0, 1, 0).cross(dir);
      if (derecha.lengthSq() < 1e-6) derecha.set(1, 0, 0);
      derecha.normalize();
      arriba.copy(dir).cross(derecha).normalize();
      const u = Math.round(objetivo.dot(derecha) / texel) * texel;
      const v = Math.round(objetivo.dot(arriba) / texel) * texel;
      const w = objetivo.dot(dir);
      centro.copy(derecha).multiplyScalar(u).addScaledVector(arriba, v).addScaledVector(dir, w);
      cam.position.copy(centro).addScaledVector(dir, LEJOS);
      cam.up.copy(arriba);
      cam.lookAt(centro);
      cam.left = -semilado; cam.right = semilado; cam.top = semilado; cam.bottom = -semilado;
      cam.near = 1; cam.far = LEJOS * 2;
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld();
      uniformes.uSombraMatriz.value.copy(sesgo).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
      uniformes.uSombraTexel.value = texel;
      uniformes.uSombraSesgo.value = 0.35 / (cam.far - cam.near);   // ~35 cm

      const previo = { rt: render.getRenderTarget(), over: escena.overrideMaterial, fondo: escena.background };
      escena.overrideMaterial = material;
      escena.background = null;
      render.setRenderTarget(rt);
      render.clear(true, true, false);
      render.render(escena, cam);
      render.setRenderTarget(previo.rt);
      escena.overrideMaterial = previo.over;
      escena.background = previo.fondo;
    },
  };
}
