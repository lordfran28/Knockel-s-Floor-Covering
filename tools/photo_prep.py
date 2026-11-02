"""Turn a phone photo of a floor sample into the picture the room tool lays.

prepare(src, id, photo, root, floors) finds the sample on its background, cuts it out, evens out the
light (so the window side isn't brighter than the far side once it repeats across a room), and:
  roll  (carpet, sheet vinyl)  makes it repeat without a seam
  plank (vinyl, laminate, wood) turns the boards lengthwise and keeps them as one strip
  tile                          keeps the single tile
It writes assets/floors/<id>.jpg and a square assets/floors/thumbs/<id>.jpg.
"""
import os
import numpy as np
from PIL import Image, ImageOps
from scipy import ndimage

MAX = 2048


def _find_sample(rgb):
    """Bounding box (x0, y0, x1, y1) of the sample, found against the colour of the photo's edges."""
    h, w, _ = rgb.shape
    b = max(4, int(min(h, w) * 0.03))
    border = np.concatenate([rgb[:b].reshape(-1, 3), rgb[-b:].reshape(-1, 3), rgb[:, :b].reshape(-1, 3), rgb[:, -b:].reshape(-1, 3)])
    bg = np.median(border, axis=0)
    dist = np.sqrt(((rgb - bg) ** 2).sum(axis=2))
    bd = np.sqrt(((border - bg) ** 2).sum(axis=1))
    thr = max(28.0, float(np.percentile(bd, 90)) * 1.6)
    mask = ndimage.binary_closing(ndimage.binary_opening(dist > thr, iterations=2), iterations=4)
    lab, n = ndimage.label(mask)
    if n == 0:
        return None
    sizes = ndimage.sum(mask, lab, range(1, n + 1))
    k = int(np.argmax(sizes)) + 1
    if sizes[k - 1] < 0.08 * h * w:
        return None
    ys, xs = np.nonzero(lab == k)
    # trim the outer few percent: the edge of a sample is often frayed, bevelled or in shadow
    y0, y1, x0, x1 = np.percentile(ys, 0.5), np.percentile(ys, 99.5), np.percentile(xs, 0.5), np.percentile(xs, 99.5)
    dy, dx = (y1 - y0) * 0.025, (x1 - x0) * 0.025
    return int(x0 + dx), int(y0 + dy), int(x1 - dx), int(y1 - dy)


def _trim_flat(im):
    """Cut plain white or black bands off the edges of a maker's picture."""
    a = np.asarray(im.convert("L"), dtype=np.int16)
    busy = (a < 238) & (a > 12)
    rows = np.nonzero(busy.mean(axis=1) > 0.03)[0]
    cols = np.nonzero(busy.mean(axis=0) > 0.03)[0]
    if len(rows) < 16 or len(cols) < 16:
        return im
    return im.crop((int(cols[0]), int(rows[0]), int(cols[-1]) + 1, int(rows[-1]) + 1))


def _even_light(a, sigma_frac=0.22):
    """Divide out the slow change in brightness across the sample, keeping its average."""
    lum = a.mean(axis=2)
    small = max(1, int(max(a.shape[:2]) / 256))
    s = lum[::small, ::small]
    blur = ndimage.gaussian_filter(s, sigma=max(2.0, sigma_frac * min(s.shape)), mode="reflect")
    blur = np.array(Image.fromarray(blur.astype(np.float32), mode="F").resize((a.shape[1], a.shape[0]), Image.BILINEAR))
    gain = np.clip(lum.mean() / np.maximum(blur, 1.0), 0.6, 1.6)
    return np.clip(a * gain[..., None], 0, 255)


def _seamless(a):
    """Blend each half with the copy shifted by half, so the right edge runs into the left, and the top into the bottom."""
    h, w, _ = a.shape
    sh = np.roll(np.roll(a, h // 2, axis=0), w // 2, axis=1)
    yy = 1 - np.abs(np.linspace(-1, 1, h))
    xx = 1 - np.abs(np.linspace(-1, 1, w))
    m = np.clip(np.minimum.outer(yy, xx) * 3.0, 0, 1)[..., None]  # 1 in the middle, 0 at the edges
    return a * m + sh * (1 - m)


def prepare(src, pid, photo, root, floors, cap=None, thumb=560, quality=88, clean=False, repeat=None):
    """clean: a maker's own picture, already cut and lit; repeat: "mirror" or "blend" for a roll."""
    warnings = []
    im = ImageOps.exif_transpose(Image.open(src)).convert("RGB")
    if clean:
        im = _trim_flat(im)
    W, H = im.size
    k = min(1.0, 1400.0 / max(W, H))
    small = np.asarray(im.resize((max(1, int(W * k)), max(1, int(H * k))), Image.BILINEAR), dtype=np.float32)
    box = None if clean else _find_sample(small)
    if box is None or (box[2] - box[0]) * (box[3] - box[1]) > 0.97 * small.shape[0] * small.shape[1]:
        e = 0.01 if clean else 0.02
        x0, y0, x1, y1 = int(W * e), int(H * e), int(W * (1 - e)), int(H * (1 - e))  # the sample fills the frame
    else:
        x0, y0, x1, y1 = [int(v / k) for v in box]
    im = im.crop((x0, y0, x1, y1))
    layout = photo.get("layout", "roll")
    if layout in ("plank", "herringbone") and im.height > im.width:
        im = im.rotate(90, expand=True)
    real = photo.get("widthIn") if layout == "roll" else (photo.get("plankIn") or [7, 48])[1] if layout in ("plank", "herringbone") else (photo.get("tileIn") or [12])[0]
    if real and not clean and im.width / float(real) < 25:
        warnings.append("only %d pixels per inch of sample; get closer or use the full camera resolution" % (im.width / float(real)))

    cap = cap or (1024 if layout == "tile" else MAX)
    s = min(1.0, cap / max(im.size))
    if s < 1:
        im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    a = np.asarray(im, dtype=np.float32) if clean else _even_light(np.asarray(im, dtype=np.float32))
    out = {}
    if layout == "roll" and repeat == "tile":
        out["seamless"] = True    # already made to repeat from the photo's own pixels (tools/quilt.py)
        out["pattern"] = True     # lay it as it is
    elif layout == "roll" and repeat == "mirror":
        out["seamless"] = False   # the room mirrors it at the edges instead of blending
    elif layout == "roll":
        a = _seamless(a)
        out["seamless"] = True
    img = Image.fromarray(a.astype(np.uint8))
    out["aspect"] = round(img.width / img.height, 4)

    os.makedirs(os.path.join(root, floors, "thumbs"), exist_ok=True)
    rel = "%s/%s.jpg" % (floors, pid)
    img.save(os.path.join(root, rel), quality=quality, optimize=True, progressive=True)
    side = min(img.size)
    cx, cy = img.width // 2, img.height // 2
    th = img.crop((cx - side // 2, cy - side // 2, cx - side // 2 + side, cy - side // 2 + side)).resize((thumb, thumb), Image.LANCZOS)
    trel = "%s/thumbs/%s.jpg" % (floors, pid)
    th.save(os.path.join(root, trel), quality=min(86, quality), optimize=True, progressive=True)
    out.update({"image": rel, "thumb": trel, "warnings": warnings})
    return out
