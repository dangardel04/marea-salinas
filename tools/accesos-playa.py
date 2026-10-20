# Escaleras y rampas que bajan del paseo de Salinas a la arena.
#
# No hay inventario público (OpenStreetMap no las tiene; Turismo Asturias solo dice que hay rampas y
# que los socorristas están en la «escalera 1»). Se han IDENTIFICADO a mano con dos fuentes:
#   - la nube LiDAR PNOA 2024 (CNIG, CC BY 4.0), en una franja «enderezada» a lo largo del muro
#     (s a lo largo del borde del paseo, de oeste a este; t hacia el mar): una escalera o rampa es
#     una cuña de altura intermedia pegada al muro, que sube de la arena al paseo a lo largo de s;
#   - la ortofoto PNOA (IGN, WMS, CC BY 4.0) a 0,15 m: barandillas y sombras en diagonal.
# Solo entran las que se ven en las dos. La «escalera 1» es la doble que está junto al puesto de
# socorristas de OpenStreetMap (nodo 11845486586, emergency=lifeguard).
#
# Este programa MIDE en el LiDAR, para cada tramo identificado (intervalo de s), la altura del paseo
# arriba, la de la arena abajo, dónde está la cara del muro y el ancho, y escribe la geometría en
# coordenadas locales: src/scene/bahia-accesos.json.
#
# Uso: python tools/accesos-playa.py   (necesita numpy, scipy, laspy[lazrs] y pyproj)

import glob, json, math, os
import numpy as np
from scipy.spatial import cKDTree

RAIZ = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
CLAT, CLON = 43.589, -5.955
fi = math.radians(CLAT)
MLAT = 111132.92 - 559.82 * math.cos(2 * fi) + 1.175 * math.cos(4 * fi) - 0.0023 * math.cos(6 * fi)
MLON = 111412.84 * math.cos(fi) - 93.5 * math.cos(3 * fi) + 0.118 * math.cos(5 * fi)

# Identificación (intervalos de s en metros a lo largo del borde del paseo, de oeste a este).
# Cada acceso: tramos de escalera o rampa ('baja' = hacia dónde baja: +1 este, −1 oeste), rellanos
# y la franja que ocupan hacia el mar (t, en m desde el borde del paseo), leídas en las tablas de
# altura del LiDAR (cada 1 m de s, cada 0,25–1 m de t). Las «fuera» van delante de la cara del muro;
# las demás están metidas en él (empiezan ~1 m dentro del borde).
ACCESOS = [
    dict(id='A', tipo='escalera', tramos=[(137.5, 147.0, -1)], rellanos=[(147.0, 151.0)], t=(0.75, 4.5), trel=(0.5, 3.0)),
    dict(id='B', tipo='rampa', tramos=[(294.5, 321.0, +1)], rellanos=[(290.0, 294.5)], t=(0.5, 5.5), trel=(0.5, 4.0)),
    dict(id='C', tipo='escalera', tramos=[(376.0, 383.0, -1), (387.5, 395.0, +1)], rellanos=[(383.0, 387.5)], t=(-1.0, 1.0), trel=(-1.0, 2.0)),
    dict(id='D', tipo='escalera', tramos=[(549.0, 555.5, -1)], rellanos=[(555.5, 558.0)], t=(-1.0, 1.0), trel=(-1.0, 2.0)),
    dict(id='F', tipo='escalera', tramos=[(687.0, 695.0, -1), (699.5, 706.5, +1)], rellanos=[(695.0, 699.5)], t=(-1.0, 1.0), trel=(-1.0, 2.0), nombre='Escalera 1'),
    dict(id='G', tipo='escalera', tramos=[(826.5, 835.0, -1)], rellanos=[(835.0, 837.5)], t=(-0.75, 0.75), trel=(-0.75, 1.5)),
    dict(id='I', tipo='escalera', tramos=[(1034.0, 1041.0, -1), (1045.0, 1053.5, +1)], rellanos=[(1041.0, 1045.0)], t=(-1.0, 1.25), trel=(-1.0, 3.0)),
]

def main():
    import laspy
    from pyproj import Transformer
    fino = json.load(open(os.path.join(RAIZ, 'src/scene/bahia-fino.json'), encoding='utf-8'))
    paseo = json.load(open(os.path.join(RAIZ, 'src/scene/bahia-paseo.json'), encoding='utf-8'))
    perf = np.array(json.load(open(os.path.join(RAIZ, 'src/scene/bahia-perfiles-playa.json'), encoding='utf-8'))['perfiles'])
    a = np.array([p['arriba'] for t in paseo['tramos'] for p in t])
    L = np.r_[0, np.cumsum(np.hypot(np.diff(a[:, 0]), np.diff(a[:, 2])))]

    def hacia_mar(x, z):
        d = np.hypot(perf[:, 0] - x, perf[:, 1] - z); o = np.argsort(d)[:2]
        w = 1 / np.maximum(d[o], 1)
        n = (perf[o, 2:4] * w[:, None]).sum(0); return n / np.linalg.norm(n)

    def punto(s):
        x = float(np.interp(s, L, a[:, 0])); z = float(np.interp(s, L, a[:, 2]))
        return x, z, hacia_mar(x, z)

    # Nube LiDAR alrededor del paseo (sin vegetación ni ruido), con la altura sobre el CH.
    tr = Transformer.from_crs('EPSG:25830', 'EPSG:4258', always_xy=True)
    xmin, xmax, zmin, zmax = a[:, 0].min() - 30, a[:, 0].max() + 30, a[:, 2].min() - 30, a[:, 2].max() + 30
    X, Y, Z = [], [], []
    for f in sorted(glob.glob(os.path.join(RAIZ, 'data/raw/lidar/*.LAZ'))):
        las = laspy.read(f)
        lon, lat = tr.transform(np.asarray(las.x), np.asarray(las.y))
        x = (lon - CLON) * MLON; z = -(lat - CLAT) * MLAT
        m = (x > xmin) & (x < xmax) & (z > zmin) & (z < zmax) & ~np.isin(np.asarray(las.classification), [3, 4, 5, 7])
        X.append(x[m]); Y.append(np.asarray(las.z)[m] + fino['nmmaSobreCh']); Z.append(z[m])
    X, Y, Z = np.concatenate(X), np.concatenate(Y), np.concatenate(Z)
    arbol = cKDTree(np.stack([X, Z], 1))

    def altura(x, z, r=0.5):
        idx = arbol.query_ball_point([x, z], r)
        return float(np.median(Y[idx])) if idx else float('nan')

    def perfil_t(s, ts):
        x, z, n = punto(s)
        return np.array([altura(x + n[0] * t, z + n[1] * t) for t in ts])

    salida = []
    for acc in ACCESOS:
        s_todos = [v for tr_ in acc['tramos'] for v in tr_[:2]] + [v for r in acc['rellanos'] for v in r]
        s0, s1 = min(s_todos), max(s_todos)
        # alturas de referencia: paseo (t de −4 a −2) y arena (t de 6 a 9), medianas en el acceso
        ss = np.arange(s0 - 2, s1 + 2, 1.0)
        paseoY = float(np.nanmedian([np.nanmedian(perfil_t(s, [-4, -3, -2])) for s in ss]))
        arenaY = float(np.nanmedian([np.nanmedian(perfil_t(s, [6, 7, 8, 9])) for s in ss]))
        # cara del muro junto al acceso (a 3–5 m a cada lado): primer t donde la altura baja más
        # de 1 m respecto al paseo (para saber cuánto queda el acceso delante o dentro del muro)
        ts = np.arange(-3, 6, 0.25)
        caras = []
        for s in (s0 - 3, s0 - 5, s1 + 3, s1 + 5):
            p = perfil_t(s, ts); j = np.where(p < paseoY - 1.0)[0]
            if len(j): caras.append(ts[j[0]])
        cara = float(np.median(caras)) if caras else 0.5
        t0, t1 = acc['t']
        ancho = t1 - t0
        piezas = []
        for (sa, sb, baja) in acc['tramos']:
            (xa, za, na), (xb, zb, nb) = punto(sa), punto(sb)
            alto_a, alto_b = (arenaY, paseoY) if baja < 0 else (paseoY, arenaY)   # baja<0: sube hacia el este
            piezas.append(dict(clase=acc['tipo'], a=[round(xa, 2), round(alto_a, 2), round(za, 2)], b=[round(xb, 2), round(alto_b, 2), round(zb, 2)],
                               na=[round(float(na[0]), 4), round(float(na[1]), 4)], nb=[round(float(nb[0]), 4), round(float(nb[1]), 4)],
                               t0=round(t0, 2), t1=round(t1, 2), s=[sa, sb]))
        for (ra, rb) in acc['rellanos']:
            (xa, za, na), (xb, zb, nb) = punto(ra), punto(rb)
            piezas.append(dict(clase='rellano', a=[round(xa, 2), round(paseoY, 2), round(za, 2)], b=[round(xb, 2), round(paseoY, 2), round(zb, 2)],
                               na=[round(float(na[0]), 4), round(float(na[1]), 4)], nb=[round(float(nb[0]), 4), round(float(nb[1]), 4)],
                               t0=round(acc['trel'][0], 2), t1=round(acc['trel'][1], 2), s=[ra, rb]))
        xc, zc, nc = punto((s0 + s1) / 2)
        salida.append(dict(id=acc['id'], tipo=acc['tipo'], nombre=acc.get('nombre'), centro=[round(xc + nc[0] * t1, 2), round(zc + nc[1] * t1, 2)],
                           paseo=round(paseoY, 2), arena=round(arenaY, 2), cara=round(cara, 2), ancho=round(ancho, 2),
                           doble=len(acc['tramos']) == 2, piezas=piezas))
        print(acc['id'], acc['tipo'], f'paseo {paseoY:.2f} arena {arenaY:.2f} desnivel {paseoY - arenaY:.2f} cara {cara:.2f} ancho {ancho:.2f}',
              [f"{p['clase']} {abs(p['s'][1] - p['s'][0]):.1f} m" for p in piezas])
    meta = dict(
        fuente='Identificadas en la nube LiDAR PNOA 2024 (CNIG, CC BY 4.0) y en la ortofoto PNOA (IGN, CC BY 4.0); medidas en el LiDAR. Ver tools/accesos-playa.py',
        escalera1='La «escalera 1» (donde están los socorristas, según Turismo Asturias) es la que está junto al puesto de socorristas de OpenStreetMap (nodo 11845486586)',
        decorativo='Peldaños (contrahuella ~17 cm), pretil y barandilla: dibujo; posición, largo, ancho, desnivel y sentido de cada tramo: medidos',
        accesos=salida)
    json.dump(meta, open(os.path.join(RAIZ, 'src/scene/bahia-accesos.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

if __name__ == '__main__':
    main()
