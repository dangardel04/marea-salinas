# ¿Es real la distancia del muro al agua que da el modelo? Comparación con la línea de agua que se
# ve en las imágenes Sentinel‑2 (data/raw/s2_orillas.json, de tools/intermareal-s2.py).
#
# Uso (desde la raíz del proyecto):  python tools/validar-ancho.py
# Salida: data/validacion_ancho.json y un resumen en pantalla.
#
# Para cada imagen y perfil (cada 25 m de playa):
#   - observada: distancia, a lo largo del perfil, del pie del muro a la orilla de la imagen;
#   - modelo: la misma distancia hasta donde el relieve de la web queda por debajo de la cota de la
#     orilla (nivel medido + lo que las olas suben la orilla, medido igual que en la herramienta).
# Se separan las imágenes que entraron en el ajuste de la franja intermareal (no son prueba
# independiente) de las que no: mar de más de 1,3 m (Hs) y orillas por encima de +3,0 m, que caen
# sobre la arena del LiDAR.

import json, math, os
import numpy as np

RAIZ = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
RAW = os.path.join(RAIZ, 'data', 'raw')
N, PASO, LADO = 1281, 5, 6400
D = np.arange(-40, 400, 2.0)

# ---------- Relieve de la web: 5 m + fino de 1 m (como src/scene/bahia/relieve.ts, sin la fusión
# de 8 m del borde, que aquí no cambia nada apreciable) ----------
gr = np.fromfile(os.path.join(RAIZ, 'public', 'bahia', 'relieve.bin'), dtype='<i2').reshape(N, N) / 100.0
meta = json.load(open(os.path.join(RAIZ, 'src', 'scene', 'bahia-fino.json'), encoding='utf-8'))
raw = np.fromfile(os.path.join(RAIZ, 'public', 'bahia', 'fino.bin'), dtype='<i2').reshape(-1, 101, 101)
bloques = {tuple(b): raw[k] for k, b in enumerate(meta['bloques'])}

def grueso(x, z):
    c = (x + LADO / 2) / PASO; f = (z + LADO / 2) / PASO
    c0, f0 = int(c), int(f); fx, fy = c - c0, f - f0
    return (gr[f0, c0] * (1 - fx) + gr[f0, c0 + 1] * fx) * (1 - fy) + (gr[f0 + 1, c0] * (1 - fx) + gr[f0 + 1, c0 + 1] * fx) * fy

def altura(x, z):
    bi, bj = math.floor(x / 100), math.floor(z / 100)
    b = bloques.get((bi, bj))
    if b is not None:
        u, v = x - bi * 100, z - bj * 100
        c0, f0 = min(int(u), 99), min(int(v), 99); fx, fy = u - c0, v - f0
        q = b[f0:f0 + 2, c0:c0 + 2].astype(float)
        if not (q == -32768).any():
            q /= 100
            return (q[0, 0] * (1 - fx) + q[0, 1] * fx) * (1 - fy) + (q[1, 0] * (1 - fx) + q[1, 1] * fx) * fy
    return grueso(x, z)

# ---------- Orillas observadas (mismo criterio que tools/intermareal-s2.py) ----------
def orilla(v, um):
    v = np.asarray(v); agua = v >= um
    if agua[0] or agua.all(): return None
    for k in range(len(v) - 1, 0, -1):
        if not agua[k - 1] and agua[k]:
            if agua[k:].mean() < 0.9 or len(v) - k < 15: return None
            return float(D[k - 1] + (um - v[k - 1]) / (v[k] - v[k - 1]) * (D[k] - D[k - 1]))
    return None

O = json.load(open(os.path.join(RAW, 's2_orillas.json')))
P = O['perfiles']
ajuste = json.load(open(os.path.join(RAIZ, 'data', 'intermareal_s2.json'), encoding='utf-8'))
desplaz = ajuste['desplazamientoOrilla']['mediana']        # nivel − cota de la orilla (negativo)
HS_MAX, COTA_MAX = ajuste['hsMax'], ajuste['cotaMax']

# ---------- Pie del muro en cada perfil ----------
paseo = json.load(open(os.path.join(RAIZ, 'src', 'scene', 'bahia-paseo.json'), encoding='utf-8'))
pies = np.array([t['pie'] for tr in paseo['tramos'] for t in tr])
def pie_en(p):
    rx, rz = pies[:, 0] - p['bx'], pies[:, 2] - p['bz']
    along = rx * p['nx'] + rz * p['nz']; perp = np.abs(-rx * p['nz'] + rz * p['nx'])
    k = int(np.argmin(perp))
    return float(along[k]) if perp[k] < 6 else None

alturas = []
for p in P:
    alturas.append(np.array([altura(p['bx'] + d * p['nx'], p['bz'] + d * p['nz']) for d in D]))


filas = []
for e in O['escenas']:
    usada = e['hs'] is not None and e['hs'] < HS_MAX
    cota = e['nivel'] - desplaz                        # cota a la que llega la orilla
    for i, p in enumerate(P):
        dw = pie_en(p)
        if dw is None: continue
        dobs = orilla(e['mndwi'][i], e['umbral'])
        if dobs is None: continue
        dmod = orilla(cota - alturas[i], 0.0)
        if dmod is None: continue
        filas.append({'perfil': i, 'x': p['bx'], 'z': p['bz'], 'escena': e['id'], 'nivel': e['nivel'], 'hs': e['hs'],
                      'independiente': (not usada) or cota > COTA_MAX, 'obs': dobs - dw, 'mod': dmod - dw})

def resumen(sel, nombre):
    if not sel: print(f'{nombre}: sin casos'); return None
    err = np.array([f['mod'] - f['obs'] for f in sel]); obs = np.array([f['obs'] for f in sel])
    r = {'casos': len(sel), 'sesgo_m': round(float(np.median(err)), 1), 'mad_m': round(float(1.4826 * np.median(np.abs(err - np.median(err)))), 1),
         'p90abs_m': round(float(np.percentile(np.abs(err), 90)), 1), 'anchoObservadoMediano_m': round(float(np.median(obs)), 1)}
    print(f'{nombre}: {r}')
    return r

print(f'Perfiles con muro: {sum(pie_en(p) is not None for p in P)} de {len(P)}; desplazamiento de la orilla {desplaz:+.2f} m')
salida = {'nota': 'error = ancho de arena del modelo − ancho observado en Sentinel-2, del pie del muro a la orilla (m). Positivo: el modelo da más arena.',
          'todas': resumen(filas, 'Todas'),
          'usadasEnElAjuste': resumen([f for f in filas if not f['independiente']], 'Usadas en el ajuste'),
          'independientes': resumen([f for f in filas if f['independiente']], 'Independientes'),
          'independientesMarGrueso': resumen([f for f in filas if f['hs'] is not None and f['hs'] >= HS_MAX], 'Independientes, Hs ≥ 1,3 m'),
          'independientesPleamar': resumen([f for f in filas if f['nivel'] - desplaz > COTA_MAX], 'Independientes, orilla > +3 m (arena LiDAR)')}
for a, b in [(0, 1.5), (1.5, 2.5), (2.5, 3.5), (3.5, 6)]:
    salida[f'nivel_{a}_{b}'] = resumen([f for f in filas if a <= f['nivel'] < b], f'Nivel {a}–{b} m')
# por zonas de playa (x)
for nom, (x0, x1) in {'Salinas (oeste, x < −500)': (-1e9, -500), 'centro (−500 a 0)': (-500, 0), 'El Espartal (x > 0)': (0, 1e9)}.items():
    salida[nom] = resumen([f for f in filas if x0 <= f['x'] < x1], nom)

# ---------- Calibración: cuánto sube la orilla sobre el nivel del mar, según la marea ----------
# En cada caso, cota del suelo (relieve de la web) donde el satélite vio la orilla, menos el nivel
# medido. Mediana por tramos de nivel. Validación dejando fuera cada imagen entera: el ancho que
# daría el modelo con la subida calculada sin esa imagen frente al observado.
TRAMOS = [0.0, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5]
for f in filas:
    p = P[f['perfil']]; d = f['obs'] + pie_en(p)
    f['subida'] = altura(p['bx'] + d * p['nx'], p['bz'] + d * p['nz']) - f['nivel']

def tabla(sel):
    centros, subidas, casos = [], [], []
    for a, b in zip(TRAMOS[:-1], TRAMOS[1:]):
        v = [f['subida'] for f in sel if a <= f['nivel'] < b]
        if len(v) >= 30:
            centros.append(float(np.median([f['nivel'] for f in sel if a <= f['nivel'] < b])))
            subidas.append(float(np.median(v))); casos.append(len(v))
    return centros, subidas, casos

def ancho_modelo(i, cota):
    dm = orilla(cota - alturas[i], 0.0)
    return None if dm is None else dm - pie_en(P[i])

errAntes, errDespues, nivelesVal = [], [], []
for e in {f['escena'] for f in filas}:
    fuera = [f for f in filas if f['escena'] == e]
    c, s, _ = tabla([f for f in filas if f['escena'] != e])
    for f in fuera:
        am = ancho_modelo(f['perfil'], f['nivel'] + float(np.interp(f['nivel'], c, s)))
        if am is None: continue
        errAntes.append(f['mod'] - f['obs']); errDespues.append(am - f['obs']); nivelesVal.append(f['nivel'])
def est(x):
    x = np.array(x); m = float(np.median(x))
    return {'casos': len(x), 'sesgo_m': round(m, 1), 'mad_m': round(float(1.4826 * np.median(np.abs(x - m))), 1)}
c, s, n = tabla(filas)
salida['subidaOrilla'] = {
    'nota': 'cota del suelo en la orilla vista por Sentinel-2 menos el nivel medido en Avilés (m), mediana por tramos de nivel; '
            'la web la suma al nivel para saber hasta dónde llega el agua con las olas',
    'nivel': [round(v, 2) for v in c], 'subida': [round(v, 2) for v in s], 'casos': n,
    'validacionDejandoFueraCadaImagen': {'antes (subida fija de la herramienta intermareal)': est(errAntes), 'con la subida según la marea': est(errDespues)}}
print('Subida de la orilla por nivel:', list(zip([round(v, 2) for v in c], [round(v, 2) for v in s], n)))
print('Ancho, dejando fuera cada imagen: antes', est(errAntes), '→ ahora', est(errDespues))
nv = np.array(nivelesVal)
for a, b in [(0, 1.5), (1.5, 2.5), (2.5, 3.5)]:
    k = (nv >= a) & (nv < b)
    print(f'  nivel {a}–{b}: antes', est(np.array(errAntes)[k]), '→ ahora', est(np.array(errDespues)[k]))
json.dump(salida, open(os.path.join(RAIZ, 'data', 'validacion_ancho.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
json.dump({'fuente': 'tools/validar-ancho.py (líneas de agua Sentinel-2 2025-2026 y nivel medido en Avilés)',
           'nivel': salida['subidaOrilla']['nivel'], 'subida': salida['subidaOrilla']['subida'],
           # margen típico del ancho (MAD del error dejando fuera cada imagen), redondeado a 5 m
           'margen': int(5 * round(est(errDespues)['mad_m'] / 5))},
          open(os.path.join(RAIZ, 'src', 'scene', 'bahia-orilla.json'), 'w', encoding='utf-8'), ensure_ascii=False)
json.dump(filas, open(os.path.join(RAW, 'validacion_ancho_casos.json'), 'w'))
# Dirección hacia el mar de la playa para la web: la de los perfiles, normales a la curva de +3,1 m
# de la arena medida (suavizada), mucho más estable que la línea del muro en sus extremos.
json.dump({'fuente': 'perfiles de tools/intermareal-s2.py (normales a la curva de +3,1 m del LiDAR, cada 25 m)',
           'perfiles': [[round(p['bx'], 1), round(p['bz'], 1), round(p['nx'], 4), round(p['nz'], 4)] for p in P]},
          open(os.path.join(RAIZ, 'src', 'scene', 'bahia-perfiles-playa.json'), 'w', encoding='utf-8'), ensure_ascii=False)
