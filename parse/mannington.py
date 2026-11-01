import json, re, urllib.parse, sys
out = []
for line, slug in [("Adura Max", "mannington-aduramax"), ("Adura Rigid", "mannington-adurarigid"), ("Adura Flex", "mannington-aduraflex")]:
    d = json.load(open("out/pages/%s.json" % slug))
    skus = {}
    for i in d["imgs"]:
        alt = i["alt"]
        m = re.match(r"Luxury Vinyl ADURA®(\w+) (.+) ([A-Z]{2,4}\d{3}[A-Z]?)$", alt.strip())
        if not m:
            continue
        sku = m.group(3)
        rec = skus.setdefault(sku, {"line": line, "label": m.group(2), "sku": sku, "imgs": set(), "href": ""})
        if i["near"]:
            rec["href"] = i["near"]
        src = i["src"]
        q = urllib.parse.urlparse(src).query
        u = urllib.parse.parse_qs(q).get("url", [src])[0]
        rec["imgs"].add(u)
    for sku, r in skus.items():
        if "/" + line.split()[1].lower() not in r["href"].lower() and r["href"]:
            pass
        fmt = re.search(r"/(adura\w+)-(wood-plank|rectangle-tile|tile|plank)[^/]*/([^/]+)/", urllib.parse.unquote(r["href"]))
        style = fmt.group(3) if fmt else ""
        kind = fmt.group(2) if fmt else ""
        color = r["label"][len(style):].strip() if style and r["label"].startswith(style) else r["label"]
        full = [u for u in r["imgs"] if "-full-" in u.lower()]
        sw = [u for u in r["imgs"] if "swatch" in u.lower()]
        out.append({"line": line, "style": style, "color": color, "sku": sku, "kind": kind, "full": full, "swatch": sw, "all": sorted(r["imgs"])})
print(len(out))
import collections
print(collections.Counter((o["line"], bool(o["full"]), bool(o["swatch"])) for o in out))
for o in out[:6]:
    print(o["line"], o["style"], "|", o["color"], o["sku"], o["kind"], o["full"][:1], len(o["all"]))
json.dump(out, open("parse/mannington.json", "w"), indent=0)
