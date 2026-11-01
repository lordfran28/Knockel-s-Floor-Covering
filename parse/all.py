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

import hashlib
for i in items:
    i["file"] = "o/" + hashlib.sha1(i["img"].encode()).hexdigest()[:14]
json.dump(items, open("parse/orders.json", "w"), indent=0, ensure_ascii=False)
have = set(l.split()[0] for l in open("images.txt") if l.strip() and not l.startswith("#"))
new = {}
for i in items:
    if i["file"] not in have:
        new[i["file"]] = i["img"]
with open("images.txt", "a") as f:
    for k, u in new.items():
        f.write("%s %s\n" % (k, u))
print(len(new), "new pictures queued")
import collections
for k, v in sorted(collections.Counter((i["brand"], i["collection"]) for i in items).items()):
    print(v, k)
print(len(items), "floors,", len(set(i["img"] for i in items)), "pictures")
