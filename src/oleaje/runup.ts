// Subida del agua por las olas sobre la playa (run-up), fórmula empírica de
// Stockdon, H.F., Holman, R.A., Howd, P.A. y Sallenger, A.H. (2006). «Empirical parameterization
// of setup, swash, and runup». Coastal Engineering 53, 573-588.
//
//   L0 = g·T²/2π                       longitud de onda en aguas profundas
//   ξ0 = βf / √(H0/L0)                 número de Iribarren
//   R2 = 1,1·( 0,35·βf·√(H0·L0) + ½·√(H0·L0·(0,563·βf² + 0,004)) )
//   si ξ0 < 0,3 (playa disipativa):  R2 = 0,043·√(H0·L0)
//
// R2 = cota que solo supera el 2 % de las subidas de las olas, por encima del nivel del mar en
// reposo (marea + efecto meteorológico). H0: altura significante en aguas profundas (m);
// T: periodo de pico (s); βf: pendiente del frente de playa.

const G = 9.81;

export interface Runup {
  /** Cota superada por el 2 % de las olas, m sobre el nivel del mar. */
  r2: number;
  /** Sobreelevación media del agua en la orilla (setup), m. */
  setup: number;
  iribarren: number;
  disipativa: boolean;
}

export function stockdon(h0: number, t: number, beta: number): Runup | null {
  if (!(h0 > 0) || !(t > 0) || !(beta > 0)) return null;
  const l0 = (G * t * t) / (2 * Math.PI);
  const hl = Math.sqrt(h0 * l0);
  const iribarren = beta / Math.sqrt(h0 / l0);
  const setup = 0.35 * beta * hl;
  if (iribarren < 0.3) return { r2: 0.043 * hl, setup, iribarren, disipativa: true };
  const r2 = 1.1 * (setup + Math.sqrt(h0 * l0 * (0.563 * beta * beta + 0.004)) / 2);
  return { r2, setup, iribarren, disipativa: false };
}
