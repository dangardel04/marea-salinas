// Propagación del oleaje sobre el fondo de la bahía (teoría lineal, aproximaciones estándar).
//
// - Dispersión: ω² = g·k·tanh(k·h). Aproximación explícita de Fenton y McKee (1990):
//     L = L0 · tanh^{2/3}((ω·√(h/g))^{3/2}),   L0 = g·T²/2π      (error < 1,7 %)
// - Celeridad c = L/T; celeridad de grupo cg = c/2·(1 + 2kh/sinh(2kh)).
// - Asomeramiento: Ks = √(cg0/cg).
// - Tiempo de llegada del frente de onda T(x): ecuación eikonal |∇T| = 1/c(x), resuelta con
//   fast marching (Sethian, 1996) desde el borde de la rejilla por el que entra el oleaje.
//   Recoge la refracción (los frentes giran hacia donde hay menos fondo) y deja sombra detrás
//   de los obstáculos. No recoge la difracción ni la reflexión de forma rigurosa.

const G = 9.81;

/** Longitud de onda (m) para periodo T (s) y profundidad h (m). */
export function longitudOnda(t: number, h: number): number {
  const l0 = (G * t * t) / (2 * Math.PI);
  if (h <= 0) return 0;
  const w = (2 * Math.PI) / t;
  return l0 * Math.pow(Math.tanh(Math.pow(w * Math.sqrt(h / G), 1.5)), 2 / 3);
}

export function celeridad(t: number, h: number) { return longitudOnda(t, h) / t; }

export function celeridadGrupo(t: number, h: number): number {
  const l = longitudOnda(t, h);
  if (l === 0) return 0;
  const kh = (2 * Math.PI * h) / l;
  const n = kh > 20 ? 0.5 : 0.5 * (1 + (2 * kh) / Math.sinh(2 * kh));
  return (l / t) * n;
}

/** Coeficiente de asomeramiento respecto a aguas profundas. */
export function asomeramiento(t: number, h: number): number {
  const cg0 = (G * t) / (4 * Math.PI);
  const cg = celeridadGrupo(t, h);
  return cg > 0 ? Math.sqrt(cg0 / cg) : 0;
}

export interface CampoTiempos {
  n: number;
  /** Tiempo de llegada (s) en cada nodo; Infinity en tierra o donde no llega. */
  t: Float32Array;
}

/**
 * Fast marching sobre una rejilla n×n de paso `paso` metros. `prof` = profundidad (m, >0 agua).
 * `dirHacia` = dirección hacia la que viaja el oleaje en la rejilla (x este, z sur), unitaria.
 * Siembra: los nodos de agua del borde por el que entra el oleaje, con T = (d·p)/c.
 */
export function tiemposLlegada(prof: Float32Array, n: number, paso: number, periodo: number, dirHacia: { x: number; z: number }): CampoTiempos {
  const INF = Infinity;
  const t = new Float32Array(n * n).fill(INF);
  const lentitud = new Float32Array(n * n);
  for (let k = 0; k < n * n; k++) lentitud[k] = prof[k] > 0.05 ? 1 / celeridad(periodo, prof[k]) : INF;
  const estado = new Uint8Array(n * n); // 0 lejano, 1 frente, 2 fijado

  // Montículo binario de mínimos sobre (tiempo, nodo).
  const heapT: number[] = [], heapK: number[] = [];
  const empujar = (tt: number, k: number) => {
    let i = heapT.length; heapT.push(tt); heapK.push(k);
    while (i > 0) { const p = (i - 1) >> 1; if (heapT[p] <= heapT[i]) break; [heapT[p], heapT[i]] = [heapT[i], heapT[p]]; [heapK[p], heapK[i]] = [heapK[i], heapK[p]]; i = p; }
  };
  const sacar = (): number => {
    const k = heapK[0];
    const ut = heapT.pop()!, uk = heapK.pop()!;
    if (heapT.length) {
      heapT[0] = ut; heapK[0] = uk;
      let i = 0;
      for (;;) {
        const a = 2 * i + 1, b = a + 1;
        let m = i;
        if (a < heapT.length && heapT[a] < heapT[m]) m = a;
        if (b < heapT.length && heapT[b] < heapT[m]) m = b;
        if (m === i) break;
        [heapT[m], heapT[i]] = [heapT[i], heapT[m]]; [heapK[m], heapK[i]] = [heapK[i], heapK[m]]; i = m;
      }
    }
    return k;
  };

  // Siembra en los bordes de entrada.
  const c0 = celeridad(periodo, 1000);
  const centro = ((n - 1) * paso) / 2;
  const sembrar = (f: number, c: number) => {
    const k = f * n + c;
    if (lentitud[k] === INF) return;
    const x = c * paso - centro, z = f * paso - centro;
    const tt = (dirHacia.x * x + dirHacia.z * z) / c0;
    if (tt < t[k]) { t[k] = tt; estado[k] = 1; empujar(tt, k); }
  };
  for (let q = 0; q < n; q++) {
    if (dirHacia.z > 0.05) sembrar(0, q); // entra por el norte
    if (dirHacia.z < -0.05) sembrar(n - 1, q);
    if (dirHacia.x > 0.05) sembrar(q, 0); // entra por el oeste
    if (dirHacia.x < -0.05) sembrar(q, n - 1);
  }

  // Actualización de primer orden de la eikonal en un nodo.
  const resolver = (k: number): number => {
    const f = Math.floor(k / n), c = k % n;
    const tx = Math.min(c > 0 && estado[k - 1] === 2 ? t[k - 1] : INF, c < n - 1 && estado[k + 1] === 2 ? t[k + 1] : INF);
    const tz = Math.min(f > 0 && estado[k - n] === 2 ? t[k - n] : INF, f < n - 1 && estado[k + n] === 2 ? t[k + n] : INF);
    const s = lentitud[k] * paso;
    const a = Math.min(tx, tz), b = Math.max(tx, tz);
    if (b === INF || b - a >= s) return a + s;
    return (a + b + Math.sqrt(2 * s * s - (a - b) * (a - b))) / 2;
  };

  while (heapT.length) {
    const k = sacar();
    if (estado[k] === 2) continue;
    estado[k] = 2;
    const f = Math.floor(k / n), c = k % n;
    for (const [ff, cc] of [[f - 1, c], [f + 1, c], [f, c - 1], [f, c + 1]]) {
      if (ff < 0 || ff >= n || cc < 0 || cc >= n) continue;
      const kk = ff * n + cc;
      if (estado[kk] === 2 || lentitud[kk] === INF) continue;
      const nt = resolver(kk);
      if (nt < t[kk]) { t[kk] = nt; estado[kk] = 1; empujar(nt, kk); }
    }
  }
  return { n, t };
}
