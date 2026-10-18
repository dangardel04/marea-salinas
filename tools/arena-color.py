# Color de la arena seca de la playa, medido en la ortofoto PNOA 2023, para que la arena que la
# escena dibuja donde la foto no sirve (la que cubre la marea) case con la fotografiada.
#
# Uso (desde la raíz del proyecto, después de tools/bahia-relieve.ts y tools/bahia-orto.ts):
#   python tools/arena-color.py
# Necesita Python 3 con numpy y Pillow. Salida: src/scene/bahia-arena.json
#
# Píxeles de arena seca: nodos del relieve medidos por LiDAR, entre +3,4 y +5,5 m sobre el CH
# (la arena alta de la playa, por encima de las pleamares normales y por debajo del paseo), con
# poca pendiente (< 1:6) y dentro de la franja de la playa (a menos de 120 m de la curva de
# +3,1 m). De cada uno se toma el píxel de la ortofoto del nivel 5 (0,39 m). Se dan la mediana y
# los percentiles 25 y 75 en sRGB, y la variación (desviación por canal) para el grano.

import json, math, os
import numpy as np
from PIL import Image

RAIZ = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
N, PASO, LADO = 1281, 5, 6400
NIVEL, PX = 5, 512

cm = np.fromfile(os.path.join(RAIZ, 'public', 'bahia', 'relieve.bin'), dtype='<i2').reshape(N, N)
alto = cm / 100.0; med = (np.abs(cm) % 2) == 1
gy, gx = np.gradient(alto, PASO)
pend = np.hypot(gx, gy)
# franja: algún nodo por debajo de +3,1 m (agua o arena baja) a menos de 120 m
bajo = alto < 3.1
r = 24  # nodos (120 m)
from numpy.lib.stride_tricks import sliding_window_view
pad = np.pad(bajo, r, constant_values=False)
cerca = np.zeros_like(bajo)
# dilatación por separable max (cuadrado de 2r+1)
tmp = sliding_window_view(pad, 2 * r + 1, axis=0).max(axis=-1)
cerca = sliding_window_view(tmp, 2 * r + 1, axis=1).max(axis=-1)
sel = med & (alto > 3.4) & (alto < 5.5) & (pend < 1 / 6) & cerca
f, c = np.nonzero(sel)
x = c * PASO - LADO / 2; z = f * PASO - LADO / 2
lado = LADO / 2 ** NIVEL
ti = np.floor((x + LADO / 2) / lado).astype(int); tj = np.floor((z + LADO / 2) / lado).astype(int)
pxs = []
cache = {}
for i, j, xx, zz in zip(ti, tj, x, z):
    k = (i, j)
    if k not in cache:
        ruta = os.path.join(RAIZ, 'public', 'bahia', 'orto', str(NIVEL), f'{i}_{j}.jpg')
        cache[k] = np.asarray(Image.open(ruta).convert('RGB')) if os.path.exists(ruta) else None
    im = cache[k]
    if im is None: continue
    u = int((xx + LADO / 2 - i * lado) / lado * PX); v = int((zz + LADO / 2 - j * lado) / lado * PX)
    pxs.append(im[min(v, PX - 1), min(u, PX - 1)])
P = np.array(pxs, float)
# fuera lo que no es arena: vegetación (verde dominante), agua (azul dominante) y sombras
lum = P.mean(1)
arena = (P[:, 2] <= P[:, 0] + 8) & ~((P[:, 1] > P[:, 0] + 10) & (P[:, 1] > P[:, 2] + 10)) & (lum > 90)
A = P[arena]
salida = {
    'fuente': 'Ortofoto PNOA 2023 (IGN), nivel 5 de public/bahia/orto, en nodos de arena seca medidos por LiDAR entre +3,4 y +5,5 m; ver tools/arena-color.py',
    'pixeles': int(len(A)), 'descartados': int(len(P) - len(A)),
    'secaSrgb': [round(float(v)) for v in np.median(A, 0)],
    'p25Srgb': [round(float(v)) for v in np.percentile(A, 25, 0)],
    'p75Srgb': [round(float(v)) for v in np.percentile(A, 75, 0)],
    'desviacionSrgb': [round(float(v), 1) for v in A.std(0)],
}
json.dump(salida, open(os.path.join(RAIZ, 'src', 'scene', 'bahia-arena.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(salida)
