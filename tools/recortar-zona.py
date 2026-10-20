# Recorta los edificios a la zona de la playa y el paseo (src/scene/bahia-zona.json).
#
# La escena solo dibuja con detalle lo cercano a la playa (src/scene/bahia/zona.ts); lo demás se
# funde en la bruma. Los edificios de toda la bahía pesaban ~12 MB que casi nadie llegaba a ver:
# aquí se quitan los triángulos cuyo centro queda a más de `recorteEdificios` m de las semillas de
# la zona (pies del muro, uno de cada `cadaPie`, y arranques de los perfiles de la playa; las
# mismas que zona.ts).
#
# Entrada y salida (se reescriben en su sitio; repetirlo no cambia nada):
#   public/bahia/edificios.bin        + src/scene/bahia-edificios.json        (triángulos sueltos)
#   public/bahia/edificios-lidar.bin  + src/scene/bahia-edificios-lidar.json  (malla indexada)
# Ejecutar después de tools/bahia-edificios.ts y tools/edificios-lidar.py.

import json, os
import numpy as np
from scipy.spatial import cKDTree

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ESC = os.path.join(RAIZ, 'src', 'scene')
PUB = os.path.join(RAIZ, 'public', 'bahia')

zona = json.load(open(os.path.join(ESC, 'bahia-zona.json'), encoding='utf-8'))
paseo = json.load(open(os.path.join(ESC, 'bahia-paseo.json'), encoding='utf-8'))
perfiles = json.load(open(os.path.join(ESC, 'bahia-perfiles-playa.json'), encoding='utf-8'))['perfiles']
pies = [p for t in paseo['tramos'] for p in t]
semillas = [(p['pie'][0], p['pie'][2]) for i, p in enumerate(pies) if i % zona['cadaPie'] == 0]
semillas += [(p[0], p[1]) for p in perfiles]
arbol = cKDTree(np.array(semillas))
R = zona['recorteEdificios']


def dentro(cx, cz):
    d, _ = arbol.query(np.stack([cx, cz], 1))
    return d <= R


# ---------- Cajas del Catastro: triángulos sueltos ----------
meta = json.load(open(os.path.join(ESC, 'bahia-edificios.json'), encoding='utf-8'))
nv = meta['vertices']
buf = open(os.path.join(PUB, 'edificios.bin'), 'rb').read()
pos = np.frombuffer(buf, np.int16, nv * 3).reshape(-1, 3)
col = np.frombuffer(buf, np.uint8, nv * 3, nv * 6).reshape(-1, 3)
tri = pos.reshape(-1, 3, 3).astype(np.float64) / 10
c = tri.mean(1)
m = dentro(c[:, 0], c[:, 2])
p2 = pos.reshape(-1, 3, 3)[m].reshape(-1, 3)
c2 = col.reshape(-1, 3, 3)[m].reshape(-1, 3)
with open(os.path.join(PUB, 'edificios.bin'), 'wb') as f:
    f.write(p2.astype('<i2').tobytes())
    f.write(c2.astype(np.uint8).tobytes())
antes = nv
meta['vertices'] = int(len(p2))
meta['recorte'] = f'Solo a menos de {R} m de la playa y el paseo (tools/recortar-zona.py)'
json.dump(meta, open(os.path.join(ESC, 'bahia-edificios.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f'Catastro: {antes} → {len(p2)} vértices')

# ---------- Edificios del LiDAR: malla indexada ----------
meta = json.load(open(os.path.join(ESC, 'bahia-edificios-lidar.json'), encoding='utf-8'))
nv, ni = meta['vertices'], meta['indices']
buf = open(os.path.join(PUB, 'edificios-lidar.bin'), 'rb').read()
pos = np.frombuffer(buf, np.int16, nv * 3).reshape(-1, 3)
col = np.frombuffer(buf, np.uint8, nv * 3, nv * 6).reshape(-1, 3)
desp = -(-(nv * 9) // 4) * 4
idx = np.frombuffer(buf, np.uint32, ni * 3, desp).reshape(-1, 3)
c = pos[idx].astype(np.float64).mean(1) / 10
idx = idx[dentro(c[:, 0], c[:, 2])]
usados = np.unique(idx)
nuevo = np.full(nv, -1, np.int64)
nuevo[usados] = np.arange(len(usados))
pos2, col2, idx2 = pos[usados], col[usados], nuevo[idx].astype(np.uint32)
with open(os.path.join(PUB, 'edificios-lidar.bin'), 'wb') as f:
    f.write(pos2.astype('<i2').tobytes())
    f.write(col2.astype(np.uint8).tobytes())
    f.write(b'\0' * (-(-(len(pos2) * 9) // 4) * 4 - len(pos2) * 9))
    f.write(idx2.astype('<u4').tobytes())
meta['vertices'] = int(len(pos2))
meta['indices'] = int(len(idx2))
meta['recorte'] = f'Solo a menos de {R} m de la playa y el paseo (tools/recortar-zona.py)'
json.dump(meta, open(os.path.join(ESC, 'bahia-edificios-lidar.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f'LiDAR: {nv} → {len(pos2)} vértices, {ni} → {len(idx2)} triángulos')
for n in ('edificios.bin', 'edificios-lidar.bin'):
    print(n, f'{os.path.getsize(os.path.join(PUB, n)) / 1e6:.2f} MB')
