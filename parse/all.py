"""Turn the fetched pages into one list of special-order floors: parse/orders.json and images.txt lines."""
import json, re, html, urllib.parse, os, sys

def page(s):
    return json.load(open("out/pages/%s.json" % s))

def title(slug):
    return " ".join(w.capitalize() if w not in ("and", "of") else w for w in re.split(r"[-_ ]+", slug) if w)

def woo(slug):
    h = open("out/pages/%s.html" % slug).read()
    m = re.search(r'data-product_variations="([^"]+)"', h)
    return json.loads(html.unescape(m.group(1))) if m else []

items = []
def add(**k):
    items.append(k)

# Mannington Adura
for o in json.load(open("parse/mannington.json")):
    img = (o["full"] or o["swatch"] or [None])[0]
    if not img:
        continue
    kind = "full" if o["full"] else "swatch"
    install = "glue-down" if o["line"] == "Adura Flex" else "click"
    add(brand="Mannington", collection=o["line"], name=re.sub(r"\s+", " ", (o["style"] + " " + o["color"]) if o["style"] and not o["color"].startswith(o["style"]) else o["color"]).strip(), code=o["sku"], type="vinyl plank",
        install=install, img=img, pic=kind, look="tile" if "tile" in o["kind"] else "wood")

# Karndean Van Gogh
for slug, coll, install in [("karndean-vg-gluedown", "Van Gogh", "glue-down"), ("karndean-vg-rigid", "Van Gogh Rigid Core", "click")]:
    d = page(slug)
    seen = {}
    for i in d["imgs"]:
        u = urllib.parse.unquote(i["src"])
        near = i["near"]
        m = re.search(r"/floors/products/([a-z0-9-]+)-((?:vgw|scb)\d+t?)$", near)
        if not m or not re.search(r"_oh|overhead", u, re.I):
            continue
        if m.group(2) in seen:
            continue
        seen[m.group(2)] = 1
        add(brand="Karndean", collection=coll, name=title(m.group(1)), code=m.group(2).upper(), type="vinyl plank",
            install=install, img=i["src"].split("?")[0], pic="overhead", look="wood")

# Paramount TimbrCORE
for slug, coll in [("paramount-sequoia", "TimbrCORE Sequoia"), ("paramount-floorganic", "TimbrCORE FloorGANIC"), ("paramount-floorganic-xpt", "TimbrCORE FloorGANIC XPT"), ("paramount-life-protect", "TimbrCORE Life Protect")]:
    if not os.path.exists("out/pages/%s.html" % slug):
        continue
    for v in woo(slug):
        c = v["attributes"].get("attribute_pa_color", "")
        m = re.match(r"(.+)-(tc[a-z0-9]+)$", c)
        name, code = (title(m.group(1)), m.group(2).upper()) if m else (title(c), "")
        img = (v.get("image") or {}).get("full_src")
        if img:
            add(brand="Paramount", collection=coll, name=name, code=code, type="laminate", install="click", img=img, pic="plank", look="wood")

# Southwind XRP (WPC and SPC)
sw = [s[len("out/pages/"):-5] for s in sorted(os.popen("ls out/pages/southwind-*.json").read().split()) if not s.endswith(".api.json")]
for slug in sw:
    if slug in ("southwind-home", "southwindcarpet-home", "southwind-wpc", "southwind-spc"):
        continue
    d = page(slug)
    coll = d.get("title", "").split(" - ")[0].strip()
    for v in woo(slug):
        c = list(v["attributes"].values())[0] if v["attributes"] else ""
        img = (v.get("image") or {}).get("full_src")
        if img:
            add(brand="Southwind", collection="XRP " + coll, name=title(c), code=v.get("sku", ""), type="vinyl plank", install="click",
                img=img, pic="thumb", look="tile" if "tile" in coll.lower() else "wood")

# Mannington luxury vinyl sheet (each design comes in Platinum, Gold and Silver)
d = page("mannington-lvs")
lvs = {}
for i in d["imgs"]:
    m = re.match(r"Luxury Vinyl Sheet (\w+) (.+) (\d{5,6})$", i["alt"].strip())
    if not m:
        continue
    u = urllib.parse.parse_qs(urllib.parse.urlparse(i["src"]).query).get("url", [i["src"]])[0]
    r = lvs.setdefault(m.group(3), {"label": m.group(2), "imgs": set(), "href": ""})
    if "logo" not in u.lower():
        r["imgs"].add(u)
    if i["near"]:
        r["href"] = i["near"]
for code, r in lvs.items():
    full = [u for u in r["imgs"] if "full" in u.lower()]
    sw = [u for u in r["imgs"] if "swatch" in u.lower()]
    other = [u for u in r["imgs"] if not re.search(r"-(rs|angle|prop)-|_rs|RS\.", u, re.I)]
    img = (full or sw or other or [None])[0]
    if img:
        add(brand="Mannington", collection="Luxury Vinyl Sheet", name=r["label"], code=code, type="sheet vinyl", install="",
            img=img, pic="full" if full else "swatch", look="wood" if "/platinum-wood/" in r["href"] else "tile", notes="Comes in Platinum, Gold and Silver")

# Beauflor luxury vinyl rolls
for slug, coll in [("beauflor-list-craftech", "Craftech"), ("beauflor-craftech-2", "Craftech"), ("beauflor-blacktex-1", "Blacktex HD"), ("beauflor-blacktex-2", "Blacktex HD"), ("beauflor-blacktex-3", "Blacktex HD")]:
    if not os.path.exists("out/pages/%s.json" % slug):
        continue
    seen_b = set(i["name"] for i in items if i["brand"] == "Beauflor")
    for i in page(slug)["imgs"]:
        m = re.search(r"/([a-z0-9_-]+?)_(\d{3}[a-z])_cv_beauflor", i["src"], re.I)
        if not m or title(m.group(1)) in seen_b:
            continue
        seen_b.add(title(m.group(1)))
        img = re.sub(r"beaulieu_600_crop,default", "beaulieu_1600,default", i["src"]) if False else i["src"]
        add(brand="Beauflor", collection=coll, name=title(m.group(1)), code=m.group(2).upper(), type="sheet vinyl", install="",
            img=img, pic="roll", look="wood")

# Congoleum AirStep
for slug in ("congoleum-advantage", "congoleum-evolution", "congoleum-plus"):
    h = open("out/pages/%s.html" % slug).read()
    for blk in re.findall(r'<div class="product-imageholder.*?</ul>', h, re.S):
        img = re.search(r'src="([^"]+_CHIP[^"]*)"', blk)
        det = re.search(r'class="details">([^<|]+)\|\s*([^<]+)<', blk)
        nm = re.search(r'class="name"><strong><a[^>]*>([^<]+)<', blk)
        des = re.search(r'data-design="([^"]+)"', blk)
        if not (img and det and nm):
            continue
        add(brand="Congoleum", collection=html.unescape(det.group(1)).strip(), name=html.unescape(nm.group(1)).strip(), code=det.group(2).strip(),
            type="sheet vinyl", install="", img=re.sub(r"-\d+x\d+(\.\w+)$", r"\1", img.group(1)), pic="chip",
            look="wood" if des and "wood" in des.group(1) else "tile")

# Paramount Bliss 5.0
for slug, coll, look in [("paramount-bliss50-plank", "Bliss 5.0 Plank", "wood"), ("paramount-bliss50-tile", "Bliss 5.0 Tile", "tile")]:
    if not os.path.exists("out/pages/%s.html" % slug):
        continue
    for v in woo(slug):
        c = v["attributes"].get("attribute_pa_color", "")
        m = re.match(r"(.+)-(pa5mm\d+|5mm\d+)$", c)
        name, code = (title(m.group(1)), m.group(2).upper().replace("PA", "")) if m else (title(c), "")
        img = (v.get("image") or {}).get("full_src")
        if img:
            add(brand="Paramount", collection=coll, name=name, code=code, type="vinyl plank", install="click", img=img, pic="plank", look=look)

# MSI Everlife luxury vinyl
MSI_BIG = os.path.exists("out/img/test/msi-big.jpg")
MSI_NAMES = {"ashton-2": "Ashton 2.0", "cyrus-2": "Cyrus 2.0", "xl-ashton": "XL Ashton", "xl-cyrus": "XL Cyrus", "xl-prescott": "XL Prescott", "xl-trecento": "XL Trecento"}
for c in ["acclima", "andover", "ashton-2", "ashton", "cyrus-2", "cyrus", "glenridge", "katavia", "prescott", "wilmont", "xl-ashton", "xl-cyrus", "xl-prescott", "trecento", "xl-trecento"]:
    if not os.path.exists("out/pages/msi-%s.json" % c):
        continue
    base = "luxury-vinyl-tile" if "trecento" in c else "luxury-vinyl-planks"
    got = {}
    for i in page("msi-" + c)["imgs"]:
        m = re.search(r"/%s/%s/([a-z0-9-]+)/?$" % (base, c), i["near"])
        if m and i["src"] and not i["src"].endswith(".svg") and m.group(1) not in got:
            u = i["src"]
            u = u.replace("/lvt/thumbnails/", "/lvt/detail/").replace("/colornames/thumbnails/", "/colornames/")
            got[m.group(1)] = u
    coll = "Everlife " + MSI_NAMES.get(c, title(c))
    for color, img in sorted(got.items()):
        add(brand="MSI", collection=coll, name=title(color), code="", type="vinyl plank", install="",
            img=img, pic="msi", look="tile" if "trecento" in c else "wood")

# Mercier PRO hardwood
for sp in ("red-oak", "hard-maple"):
    for c in ("acorn-brown", "brookline", "concrete-grey", "gunstock", "keystone", "linen", "moccasin", "natural"):
        slug = "mercier-%s-%s" % (sp, c)
        if not os.path.exists("out/pages/%s.html" % slug):
            continue
        m = re.search(r'og:image" content="([^"]+)"', open("out/pages/%s.html" % slug).read())
        if m:
            add(brand="Mercier", collection="PRO " + title(sp), name=title(c), code="", type="hardwood", install="", img=m.group(1), pic="mercier", look="wood",
                notes="3¼ or 4¼ inch solid, or 5 inch engineered")

# Mohawk carpet styles on the store's PetPremier and SmartStrand displays
MOHAWK = {"3M40", "3M34", "3M35", "3M41", "3M42", "3N78", "2R31", "2R32", "2R33", "2S68", "2S53", "2M64", "2S73", "2F65", "2N80", "2N81"}
seen = set()
for f in sorted(os.popen("ls out/api/mohawk-*.json").read().split()):
    try:
        j = json.load(open(f))
    except Exception:
        continue
    for d in j["response"]["docs"]:
        for v in d.get("variants", []):
            sn = (v.get("style_number") or [""])[0]
            if sn not in MOHAWK:
                continue
            color, code = (v.get("color_name") or [""])[0], (v.get("color_code") or [""])[0]
            img = ((v.get("swatch_images") or v.get("sku_swatch_images") or [""])[0])
            key = (sn, code)
            if not img or key in seen:
                continue
            seen.add(key)
            line = (v.get("product_line") or [""])[0]
            add(brand="Mohawk", collection="%s %s" % (line, (v.get("style_name") or [""])[0]), name=color, code="%s-%s" % (sn, code),
                type="carpet", install="", img=img + "?wid=1200&hei=1200&fmt=jpg&qlt=90", pic="carpet", look="carpet")

import hashlib
for i in items:
    i["file"] = "o/" + hashlib.sha1(i["img"].encode()).hexdigest()[:14]
json.dump(items, open("parse/orders.json", "w"), indent=0, ensure_ascii=False)
# images.txt is rebuilt each time; the fetcher skips pictures it already has
want = {}
for i in items:
    want[i["file"]] = urllib.parse.quote(i["img"], safe=":/?&=%#,+@;~!$'()*")
keep = [l for l in open("images.txt") if l.startswith("#") or l.startswith("test/msi")]
with open("images.txt", "w") as f:
    f.writelines(keep)
    for k, u in want.items():
        f.write("%s %s\n" % (k, u))
got = sum(1 for k in want if os.path.exists("out/img/%s.jpg" % k))
print(len(want), "pictures,", got, "already fetched")
import collections
for k, v in sorted(collections.Counter((i["brand"], i["collection"]) for i in items).items()):
    print(v, k)
print(len(items), "floors,", len(set(i["img"] for i in items)), "pictures")
