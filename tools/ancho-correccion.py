# Corrección local del ancho de arena con lo observado por Sentinel‑2 (2025‑2026).
#
# Uso (después de tools/validar-ancho.py):  python tools/ancho-correccion.py
# Salida: src/scene/bahia-correccion-arena.json y data/validacion_correccion_arena.json
#
# El relieve de la arena alta es el LiDAR de agosto de 2024 y la playa ha cambiado desde entonces
# (más arena en un sitio, menos en otro). Con la subida media de la orilla (bahia-orilla.json) el
# ancho sale bien en promedio, pero en un punto concreto puede fallar en ±25 m. Aquí, para cada
# perfil de playa con muro y cada tramo de nivel, se calcula cuánto difiere el ancho observado del
# que da la web (mediana con los perfiles vecinos) y la web lo suma.
# Se valida dejando fuera cada imagen entera. (Se probó también pasar la corrección al relieve,
# subiendo o bajando la arena: con las barras y canales la orilla salta y no fue robusto.)
#
# El ancho se mide como en la web (src/scene/bahia/arena.ts): dirección de los dos perfiles más
# cercanos, pie del muro buscado en el relieve desde el borde (donde acaba su cara: pendiente < 25 %), agua hasta nivel + subida medida.

import json, math, os
import numpy as np

RAIZ = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
texto = open(os.path.join(RAIZ, 'tools', 'validar-ancho.py'), encoding='utf-8').read()
g = {'__file__': os.path.join(RAIZ, 'tools', 'validar-ancho.py')}
exec(texto.split('# ---------- Orillas observadas')[0], g)
exec('#' + texto.split('# ---------- Orillas observadas')[1].split('O = json.load')[0], g)
altura, orilla = g['altura'], g['orilla']

O = json.load(open(os.path.join(RAIZ, 'data', 'raw', 's2_orillas.json')))
P = O['perfiles']
om = json.load(open(os.path.join(RAIZ, 'src', 'scene', 'bahia-orilla.json'), encoding='utf-8'))
paseo = json.load(open(os.path.join(RAIZ, 'src', 'scene', 'bahia-paseo.json'), encoding='utf-8'))
pies = [t for tr in paseo['tramos'] for t in tr]
subida = lambda n: float(np.interp(n, om['nivel'], om['subida']))
BANDAS = [(0.0, 1.5), (1.5, 2.5), (2.5, 3.0), (3.0, 3.7)]
# Robustez (elegida dejando fuera cada imagen): ±3 perfiles vecinos (175 m de playa), al menos
# 15 casos, la mediana se encoge hacia 0 con pocos datos (n/(n+10)) y se limita a ±40 m.
VECINOS, N_MIN, ENCOGE, TOPE = 3, 15, 10, 40

def hacia_mar(x0, z0):
    d = sorted(((math.hypot(p['bx'] - x0, p['bz'] - z0), p) for p in P), key=lambda q: q[0])[:2]
    wa, wb = 1 / max(d[0][0], 1), 1 / max(d[1][0], 1)
    nx = d[0][1]['nx'] * wa + d[1][1]['nx'] * wb; nz = d[0][1]['nz'] * wa + d[1][1]['nz'] * wb
    l = math.hypot(nx, nz); return nx / l, nz / l

def pie_muro(k):
    x0, y0, z0 = pies[k]['arriba']; dx, dz = hacia_mar(x0, z0)
    h = lambda d: altura(x0 + dx * d, z0 + dz * d)
    for d in np.arange(0, 45.5, 0.5):
        if h(d) < y0 - 1 and abs(h(d + 2) - h(d)) < 0.5: return x0 + dx * d, z0 + dz * d, dx, dz
    return pies[k]['pie'][0], pies[k]['pie'][2], dx, dz

# Para cada perfil de playa: el punto del muro más cercano (si está a menos de 80 m) y su pie.
perfil_muro = {}
for i, p in enumerate(P):
    dd = [math.hypot(q['arriba'][0] - p['bx'], q['arriba'][2] - p['bz']) for q in pies]
    k = int(np.argmin(dd))
    if dd[k] < 80: perfil_muro[i] = pie_muro(k)
print(f'Perfiles con muro: {len(perfil_muro)}')

def borde_agua(hs, linea):
    """Orilla como la ve el satélite (y la web con la cota de rebose): el borde de la arena más
    hacia el mar, con agua en al menos el 90 % de lo que queda; un canal o charco detrás de una
    barra de arena cuenta como arena."""
    agua = np.asarray(hs) < linea
    if agua[0]: return 0.0
    for k in range(len(agua) - 1, 0, -1):
        if agua[k] and not agua[k - 1] and agua[k:].mean() >= 0.9: return float(k)
    return None

def ancho_modelo(px, pz, dx, dz, nivel):
    hs = [altura(px + dx * d, pz + dz * d) for d in range(0, 701)]
    return borde_agua(hs, nivel + subida(nivel))

# Casos: (perfil, imagen, nivel, observado, modelo)
casos = []
for i, (px, pz, dx, dz) in perfil_muro.items():
    pr = P[i]
    cache = {}
    for e in O['escenas']:
        do = orilla(e['mndwi'][i], e['umbral'])
        if do is None: continue
        ox, oz = pr['bx'] + do * pr['nx'], pr['bz'] + do * pr['nz']
        obs = (ox - px) * dx + (oz - pz) * dz
        n = round(e['nivel'], 2)
        if n not in cache: cache[n] = ancho_modelo(px, pz, dx, dz, e['nivel'])
        if cache[n] is not None and obs > -5: casos.append((i, e['id'], e['nivel'], obs, cache[n]))
print(f'Casos: {len(casos)}')

def tabla(sel):
    """Corrección (observado − web) por perfil y banda, con los vecinos; NaN si hay pocos casos."""
    t = {}
    for i in perfil_muro:
        fila = []
        for a, b in BANDAS:
            v = [c[3] - c[4] for c in sel if abs(c[0] - i) <= VECINOS and a <= c[2] < b]
            if len(v) < N_MIN: fila.append(float('nan')); continue
            fila.append(float(np.clip(np.median(v) * len(v) / (len(v) + ENCOGE), -TOPE, TOPE)))
        t[i] = fila
    return t

centros = [float(np.median([c[2] for c in casos if a <= c[2] < b])) for a, b in BANDAS]

def aplicar(t, i, nivel):
    f = np.array(t[i]); ok = ~np.isnan(f)
    if not ok.any(): return 0.0
    return float(np.interp(nivel, np.array(centros)[ok], f[ok]))

err0, err1, zona = [], [], []
for e in sorted({c[1] for c in casos}):
    t = tabla([c for c in casos if c[1] != e])
    for c in casos:
        if c[1] != e: continue
        err0.append(c[4] - c[3]); err1.append(c[4] + aplicar(t, c[0], c[2]) - c[3]); zona.append(P[c[0]]['bx'])
err0, err1, zona = map(np.array, (err0, err1, zona))
def est(x):
    m = float(np.median(x)); return {'casos': int(len(x)), 'sesgo_m': round(m, 1), 'mad_m': round(float(1.4826 * np.median(np.abs(x - m))), 1),
                                     'p75abs_m': round(float(np.percentile(np.abs(x), 75)), 1)}
res = {'todas': {'sin corrección': est(err0), 'con corrección local': est(err1)}}
for nom, (x0, x1) in {'Salinas oeste (x < −700)': (-1e9, -700), 'centro (−700 a −200)': (-700, -200), 'este (x > −200)': (-200, 1e9)}.items():
    s = (zona >= x0) & (zona < x1)
    res[nom] = {'sin corrección': est(err0[s]), 'con corrección local': est(err1[s])}
for k, v in res.items(): print(k, v)

t = tabla(casos)
json.dump({'fuente': 'tools/ancho-correccion.py: ancho observado en Sentinel-2 (2025-2026) menos el de la web, por perfil de playa (±3 vecinos) y tramo de nivel',
           'niveles': [round(c, 2) for c in centros],
           'perfiles': {str(i): [None if math.isnan(v) else round(v, 1) for v in f] for i, f in t.items()},
           'margen': int(5 * round(est(err1)['mad_m'] / 5))},
          open(os.path.join(RAIZ, 'src', 'scene', 'bahia-correccion-arena.json'), 'w', encoding='utf-8'), ensure_ascii=False)
json.dump({'nota': 'error = ancho de la web − observado (m), dejando fuera cada imagen', **res},
          open(os.path.join(RAIZ, 'data', 'validacion_correccion_arena.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
