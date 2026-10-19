# Edificios de Salinas con la nube LiDAR PNOA 2024: altura y forma del tejado medidas, y color del
# tejado sacado del propio vuelo. Solo en el tramo de la playa de Salinas y el pueblo (ZONA); fuera
# de él siguen las cajas del Catastro de tools/bahia-edificios.ts.
#
# Uso (desde la raíz del proyecto, con las teselas LAZ en data/raw/lidar/ y el Catastro ya bajado
# por tools/bahia-edificios.ts en data/raw/catastro/):
#   python tools/edificios-lidar.py      y después     node tools/bahia-edificios.ts
# Necesita Python 3 con numpy, scipy, laspy[lazrs], pyproj, matplotlib y triangle.
# Salida: public/bahia/edificios-lidar.bin, src/scene/bahia-edificios-lidar.json y
#         data/edificios_lidar_ids.json (partes del Catastro que ya no se dibujan como cajas).
#
# Método, por cada parte de edificio del Catastro (huella oficial):
#   - Tejado: puntos de clase 6 (edificio) dentro de la huella, rejilla de 1 m con la cota más alta
#     de cada celda, huecos rellenos con la celda más cercana y filtro de mediana 3 × 3 (quita
#     antenas y ruido). Si la nube cubre menos del 30 % de la huella, la parte se queda con su caja.
#   - Malla del tejado: triangulación de Delaunay con restricciones (triangle) de la huella, con
#     los bordes partidos cada 2 m y puntos interiores cada 2 m; la cota de cada vértice, del tejado.
#   - Suelo: mediana de los puntos de clase 2 (suelo) a entre 1 y 5 m de la huella.
#   - Fachadas: un cuadrilátero por tramo de borde, del suelo al alero (la cota del tejado en el borde).
#   - Color del tejado: media del RGB de los puntos de clase 6 a menos de 1,2 m de cada vértice.
#   - Color de fachada: claro, uno de una paleta corta según la parte (DECORATIVO: no hay dato).

import glob, json, math, os, re, hashlib
import numpy as np

RAIZ = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
RAW = os.path.join(RAIZ, 'data', 'raw')
ZONA = (260400.0, 4828000.0, 262400.0, 4829900.0)  # UTM 30N: de La Peñona y el club al centro de Salinas
PASO_TEJADO = 2.0
CLAT, CLON = 43.589, -5.955
fi = math.radians(CLAT)
MLAT = 111132.92 - 559.82 * math.cos(2 * fi) + 1.175 * math.cos(4 * fi) - 0.0023 * math.cos(6 * fi)
MLON = 111412.84 * math.cos(fi) - 93.5 * math.cos(3 * fi) + 0.118 * math.cos(5 * fi)
FACHADAS = [(236, 233, 226), (234, 226, 208), (214, 214, 209), (229, 214, 186), (240, 238, 232)]

def nmma_sobre_ch():
    texto = open(os.path.join(RAIZ, 'src', 'config.ts'), encoding='utf-8').read()
    m = re.search(r'NMMA_SOBRE_CH_APROX\s*=\s*([0-9.]+)\s*-\s*([0-9.]+)', texto)
    return float(m.group(1)) - float(m.group(2))

def partes_catastro():
    partes = {}
    for f in glob.glob(os.path.join(RAW, 'catastro', '*.xml')):
        xml = open(f, encoding='latin1').read()
        for bloque in xml.split('<bu-ext2d:BuildingPart ')[1:]:
            m = re.search(r'gml:id="([^"]+)"', bloque)
            pl = re.search(r'numberOfFloorsAboveGround>(\d+)<', bloque)
            if not m or not pl or int(pl.group(1)) <= 0 or m.group(1) in partes: continue
            ext = re.search(r'<gml:exterior>([\s\S]*?)</gml:exterior>', bloque)
            if not ext: continue
            anillos = []
            for trozo in [ext.group(1)] + re.findall(r'<gml:interior>([\s\S]*?)</gml:interior>', bloque):
                p = re.search(r'<gml:posList[^>]*>([^<]+)<', trozo)
                if p:
                    v = np.array(p.group(1).split(), float).reshape(-1, 2)
                    if len(v) > 1 and np.allclose(v[0], v[-1]): v = v[:-1]
                    if len(v) >= 3: anillos.append(v)
            if not anillos: continue
            c = anillos[0].mean(0)
            if ZONA[0] <= c[0] <= ZONA[2] and ZONA[1] <= c[1] <= ZONA[3]:
                partes[m.group(1)] = {'plantas': int(pl.group(1)), 'anillos': anillos}
    return partes

def densificar(anillo, paso):
    pts = []
    n = len(anillo)
    for k in range(n):
        a, b = anillo[k], anillo[(k + 1) % n]
        L = float(np.hypot(*(b - a)))
        m = max(1, int(math.ceil(L / paso)))
        for t in range(m): pts.append(a + (b - a) * (t / m))
    return np.array(pts)

def punto_dentro(anillo):
    """Un punto que caiga dentro del anillo (para marcar los patios como agujeros)."""
    from matplotlib.path import Path
    c = anillo.mean(0)
    camino = Path(anillo)
    if camino.contains_point(c): return c
    xs = np.linspace(anillo[:, 0].min(), anillo[:, 0].max(), 15); ys = np.linspace(anillo[:, 1].min(), anillo[:, 1].max(), 15)
    for x in xs:
        for y in ys:
            if camino.contains_point((x, y)): return np.array([x, y])
    return c

def main():
    import laspy, triangle
    from pyproj import Transformer
    from scipy import ndimage
    from matplotlib.path import Path

    tr = Transformer.from_crs('EPSG:25830', 'EPSG:4258', always_xy=True)
    desnivel = nmma_sobre_ch()
    partes = partes_catastro()
    print(len(partes), 'partes del Catastro en la zona')

    # Nube: edificios (clase 6, con color) y suelo (clase 2), solo en la zona (+50 m)
    E, C, S = [], [], []
    for f in sorted({os.path.normcase(f): f for f in glob.glob(os.path.join(RAW, 'lidar', '*.[lL][aA][zZ]'))}.values()):
        with laspy.open(f) as r:
            hd = r.header
            if hd.maxs[0] < ZONA[0] - 50 or hd.mins[0] > ZONA[2] + 50 or hd.maxs[1] < ZONA[1] - 50 or hd.mins[1] > ZONA[3] + 50: continue
            las = r.read()
        x, y, z = np.asarray(las.x), np.asarray(las.y), np.asarray(las.z)
        cl = np.asarray(las.classification)
        dentro = (x > ZONA[0] - 50) & (x < ZONA[2] + 50) & (y > ZONA[1] - 50) & (y < ZONA[3] + 50)
        e = dentro & (cl == 6); s = dentro & (cl == 2)
        E.append(np.c_[x[e], y[e], z[e]]); S.append(np.c_[x[s], y[s], z[s]])
        rgb = np.c_[np.asarray(las.red)[e], np.asarray(las.green)[e], np.asarray(las.blue)[e]].astype(float)
        C.append(rgb / 256.0 if rgb.max() > 255 else rgb)
        print(os.path.basename(f), e.sum(), 'puntos de edificio', s.sum(), 'de suelo', flush=True)
    E = np.concatenate(E); C = np.concatenate(C); S = np.concatenate(S)
    # Rejillas de 1 m sobre toda la zona, una sola vez: tejado (cota máxima de los puntos de
    # edificio), color medio de esos puntos y suelo (media de los de suelo, con los huecos de
    # debajo de los edificios rellenos con el suelo más cercano).
    X0, Y0 = ZONA[0] - 50, ZONA[1] - 50
    NX, NY = int(ZONA[2] - ZONA[0]) + 101, int(ZONA[3] - ZONA[1]) + 101
    def celda(px, py):
        return np.clip((py - Y0).astype(int), 0, NY - 1), np.clip((px - X0).astype(int), 0, NX - 1)
    jE, iE = celda(E[:, 0], E[:, 1])
    DSM = np.full((NY, NX), np.nan); np.fmax.at(DSM, (jE, iE), E[:, 2])
    kE = jE * NX + iE
    nE = np.bincount(kE, minlength=NX * NY)
    RGB = np.stack([np.bincount(kE, weights=C[:, q], minlength=NX * NY) for q in range(3)], 1) / np.maximum(nE, 1)[:, None]
    RGB = RGB.reshape(NY, NX, 3)
    tieneRGB = (nE > 0).reshape(NY, NX)
    _, (ri, rj) = ndimage.distance_transform_edt(~tieneRGB, return_indices=True)
    RGB = RGB[ri, rj]
    jS, iS = celda(S[:, 0], S[:, 1]); kS = jS * NX + iS
    nS = np.bincount(kS, minlength=NX * NY)
    G = (np.bincount(kS, weights=S[:, 2], minlength=NX * NY) / np.maximum(nS, 1)).reshape(NY, NX)
    _, (gi, gj) = ndimage.distance_transform_edt((nS == 0).reshape(NY, NX), return_indices=True)
    G = G[gi, gj]
    print('rejillas listas', flush=True)

    def a_local(px, py):
        lon, lat = tr.transform(px, py)
        return (np.asarray(lon) - CLON) * MLON, -(np.asarray(lat) - CLAT) * MLAT

    pos, col, idx = [], [], []
    hechos, sinNube = [], 0
    nv = 0
    for pid, p in partes.items():
        anillos = p['anillos']; ext = anillos[0]
        area = abs(0.5 * np.sum(ext[:, 0] * np.roll(ext[:, 1], -1) - np.roll(ext[:, 0], -1) * ext[:, 1]))
        if area < 8: continue
        # Ventana de la rejilla que cubre la huella (+5 m para el suelo de alrededor)
        i0 = max(0, int(ext[:, 0].min() - X0) - 5); i1 = min(NX, int(ext[:, 0].max() - X0) + 6)
        j0 = max(0, int(ext[:, 1].min() - Y0) - 5); j1 = min(NY, int(ext[:, 1].max() - Y0) + 6)
        if i1 - i0 < 3 or j1 - j0 < 3: continue
        wx0, wy0 = X0 + i0, Y0 + j0
        ci, cj = np.meshgrid(np.arange(i1 - i0) + wx0 + 0.5, np.arange(j1 - j0) + wy0 + 0.5)
        centros = np.c_[ci.ravel(), cj.ravel()]
        caminos = [Path(a) for a in anillos]
        mask = caminos[0].contains_points(centros)
        for cam in caminos[1:]: mask &= ~cam.contains_points(centros)
        mask = mask.reshape(ci.shape)
        dsm = DSM[j0:j1, i0:i1]
        cubiertas = np.isfinite(dsm) & mask
        if cubiertas.sum() < 0.3 * area:
            sinNube += 1; continue
        rej = np.where(cubiertas, dsm, np.nan)
        _, (ii, jj) = ndimage.distance_transform_edt(~cubiertas, return_indices=True)
        rej = ndimage.median_filter(rej[ii, jj], size=3)
        def tejado(qx, qy, rej=rej, wx0=wx0, wy0=wy0):
            return ndimage.map_coordinates(rej, [np.asarray(qy) - wy0 - 0.5, np.asarray(qx) - wx0 - 0.5], order=1, mode='nearest')
        anillo_ = ndimage.binary_dilation(mask, iterations=4) & ~ndimage.binary_dilation(mask, iterations=1)
        g = G[j0:j1, i0:i1]
        suelo = float(np.median(g[anillo_])) if anillo_.any() else float(np.min(g))
        # Triangulación del tejado
        bordes, segs, agujeros = [], [], []
        for k, a in enumerate(anillos):
            d = densificar(a, PASO_TEJADO)
            base = sum(len(b) for b in bordes)
            bordes.append(d)
            segs += [[base + q, base + (q + 1) % len(d)] for q in range(len(d))]
            if k: agujeros.append(punto_dentro(a))
        borde = np.concatenate(bordes)
        gx, gy = np.meshgrid(np.arange(ext[:, 0].min() + 1, ext[:, 0].max(), PASO_TEJADO), np.arange(ext[:, 1].min() + 1, ext[:, 1].max(), PASO_TEJADO))
        interior = np.c_[gx.ravel(), gy.ravel()]
        if len(interior):
            ok = caminos[0].contains_points(interior, radius=-1.6)
            for cam in caminos[1:]: ok &= ~cam.contains_points(interior, radius=1.6)
            interior = interior[ok]
        verts = np.concatenate([borde, interior]) if len(interior) else borde
        entrada = {'vertices': verts, 'segments': np.array(segs)}
        if agujeros: entrada['holes'] = np.array(agujeros)
        try:
            t = triangle.triangulate(entrada, 'p')
        except Exception:
            sinNube += 1; continue
        V = t['vertices']; T = t['triangles']
        if len(T) == 0: sinNube += 1; continue
        # Cota del tejado; en el borde, medio metro hacia dentro para no coger la del suelo
        zr = tejado(V[:, 0], V[:, 1])
        # Color del tejado: media de los puntos cercanos
        rgb = np.stack([ndimage.map_coordinates(RGB[j0:j1, i0:i1, q], [V[:, 1] - wy0 - 0.5, V[:, 0] - wx0 - 0.5], order=1, mode='nearest') for q in range(3)], 1)
        lx, lz = a_local(V[:, 0], V[:, 1])
        # orden de los triángulos para que miren hacia arriba (en local la z va al sur: se invierte)
        for a, b, c in T:
            cruz = (V[b, 0] - V[a, 0]) * (V[c, 1] - V[a, 1]) - (V[b, 1] - V[a, 1]) * (V[c, 0] - V[a, 0])
            idx.append((nv + a, nv + c, nv + b) if cruz > 0 else (nv + a, nv + b, nv + c))
        for k in range(len(V)):
            pos.append((lx[k], zr[k] + desnivel, lz[k])); col.append(rgb[k])
        nv += len(V)
        # Fachadas (vértices propios: aristas vivas)
        fach = FACHADAS[int(hashlib.md5(pid.encode()).hexdigest(), 16) % len(FACHADAS)]
        y_suelo = suelo + desnivel - 0.6
        for d in bordes:
            zb = tejado(d[:, 0], d[:, 1]) + desnivel
            bx, bz = a_local(d[:, 0], d[:, 1])
            m = len(d)
            for q in range(m):
                r_ = (q + 1) % m
                base = nv
                for (xx, yy, zz) in ((bx[q], y_suelo, bz[q]), (bx[r_], y_suelo, bz[r_]), (bx[r_], zb[r_], bz[r_]), (bx[q], zb[q], bz[q])):
                    pos.append((xx, yy, zz)); col.append(fach)
                idx.append((base, base + 1, base + 2)); idx.append((base, base + 2, base + 3))
                nv += 4
        hechos.append(pid)
        if len(hechos) % 250 == 0: print(len(hechos), 'partes hechas', flush=True)

    P = np.array(pos); Cc = np.clip(np.array(col), 0, 255).astype(np.uint8); I = np.array(idx, dtype=np.uint32)
    pos16 = np.round(P * 10).astype('<i2')
    with open(os.path.join(RAIZ, 'public', 'bahia', 'edificios-lidar.bin'), 'wb') as f:
        f.write(pos16.tobytes()); f.write(Cc.tobytes())
        if (len(P) * 9) % 4: f.write(b'\0' * (4 - (len(P) * 9) % 4))
        f.write(I.astype('<u4').tobytes())
    meta = {
        'fuente': 'Huellas: Catastro (INSPIRE BuildingPart). Alturas, tejados y color de los tejados: LiDAR PNOA 2024 (CNIG, CC BY 4.0), clases 6 (edificio) y 2 (suelo). Ver tools/edificios-lidar.py',
        'zonaUtm': ZONA, 'partes': len(hechos), 'sinNubeSuficiente': sinNube, 'vertices': int(len(P)), 'indices': int(len(I)),  # indices = número de triángulos
        'formato': 'Int16 x,y,z (dm, local) por vértice; Uint8 r,g,b por vértice; relleno a múltiplo de 4 bytes; Uint32 índices de triángulos',
        'fachadas': 'Color DECORATIVO (paleta clara); la nube no da el de las fachadas',
    }
    json.dump(meta, open(os.path.join(RAIZ, 'src', 'scene', 'bahia-edificios-lidar.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    json.dump(sorted(hechos), open(os.path.join(RAIZ, 'data', 'edificios_lidar_ids.json'), 'w', encoding='utf-8'))
    print(f'{len(hechos)} partes con tejado LiDAR ({sinNube} sin nube suficiente: siguen como cajas), {len(P)} vértices, {len(I)} triángulos, '
          f'{os.path.getsize(os.path.join(RAIZ, "public", "bahia", "edificios-lidar.bin")) / 1e6:.1f} MB')

main()
