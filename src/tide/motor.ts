// Motor de marea: altura, pleamares/bajamares y tendencia sobre el evaluador armónico.
// Todos los instantes son milisegundos UTC (como Date.getTime()).

import { crearEvaluador, type ConjuntoArmonico } from './armonicos.ts';

export type TipoExtremo = 'pleamar' | 'bajamar';

export interface Extremo {
  t: number; // ms UTC
  altura: number; // m
  tipo: TipoExtremo;
}

export interface Tendencia {
  sentido: 'subiendo' | 'bajando';
  /** Velocidad de cambio en cm/hora (con signo). */
  cmPorHora: number;
}

const MIN_MS = 60_000;
const PASO_BUSQUEDA_MS = 20 * MIN_MS; // menor que el cuarto de periodo de M4 (~1,5 h)
const TOLERANCIA_MS = 1000;
/** Pares de extremos con menos de 1 cm de diferencia se consideran ruido de la curva. */
const PROMINENCIA_MIN_M = 0.01;

export function crearMotor(conjunto: ConjuntoArmonico) {
  const ev = crearEvaluador(conjunto);

  function biseccion(a: number, b: number, da: number): number {
    while (b - a > TOLERANCIA_MS) {
      const m = (a + b) / 2;
      const dm = ev.derivada(m);
      if (dm === 0) return m;
      if (Math.sign(dm) === Math.sign(da)) { a = m; da = dm; } else b = m;
    }
    return (a + b) / 2;
  }

  /** Pleamares y bajamares en [desde, hasta], ordenadas. */
  function extremos(desde: number, hasta: number): Extremo[] {
    const res: Extremo[] = [];
    let a = desde;
    let da = ev.derivada(a);
    while (a < hasta) {
      const b = Math.min(a + PASO_BUSQUEDA_MS, hasta);
      const db = ev.derivada(b);
      if (da !== 0 && Math.sign(db) !== Math.sign(da)) {
        const t = biseccion(a, b, da);
        res.push({ t, altura: ev.altura(t), tipo: da > 0 ? 'pleamar' : 'bajamar' });
      }
      a = b;
      da = db;
    }
    // Quita pares espurios (máximo y mínimo casi iguales y seguidos).
    for (let i = 0; i < res.length - 1; ) {
      if (Math.abs(res[i + 1].altura - res[i].altura) < PROMINENCIA_MIN_M) res.splice(i, 2);
      else i++;
    }
    return res;
  }

  function tendencia(t: number): Tendencia {
    const d = ev.derivada(t);
    return { sentido: d >= 0 ? 'subiendo' : 'bajando', cmPorHora: d * 100 };
  }

  /** Próxima pleamar y próxima bajamar a partir de t (busca hasta 30 h). */
  function proximos(t: number): { pleamar?: Extremo; bajamar?: Extremo } {
    const lista = extremos(t, t + 30 * 60 * MIN_MS);
    return { pleamar: lista.find((e) => e.tipo === 'pleamar'), bajamar: lista.find((e) => e.tipo === 'bajamar') };
  }

  /** Serie de alturas cada `pasoMs` en [desde, hasta]. */
  function serie(desde: number, hasta: number, pasoMs: number): { t: number; h: number }[] {
    const out = [];
    for (let t = desde; t <= hasta; t += pasoMs) out.push({ t, h: ev.altura(t) });
    return out;
  }

  return { altura: ev.altura, derivada: ev.derivada, extremos, tendencia, proximos, serie };
}

export type Motor = ReturnType<typeof crearMotor>;
