# Knockel's Floor Covering — new website (draft)

The new website for Knockel's Floor Covering, served by GitHub Pages from this repository.
Later it can live at knockelsfloorcovering.com.

- `index.html` — the home page. The opening floor lays itself as you scroll (`assets/home.js`).
- `room.html` — "Try a floor in your room": a visitor's photo, four corners, and a sample laid in
  perspective with the room's own light (`assets/room.js`). Everything runs on the visitor's device.
- `catalog.json` — the floors in the room tool and on the home page. Don't edit it by hand: it's
  built from `inventory.csv` (one row per floor: name, brand, type, glue-down or click, in stock,
  price, sale price or percent, sale dates, photo, real sizes) and `sales.csv` (sales across many
  floors) by `python3 tools/inventory.py --photos FOLDER`, which also prepares the sample photos
  (`tools/photo_prep.py`: finds the sample, evens the light, makes carpet repeat without a seam,
  writes `assets/floors/<id>.jpg` and a thumbnail). The columns are listed at the top of the script.
- The room page's side bars (`assets/shelf.js`) build the shelves from the catalog: In stock (by kind,
  vinyl plank by glue-down or click), On sale, then each kind's brands. The sample looks stay until the
  store's own floors replace them (`--drop-looks`).
- Sizes are real: planks from one board's width and length (the photo holds a few boards side by side),
  tiles from one tile, carpet and sheet vinyl from the width of the piece in the photo.

## Still needed from the store
- Store hours (the page says "Call ahead for store hours" until then).
- What "Pick-Up Services" means, in one sentence.
- Real photos: the storefront, the showroom, finished jobs, the people.
- Product photos for the catalog.

## Credits
Floor samples: Poly Haven and ambientCG (CC0). The lavender shag carpet behind the page: "Carpet (original)" by Simon Svensson Thunman, CC0, via Wikimedia Commons, lightened a little and made to repeat without a seam. The back of the carpet roll: cut from Auckland Museum's photo "Carpet (AM 1995.36.1-5)" of a rolled Smith & Caughey runner, CC BY 4.0, with the light evened out. The plywood: Poly Haven (CC0). The marble-look vinyl tiles: ambientCG Marble 019 (CC0). The patterned tile floor behind the room page: cut from "Dresden-Striesen Voglerstraße 10 Entree" by Jörg Blobelt, CC BY-SA 4.0, via Wikimedia Commons. Main Street, Monona, c. 1925: public domain. The Mississippi
at Pikes Peak: Archbob, CC0. Showroom photos and the old sign: the store. Bay-window room: Tomwsulcer, CC0.
Corner room: aismallard, CC BY-SA 3.0. All photos via Wikimedia Commons. Fonts: Zilla Slab and Public Sans
(SIL Open Font License, licences in `assets/fonts/`).
