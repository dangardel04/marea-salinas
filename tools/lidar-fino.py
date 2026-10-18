# Relieve fino (1 m) de la playa con la nube de puntos LiDAR PNOA 2024 (3ª cobertura).
#
# Uso (desde la raíz del proyecto; necesita data/raw/mdt05_bahia.asc, que baja
# node tools/bahia-relieve.ts):
#   python tools/lidar-fino.py
# Necesita Python 3 con numpy, laspy[lazrs] y pyproj. Después, node tools/bahia-relieve.ts.
# Entrada: las teselas LAZ en data/raw/lidar/ (centrodedescargas.cnig.es, «LiDAR 3ª cobertura»;
#          hay que bajarlas a mano porque la descarga pide un reCAPTCHA).
# Salida:  public/bahia/fino.bin      bloques de 101×101 nodos (Int16 LE, cm sobre el CH de
#                                     Avilés; −32768 = sin dato, se usa el relieve de 5 m)
#          src/scene/bahia-fino.json  índice de bloques y metadatos
#          data/lidar2024.json        hora del vuelo y comprobación del sistema vertical
#
# Método:
#   - Solo puntos de clase 2 (suelo). ETRS89 UTM 30N → geográficas → marco local de la bahía
#     (x este, z sur). Rejilla de 1 m con nodos en metros enteros: cada nodo es la media de los
#     puntos de suelo de su metro cuadrado. Los huecos pequeños (con al menos 6 vecinos con dato
#     en 5×5 m) se rellenan con la media de esos vecinos; el resto queda sin dato.
#   - Sistema vertical: la nube no lo declara. Se compara con el MDT05 del IGN (NMMA) en tierra
#     por encima de +6 m: si la diferencia mediana es de centímetros, la nube está en altitud
#     ortométrica como el MDT05 y se pasa al CH con el mismo desnivel (NMMA_SOBRE_CH_APROX de
#     src/config.ts).
#   - Se guardan los bloques de 100 m con arena de playa (algún nodo por debajo de +4,5 m sobre
#     el CH) y sus vecinos, con al menos un 10 % de nodos con dato: la playa, el paseo, el club,
#     las dunas y la primera línea de casas.

import glob, json, math, os, re, datetime as dt
import numpy as np

RAIZ = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
RAW = os.path.join(RAIZ, 'data', 'raw')
BLOQUE = 100            # cuadros por bloque (101 nodos por lado: el borde se repite)
SIN_DATO = -32768
COTA_PLAYA = 4.5        # m sobre el CH

CLAT, CLON = 43.589, -5.955
fi = math.radians(CLAT)
MLAT = 111132.92 - 559.82 * math.cos(2 * fi) + 1.175 * math.cos(4 * fi) - 0.0023 * math.cos(6 * fi)
MLON = 111412.84 * math.cos(fi) - 93.5 * math.cos(3 * fi) + 0.118 * math.cos(5 * fi)

def nmma_sobre_ch():
    """El mismo desnivel que usa el resto del proyecto (src/config.ts)."""
    texto = open(os.path.join(RAIZ, 'src', 'config.ts'), encoding='utf-8').read()
    m = re.search(r'NMMA_SOBRE_CH_APROX\s*=\s*([0-9.]+)\s*-\s*([0-9.]+)', texto)
    return float(m.group(1)) - float(m.group(2))

def leer_mdt05():
    """MDT05 del IGN tal como lo baja tools/bahia-relieve.ts (ASCII grid en geográficas)."""
    texto = open(os.path.join(RAW, 'mdt05_bahia.asc'), encoding='latin1').read()
    cuerpo = texto.split('filename=out.asc')[1].split('--wcs')[0].strip().split('\n')
    cab = {l.split()[0].lower(): float(l.split()[1]) for l in cuerpo[:5]}
    v = np.array([[float(a) for a in l.split()] for l in cuerpo[5:]])
    return cab, v

def main():
    import laspy
    from pyproj import Transformer
    tr = Transformer.from_crs('EPSG:25830', 'EPSG:4258', always_xy=True)
    ficheros = sorted({os.path.normcase(f): f for f in glob.glob(os.path.join(RAW, 'lidar', '*.[lL][aA][zZ]'))}.values())
    if not ficheros: raise SystemExit('No hay teselas LAZ en data/raw/lidar/')

    xs, zs, hs, ts = [], [], [], []
    for f in ficheros:
        with laspy.open(f) as r:
            las = r.read()
        g = np.asarray(las.classification) == 2
        lon, lat = tr.transform(np.asarray(las.x)[g], np.asarray(las.y)[g])
        xs.append((lon - CLON) * MLON); zs.append(-(lat - CLAT) * MLAT); hs.append(np.asarray(las.z)[g])
        ts.append([float(np.min(las.gps_time)), float(np.max(las.gps_time))])
        print(os.path.basename(f), f'{g.sum()} puntos de suelo', flush=True)
    x = np.concatenate(xs); z = np.concatenate(zs); h = np.concatenate(hs)

    # Hora del vuelo: tiempo GPS ajustado (s desde 1980‑01‑06 − 1e9), menos los 18 s GPS−UTC
    base = dt.datetime(1980, 1, 6, tzinfo=dt.timezone.utc)
    aUtc = lambda s: (base + dt.timedelta(seconds=s + 1e9 - 18)).isoformat(timespec='seconds')
    vuelo = [aUtc(min(t[0] for t in ts)), aUtc(max(t[1] for t in ts))]
    print('vuelo', vuelo)

    # Rejilla de 1 m
    x0, z0 = math.floor(x.min()), math.floor(z.min())
    nx, nz = math.ceil(x.max()) - x0 + 1, math.ceil(z.max()) - z0 + 1
    k = np.rint(z - z0).astype(np.int64) * nx + np.rint(x - x0).astype(np.int64)
    suma = np.bincount(k, weights=h, minlength=nx * nz); cuenta = np.bincount(k, minlength=nx * nz)
    rej = np.full(nx * nz, np.nan); ok = cuenta > 0
    rej[ok] = suma[ok] / cuenta[ok]
    rej = rej.reshape(nz, nx)
    hueco = np.isnan(rej)
    v = np.where(hueco, 0, rej); w = (~hueco).astype(float)
    def caja(a, r=2):
        p = np.pad(a, r); s = np.zeros_like(a)
        for dy in range(2 * r + 1):
            for dx in range(2 * r + 1): s += p[dy:dy + a.shape[0], dx:dx + a.shape[1]]
        return s
    sv, sw = caja(v), caja(w)
    rellenar = hueco & (sw >= 6)
    rej[rellenar] = sv[rellenar] / sw[rellenar]
    print(f'rejilla {nx}×{nz} m, nodos con dato {np.isfinite(rej).mean() * 100:.1f} %')

    # ---- Sistema vertical: comparación con el MDT05 (NMMA) en tierra por encima de +6 m ----
    cab, mdt = leer_mdt05()
    jj, ii = np.nonzero(np.isfinite(rej))
    sel = np.random.default_rng(0).choice(len(jj), size=min(400_000, len(jj)), replace=False)
    jj, ii = jj[sel], ii[sel]
    lat = CLAT - (jj + z0) / MLAT; lon = CLON + (ii + x0) / MLON
    c = np.floor((lon - cab['xllcorner']) / cab['cellsize']).astype(int)
    r = (mdt.shape[0] - 1 - np.floor((lat - cab['yllcorner']) / cab['cellsize'])).astype(int)
    dentro = (c >= 0) & (c < mdt.shape[1]) & (r >= 0) & (r < mdt.shape[0])
    m5 = np.full(len(jj), np.nan); m5[dentro] = mdt[r[dentro], c[dentro]]
    estable = m5 > 6
    dif = rej[jj[estable], ii[estable]] - m5[estable]
    dMed = float(np.median(dif)); dMad = float(1.4826 * np.median(np.abs(dif - dMed)))
    print(f'LiDAR 2024 − MDT05 en tierra (> +6 m NMMA): mediana {dMed:+.3f} m, MAD {dMad:.3f} m, {estable.sum()} nodos')
    if abs(dMed) > 0.5: raise SystemExit('La nube no parece estar en altitud ortométrica (NMMA): revisa el sistema vertical.')
    desnivel = nmma_sobre_ch()
    rej = rej + desnivel  # → m sobre el CH de Avilés

    # ---- Bloques de la playa y sus vecinos ----
    def sub_bloque(bi, bj):
        gx = np.arange(bi * BLOQUE, bi * BLOQUE + BLOQUE + 1) - x0; gz = np.arange(bj * BLOQUE, bj * BLOQUE + BLOQUE + 1) - z0
        sub = np.full((len(gz), len(gx)), np.nan)
        vi = (gx >= 0) & (gx < nx); vj = (gz >= 0) & (gz < nz)
        if vi.any() and vj.any(): sub[np.ix_(vj, vi)] = rej[np.ix_(gz[vj], gx[vi])]
        return sub
    rango_i = range(math.floor(x0 / BLOQUE), math.ceil((x0 + nx) / BLOQUE))
    rango_j = range(math.floor(z0 / BLOQUE), math.ceil((z0 + nz) / BLOQUE))
    subs = {(bi, bj): sub_bloque(bi, bj) for bj in rango_j for bi in rango_i}
    playa = {b for b, s in subs.items() if np.isfinite(s).mean() >= 0.10 and np.nanmin(s) < COTA_PLAYA}
    elegidos = sorted({(bi + di, bj + dj) for bi, bj in playa for di in (-1, 0, 1) for dj in (-1, 0, 1)
                       if (bi + di, bj + dj) in subs and np.isfinite(subs[(bi + di, bj + dj)]).mean() >= 0.10},
                      key=lambda b: (b[1], b[0]))
    with open(os.path.join(RAIZ, 'public', 'bahia', 'fino.bin'), 'wb') as f:
        for b in elegidos:
            s = subs[b]
            f.write(np.where(np.isfinite(s), np.rint(s * 100), SIN_DATO).astype('<i2').tobytes())
    nodos = int(sum(np.isfinite(subs[b]).sum() for b in elegidos))
    meta = {
        'formato': f'Bloques de {BLOQUE + 1}×{BLOQUE + 1} nodos con 1 m de paso, Int16 little-endian, cm sobre el CH de Avilés, filas de norte a sur; {SIN_DATO} = sin dato. '
                   f'El bloque (bi, bj) cubre x de bi·{BLOQUE} a (bi+1)·{BLOQUE} m y z de bj·{BLOQUE} a (bj+1)·{BLOQUE} m del marco local, en el orden de «bloques».',
        'bloque': BLOQUE, 'paso': 1, 'sinDato': SIN_DATO, 'bloques': [list(map(int, b)) for b in elegidos],
        'fuente': 'LiDAR PNOA 2024 (3ª cobertura), nube clasificada, clase 2 (suelo). © Instituto Geográfico Nacional (CNIG), CC BY 4.0',
        'teselas': [os.path.basename(f) for f in ficheros],
        'vuelo': vuelo,
        'nmmaSobreCh': round(desnivel, 4),
    }
    json.dump(meta, open(os.path.join(RAIZ, 'src', 'scene', 'bahia-fino.json'), 'w', encoding='utf-8'), ensure_ascii=False)
    tam = os.path.getsize(os.path.join(RAIZ, 'public', 'bahia', 'fino.bin')) / 1e6
    print(f'{len(elegidos)} bloques, {nodos} nodos con dato, {tam:.1f} MB')
    informe = {
        'vuelo': vuelo, 'puntosSuelo': int(len(h)), 'bloques': len(elegidos), 'nodosConDato': nodos,
        'comprobacionVertical': {'mediana': round(dMed, 3), 'mad': round(dMad, 3), 'nodos': int(estable.sum()),
                                 'nota': 'LiDAR 2024 (sin convertir) − MDT05 IGN (NMMA) en nodos de tierra por encima de +6 m'},
        'arenaMasBaja': {'p01': round(float(np.nanpercentile(rej, 0.1)), 2), 'nota': 'percentil 0,1 de la cota de suelo, m sobre el CH'},
    }
    json.dump(informe, open(os.path.join(RAIZ, 'data', 'lidar2024.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

main()
