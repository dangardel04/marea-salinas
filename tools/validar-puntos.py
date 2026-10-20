# Comprueba, en cada punto con nombre del selector de la web, los metros de arena que da la web
# frente a los que se ven en las imágenes Sentinel‑2 a la misma marea.
#
# Uso (después de tools/validar-ancho.py):  python tools/validar-puntos.py
# Salida: data/validacion_puntos.json
#
# Mismo método que src/scene/bahia/arena.ts: dirección hacia el mar de los dos perfiles de playa
# más cercanos; pie del muro buscado en el relieve desde el borde; agua hasta nivel + subida medida
# (bahia-orilla.json); mediana de los puntos vecinos del muro (±4). Observado: la orilla de cada imagen en el perfil más cercano, proyectada en
# esa misma dirección y medida desde ese mismo pie.

import json, math, os
import numpy as np

RAIZ = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
src = open(os.path.join(RAIZ, 'tools', 'validar-ancho.py'), encoding='utf-8').read().split('# ---------- Orillas observadas')[0]
g = {'__file__': os.path.join(RAIZ, 'tools', 'validar-ancho.py')}; exec(src, g)
altura, D = g['altura'], g['D']
exec('#' + open(os.path.join(RAIZ, 'tools', 'validar-ancho.py'), encoding='utf-8').read().split('# ---------- Orillas observadas')[1].split('O = json.load')[0], g)
orilla = g['orilla']

O = json.load(open(os.path.join(RAIZ, 'data', 'raw', 's2_orillas.json')))
P = O['perfiles']
orillaMeta = json.load(open(os.path.join(RAIZ, 'src', 'scene', 'bahia-orilla.json'), encoding='utf-8'))
paseo = json.load(open(os.path.join(RAIZ, 'src', 'scene', 'bahia-paseo.json'), encoding='utf-8'))
pies = [t for tr in paseo['tramos'] for t in tr]
subida = lambda n: float(np.interp(n, orillaMeta['nivel'], orillaMeta['subida']))
corr = json.load(open(os.path.join(RAIZ, 'src', 'scene', 'bahia-correccion-arena.json'), encoding='utf-8'))
def correccion(i, nivel):
    fila = corr['perfiles'].get(str(i))
    if not fila: return 0.0
    xs = [n for n, v in zip(corr['niveles'], fila) if v is not None]; ys = [v for v in fila if v is not None]
    if not xs: return 0.0
    if nivel > xs[-1]:
        t = min(1.0, (nivel - xs[-1]) / 0.8); return ys[-1] * (1 - t * t * (3 - 2 * t))
    return float(np.interp(nivel, xs, ys))

def hacia_mar(x0, z0):
    d = sorted(((math.hypot(p['bx'] - x0, p['bz'] - z0), p) for p in P), key=lambda q: q[0])[:2]
    wa, wb = 1 / max(d[0][0], 1), 1 / max(d[1][0], 1)
    nx = d[0][1]['nx'] * wa + d[1][1]['nx'] * wb; nz = d[0][1]['nz'] * wa + d[1][1]['nz'] * wb
    l = math.hypot(nx, nz); return nx / l, nz / l

def pie(k):
    x0, y0, z0 = pies[k]['arriba']; dx, dz = hacia_mar(x0, z0)
    h = lambda d: altura(x0 + dx * d, z0 + dz * d)
    for d in np.arange(0, 45.5, 0.5):
        if h(d) < y0 - 1 and abs(h(d + 2) - h(d)) < 0.5: return x0 + dx * d, z0 + dz * d, dx, dz
    return pies[k]['pie'][0], pies[k]['pie'][2], dx, dz

VECINOS = 4  # como arena.ts: la medida es la mediana de los puntos del muro a ±4

def ancho_modelo(px, pz, dx, dz, nivel):
    linea = nivel + subida(nivel)
    perfil = np.array([altura(px + dx * d, pz + dz * d) for d in np.arange(0, 701, 1.0)])
    agua = np.where(perfil < linea)[0]
    return float(agua[0]) if len(agua) else None

# Puntos del selector (mismos criterios que arena.ts)
puntos = []
for l in paseo['lugares']:
    dd = [math.hypot(p['pie'][0] - l['x'], p['pie'][2] - l['z']) for p in pies]
    k = int(np.argmin(dd))
    if dd[k] <= 60: puntos.append((l['nombre'], k))
puntos += [('extremo oeste', 0), ('extremo este', len(pies) - 1)]

salida = {'nota': 'metros de arena del pie del muro al agua: web (con la subida medida y la corrección local; en muestra) frente a lo visto en Sentinel-2 a la misma marea; mediana por tramos de nivel', 'puntos': {}}
for nombre, k in sorted(puntos, key=lambda q: q[1]):
    px, pz, dx, dz = pie(k)
    vecinos = [pie(j) for j in range(max(0, k - VECINOS), min(len(pies), k + VECINOS + 1))]
    i = int(np.argmin([math.hypot(p['bx'] - px, p['bz'] - pz) for p in P]))
    pr = P[i]
    filas = []
    for e in O['escenas']:
        do = orilla(e['mndwi'][i], e['umbral'])
        if do is None: continue
        ox, oz = pr['bx'] + do * pr['nx'], pr['bz'] + do * pr['nz']
        obs = (ox - px) * dx + (oz - pz) * dz
        # Como la web: mediana de los puntos vecinos del muro (±VECINOS).
        vals = []
        for j in vecinos:
            qx, qz, qdx, qdz = j
            m = ancho_modelo(qx, qz, qdx, qdz, e['nivel'])
            ib = int(np.argmin([math.hypot(p['bx'] - qx, p['bz'] - qz) for p in P]))
            if m is not None: vals.append(max(0.0, m + correccion(ib, e['nivel'])))
        mod = float(np.median(vals)) if vals else None
        if mod is not None: filas.append((e['nivel'], obs, mod))
    tramos = {}
    for a, b in [(0, 1.5), (1.5, 2.5), (2.5, 3.0), (3.0, 3.6)]:
        s = [f for f in filas if a <= f[0] < b]
        if len(s) >= 4:
            tramos[f'{a}-{b}'] = {'casos': len(s), 'observado_m': round(float(np.median([f[1] for f in s]))),
                                  'web_m': round(float(np.median([f[2] for f in s]))),
                                  'diferencia_m': round(float(np.median([f[2] - f[1] for f in s])))}
    salida['puntos'][nombre] = {'perfilSentinel': i, 'distanciaPerfil_m': round(math.hypot(pr['bx'] - px, pr['bz'] - pz)), 'tramos': tramos}
    print(nombre, salida['puntos'][nombre])
json.dump(salida, open(os.path.join(RAIZ, 'data', 'validacion_puntos.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
