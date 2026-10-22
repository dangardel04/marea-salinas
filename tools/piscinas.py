# Piscinas de la zona del Club Náutico, medidas en la ortofoto PNOA (IGN, CC BY 4.0) de más detalle
# (nivel 6, 0,195 m/píxel, de tools/bahia-orto-detalle.ts): el agua de una piscina es de un turquesa
# que no tiene nada más en la foto. Para cada mancha de ese color de más de 15 m² se guarda el
# rectángulo de área mínima que la contiene (las piscinas de la zona son rectangulares) si lo llena
# en más de un 80 %.
#
# Uso: python tools/piscinas.py      Salida: src/scene/bahia-piscinas.json
# Necesita numpy, scipy y Pillow.

import json, math, os
import numpy as np
from PIL import Image
from scipy import ndimage

RAIZ = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
LADO, NIVEL, PIX = 6400.0, 6, 512
meta = json.load(open(os.path.join(RAIZ, 'src', 'scene', 'bahia-orto.json'), encoding='utf-8'))
claves = meta['indice'][str(NIVEL)]
lado = LADO / 2 ** NIVEL
ij = [tuple(map(int, c.split('_'))) for c in claves]
i0, i1 = min(a for a, _ in ij), max(a for a, _ in ij)
j0, j1 = min(b for _, b in ij), max(b for _, b in ij)
W, H = (i1 - i0 + 1) * PIX, (j1 - j0 + 1) * PIX
foto = np.zeros((H, W, 3), np.uint8)
for i, j in ij:
    im = np.asarray(Image.open(os.path.join(RAIZ, 'public', 'bahia', 'orto', str(NIVEL), f'{i}_{j}.jpg')).convert('RGB'))
    foto[(j - j0) * PIX:(j - j0 + 1) * PIX, (i - i0) * PIX:(i - i0 + 1) * PIX] = im
x0, z0 = -LADO / 2 + i0 * lado, -LADO / 2 + j0 * lado
m = lado / PIX   # m por píxel

f = foto.astype(np.float32) / 255
r, g, b = f[..., 0], f[..., 1], f[..., 2]
mx, mn = f.max(-1), f.min(-1)
sat = (mx - mn) / np.maximum(mx, 1e-3)
# tono (grados)
tono = np.degrees(np.arctan2(np.sqrt(3) * (g - b), 2 * r - g - b)) % 360
agua = (tono > 165) & (tono < 210) & (sat > 0.3) & (mx > 0.45) & (b > r + 0.12)
agua = ndimage.binary_opening(agua, iterations=2)
agua = ndimage.binary_closing(agua, iterations=3)
etiquetas, n = ndimage.label(agua)

def rect_minimo(pts):
    """Rectángulo de área mínima (cierre convexo + calibres rotantes)."""
    from scipy.spatial import ConvexHull
    h = pts[ConvexHull(pts).vertices]
    mejor = None
    for k in range(len(h)):
        e = h[(k + 1) % len(h)] - h[k]
        a = math.atan2(e[1], e[0])
        c, s = math.cos(a), math.sin(a)
        R = np.array([[c, s], [-s, c]])
        q = h @ R.T
        lo, hi = q.min(0), q.max(0)
        ar = (hi - lo).prod()
        if mejor is None or ar < mejor[0]: mejor = (ar, a, lo, hi, R)
    ar, a, lo, hi, R = mejor
    esq = np.array([[lo[0], lo[1]], [hi[0], lo[1]], [hi[0], hi[1]], [lo[0], hi[1]]]) @ R
    return ar, esq

piscinas = []
for k in range(1, n + 1):
    py, px = np.nonzero(etiquetas == k)
    area = len(px) * m * m
    if area < 15: continue
    pts = np.c_[x0 + (px + 0.5) * m, z0 + (py + 0.5) * m]
    ar, esq = rect_minimo(pts)
    llenado = area / ar
    if llenado < 0.8: continue
    lados = [float(np.hypot(*(esq[(q + 1) % 4] - esq[q]))) for q in range(2)]
    piscinas.append({'esquinas': [[round(float(x), 2), round(float(z), 2)] for x, z in esq], 'area': round(area, 1),
                     'largo': round(max(lados), 2), 'ancho': round(min(lados), 2), 'llenado': round(llenado, 2)})
piscinas.sort(key=lambda p: -p['area'])
json.dump({
    'fuente': 'Medidas en la ortofoto PNOA (IGN, CC BY 4.0) a 0,195 m/píxel: manchas de agua turquesa de más de 15 m², con su rectángulo mínimo. Ver tools/piscinas.py',
    'decorativo': 'Profundidad del vaso (1,6 m), borde (0,4 m) y su material; color del agua',
    'piscinas': piscinas,
}, open(os.path.join(RAIZ, 'src', 'scene', 'bahia-piscinas.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
for p in piscinas: print(p['area'], 'm²', p['largo'], '×', p['ancho'], 'llenado', p['llenado'], p['esquinas'][0])
