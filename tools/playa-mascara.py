# Máscara de playa: dónde hay arena de playa según OpenStreetMap (natural=beach), en la rejilla de la
# bahía. La escena la usa para dibujar ahí arena limpia en vez de la ortofoto (que trae gente, algas,
# sombras y el mar del día del vuelo) y para no confundir la playa con zonas bajas del puerto.
#
# Uso (desde la raíz del proyecto): python tools/playa-mascara.py
# Necesita Python 3 con numpy y Pillow. Salida: public/bahia/playa.png (gris de 8 bits, 1281 × 1281,
# filas de norte a sur, 255 = playa) y src/scene/bahia-playa.json.
# Datos: © colaboradores de OpenStreetMap, ODbL 1.0, vía la API Overpass.

import json, math, os, urllib.parse, urllib.request
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

RAIZ = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
RAW = os.path.join(RAIZ, 'data', 'raw')
N, PASO, LADO = 1281, 5, 6400
CLAT, CLON = 43.589, -5.955
fi = math.radians(CLAT)
MLAT = 111132.92 - 559.82 * math.cos(2 * fi) + 1.175 * math.cos(4 * fi) - 0.0023 * math.cos(6 * fi)
MLON = 111412.84 * math.cos(fi) - 93.5 * math.cos(3 * fi) + 0.118 * math.cos(5 * fi)

s, n = CLAT - LADO / 2 / MLAT, CLAT + LADO / 2 / MLAT
w, e = CLON - LADO / 2 / MLON, CLON + LADO / 2 / MLON
consulta = f'[out:json][timeout:60];(way["natural"="beach"]({s},{w},{n},{e});relation["natural"="beach"]({s},{w},{n},{e}););out geom;'
cache = os.path.join(RAW, 'osm_playas.json')
if os.path.exists(cache):
    datos = json.load(open(cache, encoding='utf-8'))
else:
    datos = None
    for servidor in ('https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://lz4.overpass-api.de/api/interpreter'):
        try:
            req = urllib.request.Request(servidor, data=urllib.parse.urlencode({'data': consulta}).encode(),
                                         headers={'User-Agent': 'marea-salinas (proyecto personal)'})
            datos = json.load(urllib.request.urlopen(req, timeout=90)); break
        except Exception as e:
            print(servidor, 'falló:', e)
    if datos is None: raise SystemExit('Ningún servidor Overpass respondió')
    json.dump(datos, open(cache, 'w', encoding='utf-8'))

def a_px(lat, lon):
    x = (lon - CLON) * MLON; z = -(lat - CLAT) * MLAT
    return ((x + LADO / 2) / PASO, (z + LADO / 2) / PASO)

esc = 4  # se dibuja a 4× y se reduce: bordes suaves
im = Image.new('L', (N * esc, N * esc), 0)
dib = ImageDraw.Draw(im)
nombres = []
for el in datos['elements']:
    anillos = []
    if el['type'] == 'way':
        anillos.append((el['geometry'], True))
    else:
        for m in el.get('members', []):
            if m.get('type') == 'way' and 'geometry' in m: anillos.append((m['geometry'], m.get('role') != 'inner'))
    for geom, exterior in anillos:
        pts = [tuple(v * esc for v in a_px(p['lat'], p['lon'])) for p in geom]
        if len(pts) >= 3: dib.polygon(pts, fill=255 if exterior else 0)
    nombres.append(el.get('tags', {}).get('name', f"{el['type']} {el['id']}"))
# un poco de margen (3 m) para cubrir el pie del muro y bordes de digitalización
im = im.resize((N, N), Image.LANCZOS).filter(ImageFilter.MaxFilter(3))
im.save(os.path.join(RAIZ, 'public', 'bahia', 'playa.png'), optimize=True)
json.dump({'fuente': 'OpenStreetMap, natural=beach (Overpass), © colaboradores de OpenStreetMap, ODbL 1.0',
           'consultado': __import__('datetime').date.today().isoformat(), 'playas': nombres,
           'formato': 'PNG gris 1281 × 1281 en la rejilla del relieve (5 m), filas de norte a sur; 255 = playa'},
          open(os.path.join(RAIZ, 'src', 'scene', 'bahia-playa.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
a = np.asarray(im) > 127
print(len(nombres), 'playas:', nombres, '|', round(a.sum() * PASO * PASO / 1e4, 1), 'ha')
