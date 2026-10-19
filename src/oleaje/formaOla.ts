// Forma de la ola cerca de la costa: las mismas fórmulas que usa el sombreador del agua
// (src/scene/bahia/agua.ts, FORMA_OLA y noLinealidad), aquí en TypeScript para comprobarlas.
//
// Ruessink, Ramaekers y van Rijn (2012), Coastal Engineering 65, 56–63: no linealidad B y fase ψ
// según el número de Ursell. Abreu, Silva, Sancho y Temperville (2010), Coastal Engineering 57,
// 656–667: forma analítica con r y φ. Coeficientes y log₁₀ como en Delft3D (ua_rvr.f90).

/** Número de Ursell de Ruessink et al. (2012) con Hrms = Hs/√2: Ur = 3/8·Hs·k/(kh)³. */
export function ursell(hs: number, k: number, h: number): number {
  return (3 / 8) * hs * k / (k * h) ** 3;
}

/** No linealidad total B y fase ψ (rad) según Ur. */
export function ruessink(ur: number): { B: number; psi: number } {
  const B = 0.857 / (1 + Math.exp((-0.471 - Math.log10(ur)) / 0.297));
  const psi = ((-90 + 90 * Math.tanh(0.815 / ur ** 0.672)) * Math.PI) / 180;
  return { B, psi };
}

/** r y φ de la forma de Abreu a partir de B y ψ. */
export function abreuDesdeRuessink(B: number, psi: number): { r: number; phi: number; b: number } {
  const b = Math.sqrt((2 * B * B) / (9 + 2 * B * B));
  return { r: (2 * b) / (1 + b * b), phi: -psi - Math.PI / 2, b };
}

/** Forma de Abreu et al. (2010), de media cero; s es la fase en el tiempo. */
export function formaOla(s: number, r: number, phi: number): number {
  const f = Math.sqrt(1 - r * r);
  return (f * (Math.sin(s) + (r * Math.sin(phi)) / (1 + f))) / (1 - r * Math.cos(s + phi));
}
