# Muro del paseo de Salinas y lugares para orientarse, para dibujarlos como piezas limpias.
#
# Uso (desde la raíz del proyecto, después de tools/lidar-fino.py):  python tools/paseo-muro.py
# Necesita Python 3 con numpy y scipy. Entrada: data/raw/osm_paseo.osm (API de OpenStreetMap, se
# baja si no está) y el relieve fino de 1 m (public/bahia/fino.bin).
# Salida: src/scene/bahia-paseo.json
#
# Muro: a lo largo del «Paseo del Cantábrico» de OpenStreetMap (eje del paseo), cada 2 m, perfil
# perpendicular hacia el mar sobre el LiDAR de 2024: borde superior = último punto a la altura del
# paseo antes de la caída; pie = primer punto, ya en la arena, con poca pendiente. Donde la caída es
# de menos de 1,2 m (rampas, bajadas) no hay muro. Se suaviza a lo largo (mediana de 9 y media de 7).
# Lugares: nodos y vías con nombre de OpenStreetMap (museo, club, mirador, balneario, torres...).
# © colaboradores de OpenStreetMap, ODbL 1.0.

import json, math, os, urllib.request
import xml.etree.ElementTree as ET
import numpy as np
from scipy.ndimage import median_filter

RAIZ = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
RAW = os.path.join(RAIZ, 'data', 'raw')
CLAT, CLON = 43.589, -5.955
fi = math.radians(CLAT)
MLAT = 111132.92 - 559.82 * math.cos(2 * fi) + 1.175 * math.cos(4 * fi) - 0.0023 * math.cos(6 * fi)
MLON = 111412.84 * math.cos(fi) - 93.5 * math.cos(3 * fi) + 0.118 * math.cos(5 * fi)
loc = lambda la, lo: ((lo - CLON) * MLON, -(la - CLAT) * MLAT)

ruta = os.path.join(RAW, 'osm_paseo.osm')
if not os.path.exists(ruta):
    req = urllib.request.Request('https://api.openstreetmap.org/api/0.6/map?bbox=-5.972,43.574,-5.940,43.590', headers={'User-Agent': 'marea-salinas'})
    open(ruta, 'wb').write(urllib.request.urlopen(req, timeout=120).read())
r = ET.parse(ruta).getroot()
nodos = {n.get('id'): (float(n.get('lat')), float(n.get('lon'))) for n in r.findall('node')}
etiquetas = lambda el: {x.get('k'): x.get('v') for x in el.findall('tag')}

# ---------- Relieve fino ----------
meta = json.load(open(os.path.join(RAIZ, 'src', 'scene', 'bahia-fino.json'), encoding='utf-8'))
raw = np.fromfile(os.path.join(RAIZ, 'public', 'bahia', 'fino.bin'), dtype='<i2').reshape(-1, 101, 101)
bloques = {tuple(b): raw[k] for k, b in enumerate(meta['bloques'])}
def altura(x, z):
    bi, bj = math.floor(x / 100), math.floor(z / 100)
    b = bloques.get((bi, bj))
    if b is None: return np.nan
    u, v = x - bi * 100, z - bj * 100
    c0, f0 = min(int(u), 99), min(int(v), 99); fx, fy = u - c0, v - f0
    q = b[f0:f0 + 2, c0:c0 + 2].astype(float)
    if (q == -32768).any(): return np.nan
    q /= 100
    return (q[0, 0] * (1 - fx) + q[0, 1] * fx) * (1 - fy) + (q[1, 0] * (1 - fx) + q[1, 1] * fx) * fy

# ---------- Eje del paseo ----------
eje = None
for w in r.findall('way'):
    t = etiquetas(w)
    if t.get('name') == 'Paseo del Cantábrico' and t.get('highway') == 'pedestrian':
        eje = np.array([loc(*nodos[n.get('ref')]) for n in w.findall('nd') if n.get('ref') in nodos])
if eje is None: raise SystemExit('No está el Paseo del Cantábrico en los datos de OSM')
dl = np.r_[0, np.cumsum(np.hypot(*np.diff(eje, axis=0).T))]
s = np.arange(0, dl[-1], 2.0)
ex = np.interp(s, dl, eje[:, 0]); ez = np.interp(s, dl, eje[:, 1])
suav = lambda v: np.convolve(np.pad(v, 6, 'edge'), np.ones(13) / 13, 'valid')
tx, tz = np.gradient(suav(ex)), np.gradient(suav(ez))
nrm = np.maximum(np.hypot(tx, tz), 1e-9); nx, nz = -tz / nrm, tx / nrm
# hacia el mar = hacia donde baja el terreno a 40 m
for i in range(len(s)):
    if altura(ex[i] + 40 * nx[i], ez[i] + 40 * nz[i]) > altura(ex[i] - 40 * nx[i], ez[i] - 40 * nz[i]):
        nx[i], nz[i] = -nx[i], -nz[i]

D = np.arange(-6, 45, 0.5)
filas = []
for i in range(len(s)):
    hs = np.array([altura(ex[i] + d * nx[i], ez[i] + d * nz[i]) for d in D])
    if np.isnan(hs).mean() > 0.3:
        filas.append(None); continue
    hs = np.where(np.isnan(hs), np.nanmedian(hs), hs)
    hp = np.median(hs[(D >= -3) & (D <= 3)])          # cota del paseo en el eje
    pend = np.abs(np.gradient(hs, D))
    # borde: primer punto, hacia el mar, donde la pendiente pasa de 0,6 (empieza la caída)
    k0 = next((k for k in range(len(D)) if D[k] > 0 and pend[k] > 0.6), None)
    if k0 is None: filas.append(None); continue
    # pie: primer punto, tras el borde, con pendiente < 0,15 durante 2 m (ya es arena)
    k1 = next((k for k in range(k0 + 1, len(D) - 4) if (pend[k:k + 4] < 0.15).all()), None)
    if k1 is None: filas.append(None); continue
    caida = hs[k0] - hs[k1]
    if caida < 1.2 or D[k1] - D[k0] > 12: filas.append(None); continue
    filas.append((D[k0], hs[k0], D[k1], hs[k1], hp))

# Suavizado a lo largo y tramos continuos
ok = np.array([f is not None for f in filas])
A = np.array([f if f is not None else (np.nan,) * 5 for f in filas], float)
for c in range(5):
    col = A[:, c].copy()
    v = ~np.isnan(col)
    if v.sum() > 9:
        # mediana de 9 (quita saltos) y media móvil de 7 (quita el zigzag): ~16 m de playa
        col[v] = median_filter(col[v], 9)
        col[v] = np.convolve(np.pad(col[v], 3, 'edge'), np.ones(7) / 7, 'valid')
    A[:, c] = col
tramos, actual = [], []
for i in range(len(s)):
    if ok[i]:
        d0, h0, d1, h1, hp = A[i]
        actual.append({'arriba': [round(ex[i] + d0 * nx[i], 2), round(h0, 2), round(ez[i] + d0 * nz[i], 2)],
                       'pie': [round(ex[i] + d1 * nx[i], 2), round(h1, 2), round(ez[i] + d1 * nz[i], 2)],
                       'eje': [round(ex[i], 2), round(hp, 2), round(ez[i], 2)]})
    elif actual:
        if len(actual) >= 3: tramos.append(actual)
        actual = []
if len(actual) >= 3: tramos.append(actual)

# ---------- Lugares para orientarse ----------
quiero = {
    'Real Club Náutico de Salinas': 'Club Náutico', 'Museo de las Anclas Philippe Cousteau': 'Museo de las Anclas',
    'Balneario de Salinas': 'Balneario', 'Mirador de Salinas': 'Mirador de Salinas', 'Dunas del Espartal': 'Dunas de El Espartal',
    'Edificio Gauzón I': 'Torres Gauzón', 'Edificio Miramar': 'Edificio Miramar', 'Iglesia de Nuestra Señora del Carmen': 'Iglesia del Carmen',
}
lugares = []
for el in list(r.findall('node')) + list(r.findall('way')):
    t = etiquetas(el); n = t.get('name')
    if n == 'La Peñona' and el.tag == 'node' and not t.get('amenity'): quiero_n = 'La Peñona'
    elif n in quiero: quiero_n = quiero[n]
    else: continue
    if el.tag == 'node': x, z = loc(*nodos[el.get('id')])
    else:
        pts = np.array([loc(*nodos[q.get('ref')]) for q in el.findall('nd') if q.get('ref') in nodos]); x, z = pts.mean(0)
    h = altura(x, z)
    lugares.append({'nombre': quiero_n, 'x': round(float(x), 1), 'z': round(float(z), 1), 'y': None if np.isnan(h) else round(float(h), 1)})
# el paseo: en el centro de su eje
km = len(s) // 2
lugares.append({'nombre': 'Paseo del Cantábrico', 'x': round(float(ex[km]), 1), 'z': round(float(ez[km]), 1), 'y': None})

# Perfil de referencia para el ancho de arena: frente al Balneario (o el centro del paseo)
bal = next((l for l in lugares if l['nombre'] == 'Balneario'), lugares[-1])
iRef = int(np.argmin([(t['pie'][0] - bal['x']) ** 2 + (t['pie'][2] - bal['z']) ** 2 for tr in tramos for t in tr]))
todos = [t for tr in tramos for t in tr]
ref = todos[iRef]
dx, dz = ref['pie'][0] - ref['arriba'][0], ref['pie'][2] - ref['arriba'][2]
l = math.hypot(dx, dz) or 1
salida = {
    'fuente': 'Eje: «Paseo del Cantábrico» de OpenStreetMap (© colaboradores de OpenStreetMap, ODbL). Borde y pie del muro: relieve LiDAR PNOA 2024 de 1 m. Ver tools/paseo-muro.py',
    'tramos': tramos,
    'lugares': lugares,
    'perfilArena': {'nombre': 'frente al Balneario', 'pie': ref['pie'], 'haciaMar': [round(dx / l, 4), round(dz / l, 4)]},
}
json.dump(salida, open(os.path.join(RAIZ, 'src', 'scene', 'bahia-paseo.json'), 'w', encoding='utf-8'), ensure_ascii=False)
alt = np.array([t['arriba'][1] - t['pie'][1] for t in todos])
print(f'{len(tramos)} tramos de muro, {len(todos) * 2} m, altura del muro mediana {np.median(alt):.1f} m (p10 {np.percentile(alt, 10):.1f}, p90 {np.percentile(alt, 90):.1f}); {len(lugares)} lugares')
for l_ in lugares: print('  ', l_)
