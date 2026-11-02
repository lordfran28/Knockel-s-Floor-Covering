#!/usr/bin/env python3
"""Knockel's inventory -> catalog.json, the list of floors the room tool shows.

    python3 tools/inventory.py                      # inventory.csv (+ sales.csv) -> catalog.json
    python3 tools/inventory.py --photos PHOTO_DIR   # also prepare the sample photos found in PHOTO_DIR

inventory.csv has one row per floor. Only "name" and "type" are required; leave the rest blank when
you don't know them. Columns (any order, any capitalisation):

    name             Iced Mocha
    collection       Soft Dimensions
    brand            Mohawk
    type             carpet | vinyl plank | sheet vinyl | laminate | hardwood | tile
    install          glue-down | click            (vinyl plank and laminate)
    in_stock         yes / no
    price            2.99                         (a number, no $; the cash and carry price)
    installed_price  5.99                         (the price installed, when there is one)
    regular_installed_price  3.67                 (on sale: the installed price before the sale)
    unit             sq ft | sq yd | each | box   (default sq ft)
    on_hand          1100                         (how much is in the store, in the unit above)
    can_get_more     yes / no                     (no: when it's gone it's gone)
    thickness_mm     5
    wear_mil         20                           (wear layer)
    ac_rating        AC4                          (laminate)
    size             9" x 60"                     (as it should read on the site)
    tag              Closeout                     (a word on the picture: Sale price, Closeout ...)
    sale_price       2.49                         (or sale_percent 15)
    sale_percent     15
    sale_starts      2026-11-01                   (optional; the sale shows from this day)
    sale_ends        2026-11-30                   (the sale stops showing after this day)
    photo            IMG_1234.jpg                 (the sample's photo, in PHOTO_DIR)
    sample_width_in  18                           (carpet and sheet vinyl: how wide the piece in the photo is)
    plank_width_in   7.25                         (planks: one board's width and length)
    plank_length_in  48
    planks_in_photo  3                            (boards side by side in the photo)
    tile_width_in    12
    tile_length_in   24
    grout_in         0.125
    grout_color      #BDB6AA
    id               (made from brand, collection and name when blank)
    code             MPB821                       (the maker's item number)
    layout           roll | plank | tile | herringbone  (how the photo is laid; blank: by the type of floor)
    photo_from       maker                        (the maker's own picture: no cutting out or evening the light)
    repeat           mirror | blend | tile        (how a repeating picture meets itself; tile: made by tools/quilt.py)

special-order.csv (optional) has the same columns for floors that are ordered, not kept in the store
(the makers' current colors of the lines on display). They show as "Special order", by brand and collection.

sales.csv (optional) holds sales for many floors at once: name, brand, type, install, in_stock_only,
percent, starts, ends. Blank columns match everything, so "Mohawk, carpet, 15" is 15% off every
Mohawk carpet.

The sample looks already in catalog.json (type "look") stay until --drop-looks is given.
"""
import argparse, csv, datetime, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, ".."))
CATALOG = os.path.join(ROOT, "catalog.json")
FLOORS = "assets/floors"
ORDER_FLOORS = "assets/floors/order"   # pictures of the floors to order; ones no longer listed are deleted

TYPES = {
    "carpet": "carpet", "carpets": "carpet", "rug": "carpet",
    "vinyl plank": "vinyl-plank", "vinyl-plank": "vinyl-plank", "vinyl": "vinyl-plank", "lvp": "vinyl-plank",
    "lvt": "vinyl-plank", "luxury vinyl": "vinyl-plank", "luxury vinyl plank": "vinyl-plank", "vinyl tile": "vinyl-plank",
    "sheet vinyl": "sheet-vinyl", "sheet-vinyl": "sheet-vinyl", "sheet": "sheet-vinyl", "linoleum": "sheet-vinyl",
    "laminate": "laminate",
    "hardwood": "hardwood", "wood": "hardwood", "engineered": "hardwood", "engineered hardwood": "hardwood",
    "tile": "tile", "porcelain": "tile", "ceramic": "tile", "stone": "tile",
}
INSTALL = {"glue": "glue-down", "glue-down": "glue-down", "glue down": "glue-down", "glue on": "glue-down", "glued": "glue-down",
           "dry back": "glue-down", "dryback": "glue-down",
           "click": "click", "click-lock": "click", "click lock": "click", "click on": "click", "floating": "click", "locking": "click"}
LAYOUT = {"carpet": "roll", "sheet-vinyl": "roll", "vinyl-plank": "plank", "laminate": "plank", "hardwood": "plank", "tile": "tile"}
UNITS = {"sq ft": "sq ft", "sqft": "sq ft", "sf": "sq ft", "ft2": "sq ft", "sq yd": "sq yd", "sqyd": "sq yd", "sy": "sq yd",
         "yd2": "sq yd", "each": "each", "ea": "each", "box": "box", "carton": "box", "roll": "roll", "lin ft": "lin ft"}


def slug(t):
    t = re.sub(r"[^a-z0-9]+", "-", str(t).lower().replace("&", " and ")).strip("-")
    return t[:80] or "floor"


def num(v):
    v = str(v or "").strip().replace("$", "").replace(",", "").replace("%", "")
    if not v:
        return None
    try:
        return float(v)
    except ValueError:
        raise ValueError("%r is not a number" % v)


def yes(v):
    return str(v or "").strip().lower() in ("y", "yes", "true", "1", "x", "in stock", "stock")


def day(v):
    v = str(v or "").strip()
    if not v:
        return None
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%Y/%m/%d"):
        try:
            return datetime.datetime.strptime(v, fmt).strftime("%Y-%m-%d")
        except ValueError:
            pass
    raise ValueError("%r is not a date (use 2026-11-30 or 11/30/2026)" % v)


def rows(path):
    with open(path, encoding="utf-8-sig", newline="") as f:
        for i, r in enumerate(csv.DictReader(f), start=2):
            r = {re.sub(r"[^a-z0-9]+", "_", (k or "").strip().lower()).strip("_"): (v or "").strip() for k, v in r.items()}
            if any(r.values()):
                yield i, r


def product(r, brands):
    name = r.get("name")
    if not name:
        raise ValueError("no name")
    t = TYPES.get(r.get("type", "").lower())
    if not t:
        raise ValueError("type %r isn't one of carpet, vinyl plank, sheet vinyl, laminate, hardwood, tile" % r.get("type"))
    p = {"id": r.get("id") or slug(" ".join(x for x in (r.get("brand"), r.get("collection"), name) if x)), "name": name, "type": t}
    if r.get("collection"):
        p["collection"] = r["collection"]
    if r.get("brand"):
        b = slug(r["brand"])
        brands.setdefault(b, r["brand"])
        p["brand"] = b
    if r.get("install"):
        ins = INSTALL.get(r["install"].lower())
        if not ins:
            raise ValueError("install %r isn't glue-down or click" % r["install"])
        p["install"] = ins
    if yes(r.get("in_stock")):
        p["inStock"] = True
    price = num(r.get("price"))
    if price is not None:
        p["price"] = round(price, 2)
        p["unit"] = UNITS.get(r.get("unit", "").lower(), "sq ft")
    inst = num(r.get("installed_price"))
    if inst is not None:
        p["priceInstalled"] = round(inst, 2)
        p.setdefault("unit", UNITS.get(r.get("unit", "").lower(), "sq ft"))
        was = num(r.get("regular_installed_price"))
        if was is not None and was > inst:
            p["wasInstalled"] = round(was, 2)
    on = num(r.get("on_hand"))
    if on is not None:
        p["onHand"] = int(on) if on == int(on) else on
    more = str(r.get("can_get_more") or "").strip().lower()
    if more:
        p["reorder"] = yes(more)
    for col, key in (("thickness_mm", "thickness"), ("wear_mil", "wear")):
        v = num(r.get(col))
        if v is not None:
            p[key] = int(v) if v == int(v) else v
    for col, key in (("ac_rating", "ac"), ("size", "size"), ("tag", "tag")):
        if r.get(col):
            p[key] = r[col]
    sp, pc = num(r.get("sale_price")), num(r.get("sale_percent"))
    if sp is not None or pc is not None:
        s = {}
        if sp is not None:
            s["price"] = round(sp, 2)
        else:
            s["percent"] = pc
        if r.get("sale_starts"):
            s["starts"] = day(r["sale_starts"])
        if r.get("sale_ends"):
            s["ends"] = day(r["sale_ends"])
        p["sale"] = s
    layout = r.get("layout", "").lower() if r.get("layout", "").lower() in ("roll", "plank", "tile", "herringbone") else LAYOUT[t]
    ph = {"layout": layout}
    if layout == "roll":
        ph["widthIn"] = num(r.get("sample_width_in")) or 18
    elif layout in ("plank", "herringbone"):
        ph["plankIn"] = [num(r.get("plank_width_in")) or 7, num(r.get("plank_length_in")) or 48]
        ph["planks"] = int(num(r.get("planks_in_photo")) or 1)
    else:
        ph["tileIn"] = [num(r.get("tile_width_in")) or 12, num(r.get("tile_length_in")) or num(r.get("tile_width_in")) or 24]
        ph["groutIn"] = num(r.get("grout_in")) if r.get("grout_in") else 0.125
        if r.get("grout_color"):
            ph["grout"] = r["grout_color"]
    if r.get("photo"):
        ph["source"] = r["photo"]
    p["photo"] = ph
    if r.get("notes"):
        p["notes"] = r["notes"]
    if r.get("code"):
        p["code"] = r["code"]
    return p


def sale_rule(r):
    s = {}
    for k in ("name", "brand", "type", "install"):
        if r.get(k):
            s[k] = slug(r[k]) if k == "brand" else TYPES.get(r[k].lower(), r[k]) if k == "type" else INSTALL.get(r[k].lower(), r[k]) if k == "install" else r[k]
    if yes(r.get("in_stock_only")):
        s["inStock"] = True
    pc = num(r.get("percent"))
    if pc is None:
        raise ValueError("a sale needs a percent")
    s["percent"] = pc
    if r.get("starts"):
        s["starts"] = day(r["starts"])
    if r.get("ends"):
        s["ends"] = day(r["ends"])
    return s


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--inventory", default=os.path.join(ROOT, "inventory.csv"))
    ap.add_argument("--sales", default=os.path.join(ROOT, "sales.csv"))
    ap.add_argument("--orders", default=os.path.join(ROOT, "special-order.csv"))
    ap.add_argument("--photos", help="folder holding the photos named in the photo column")
    ap.add_argument("--drop-looks", action="store_true", help="take the sample looks out of the room tool")
    a = ap.parse_args()

    old = json.load(open(CATALOG, encoding="utf-8")) if os.path.exists(CATALOG) else {}
    known = {b["id"]: b for b in old.get("brands", [])}
    brands = {k: v["name"] for k, v in known.items()}
    before = {p["id"]: p for p in old.get("products", [])}
    looks = [] if a.drop_looks else [p for p in old.get("products", []) if p.get("type") == "look"]

    products, problems, seen = [], [], set()
    sources = [(a.inventory, False), (a.orders, True)]
    for path, order in sources:
        if not os.path.exists(path):
            continue
        for line, r in rows(path):
            try:
                p = product(r, brands)
            except ValueError as e:
                problems.append("%s line %d: %s" % (os.path.basename(path), line, e))
                continue
            if order:
                p.pop("inStock", None)
                p["order"] = True
            base, n = p["id"], 2
            while p["id"] in seen:
                p["id"], n = "%s-%d" % (base, n), n + 1
            seen.add(p["id"])
            src = p["photo"].pop("source", None)
            prev = before.get(p["id"], {}).get("photo", {})
            if src and a.photos and os.path.exists(os.path.join(a.photos, src)):
                from photo_prep import prepare
                small = {"cap": 800, "thumb": 300, "quality": 74} if order else {}
                if r.get("photo_from", "").lower() == "maker":
                    small.update(clean=True, repeat=(r.get("repeat") or "mirror").lower())
                info = prepare(os.path.join(a.photos, src), p["id"], p["photo"], ROOT, ORDER_FLOORS if order else FLOORS, **small)
                warnings = info.pop("warnings", [])
                p["photo"].update(info)
                for w in warnings:
                    problems.append("%s (%s): %s" % (p["name"], src, w))
            elif prev.get("image") and os.path.exists(os.path.join(ROOT, prev["image"])):
                for k in ("image", "thumb", "aspect", "seamless", "pattern"):
                    if k in prev:
                        p["photo"][k] = prev[k]
            elif src:
                problems.append("%s: photo %s not found%s" % (p["name"], src, "" if a.photos else " (run with --photos FOLDER)"))
            products.append(p)

    # a floor taken off special-order.csv takes its pictures with it
    used = set()
    for p in products:
        for k in ("image", "thumb"):
            if p["photo"].get(k):
                used.add(os.path.normpath(p["photo"][k]))
    gone = 0
    for sub in ("", "thumbs"):
        d = os.path.join(ROOT, ORDER_FLOORS, sub)
        if os.path.isdir(d):
            for f in os.listdir(d):
                rel = os.path.normpath(os.path.join(ORDER_FLOORS, sub, f))
                if f.endswith(".jpg") and rel not in used:
                    os.remove(os.path.join(ROOT, rel))
                    gone += 1
    if gone:
        print("removed %d pictures of floors no longer listed" % gone)

    sales = []
    if os.path.exists(a.sales):
        for line, r in rows(a.sales):
            try:
                sales.append(sale_rule(r))
            except ValueError as e:
                problems.append("sales.csv line %d: %s" % (line, e))

    cat = {
        "version": 2,
        "brands": [{"id": k, "name": v} for k, v in sorted(brands.items(), key=lambda kv: kv[1].lower())],
        "sales": sales,
        "products": products + looks,
    }
    with open(CATALOG, "w", encoding="utf-8") as f:
        # one floor per line keeps the file small and its changes readable
        f.write('{\n "version": 2,\n "brands": %s,\n "sales": %s,\n "products": [\n' % (
            json.dumps(cat["brands"], ensure_ascii=False), json.dumps(cat["sales"], ensure_ascii=False)))
        f.write(",\n".join("  " + json.dumps(p, ensure_ascii=False) for p in cat["products"]))
        f.write("\n ]\n}\n")
    shown = sum(1 for p in products if p["photo"].get("image"))
    orders = sum(1 for p in products if p.get("order"))
    print("catalog.json: %d floors in the store and %d to order (%d with photos), %d sample looks, %d sales." % (len(products) - orders, orders, shown, len(looks), len(sales)))
    for p in problems:
        print("  ! " + p)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
