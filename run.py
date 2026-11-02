"""Render pages (pages.txt: SLUG URL [scroll]) and download pictures (images.txt: NAME URL) into out/."""
import json, os, re, sys, time, io, hashlib
from urllib.parse import urljoin

OUT = "out"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"


def lines(path):
    if not os.path.exists(path):
        return []
    out = []
    for ln in open(path, encoding="utf-8"):
        ln = ln.strip()
        if ln and not ln.startswith("#"):
            out.append(ln.split())
    return out


def pages():
    todo = [p for p in lines("pages.txt") if not os.path.exists(os.path.join(OUT, "pages", p[0] + ".html"))]
    if not todo:
        return
    from playwright.sync_api import sync_playwright
    os.makedirs(os.path.join(OUT, "pages"), exist_ok=True)
    with sync_playwright() as pw:
        br = pw.chromium.launch()
        ctx = br.new_context(user_agent=UA, viewport={"width": 1400, "height": 1000})
        for p in todo:
            slug, url = p[0], p[1]
            scroll = int(p[2]) if len(p) > 2 else 12
            pg = ctx.new_page()
            api = []
            def keep(resp):
                try:
                    ct = resp.headers.get("content-type", "")
                    if "json" in ct and resp.request.resource_type in ("xhr", "fetch"):
                        body = resp.text()
                        if len(body) > 400:
                            api.append({"url": resp.url, "body": body[:3_000_000]})
                except Exception:
                    pass
            pg.on("response", keep)
            info = {"url": url}
            try:
                r = pg.goto(url, wait_until="domcontentloaded", timeout=60000)
                info["status"] = r.status if r else None
                try:
                    pg.wait_for_load_state("networkidle", timeout=20000)
                except Exception:
                    pass
                for _ in range(scroll):
                    pg.mouse.wheel(0, 2500)
                    time.sleep(0.6)
                # press "load more" style buttons until they're gone
                more = re.compile(r"^\s*(load|show|view|see)\s+more", re.I)
                for _ in range(60):
                    b = pg.get_by_text(more)
                    vis = [b.nth(i) for i in range(min(b.count(), 6)) if b.nth(i).is_visible()]
                    if not vis:
                        break
                    try:
                        vis[0].scroll_into_view_if_needed(timeout=3000)
                        vis[0].click(timeout=4000)
                        time.sleep(2)
                    except Exception:
                        break
                # keep scrolling while the page grows
                last = 0
                for _ in range(40):
                    h = pg.evaluate("document.body.scrollHeight")
                    if h == last:
                        break
                    last = h
                    pg.mouse.wheel(0, h)
                    time.sleep(0.8)
                time.sleep(1)
                html = pg.content()
                imgs = pg.evaluate("""() => Array.from(document.querySelectorAll('img, source, [data-src], [data-bg], [style*="background"]')).map(e => ({
                    src: e.currentSrc || e.src || e.getAttribute('data-src') || e.getAttribute('data-bg') || '',
                    srcset: e.getAttribute('srcset') || e.getAttribute('data-srcset') || '',
                    alt: e.getAttribute('alt') || e.getAttribute('title') || '',
                    style: (e.getAttribute('style') || '').slice(0, 300),
                    near: (e.closest('a') && e.closest('a').href) || ''
                }))""")
                links = pg.evaluate("() => Array.from(document.querySelectorAll('a[href]')).map(a => [a.href, (a.innerText || a.title || '').trim().slice(0, 120)])")
                info.update({"final": pg.url, "title": pg.title(), "imgs": imgs, "links": links, "api": [a["url"] for a in api]})
                open(os.path.join(OUT, "pages", slug + ".html"), "w", encoding="utf-8").write(html)
                if api:
                    json.dump(api, open(os.path.join(OUT, "pages", slug + ".api.json"), "w"))
                print("page ok", slug, info.get("status"), len(html), len(imgs), "imgs", len(api), "api")
            except Exception as e:
                info["error"] = str(e)[:500]
                print("page FAILED", slug, e)
            json.dump(info, open(os.path.join(OUT, "pages", slug + ".json"), "w"))
            pg.close()
        br.close()


def images():
    todo = lines("images.txt")
    if not todo:
        return
    import requests
    from PIL import Image
    s = requests.Session()
    s.headers["User-Agent"] = UA
    ok = bad = 0
    for p in todo:
        name, url = p[0], p[1]
        dest = os.path.join(OUT, "img", name + ".jpg")
        if os.path.exists(dest):
            continue
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        try:
            for attempt in range(6):
                r = s.get(url, timeout=60)
                if r.status_code != 429:
                    break
                time.sleep(20 * (attempt + 1))   # the site asked us to slow down
            r.raise_for_status()
            if "midwestfloorsource" in url:
                time.sleep(4)
            im = Image.open(io.BytesIO(r.content))
            im = im.convert("RGB")
            m = 1600
            if max(im.size) > m:
                k = m / max(im.size)
                im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
            im.save(dest, quality=90)
            ok += 1
        except Exception as e:
            bad += 1
            print("img FAILED", name, url, str(e)[:200])
    print("images: %d ok, %d failed" % (ok, bad))


def apis():
    """api.txt: SLUG URL. Plain GET, the body saved as out/api/SLUG.json."""
    todo = [p for p in lines("api.txt") if not os.path.exists(os.path.join(OUT, "api", p[0] + ".json"))]
    if not todo:
        return
    import requests
    os.makedirs(os.path.join(OUT, "api"), exist_ok=True)
    for slug, url in [(p[0], p[1]) for p in todo]:
        try:
            r = requests.get(url, headers={"User-Agent": UA, "Accept": "application/json,*/*"}, timeout=60)
            open(os.path.join(OUT, "api", slug + ".json"), "w", encoding="utf-8").write(r.text)
            print("api", r.status_code, slug, len(r.text))
        except Exception as e:
            print("api FAILED", slug, e)


if __name__ == "__main__":
    apis()
    pages()
    images()
