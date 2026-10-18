# Perfil de la franja intermareal de la playa a partir de la línea de agua de Sentinel‑2.
#
# Uso (desde la raíz del proyecto, después de tools/bahia-relieve.ts, que deja el relieve sin esta
# corrección en data/raw/relieve_generico.bin):
#   python tools/intermareal-s2.py
# Necesita Python 3 con numpy, rasterio y matplotlib. Salida: data/intermareal_s2.json, que lee
# tools/bahia-relieve.ts (vuelve a ejecutarlo después). Las orillas extraídas quedan en
# data/raw/s2_orillas.json (si existe, no se vuelve a descargar nada) y una figura de control en
# data/raw/s2_intermareal.png.
#
# Método (el de la «waterline method», p. ej. CoastSat):
#   1. Perfiles cada 25 m, normales a la curva de +3,1 m de la arena MEDIDA por el MDT05, de 40 m
#      hacia tierra a 400 m hacia el mar.
#   2. En cada imagen Sentinel‑2 L2A del último año sin nubes sobre la playa: índice MNDWI
#      (B03 y B11) muestreado en los perfiles, umbral de Otsu de la escena y borde de la arena más
#      hacia el mar (último paso de arena a agua con agua en al menos el 90 % del resto del perfil).
#   3. A esa orilla se le asigna el nivel MEDIDO por el mareógrafo de Avilés a la hora de la imagen
#      (todas pasan hacia las 11:30 UTC; misma conversión al cero hidrográfico que el resto).
#   4. Solo imágenes con oleaje Hs < 1,3 m (modelo Open‑Meteo): con más ola la espuma y el vaivén
#      sesgan la orilla hacia tierra.
#   5. La orilla no es el nivel en reposo: las olas la suben. Ese desplazamiento se mide con las
#      orillas que caen sobre la arena medida por el LiDAR (mediana de nivel − cota LiDAR) y se
#      corrige con él.
#   6. Por perfil, con los dos perfiles vecinos a cada lado (125 m de playa): mediana de la orilla
#      de cada imagen y perfil monótono (la orilla solo avanza hacia el mar al bajar el nivel) por
#      regresión isotónica. No se impone ninguna forma (recta, curva): la marcan las imágenes.
#      Validación dejando cada imagen fuera; un perfil solo se usa si así falla menos que el relieve
#      genérico (pendiente 1:50 → EMODnet) en esas mismas orillas.
#   7. Solo vale entre la arena medida y la orilla más baja observada: por debajo no hay dato y el
#      relieve sigue siendo una estimación.

import json, math, os, sys, datetime as dt, urllib.request
import numpy as np

RAIZ = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
RAW = os.path.join(RAIZ, 'data', 'raw')
os.makedirs(RAW, exist_ok=True)
os.environ.update(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR', AWS_NO_SIGN_REQUEST='YES')

STAC = 'https://earth-search.aws.element84.com/v1/search'
COLECCION = 'sentinel-2-l2a'
DESDE, HASTA = '2025-10-01T00:00:00Z', '2026-10-18T00:00:00Z'
HS_MAX = 1.3
COTA_MAX = 3.0
PASO_PERFIL, D = 25.0, np.arange(-40, 400, 2.0)

# ---------- Marco de la bahía (igual que src/bahia.ts) y relieve ----------
N, PASO, LADO = 1281, 5, 6400
CLAT, CLON = 43.589, -5.955
fi = math.radians(CLAT)
MLAT = 111132.92 - 559.82 * math.cos(2 * fi) + 1.175 * math.cos(4 * fi) - 0.0023 * math.cos(6 * fi)
MLON = 111412.84 * math.cos(fi) - 93.5 * math.cos(3 * fi) + 0.118 * math.cos(5 * fi)
# Relieve SIN esta corrección (lo deja tools/bahia-relieve.ts): así el resultado no depende de
# haberla aplicado ya y la comparación es siempre contra la pendiente genérica.
RUTA_GENERICO = os.path.join(RAW, 'relieve_generico.bin')
if not os.path.exists(RUTA_GENERICO): raise SystemExit('Falta data/raw/relieve_generico.bin: ejecuta antes node tools/bahia-relieve.ts')
cm = np.fromfile(RUTA_GENERICO, dtype='<i2').reshape(N, N)
alto = generico = cm / 100.0
medido = (np.abs(cm) % 2).astype(float)

def bil(arr, x, z):
    c = (np.asarray(x) + LADO / 2) / PASO; f = (np.asarray(z) + LADO / 2) / PASO
    c0 = np.floor(c).astype(int); f0 = np.floor(f).astype(int); fx = c - c0; fy = f - f0
    return (arr[f0, c0] * (1 - fx) + arr[f0, c0 + 1] * fx) * (1 - fy) + (arr[f0 + 1, c0] * (1 - fx) + arr[f0 + 1, c0 + 1] * fx) * fy

# ---------- Perfiles ----------
def perfiles():
    import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
    # Solo lo medido: el resto a 0 para que la curva no dependa de la franja estimada.
    solo = np.where(medido > 0, alto, 0.0)
    c0, c1 = (-1150 + 3200) // 5, (1400 + 3200) // 5; f0, f1 = (-200 + 3200) // 5, (1450 + 3200) // 5
    xs = np.arange(c0, c1) * 5 - 3200.0; zs = np.arange(f0, f1) * 5 - 3200.0
    cs = plt.contour(xs, zs, solo[f0:f1, c0:c1], levels=[3.1]); plt.close('all')
    lin = max(cs.allsegs[0], key=len)
    dl = np.r_[0, np.cumsum(np.hypot(*np.diff(lin, axis=0).T))]
    sg = np.arange(0, dl[-1], PASO_PERFIL)
    bx = np.interp(sg, dl, lin[:, 0]); bz = np.interp(sg, dl, lin[:, 1])
    k = 4
    sx = np.convolve(np.pad(bx, k, 'edge'), np.ones(2 * k + 1) / (2 * k + 1), 'valid')
    sz = np.convolve(np.pad(bz, k, 'edge'), np.ones(2 * k + 1) / (2 * k + 1), 'valid')
    tx, tz = np.gradient(sx), np.gradient(sz)
    n = np.hypot(tx, tz); nx, nz = -tz / n, tx / n
    for i in range(len(bx)):  # hacia el mar = hacia donde baja el relieve
        if bil(alto, bx[i] + 30 * nx[i], bz[i] + 30 * nz[i]) > bil(alto, bx[i] - 30 * nx[i], bz[i] - 30 * nz[i]):
            nx[i], nz[i] = -nx[i], -nz[i]
    return [{'s': float(sg[i]), 'bx': float(bx[i]), 'bz': float(bz[i]), 'nx': float(nx[i]), 'nz': float(nz[i])} for i in range(len(bx))]

# ---------- Nivel medido y oleaje ----------
def cargar_nivel():
    const = json.load(open(os.path.join(RAIZ, 'src', 'tide', 'constantes.json'), encoding='utf-8'))
    desnivel = const['z0CeroPuerto'] - const['z0Ch']
    obs = {}
    for l in open(os.path.join(RAIZ, 'data', 'obs_aviles_10min.csv')).read().strip().split('\n')[1:]:
        _, s, h, _n = l.split(','); obs[int(s)] = float(h) - desnivel
    def nivel(t):
        a = int(t // 600) * 600; b = a + 600
        return obs[a] + (obs[b] - obs[a]) * (t - a) / 600 if a in obs and b in obs else None
    return nivel, desnivel

def cargar_olas():
    u = ('https://marine-api.open-meteo.com/v1/marine?latitude=43.6&longitude=-5.96&hourly=wave_height,wave_period'
         f'&start_date={DESDE[:10]}&end_date={HASTA[:10]}&timezone=GMT')
    mj = json.load(urllib.request.urlopen(u, timeout=60))['hourly']
    return {int(dt.datetime.fromisoformat(t + '+00:00').timestamp()): (h, p) for t, h, p in zip(mj['time'], mj['wave_height'], mj['wave_period'])}, u

def otsu(v):
    v = v[np.isfinite(v)]; h, e = np.histogram(v, 200); c = (e[:-1] + e[1:]) / 2
    w0 = np.cumsum(h).astype(float); w1 = w0[-1] - w0; m0 = np.cumsum(h * c); mt = m0[-1]
    with np.errstate(divide='ignore', invalid='ignore'):
        sb = (mt * w0 / w0[-1] - m0) ** 2 / (w0 * w1)
    return float(c[np.nanargmax(sb)])

def extraer(P):
    import rasterio
    from rasterio.warp import transform
    nivel, _ = cargar_nivel()
    olas, url_olas = cargar_olas()
    q = {'collections': [COLECCION], 'intersects': {'type': 'Point', 'coordinates': [-5.9644, 43.5768]},
         'datetime': f'{DESDE}/{HASTA}', 'limit': 200, 'query': {'eo:cloud_cover': {'lt': 80}}}
    req = urllib.request.Request(STAC, json.dumps(q).encode(), {'Content-Type': 'application/json'})
    vistos, escenas = set(), []
    # Un día puede venir reprocesado varias veces: se queda la versión más reciente.
    for it in sorted(json.load(urllib.request.urlopen(req, timeout=60))['features'], key=lambda x: x['id'], reverse=True):
        dia = it['properties']['datetime'][:10]
        if dia in vistos: continue
        vistos.add(dia); escenas.append(it)
    px = np.concatenate([[p['bx'] + D * p['nx']] for p in P]).ravel()
    pz = np.concatenate([[p['bz'] + D * p['nz']] for p in P]).ravel()
    lat = CLAT - pz / MLAT; lon = CLON + px / MLON
    res = []
    for it in escenas:
        t = dt.datetime.fromisoformat(it['properties']['datetime'].replace('Z', '+00:00')).timestamp()
        h = nivel(t)
        if h is None: continue
        bandas = {}
        for b in ('scl', 'green', 'swir16'):
            with rasterio.open(it['assets'][b]['href']) as f:
                X, Y = transform('EPSG:4326', f.crs, lon.tolist(), lat.tolist())
                inv = ~f.transform
                cr = np.array([inv * (x, y) for x, y in zip(X, Y)]) - 0.5
                ci = np.floor(cr[:, 0]).astype(int); ri = np.floor(cr[:, 1]).astype(int)
                w = rasterio.windows.Window(int(ci.min()), int(ri.min()), int(ci.max() - ci.min() + 2), int(ri.max() - ri.min() + 2))
                arr = f.read(1, window=w).astype(float)
                cc = ci - ci.min(); rr = ri - ri.min(); fx = cr[:, 0] - ci; fy = cr[:, 1] - ri
                if b == 'scl':
                    bandas[b] = arr[np.clip(np.round(cr[:, 1]).astype(int) - ri.min(), 0, arr.shape[0] - 1),
                                    np.clip(np.round(cr[:, 0]).astype(int) - ci.min(), 0, arr.shape[1] - 1)]
                else:
                    bandas[b] = (arr[rr, cc] * (1 - fx) + arr[rr, cc + 1] * fx) * (1 - fy) + (arr[rr + 1, cc] * (1 - fx) + arr[rr + 1, cc + 1] * fx) * fy
        nubes = float(np.isin(bandas['scl'], [3, 8, 9, 10]).mean())  # sombra, nubes, cirros
        if nubes > 0.05:
            print(it['id'], f'nubes {nubes:.2f}: descartada'); continue
        g, sw = bandas['green'], bandas['swir16']
        m = (g - sw) / np.maximum(g + sw, 1)
        um = otsu(m)
        hs, tm = olas.get(int(round(t / 3600) * 3600), (None, None))
        res.append({'id': it['id'], 'utc': it['properties']['datetime'], 'nivel': round(h, 3), 'hs': hs, 'tm': tm,
                    'nubes': round(nubes, 3), 'umbral': round(um, 3),
                    'mndwi': [[round(float(x), 3) for x in m[i * len(D):(i + 1) * len(D)]] for i in range(len(P))]})
        print(it['id'], f'nivel {h:.2f} m, Hs {hs} m', flush=True)
    return {'escenas': res, 'url_olas': url_olas}

# ---------- Ajuste ----------
def orilla(v, um):
    """Borde de la arena más hacia el mar: último paso de tierra a agua con agua en al menos el 90 %
    del resto del perfil. Así no se confunde el mar con el agua que queda en los canales de bajamar."""
    v = np.asarray(v)
    agua = v >= um
    if agua[0] or agua.all(): return None
    for k in range(len(v) - 1, 0, -1):
        if not agua[k - 1] and agua[k]:
            if agua[k:].mean() < 0.9 or len(v) - k < 15: return None
            return round(float(D[k - 1] + (um - v[k - 1]) / (v[k] - v[k - 1]) * (D[k] - D[k - 1])), 1)
    return None

def isotonica(nivel, d, peso):
    """Regresión isotónica (PAVA): al bajar el nivel la orilla solo puede ir hacia el mar.
    Devuelve bloques (nivel medio, distancia media, peso) ordenados de tierra a mar."""
    o = np.argsort(-np.asarray(nivel))
    bl = [[float(nivel[k]) * peso[k], float(d[k]) * peso[k], float(peso[k])] for k in o]
    i = 0
    while i < len(bl) - 1:
        a, b = bl[i], bl[i + 1]
        if b[1] / b[2] <= a[1] / a[2] + 1.0:  # no avanza al menos 1 m hacia el mar: se funden
            bl[i] = [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; del bl[i + 1]
            i = max(i - 1, 0)
        else:
            i += 1
    return [(x[0] / x[2], x[1] / x[2], x[2]) for x in bl]

def main():
    P = perfiles()
    print(len(P), 'perfiles')
    cache = os.path.join(RAW, 's2_orillas.json')
    if os.path.exists(cache):
        O = json.load(open(cache))
        if len(O['escenas'][0]['mndwi']) != len(P): raise SystemExit('La caché no corresponde a estos perfiles: bórrala.')
    else:
        O = extraer(P); json.dump(O, open(cache, 'w'))
    for e in O['escenas']:
        e['orillas'] = [orilla(v, e['umbral']) for v in e['mndwi']]
    E = [e for e in O['escenas'] if e['hs'] is not None and e['hs'] < HS_MAX]

    # Desplazamiento de la orilla respecto al nivel en reposo, medido sobre la arena del LiDAR
    dif = []
    for e in E:
        for i, d in enumerate(e['orillas']):
            if d is None: continue
            x, z = P[i]['bx'] + d * P[i]['nx'], P[i]['bz'] + d * P[i]['nz']
            if bil(medido, x, z) > 0.99: dif.append(e['nivel'] - float(bil(alto, x, z)))
    dif = np.array(dif)
    desplaz = float(np.median(dif))          # nivel − cota LiDAR: negativo = la orilla sube por la arena
    mad = float(1.4826 * np.median(np.abs(dif - desplaz)))
    print(f'Orillas sobre arena medida: {len(dif)}, nivel − cota LiDAR mediana {desplaz:+.2f} m (MAD {mad:.2f})')

    # Por perfil (con dos vecinos a cada lado): mediana de la orilla de cada imagen fuera de la
    # arena medida y perfil monótono por regresión isotónica.
    # Por encima de +3,0 m no se usa: ahí empieza la arena medida y, donde la orilla de pleamar cae
    # más allá de ella, la playa ha cambiado desde el vuelo del LiDAR y el perfil no casaría.
    ajustes, residuos, residuosG, motivos = [], [], [], {}
    def descartar(m):
        motivos[m] = motivos.get(m, 0) + 1; ajustes.append(None)
    for i in range(len(P)):
        niv, dd, pe = [], [], []
        for e in E:
            if e['nivel'] - desplaz > COTA_MAX: continue
            vs = []
            for j in range(max(0, i - 2), min(len(P), i + 3)):
                d = e['orillas'][j]
                if d is None: continue
                x, z = P[j]['bx'] + d * P[j]['nx'], P[j]['bz'] + d * P[j]['nz']
                if bil(medido, x, z) > 0.99: continue
                vs.append(d)
            if len(vs) >= 3: niv.append(e['nivel']); dd.append(float(np.median(vs))); pe.append(len(vs))
        if len(niv) < 6: descartar('menos de 6 imágenes'); continue
        niv, dd, pe = np.array(niv), np.array(dd), np.array(pe, float)
        def perfil(k):
            bl = isotonica(niv[k], dd[k], pe[k])
            return np.array([b[1] for b in bl]), np.array([b[0] - desplaz for b in bl])
        ds, zs = perfil(np.arange(len(niv)))
        if len(ds) < 3: descartar('menos de 3 tramos'); continue
        pend = (zs[0] - zs[-1]) / (ds[-1] - ds[0])
        if not (1 / 300 < pend < 1 / 15): descartar('pendiente impropia de arena'); continue
        # Validación dejando cada imagen fuera: cota que predice el perfil sin ella en su orilla,
        # frente a la que da en ese mismo punto el relieve genérico (pendiente 1:50 → EMODnet).
        r, rg = [], []
        for k in range(len(niv)):
            dk, zk = perfil(np.arange(len(niv)) != k)
            if len(dk) >= 2 and dk[0] <= dd[k] <= dk[-1]:
                suelo = niv[k] - desplaz
                r.append(float(suelo - np.interp(dd[k], dk, zk)))
                rg.append(float(suelo - bil(generico, P[i]['bx'] + dd[k] * P[i]['nx'], P[i]['bz'] + dd[k] * P[i]['nz'])))
        if len(r) < 4: descartar('menos de 4 casos de validación'); continue
        rms, rmsG = float(np.sqrt(np.mean(np.square(r)))), float(np.sqrt(np.mean(np.square(rg))))
        if rms >= rmsG: descartar('no mejora el relieve genérico'); continue
        residuos += r; residuosG += rg
        ajustes.append({'puntos': [[round(float(a), 1), round(float(b), 3)] for a, b in zip(ds, zs)], 'imagenes': len(niv),
                        'pendienteMedia': round(float(pend), 5), 'rms': round(rms, 3), 'rmsGenerico': round(rmsG, 3)})
    validos = [a for a in ajustes if a]
    pend = np.array([a['pendienteMedia'] for a in validos])
    residuos, residuosG = np.array(residuos), np.array(residuosG)
    def estad(x):
        return {'casos': int(len(x)), 'sesgo': round(float(np.median(x)), 3), 'mad': round(float(1.4826 * np.median(np.abs(x - np.median(x)))), 3),
                'rms': round(float(np.sqrt(np.mean(x ** 2))), 3), 'p90abs': round(float(np.percentile(np.abs(x), 90)), 3)}
    val, valG = estad(residuos), estad(residuosG)
    print(f'Perfiles válidos {len(validos)}/{len(P)} (descartes: {motivos}); pendiente media mediana 1:{1 / np.median(pend):.0f} '
          f'(p10–p90 1:{1 / np.percentile(pend, 90):.0f}–1:{1 / np.percentile(pend, 10):.0f})')
    print(f'Validación dejando cada imagen fuera, Sentinel‑2: {val}')
    print(f'Mismos puntos, relieve genérico:              {valG}')

    # Diferencia con el relieve genérico a la cota +1,5 m
    desp = []
    for p, a in zip(P, ajustes):
        if not a: continue
        ds = np.array([q[0] for q in a['puntos']]); zs = np.array([q[1] for q in a['puntos']])
        if not (zs[-1] < 1.5 < zs[0]): continue
        d_s2 = float(np.interp(-1.5, -zs, ds))
        zr = bil(alto, p['bx'] + D * p['nx'], p['bz'] + D * p['nz'])
        k = int(np.argmax((zr < 1.5) & (D > 0)))
        desp.append(d_s2 - D[k])
    desp = np.array(desp)
    cotas = [q[1] for a in validos for q in a['puntos']]

    salida = {
        'metodo': 'Línea de agua Sentinel-2 (MNDWI B03/B11, umbral de Otsu, borde de la arena más hacia el mar) en perfiles cada 25 m '
                  'normales a la curva de +3,1 m de la arena medida; nivel medido en el mareógrafo de Avilés; imágenes con Hs < 1,3 m; '
                  'por perfil (±2 vecinos), mediana de la orilla de cada imagen y perfil monótono por regresión isotónica.',
        'fuentes': {'imagenes': f'{STAC} (colección {COLECCION}, Copernicus Sentinel-2 L2A)', 'olas': O['url_olas'],
                    'nivel': 'data/obs_aviles_10min.csv (REDMAR Avilés, Puertos del Estado)'},
        'consultado': dt.date.today().isoformat(),
        'periodo': [DESDE, HASTA], 'hsMax': HS_MAX, 'cotaMax': COTA_MAX,
        'escenasUsadas': [{'id': e['id'], 'utc': e['utc'], 'nivel': e['nivel'], 'hs': e['hs']} for e in E],
        'escenasSinNubes': len(O['escenas']),
        'desplazamientoOrilla': {'mediana': round(desplaz, 3), 'mad': round(mad, 3), 'n': int(len(dif)),
                                 'nota': 'nivel − cota LiDAR donde la orilla cae sobre arena medida; se resta al nivel para obtener la cota del suelo.'},
        'resumen': {'perfilesValidos': len(validos), 'perfiles': len(P),
                    'cotas': [round(min(cotas), 2), round(max(cotas), 2)],
                    'pendienteMediana': round(float(np.median(pend)), 5),
                    'pendienteP10': round(float(np.percentile(pend, 10)), 5), 'pendienteP90': round(float(np.percentile(pend, 90)), 5),
                    'validacionDejandoUnaFuera': {**val, 'nota': 'cota del suelo en la orilla de cada imagen menos la que predice el perfil hecho sin esa imagen (m)'},
                    'mismosPuntosRelieveGenerico': {**valG, 'nota': 'cota del suelo en esas mismas orillas menos la del relieve genérico (pendiente 1:50 → EMODnet)'},
                    'descartes': motivos,
                    'desplazamientoCota15': {'mediana': round(float(np.median(desp)), 1),
                                             'p10': round(float(np.percentile(desp, 10)), 1), 'p90': round(float(np.percentile(desp, 90)), 1),
                                             'nota': 'metros hacia el mar de la cota +1,5 m según el satélite respecto al relieve genérico'}},
        'perfiles': [{**{k: round(v, 3) for k, v in p.items()}, 'ajuste': a} for p, a in zip(P, ajustes)],
    }
    json.dump(salida, open(os.path.join(RAIZ, 'data', 'intermareal_s2.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(f'Cota +1,5 m: el satélite la pone {np.median(desp):.0f} m más hacia el mar que el relieve genérico '
          f'(p10 {np.percentile(desp, 10):.0f}, p90 {np.percentile(desp, 90):.0f})')
    print(f'Cotas cubiertas: {min(cotas):.2f} a {max(cotas):.2f} m; escenas usadas {len(E)} de {len(O["escenas"])} sin nubes')

    # Figuras de control
    import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
    fig, ax = plt.subplots(figsize=(12, 6))
    for p, a in zip(P, ajustes):
        ax.plot([p['bx'], p['bx'] + 300 * p['nx']], [p['bz'], p['bz'] + 300 * p['nz']], color='g' if a else 'r', lw=0.6)
        if a:
            d1 = a['puntos'][-1][0]
            ax.plot([p['bx'], p['bx'] + d1 * p['nx']], [p['bz'], p['bz'] + d1 * p['nz']], 'b', lw=1.5)
    ax.invert_yaxis(); ax.set_aspect('equal'); ax.set_title('Perfiles: azul = tramo con Sentinel‑2; rojo = descartado')
    plt.savefig(os.path.join(RAW, 's2_intermareal.png'), dpi=80); plt.close(fig)
    fig, axs = plt.subplots(2, 4, figsize=(20, 8)); axs = axs.ravel()
    elegidos = [i for i, a in enumerate(ajustes) if a]
    for ax, i in zip(axs, [elegidos[k] for k in np.linspace(0, len(elegidos) - 1, 8).astype(int)]):
        p = P[i]; px, pz = p['bx'] + D * p['nx'], p['bz'] + D * p['nz']
        zr = bil(alto, px, pz); m = bil(medido, px, pz)
        ax.plot(D, zr, color='0.5', label='relieve genérico'); ax.plot(D[m > .99], zr[m > .99], 'k', lw=3, label='LiDAR (MDT05)')
        for e in E:
            if e['orillas'][i] is not None: ax.plot(e['orillas'][i], e['nivel'] - desplaz, 'o', color='#1f77b4', ms=4)
        q = np.array(ajustes[i]['puntos']); ax.plot(q[:, 0], q[:, 1], 'r-o', ms=3, label='Sentinel‑2')
        ax.set_xlim(-40, 300); ax.set_ylim(-1.5, 6); ax.grid(alpha=.3); ax.set_title(f'perfil {i} (x {p["bx"]:.0f}, z {p["bz"]:.0f})')
    axs[0].legend(fontsize=8)
    plt.tight_layout(); plt.savefig(os.path.join(RAW, 's2_perfiles.png'), dpi=65)

main()
