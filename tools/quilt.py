#!/usr/bin/env python3
"""Make a floor picture for the room from a phone photo of the sample, using only the photo's own pixels.

The photo is cut into overlapping patches; each new patch is the one whose edge best matches what is already
laid, and where two patches overlap the join follows the path along which they differ least. Nothing is
blurred or invented. (This is image quilting, after Efros and Freeman, 2001.)

    python3 tools/quilt.py spec.json PHOTO_DIR OUT_DIR

spec.json is a list of jobs:
    {"out": "quinn-titanium-galveston.jpg", "photo": "IMG_1234.jpg",
     "board": [x0, y0, x1, y1],          # the sample in the photo, as fractions of its width and height
     "skip": [[x0, y0, x1, y1], ...],    # labels, tags, fingers: never copied
     "kind": "plank" | "carpet",
     "across_in": 7,                     # plank: how wide the board is in the photo; carpet: how wide "board" is
     "plank_in": [7, 48],                # plank: the board to make (width, length)
     "tile_in": 48,                      # carpet: the repeating square to make
     "grain": "vertical" | "horizontal"} # plank: which way the boards run in the photo
"""
import json, os, sys
import numpy as np
from PIL import Image, ImageOps
from scipy import ndimage

PPI = {"plank": 40, "carpet": 30}   # pixels per inch of the picture made


def even_light(a, frac=0.3):
    lum = a.mean(axis=2)
    blur = ndimage.gaussian_filter(lum, sigma=max(4.0, frac * min(lum.shape)), mode="reflect")
    gain = np.clip(lum.mean() / np.maximum(blur, 1.0), 0.7, 1.4)
    return np.clip(a * gain[..., None], 0, 255)


def min_cut(err, axis):
    """Cheapest path through err along axis 0 (top to bottom); returns, for each row, the column of the path."""
    e = err if axis == 0 else err.T
    h, w = e.shape
    cost = e.copy()
    for i in range(1, h):
        prev = cost[i - 1]
        left = np.r_[np.inf, prev[:-1]]
        right = np.r_[prev[1:], np.inf]
        cost[i] += np.minimum(np.minimum(left, prev), right)
    path = np.zeros(h, dtype=int)
    path[-1] = int(np.argmin(cost[-1]))
    for i in range(h - 2, -1, -1):
        j = path[i + 1]
        lo, hi = max(0, j - 1), min(w, j + 2)
        path[i] = lo + int(np.argmin(cost[i, lo:hi]))
    return path


def quilt(src, ok, out_h, out_w, block, overlap, rng, flips=True, wrap=False, tries=400):
    """src HxWx3 float, ok HxW bool (pixels that may be copied). Returns out_h x out_w x 3."""
    step = block - overlap
    H, W = ok.shape
    # top-left corners whose whole block is copyable
    ii = ndimage.uniform_filter(ok.astype(np.float32), size=block, mode="constant", origin=(-(block // 2), -(block // 2)))
    ys, xs = np.nonzero(ii[: H - block + 1, : W - block + 1] > 0.999)
    if len(ys) == 0:
        raise ValueError("no clean area as big as one patch; use a smaller patch or a bigger sample")
    sources = [src]
    if flips:
        sources.append(src[::-1, ::-1])   # the same patch turned end for end
    ny = int(np.ceil((out_h + (overlap if wrap else 0) - overlap) / step))
    nx = int(np.ceil((out_w + (overlap if wrap else 0) - overlap) / step))
    oh, ow = ny * step + overlap, nx * step + overlap
    out = np.zeros((oh, ow, 3), dtype=np.float32)
    for by in range(ny):
        for bx in range(nx):
            y, x = by * step, bx * step
            k = rng.integers(0, len(ys), size=min(tries, len(ys)))
            cy, cx, cs = ys[k], xs[k], rng.integers(0, len(sources), size=len(k))
            best, bi = None, None
            errs = np.zeros(len(k))
            for n in range(len(k)):
                s = sources[cs[n]]
                py, px = (cy[n], cx[n]) if cs[n] == 0 else (H - block - cy[n], W - block - cx[n])
                p = s[py:py + block, px:px + block]
                e = 0.0
                if bx > 0:
                    e += ((p[:, :overlap] - out[y:y + block, x:x + overlap]) ** 2).sum()
                if by > 0:
                    e += ((p[:overlap] - out[y:y + overlap, x:x + block]) ** 2).sum()
                errs[n] = e
            # pick at random among the near-best, so the same patch doesn't win every time
            lim = errs.min() * 1.1 + 1e-6
            good = np.nonzero(errs <= lim)[0]
            n = good[rng.integers(0, len(good))]
            s = sources[cs[n]]
            py, px = (cy[n], cx[n]) if cs[n] == 0 else (H - block - cy[n], W - block - cx[n])
            p = s[py:py + block, px:px + block].copy()
            mask = np.ones((block, block), dtype=bool)
            if bx > 0:
                err = ((p[:, :overlap] - out[y:y + block, x:x + overlap]) ** 2).sum(axis=2)
                path = min_cut(err, 0)
                for r in range(block):
                    mask[r, :path[r]] = False
            if by > 0:
                err = ((p[:overlap] - out[y:y + overlap, x:x + block]) ** 2).sum(axis=2)
                path = min_cut(err, 1)
                for c in range(block):
                    mask[:path[c], c] = False
            region = out[y:y + block, x:x + block]
            region[mask] = p[mask]
    if not wrap:
        return out[:out_h, :out_w]
    # make it repeat: the strip past the right edge is joined onto the left along the least-different path, then the same top to bottom
    q = out[: out_h + overlap, : out_w + overlap]
    L, R = q[:, :overlap].copy(), q[:, out_w:out_w + overlap]
    path = min_cut(((L - R) ** 2).sum(axis=2), 0)
    for r in range(q.shape[0]):
        L[r, :path[r]] = R[r, :path[r]]
    q[:, :overlap] = L
    q = q[:, :out_w]
    T, B = q[:overlap].copy(), q[out_h:out_h + overlap]
    path = min_cut(((T - B) ** 2).sum(axis=2), 1)
    for c in range(q.shape[1]):
        T[:path[c], c] = B[:path[c], c]
    q[:overlap] = T
    return q[:out_h]


def grain_angle(a, ok):
    """Angle in degrees by which the grain leans off vertical (from the structure tensor of the clean area)."""
    g = ndimage.gaussian_filter(a.mean(axis=2), 1.5)
    gx, gy = ndimage.sobel(g, 1), ndimage.sobel(g, 0)
    m = ok & (np.hypot(gx, gy) > 1)
    jxx, jyy, jxy = (gx[m] ** 2).sum(), (gy[m] ** 2).sum(), (gx[m] * gy[m]).sum()
    # dominant gradient direction is across the grain
    theta = 0.5 * np.degrees(np.arctan2(2 * jxy, jxx - jyy))
    return float(theta)


def strip_quilt(a, ok, out_w, rng, overlap):
    """Boards: long pieces the full width of the board, taken from the clean stretches and joined end to end,
    each join following the least-different path across the grain. a is H x W with the grain running left to right."""
    H, W = ok.shape
    clean = ok.all(axis=0)
    runs, start = [], None
    for c in range(W + 1):
        if c < W and clean[c]:
            start = c if start is None else start
        elif start is not None:
            if c - start >= 3 * overlap:
                runs.append((start, c))
            start = None
    if not runs:
        raise ValueError("no clean stretch across the whole board")
    longest = max(e - s for s, e in runs)
    runs = [r for r in runs if r[1] - r[0] >= max(3 * overlap, 0.5 * longest)]   # only the long clean stretches
    variants = [a, a[::-1, ::-1]]   # as photographed, or turned end for end (never mirrored: that shows)
    longest = max(e - s for s, e in runs)
    piece = max(3 * overlap, min(longest, int(out_w * 0.45)))
    out = np.zeros((H, out_w + piece, 3), dtype=np.float32)
    x = 0
    first = True
    while x < out_w:
        best = None
        for _ in range(200):
            s, e = runs[rng.integers(0, len(runs))]
            L = min(piece, e - s)
            if L < 2 * overlap:
                continue
            p0 = s + int(rng.integers(0, e - s - L + 1))
            v = int(rng.integers(0, 2))
            src = variants[v]
            c0 = p0 if v == 0 else W - p0 - L
            p = src[:, c0:c0 + L]
            err = 0.0 if first else float(((p[:, :overlap] - out[:, x:x + overlap]) ** 2).mean())
            if best is None or err < best[0]:
                best = (err, p)
            if first:
                break
        p = best[1].copy()
        L = p.shape[1]
        if first:
            out[:, :L] = p
            x, first = L - overlap, False
            continue
        err = ((p[:, :overlap] - out[:, x:x + overlap]) ** 2).sum(axis=2)
        path = min_cut(err, 0)
        mask = np.ones((H, L), dtype=bool)
        for r in range(H):
            mask[r, :path[r]] = False
        region = out[:, x:x + L]
        region[mask] = p[mask]
        x += L - overlap
    return out[:, :out_w]


def job(j, photos, outdir, seed=7):
    im = ImageOps.exif_transpose(Image.open(os.path.join(photos, j["photo"]))).convert("RGB")
    W, H = im.size
    b = j["board"]
    box = (int(b[0] * W), int(b[1] * H), int(b[2] * W), int(b[3] * H))
    a = np.asarray(im.crop(box), dtype=np.float32)
    ok = np.ones(a.shape[:2], dtype=bool)
    for s in j.get("skip", []):
        x0, y0 = int(s[0] * W) - box[0], int(s[1] * H) - box[1]
        x1, y1 = int(s[2] * W) - box[0], int(s[3] * H) - box[1]
        ok[max(0, y0):max(0, y1), max(0, x0):max(0, x1)] = False
    kind = j["kind"]
    ppi = PPI[kind]
    # "across_in" is the real width of the board (or carpet) between b[0] and b[2] in the photo
    src_ppi = a.shape[1] / float(j["across_in"]) if kind == "carpet" or j.get("grain", "vertical") == "vertical" else a.shape[0] / float(j["across_in"])
    k = ppi / src_ppi
    img = Image.fromarray(a.astype(np.uint8)).resize((max(8, round(a.shape[1] * k)), max(8, round(a.shape[0] * k))), Image.LANCZOS)
    okm = np.asarray(Image.fromarray(ok.astype(np.uint8) * 255).resize(img.size, Image.NEAREST)) > 127
    okm = ndimage.binary_erosion(okm, iterations=2, border_value=1)
    a = even_light(np.asarray(img, dtype=np.float32))
    rng = np.random.default_rng(seed)
    if kind == "plank":
        # straighten a board that leans in the photo, then cut away the corners the turn brings in
        ang = j.get("angle", grain_angle(a, okm))
        if abs(ang) > 0.4:
            a = ndimage.rotate(a, ang if j.get("grain", "vertical") == "vertical" else -ang, reshape=False, order=1, mode="nearest")
            okm = ndimage.rotate(okm.astype(np.uint8), ang if j.get("grain", "vertical") == "vertical" else -ang, reshape=False, order=0, mode="constant", cval=0) > 0
            t = abs(np.tan(np.radians(ang)))
            my, mx = int(t * a.shape[1] / 2) + 4, int(t * a.shape[0] / 2) + 4
            a, okm = a[my:-my, mx:-mx], okm[my:-my, mx:-mx]
        # the bevels and the very edges of a board catch light; keep to the face
        e = max(2, int(0.03 * a.shape[1]))
        a, okm = a[:, e:-e], okm[:, e:-e]
        j["_angle"] = round(ang, 1)
    if kind == "plank" and j.get("grain", "vertical") == "vertical":
        a, okm = np.rot90(a), np.rot90(okm)   # boards lie left to right
    if kind == "plank":
        w_in, l_in = j["plank_in"]
        out_h, out_w = round(w_in * ppi), round(l_in * ppi)
        img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).resize((round(a.shape[1] * out_h / a.shape[0]), out_h), Image.LANCZOS)
        okm = np.asarray(Image.fromarray(okm.astype(np.uint8) * 255).resize(img.size, Image.NEAREST)) > 127
        n = int(j.get("boards", 3))   # several different boards, stacked; the room mixes them
        res = np.vstack([strip_quilt(np.asarray(img, dtype=np.float32), okm, out_w, rng, overlap=max(12, int(1.2 * ppi))) for _ in range(n)])
        out = Image.fromarray(np.clip(res, 0, 255).astype(np.uint8))
        out.save(os.path.join(outdir, j["out"]), quality=93)
        return out.size
    if False:
        w_in, l_in = j["plank_in"]
        out_h, out_w = round(w_in * ppi), round(l_in * ppi)
        start, ov, wrap = int(min(out_h, a.shape[0], 4 * ppi)), 5, False
    else:
        out_h = out_w = round(j.get("tile_in", 48) * ppi)
        start, ov, wrap = int(min(4 * ppi, min(a.shape[:2]) * 0.6)), 4, True
    # the biggest patch that fits in the clean part of the photo
    res, block = None, max(24, min(start, int(min(a.shape[:2]) * 0.95)))
    while res is None:
        try:
            res = quilt(a, okm, out_h, out_w, block, max(6, block // ov), rng, flips=True, wrap=wrap)
        except ValueError:
            if block <= 24:
                raise
            block = max(24, int(block * 0.8))
    j["_block_in"] = round(block / ppi, 1)
    out = Image.fromarray(np.clip(res, 0, 255).astype(np.uint8))
    out.save(os.path.join(outdir, j["out"]), quality=93)
    return out.size


if __name__ == "__main__":
    spec, photos, outdir = sys.argv[1], sys.argv[2], sys.argv[3]
    os.makedirs(outdir, exist_ok=True)
    only = set(sys.argv[4:])
    for j in json.load(open(spec)):
        if only and j["out"] not in only:
            continue
        try:
            print(j["out"], job(j, photos, outdir), "patch", j.get("_block_in"), "angle", j.get("_angle"))
        except Exception as e:
            print(j["out"], "FAILED:", e)
