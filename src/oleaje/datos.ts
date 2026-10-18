// Datos de oleaje: previsión horaria de Open-Meteo Marine (modelo) y boya de Gijón de
// Puertos del Estado (medida). Ambos con CORS. Tiempos en ms UTC. Ver FUENTES.md §5.

export interface EstadoMar {
  /** Altura significante total, m. */
  hs: number;
  /** Periodo de pico, s. */
  tp: number;
  /** Dirección de procedencia, grados desde el norte. */
  dir: number;
  /** Mar de fondo (swell) y mar de viento, si la fuente los separa. */
  fondo?: { hs: number; tp: number; dir: number };
  viento?: { hs: number; tp: number; dir: number };
}

export interface Serie { t: number[]; e: EstadoMar[]; fuente: string }

/** Punto pedido a Open-Meteo: frente a Salinas; el modelo devuelve la celda marina más cercana. */
export const PUNTO_PREVISION = { lat: 43.6, lon: -5.96 };
export const BOYA_GIJON = { id: 1117, nombre: 'Boya de Gijón (Puertos del Estado)', lat: 43.615, lon: -5.664 };

export async function leerPrevision(señal?: AbortSignal): Promise<Serie & { celda: { lat: number; lon: number } }> {
  const v = ['wave_height', 'wave_direction', 'wave_peak_period', 'wave_period', 'swell_wave_height', 'swell_wave_direction', 'swell_wave_peak_period', 'wind_wave_height', 'wind_wave_direction', 'wind_wave_peak_period'];
  const url = `https://marine-api.open-meteo.com/v1/marine?latitude=${PUNTO_PREVISION.lat}&longitude=${PUNTO_PREVISION.lon}`
    + `&hourly=${v.join(',')}&past_days=2&forecast_days=8&timezone=GMT&cell_selection=sea`;
  const r = await fetch(url, { signal: señal });
  if (!r.ok) throw new Error(`Open-Meteo ${r.status}`);
  const j = await r.json();
  const h = j.hourly;
  const t: number[] = [], e: EstadoMar[] = [];
  h.time.forEach((iso: string, k: number) => {
    const hs = h.wave_height[k];
    if (hs == null) return;
    t.push(Date.parse(iso + ':00Z'));
    e.push({
      hs,
      tp: h.wave_peak_period[k] ?? h.wave_period[k],
      dir: h.wave_direction[k],
      fondo: h.swell_wave_height[k] != null ? { hs: h.swell_wave_height[k], tp: h.swell_wave_peak_period[k], dir: h.swell_wave_direction[k] } : undefined,
      viento: h.wind_wave_height[k] != null ? { hs: h.wind_wave_height[k], tp: h.wind_wave_peak_period[k], dir: h.wind_wave_direction[k] } : undefined,
    });
  });
  return { t, e, fuente: 'Open-Meteo Marine (modelo)', celda: { lat: j.latitude, lon: j.longitude } };
}

const aaaammddhhmm = (t: number) => {
  const d = new Date(t), p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}@${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
};

/** Últimas `horas` de la boya de Gijón (Hm0, Tp, dirección media de procedencia). */
export async function leerBoya(ahora: number, horas = 48, señal?: AbortSignal): Promise<Serie> {
  const url = `https://poem.puertos.es/portus/StationData?code=${BOYA_GIJON.id}&params=Hm0,Tp,MeanDir`
    + `&from=${aaaammddhhmm(ahora - horas * 3_600_000)}&to=${aaaammddhhmm(ahora + 3_600_000)}`;
  const r = await fetch(url, { signal: señal });
  if (!r.ok) throw new Error(`Portus ${r.status}`);
  const j = await r.json() as [unknown, [number, [number, number], [number, number], [number, number]][]];
  const t: number[] = [], e: EstadoMar[] = [];
  for (const [s, [hs, q1], [tp, q2], [dir, q3]] of j[1]) {
    if (q1 !== 1 || q2 !== 1 || q3 !== 1) continue;
    t.push(s * 1000);
    e.push({ hs, tp, dir });
  }
  return { t, e, fuente: BOYA_GIJON.nombre };
}

const interpAng = (a: number, b: number, f: number) => {
  const d = ((b - a + 540) % 360) - 180;
  return (a + d * f + 360) % 360;
};

/** Estado del mar en t, interpolado entre las horas de la serie (null fuera de rango). */
export function estadoEn(s: Serie | null, t: number): EstadoMar | null {
  if (!s || !s.t.length || t < s.t[0] || t > s.t[s.t.length - 1]) return null;
  let k = 0;
  while (k < s.t.length - 2 && s.t[k + 1] <= t) k++;
  const a = s.e[k], b = s.e[k + 1] ?? a;
  const f = s.t[k + 1] > s.t[k] ? (t - s.t[k]) / (s.t[k + 1] - s.t[k]) : 0;
  const mezcla = (x?: { hs: number; tp: number; dir: number }, y?: { hs: number; tp: number; dir: number }) =>
    x && y ? { hs: x.hs + (y.hs - x.hs) * f, tp: x.tp + (y.tp - x.tp) * f, dir: interpAng(x.dir, y.dir, f) } : undefined;
  return {
    hs: a.hs + (b.hs - a.hs) * f,
    tp: a.tp + (b.tp - a.tp) * f,
    dir: interpAng(a.dir, b.dir, f),
    fondo: mezcla(a.fondo, b.fondo),
    viento: mezcla(a.viento, b.viento),
  };
}

const PUNTOS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];
/** Rumbo de procedencia en texto (16 rumbos, en español). */
export const rumbo = (g: number) => PUNTOS[Math.round((((g % 360) + 360) % 360) / 22.5) % 16];
