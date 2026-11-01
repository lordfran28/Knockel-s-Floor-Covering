"""parse/orders.json -> the site's special-order.csv (only floors whose picture has come down)."""
import csv, json, os, sys
SITE = sys.argv[1] if len(sys.argv) > 1 else "/home/claude/knockel-s-floor-covering"
# how many inches of floor each kind of maker picture shows, left to right
WIDTH = {"full": 96, "swatch": 18, "overhead": 46, "plank": 34, "thumb": 34, "roll": 40, "chip": 36, "carpet": 18, "msi": 48, "mercier": 18}
WIDE = {("Mannington", "swatch", "sheet vinyl"): 30}
cols = ["name", "collection", "brand", "type", "install", "code", "photo", "sample_width_in", "layout", "photo_from", "repeat", "notes"]
rows, missing = [], 0
for i in json.load(open("parse/orders.json")):
    if not os.path.exists("out/img/%s.jpg" % i["file"]):
        missing += 1
        continue
    w = WIDE.get((i["brand"], i["pic"], i["type"]), WIDTH.get(i["pic"], 36))
    if i["collection"].startswith("Bliss 5.0"):
        w = 24 if "Tile" in i["collection"] else 27
    rows.append({"name": i["name"], "collection": i["collection"], "brand": i["brand"], "type": i["type"], "install": i.get("install", ""),
                 "code": i.get("code", ""), "photo": i["file"] + ".jpg", "sample_width_in": w, "layout": "roll", "photo_from": "maker",
                 "repeat": "blend" if i["type"] == "carpet" else "mirror", "notes": i.get("notes", "")})
rows.sort(key=lambda r: (r["brand"], r["collection"], r["name"]))
with open(os.path.join(SITE, "special-order.csv"), "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=cols, lineterminator="\n")
    w.writeheader()
    w.writerows(rows)
print(len(rows), "floors written,", missing, "still waiting for a picture")
