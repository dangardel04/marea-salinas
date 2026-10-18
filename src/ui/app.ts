// Interfaz: une motor de marea, corrección en vivo, escena 3D y controles de tiempo.
// Todo el estado de tiempo es UTC (ms); lo que se pinta pasa por src/tiempo.ts (Europe/Madrid).

import constantes from '../tide/constantes.json';
import { crearMotor, type Extremo } from '../tide/motor';
import { calcularCorreccion, correccionEn, leerObservaciones, type Correccion } from '../tide/correccion';
import { diaCortoMadrid, fechaLargaMadrid, fechaMadrid, horaMadrid, inicioDiaMadrid, inicioDiaSiguienteMadrid, zonaMadrid } from '../tiempo';
import { crearCurva } from './curva';
import { extremosOficiales, type ExtremoOficial } from './ihm';
import { ICONOS } from './iconos';

const MIN = 60_000, HORA = 3_600_000, DIA = 86_400_000;
const REFRESCO_CORRECCION = 5 * MIN;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
/** Escribe solo si cambia, para no rehacer el DOM 8 veces por segundo. */
function poner(e: HTMLElement, valor: string, html = false) {
  if (e.dataset.v === valor) return;
  e.dataset.v = valor;
  if (html) e.innerHTML = valor; else e.textContent = valor;
}
const metros = (h: number) => h.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface DestinoEscena { actualizar(e: { t: number; nivel: number; nivelMax6h: number }): void }

export function iniciarInterfaz() {
  const motor = crearMotor({ z0: constantes.z0Ch, constituyentes: constantes.constituyentes });

  // ---------- Estado ----------
  let correccion: Correccion | null = null;
  let estadoMareografo: 'conectando' | 'ok' | 'sin-datos' = 'conectando';
  let modo: 'ahora' | 'manual' = 'ahora';
  let tSel = Date.now();
  let reproduciendo = false;
  let velocidad = 600; // segundos simulados por segundo real
  let escena: DestinoEscena | null = null;
  let rango = calcularRango(Date.now());

  const nivel = (t: number) => motor.altura(t) + correccionEn(correccion, t);

  function calcularRango(ahora: number) {
    const ini = inicioDiaMadrid(ahora);
    const fin = inicioDiaSiguienteMadrid(ini + 7 * DIA + 12 * HORA); // hoy + 7 días completos
    return { ini, fin };
  }

  // ---------- Elementos ----------
  const el = {
    momento: $('momento'), altura: $('altura'), tendencia: $('tendencia'),
    modo: $('modo'), modoEtiqueta: $('modo-etiqueta'), modoDetalle: $('modo-detalle'),
    plHora: $('pleamar-hora'), plAlt: $('pleamar-altura'), plOf: $('pleamar-oficial'),
    bjHora: $('bajamar-hora'), bjAlt: $('bajamar-altura'), bjOf: $('bajamar-oficial'),
    curvaDia: $('curva-dia'), seleccion: $('seleccion'), rango: $('rango'), dias: $('dias'),
    tiempo: $<HTMLInputElement>('tiempo'), ahora: $<HTMLButtonElement>('ahora'),
    reproducir: $<HTMLButtonElement>('reproducir'), velocidad: $<HTMLSelectElement>('velocidad'),
    tema: $<HTMLButtonElement>('tema'),
  };
  el.ahora.innerHTML = `${ICONOS.ahora}<span>Ahora</span>`;
  $('icono-info').innerHTML = ICONOS.info;

  // ---------- Tema ----------
  const TEMAS = ['sistema', 'light', 'dark'] as const;
  const NOMBRE_TEMA = { sistema: 'Tema del sistema', light: 'Tema claro', dark: 'Tema oscuro' };
  let tema: (typeof TEMAS)[number] = 'sistema';
  try { const g = localStorage.getItem('tema'); if (g === 'light' || g === 'dark') tema = g; } catch { /* sin almacenamiento */ }
  function aplicarTema() {
    if (tema === 'sistema') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = tema;
    el.tema.innerHTML = tema === 'sistema' ? ICONOS.monitor : tema === 'light' ? ICONOS.sol : ICONOS.luna;
    el.tema.setAttribute('aria-label', `${NOMBRE_TEMA[tema]}. Pulsa para cambiar`);
    el.tema.title = NOMBRE_TEMA[tema];
  }
  el.tema.addEventListener('click', () => {
    tema = TEMAS[(TEMAS.indexOf(tema) + 1) % TEMAS.length];
    try { localStorage.setItem('tema', tema); } catch { /* sin almacenamiento */ }
    aplicarTema();
  });
  aplicarTema();

  // ---------- Controles de tiempo ----------
  function prepararDeslizador() {
    el.tiempo.min = '0';
    el.tiempo.max = String(Math.round((rango.fin - rango.ini) / MIN));
    el.tiempo.step = '5';
    el.rango.textContent = `${fechaMadrid(rango.ini)} a ${fechaMadrid(rango.fin - MIN)}`;
    el.dias.replaceChildren();
    for (let d = rango.ini; d < rango.fin; d = inicioDiaSiguienteMadrid(d)) {
      const s = document.createElement('span');
      s.style.left = `${((d - rango.ini) / (rango.fin - rango.ini)) * 100}%`;
      s.textContent = diaCortoMadrid(d);
      if (d === rango.ini) s.style.transform = 'none';
      el.dias.append(s);
    }
  }
  prepararDeslizador();

  function irA(t: number) {
    modo = 'manual';
    tSel = Math.min(Math.max(t, rango.ini), rango.fin - MIN);
  }
  el.tiempo.addEventListener('input', () => { irA(rango.ini + Number(el.tiempo.value) * MIN); });
  el.ahora.addEventListener('click', () => { modo = 'ahora'; reproduciendo = false; tSel = Date.now(); });
  el.reproducir.addEventListener('click', () => {
    reproduciendo = !reproduciendo;
    if (reproduciendo && modo === 'ahora') modo = 'manual';
    if (reproduciendo && tSel >= rango.fin - 2 * MIN) tSel = rango.ini;
  });
  el.velocidad.addEventListener('change', () => { velocidad = Number(el.velocidad.value); });

  const curva = crearCurva($('curva') as unknown as SVGSVGElement, (t) => { reproduciendo = false; irA(t); });

  // ---------- Corrección en vivo ----------
  async function refrescarCorreccion() {
    try {
      const obs = await leerObservaciones(Date.now(), AbortSignal.timeout(15_000));
      correccion = calcularCorreccion(obs, motor, Date.now());
      estadoMareografo = correccion ? 'ok' : 'sin-datos';
    } catch {
      correccion = null;
      estadoMareografo = 'sin-datos';
    }
    claveCurva = '';
  }
  refrescarCorreccion();
  setInterval(refrescarCorreccion, REFRESCO_CORRECCION);

  // ---------- Tabla oficial (opcional) ----------
  let oficiales: ExtremoOficial[] = [];
  let claveOficiales = '';
  const leyendaIhm = $('leyenda-ihm');
  function pedirOficiales(ini: number, fin: number) {
    const clave = `${ini}-${fin}`;
    if (clave === claveOficiales) return;
    claveOficiales = clave;
    extremosOficiales(ini, fin)
      .then((o) => { if (claveOficiales === clave) { oficiales = o; claveCurva = ''; leyendaIhm.hidden = o.length === 0; } })
      // Sin red o sin servicio: se quita la referencia oficial y se reintenta en el siguiente día pedido.
      .catch(() => { oficiales = []; claveOficiales = ''; leyendaIhm.hidden = true; });
  }

  // ---------- Dibujo ----------
  let claveCurva = '';
  let ultimoTexto = 0;
  let ultimoMax = { t: NaN, v: 0 };

  function maxUltimas6h(t: number) {
    // Se recalcula si el instante se mueve más de 2 min (36 muestras, barato).
    if (Math.abs(t - ultimoMax.t) < 2 * MIN) return ultimoMax.v;
    let m = -Infinity;
    for (let k = 0; k <= 36; k++) m = Math.max(m, nivel(t - k * 10 * MIN));
    ultimoMax = { t, v: m };
    return m;
  }

  function extremosConCorreccion(ini: number, fin: number): Extremo[] {
    return motor.extremos(ini, fin).map((e) => ({ ...e, altura: e.altura + correccionEn(correccion, e.t) }));
  }

  function oficialCercano(e: Extremo | undefined): string {
    if (!e) return '';
    const o = oficiales.find((x) => x.tipo === e.tipo && Math.abs(x.t - e.t) < 2 * HORA);
    return o ? `IHM ${horaMadrid(o.t)} · ${metros(o.altura)} m` : '';
  }

  function pintarTextos(t: number, ahoraReal: number) {
    poner(el.momento, `${fechaLargaMadrid(t)}, ${horaMadrid(t)} ${zonaMadrid(t)}`);
    poner(el.altura, `${metros(nivel(t))}<small>m</small>`, true);
    const d = motor.tendencia(t);
    const cmh = Math.abs(Math.round(d.cmPorHora));
    poner(el.tendencia, `${d.sentido === 'subiendo' ? ICONOS.flechaArriba : ICONOS.flechaAbajo}<span>${d.sentido === 'subiendo' ? 'Subiendo' : 'Bajando'} · <span class="num">${cmh}</span> cm/h</span>`, true);

    const sig = motor.proximos(t);
    const pl = sig.pleamar && { ...sig.pleamar, altura: sig.pleamar.altura + correccionEn(correccion, sig.pleamar.t) };
    const bj = sig.bajamar && { ...sig.bajamar, altura: sig.bajamar.altura + correccionEn(correccion, sig.bajamar.t) };
    const diaDe = (x: number) => (inicioDiaMadrid(x) === inicioDiaMadrid(t) ? '' : `${fechaMadrid(x)}, `);
    el.plHora.textContent = pl ? horaMadrid(pl.t) : '--:--';
    el.plAlt.textContent = pl ? `${diaDe(pl.t)}${metros(pl.altura)} m` : '';
    el.plOf.textContent = oficialCercano(pl);
    el.bjHora.textContent = bj ? horaMadrid(bj.t) : '--:--';
    el.bjAlt.textContent = bj ? `${diaDe(bj.t)}${metros(bj.altura)} m` : '';
    el.bjOf.textContent = oficialCercano(bj);

    // Predicción o predicción + corrección, según el instante elegido.
    let estado = 'prediccion', etiqueta = 'Predicción', detalle: string;
    if (correccion) {
      estado = 'corregido'; etiqueta = 'Predicción + corrección';
      const cm = Math.round(correccionEn(correccion, t) * 100);
      const hace = Math.max(0, Math.round((ahoraReal - correccion.t0) / MIN));
      detalle = `El mareógrafo de Avilés marca ${Math.round(correccion.r0 * 100) >= 0 ? '+' : ''}${Math.round(correccion.r0 * 100)} cm respecto a lo previsto (dato de hace ${hace} min). Corrección aplicada aquí: ${cm >= 0 ? '+' : ''}${cm} cm, se atenúa con los días.`;
    } else if (estadoMareografo === 'conectando') {
      detalle = 'Conectando con el mareógrafo de Avilés…';
    } else {
      detalle = 'Sin datos recientes del mareógrafo de Avilés: solo marea astronómica (sin viento ni presión).';
    }
    if (el.modo.dataset.estado !== estado) el.modo.dataset.estado = estado;
    poner(el.modoEtiqueta, etiqueta);
    poner(el.modoDetalle, detalle);

    el.seleccion.textContent = modo === 'ahora' ? `Ahora · ${horaMadrid(t)}` : `${fechaMadrid(t)}, ${horaMadrid(t)}`;
    el.tiempo.value = String(Math.round((t - rango.ini) / MIN));
    el.tiempo.setAttribute('aria-valuetext', `${fechaLargaMadrid(t)}, ${horaMadrid(t)}`);
    poner(el.reproducir, reproduciendo ? ICONOS.pausa : ICONOS.play, true);
    el.reproducir.setAttribute('aria-label', reproduciendo ? 'Pausar' : 'Reproducir');
    el.ahora.setAttribute('aria-pressed', String(modo === 'ahora'));
  }

  function pintarCurva(t: number) {
    const ini = inicioDiaMadrid(t), fin = inicioDiaSiguienteMadrid(ini);
    pedirOficiales(ini, fin + 30 * HORA);
    const clave = `${ini}-${correccion?.t0 ?? 0}-${oficiales.length}`;
    if (clave === claveCurva) return;
    claveCurva = clave;
    const serie = [];
    for (let s = ini; s <= fin; s += 10 * MIN) serie.push({ t: s, h: nivel(s) });
    curva.actualizar({ ini, fin, serie, extremos: extremosConCorreccion(ini, fin), oficiales: oficiales.filter((o) => o.t >= ini && o.t < fin) });
    el.curvaDia.textContent = inicioDiaMadrid(Date.now()) === ini ? `Hoy, ${fechaMadrid(ini)}` : fechaLargaMadrid(ini);
  }

  // ---------- Bucle ----------
  let previo = performance.now();
  function cuadro(ahoraPerf: number) {
    const dt = Math.min((ahoraPerf - previo) / 1000, 0.25);
    previo = ahoraPerf;
    const ahoraReal = Date.now();
    if (inicioDiaMadrid(ahoraReal) !== rango.ini) { rango = calcularRango(ahoraReal); prepararDeslizador(); }
    if (modo === 'ahora') tSel = ahoraReal;
    else if (reproduciendo) {
      tSel += dt * velocidad * 1000;
      if (tSel >= rango.fin - MIN) { tSel = rango.fin - MIN; reproduciendo = false; }
    }
    escena?.actualizar({ t: tSel, nivel: nivel(tSel), nivelMax6h: maxUltimas6h(tSel) });
    // Textos y curva a ~8 Hz: suficiente y más barato.
    if (ahoraPerf - ultimoTexto > 120) {
      ultimoTexto = ahoraPerf;
      pintarCurva(tSel);
      pintarTextos(tSel, ahoraReal);
      curva.marcar(ahoraReal, tSel, nivel(tSel));
    }
    requestAnimationFrame(cuadro);
  }
  requestAnimationFrame(cuadro);

  return {
    conectarEscena(e: DestinoEscena) { escena = e; },
  };
}
