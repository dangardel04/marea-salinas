// Cielo de la escena: Preetham de día, cúpula de degradado en crepúsculo y noche, estrellas y una
// luna iluminada por la dirección real del sol (así la fase sale sola).

import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { estadoCielo, vectorBahia, type EstadoCielo } from '../astro';

export interface Paleta { horizonte: THREE.Color; cenit: THREE.Color; luzSol: THREE.Color; luzDia: number }

/** Colores del cielo según la altura del sol (grados). Valores estéticos, no físicos. */
export function paletaCielo(alturaSol: number): Paleta {
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

export function crearCielo(escena: THREE.Scene, movil: boolean) {
  const cielo = new Sky();
  cielo.scale.setScalar(30000);
  escena.add(cielo);
  const uc = cielo.material.uniforms;
  uc.turbidity.value = 4;
  uc.rayleigh.value = 1.4;
  uc.mieCoefficient.value = 0.004;
  uc.mieDirectionalG.value = 0.85;
  // El cielo de Preetham es de alto rango: con el tono ACES y la exposición de la escena se
  // quemaba a blanco y su brillo (≈3 en luz lineal) velaba la imagen con el bloom. Se atenúa solo
  // él, hasta ≈1,2 a mediodía (factor elegido a ojo, ESTÉTICO).
  cielo.material.onBeforeCompile = (s) => {
    s.fragmentShader = s.fragmentShader.replace('gl_FragColor = vec4( texColor, 1.0 );', 'gl_FragColor = vec4( texColor * 0.16, 1.0 );');
  };

  const uCupula = {
    uHorizonte: { value: new THREE.Color() }, uCenit: { value: new THREE.Color() },
    uSol: { value: new THREE.Vector3() }, uColorSol: { value: new THREE.Color() }, uOpacidad: { value: 0 },
  };
  const cupula = new THREE.Mesh(
    new THREE.SphereGeometry(20000, 32, 16),
    new THREE.ShaderMaterial({
      uniforms: uCupula, side: THREE.BackSide, transparent: true, depthWrite: false,
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
  cupula.renderOrder = -3;
  escena.add(cupula);

  // Estrellas: posiciones decorativas uniformes en la semiesfera (no es un catálogo real).
  const nEstrellas = movil ? 900 : 1800;
  const pe = new Float32Array(nEstrellas * 3);
  let semilla = 7;
  const azar = () => ((semilla = (semilla * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < nEstrellas; i++) {
    const z = azar() * 0.98 + 0.02, fi = azar() * Math.PI * 2, r = Math.sqrt(1 - z * z);
    pe.set([r * Math.cos(fi) * 18000, z * 18000, r * Math.sin(fi) * 18000], i * 3);
  }
  const geoEst = new THREE.BufferGeometry();
  geoEst.setAttribute('position', new THREE.BufferAttribute(pe, 3));
  const matEst = new THREE.PointsMaterial({ color: 0xdfe8ff, size: movil ? 1.6 : 1.3, sizeAttenuation: false, transparent: true, depthWrite: false, fog: false });
  const estrellas = new THREE.Points(geoEst, matEst);
  estrellas.renderOrder = -2;
  escena.add(estrellas);

  const uLuna = { uDirSol: { value: new THREE.Vector3() }, uVisible: { value: 1 } };
  const luna = new THREE.Mesh(
    new THREE.SphereGeometry(1, 48, 24),
    new THREE.ShaderMaterial({
      uniforms: uLuna, transparent: true, depthWrite: false,
      vertexShader: `varying vec3 vN; void main(){ vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      // El disco lunar tiene brillo casi uniforme (no lambertiano): terminador nítido.
      fragmentShader: `uniform vec3 uDirSol; uniform float uVisible; varying vec3 vN;
        void main(){ float l = dot(normalize(vN), uDirSol);
          vec3 c = vec3(0.92, 0.91, 0.86) * smoothstep(-0.02, 0.05, l) + vec3(0.025, 0.03, 0.045);
          gl_FragColor = vec4(c, uVisible); }`,
    }),
  );
  const DIST_LUNA = 17000;
  // Diámetro aparente real ≈ 0,52°; se dibuja 3 veces mayor para que se distinga la fase.
  luna.scale.setScalar(Math.tan(THREE.MathUtils.degToRad(0.26 * 3)) * DIST_LUNA);
  luna.renderOrder = -1;
  escena.add(luna);

  /** Estado del cielo para t; mueve sol, luna y estrellas y devuelve todo lo que necesitan las luces. */
  function actualizar(t: number) {
    const c: EstadoCielo = estadoCielo(t);
    const vSol = new THREE.Vector3(...vectorBahia(c.sol));
    const vLuna = new THREE.Vector3(...vectorBahia(c.luna));
    const p = paletaCielo(c.sol.altura);
    uc.sunPosition.value.copy(vSol);
    const relevo = 1 - THREE.MathUtils.smoothstep(c.sol.altura, -1, 5);
    uCupula.uOpacidad.value = relevo;
    uCupula.uHorizonte.value.copy(p.horizonte);
    uCupula.uCenit.value.copy(p.cenit);
    uCupula.uSol.value.copy(vSol);
    uCupula.uColorSol.value.copy(p.luzSol).multiplyScalar(p.luzDia);
    cielo.visible = relevo < 0.999;
    const noche = 1 - p.luzDia;
    const lunaArriba = THREE.MathUtils.smoothstep(c.luna.altura, -2, 3);
    matEst.opacity = THREE.MathUtils.smoothstep(noche, 0.55, 0.95);
    uLuna.uDirSol.value.copy(vSol);
    uLuna.uVisible.value = lunaArriba * THREE.MathUtils.lerp(0.35, 1, noche);
    return { estado: c, vSol, vLuna, paleta: p, noche, lunaArriba };
  }

  /** Mantiene cielo, estrellas y luna centrados en la cámara (están «en el infinito»). */
  function seguir(camara: THREE.Vector3, vLuna: THREE.Vector3) {
    cielo.position.copy(camara);
    cupula.position.copy(camara);
    estrellas.position.copy(camara);
    luna.position.copy(camara).addScaledVector(vLuna, DIST_LUNA);
  }

  /** Lo que es cielo (para que el reflejo del agua lo ponga aparte). */
  const objetos: THREE.Object3D[] = [cielo, cupula, estrellas, luna];
  return { actualizar, seguir, objetos };
}
