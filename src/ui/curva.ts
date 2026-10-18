// Curva de marea de un día civil de Madrid (que puede durar 23, 24 o 25 horas) en SVG.

import { horaMadrid, partesMadrid, utcDesdeMadrid } from '../tiempo';
import type { Extremo } from '../tide/motor';
import type { ExtremoOficial } from './ihm';

const NS = 'http://www.w3.org/2000/svg';
const Y_MIN = -0.2, Y_MAX = 5.0; // m sobre el CH: fijo para comparar días entre sí
const M = { izq: 22, der: 6, arr: 14, aba: 16 };

export interface DatosCurva {
  ini: number; fin: number;
  serie: { t: number; h: number }[];
  extremos: Extremo[];
  oficiales: ExtremoOficial[];
}

export function crearCurva(svg: SVGSVGElement, alElegir: (t: number) => void) {
  let datos: DatosCurva | null = null;
  let ancho = 0, alto = 0;
  const capaBase = document.createElementNS(NS, 'g');
  const capaMarcas = document.createElementNS(NS, 'g');
  svg.append(capaBase, capaMarcas);

  const x = (t: number) => M.izq + ((t - datos!.ini) / (datos!.fin - datos!.ini)) * (ancho - M.izq - M.der);
  const y = (h: number) => M.arr + (1 - (h - Y_MIN) / (Y_MAX - Y_MIN)) * (alto - M.arr - M.aba);
  const tDesdeX = (px: number) => datos!.ini + ((px - M.izq) / (ancho - M.izq - M.der)) * (datos!.fin - datos!.ini);

  const el = (tag: string, attrs: Record<string, string | number>, texto?: string) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    if (texto !== undefined) e.textContent = texto;
    return e;
  };

  function dibujarBase() {
    if (!datos) return;
    const r = svg.getBoundingClientRect();
    ancho = r.width; alto = r.height;
    if (!ancho || !alto) return;
    svg.setAttribute('viewBox', `0 0 ${ancho} ${alto}`);
    capaBase.replaceChildren();
    for (let h = 0; h <= 5; h++) {
      capaBase.append(el('line', { class: 'rejilla', x1: M.izq, x2: ancho - M.der, y1: y(h), y2: y(h) }));
      capaBase.append(el('text', { class: 'eje', x: M.izq - 6, y: y(h) + 3, 'text-anchor': 'end' }, String(h)));
    }
    const p = partesMadrid(datos.ini + 12 * 3_600_000);
    for (const hora of [6, 12, 18]) {
      const t = utcDesdeMadrid(p.anio, p.mes, p.dia, hora, 0);
      capaBase.append(el('line', { class: 'rejilla', x1: x(t), x2: x(t), y1: M.arr, y2: alto - M.aba }));
      capaBase.append(el('text', { class: 'eje', x: x(t), y: alto - 3, 'text-anchor': 'middle' }, `${hora}h`));
    }
    const pts = datos.serie.map((s) => `${x(s.t).toFixed(1)},${y(s.h).toFixed(1)}`);
    capaBase.append(el('path', { class: 'relleno', d: `M${x(datos.ini)},${y(Y_MIN)} L${pts.join(' L')} L${x(datos.fin)},${y(Y_MIN)} Z` }));
    capaBase.append(el('path', { class: 'linea', d: `M${pts.join(' L')}` }));
    for (const o of datos.oficiales) capaBase.append(el('circle', { class: 'oficial', cx: x(o.t), cy: y(o.altura), r: 4.5 }));
    for (const e of datos.extremos) {
      capaBase.append(el('circle', { class: 'extremo', cx: x(e.t), cy: y(e.altura), r: 2.5 }));
      const dy = e.tipo === 'pleamar' ? -6 : 13;
      capaBase.append(el('text', { class: 'etiqueta', x: x(e.t), y: y(e.altura) + dy, 'text-anchor': 'middle' }, horaMadrid(e.t)));
    }
  }

  /** Mueve las marcas de «ahora» y del instante elegido sin redibujar la curva. */
  function marcar(ahora: number, elegido: number, hElegido: number) {
    capaMarcas.replaceChildren();
    if (!datos || !ancho) return;
    if (ahora >= datos.ini && ahora < datos.fin) {
      capaMarcas.append(el('line', { class: 'ahora', x1: x(ahora), x2: x(ahora), y1: M.arr - 6, y2: alto - M.aba }));
      capaMarcas.append(el('text', { class: 'eje', x: x(ahora) + 3, y: M.arr - 4 }, 'ahora'));
    }
    if (elegido >= datos.ini && elegido < datos.fin) {
      capaMarcas.append(el('line', { class: 'seleccion', x1: x(elegido), x2: x(elegido), y1: y(hElegido), y2: alto - M.aba }));
      capaMarcas.append(el('circle', { class: 'punto', cx: x(elegido), cy: y(hElegido), r: 5 }));
    }
  }

  // Tocar o arrastrar sobre la curva elige ese momento.
  let arrastrando = false;
  const elegir = (ev: PointerEvent) => {
    if (!datos) return;
    const r = svg.getBoundingClientRect();
    const t = tDesdeX(Math.min(Math.max(ev.clientX - r.left, M.izq), ancho - M.der));
    alElegir(Math.min(Math.max(t, datos.ini), datos.fin - 60_000));
  };
  svg.addEventListener('pointerdown', (ev) => { arrastrando = true; svg.setPointerCapture(ev.pointerId); elegir(ev); });
  svg.addEventListener('pointermove', (ev) => { if (arrastrando) elegir(ev); });
  svg.addEventListener('pointerup', () => { arrastrando = false; });
  svg.addEventListener('pointercancel', () => { arrastrando = false; });
  new ResizeObserver(dibujarBase).observe(svg);

  return {
    actualizar(d: DatosCurva) { datos = d; dibujarBase(); },
    marcar,
  };
}
