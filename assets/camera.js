/* Knockel's: the chosen floor through the phone's camera, life-size on the real floor.
   The floor is built from the sample photo at its real size (a 12 by 12 foot piece), handed to
   Google's model-viewer, which opens the camera: Quick Look on iPhone and iPad, WebXR on Android.
   The button only shows on phones that can do it. */
(function () {
  "use strict";
  var MV = "https://cdn.jsdelivr.net/npm/@google/model-viewer@3.5.0/dist/model-viewer.min.js";
  var SIZE_M = 3.6576, PX = 3072;   /* 12 feet square, about 21 pixels to the inch */
  var btn = document.getElementById("camera");
  if (!btn || !window.KnockelsRoom) return;
  var R = window.KnockelsRoom;

  /* ---------- can this phone do it? ---------- */
  function quickLook() {
    var ua = navigator.userAgent, ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (!ios) return false;
    if (/CriOS\/|EdgiOS\/|FxiOS\/|GSA\//.test(ua)) return true;
    var a = document.createElement("a");
    return !!(a.relList && a.relList.supports && a.relList.supports("ar"));
  }
  function webxr() {
    if (!navigator.xr || !navigator.xr.isSessionSupported) return Promise.resolve(false);
    return navigator.xr.isSessionSupported("immersive-ar").catch(function () { return false; });
  }
  Promise.resolve(quickLook() || webxr()).then(function (ok) { if (ok) btn.hidden = false; });

  /* ---------- the floor, drawn flat at its real size ---------- */
  function rand(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function bake(img, f, L, turn) {
    var c = document.createElement("canvas"); c.width = c.height = PX;
    var x = c.getContext("2d"), ppm = PX / SIZE_M, rnd = rand(1789), W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
    x.imageSmoothingQuality = "high";
    x.save();
    if (!!turn !== !!L.across) { x.translate(PX / 2, PX / 2); x.rotate(Math.PI / 2); x.translate(-PX / 2, -PX / 2); }
    if (L.kind === 1) {
      /* planks: rows a board wide, staggered, each board taken from one of the boards in the photo */
      var pl = L.unit[0] * ppm, pw = L.unit[1] * ppm, bh = H / L.n, joint = Math.max(1, L.seam * ppm * 2);
      for (var y = -pw; y < PX + pw; y += pw) {
        for (var px = -rnd() * pl; px < PX; px += pl) {
          var b = Math.floor(rnd() * L.n), flip = rnd() < 0.5;
          x.save(); x.translate(px + pl / 2, y + pw / 2); if (flip) x.scale(-1, -1);
          x.drawImage(img, 0, b * bh, W, bh, -pl / 2, -pw / 2, pl + 0.6, pw + 0.6);
          x.restore();
          var j = (rnd() - 0.5) * 0.12;
          x.fillStyle = j < 0 ? "rgba(0,0,0," + (-j) + ")" : "rgba(255,255,255," + j + ")"; x.fillRect(px, y, pl, pw);
          x.fillStyle = "rgba(20,14,8,.42)"; x.fillRect(px - joint / 2, y, joint, pw);
        }
        x.fillStyle = "rgba(20,14,8,.42)"; x.fillRect(0, y - joint / 2, PX, joint);
      }
    } else if (L.kind === 2) {
      /* tiles with grout between them, turned at random like a real install */
      var tl = L.unit[0] * ppm, tw = L.unit[1] * ppm, g = Math.max(1, L.seam * ppm);
      x.fillStyle = "rgb(" + L.grout.map(function (v) { return Math.round(v * 255); }).join(",") + ")"; x.fillRect(0, 0, PX, PX);
      for (var ty = 0; ty < PX; ty += tw) for (var tx = 0; tx < PX; tx += tl) {
        var q = L.turn === 2 ? Math.floor(rnd() * 4) : L.turn === 1 ? (rnd() < 0.5 ? 0 : 2) : 0;
        x.save(); x.translate(tx + tl / 2, ty + tw / 2); x.rotate(q * Math.PI / 2);
        var sw = q % 2 ? tw : tl, sh = q % 2 ? tl : tw;
        x.drawImage(img, -sw / 2 + g, -sh / 2 + g, sw - 2 * g, sh - 2 * g);
        x.restore();
      }
    } else {
      /* carpet and sheet goods: the sample repeats, mirrored when its edges don't meet */
      var rw = L.unit[0] * ppm, rh = L.unit[1] * ppm, mirror = f.photo && f.photo.seamless === false;
      for (var ry = 0, i = 0; ry < PX; ry += rh, i++) for (var rx = 0, k = 0; rx < PX; rx += rw, k++) {
        x.save(); x.translate(rx + rw / 2, ry + rh / 2);
        if (mirror) x.scale(k % 2 ? -1 : 1, i % 2 ? -1 : 1);
        x.drawImage(img, -rw / 2, -rh / 2, rw + 0.6, rh + 0.6);
        x.restore();
      }
    }
    x.restore();
    return c;
  }

  /* ---------- a flat square of floor as a .glb file ---------- */
  function glb(jpeg, rough) {
    var h = SIZE_M / 2;
    var pos = new Float32Array([-h, 0, -h, h, 0, -h, h, 0, h, -h, 0, h]);
    var nor = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]);
    var uv = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
    var idx = new Uint16Array([0, 3, 2, 0, 2, 1]);
    var parts = [pos, nor, uv, idx, jpeg], views = [], off = 0;
    parts.forEach(function (p) { views.push({ buffer: 0, byteOffset: off, byteLength: p.byteLength }); off += (p.byteLength + 3) & ~3; });
    views[0].target = views[1].target = views[2].target = 34962; views[3].target = 34963;
    var json = {
      asset: { version: "2.0", generator: "Knockel's Floor Covering" },
      scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: "floor" }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 }] }],
      materials: [{ name: "floor", doubleSided: true, pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: rough } }],
      textures: [{ source: 0, sampler: 0 }],
      samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }],
      images: [{ bufferView: 4, mimeType: "image/jpeg" }],
      accessors: [
        { bufferView: 0, componentType: 5126, count: 4, type: "VEC3", min: [-h, 0, -h], max: [h, 0, h] },
        { bufferView: 1, componentType: 5126, count: 4, type: "VEC3" },
        { bufferView: 2, componentType: 5126, count: 4, type: "VEC2" },
        { bufferView: 3, componentType: 5123, count: 6, type: "SCALAR" }
      ],
      bufferViews: views, buffers: [{ byteLength: off }]
    };
    var js = new TextEncoder().encode(JSON.stringify(json)), jl = (js.length + 3) & ~3;
    var total = 12 + 8 + jl + 8 + off, out = new Uint8Array(total), dv = new DataView(out.buffer);
    dv.setUint32(0, 0x46546C67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
    dv.setUint32(12, jl, true); dv.setUint32(16, 0x4E4F534A, true);
    out.set(js, 20); for (var s = 20 + js.length; s < 20 + jl; s++) out[s] = 0x20;
    var b0 = 20 + jl;
    dv.setUint32(b0, off, true); dv.setUint32(b0 + 4, 0x004E4942, true);
    parts.forEach(function (p, i) { out.set(new Uint8Array(p.buffer || p, p.byteOffset || 0, p.byteLength), b0 + 8 + views[i].byteOffset); });
    return new Blob([out], { type: "model/gltf-binary" });
  }
  var ROUGH = { carpet: 0.95, "sheet-vinyl": 0.55, "vinyl-plank": 0.6, laminate: 0.55, hardwood: 0.5, tile: 0.45 };

  /* ---------- the sheet with the camera button ---------- */
  var sheet = null, mv = null, url = null, loading = null;
  function loadViewer() {
    if (window.customElements && customElements.get("model-viewer")) return Promise.resolve();
    if (loading) return loading;
    loading = new Promise(function (ok, no) {
      var s = document.createElement("script"); s.type = "module"; s.src = MV;
      s.onload = function () { customElements.whenDefined("model-viewer").then(ok); };
      s.onerror = function () { loading = null; no(new Error("viewer")); };
      document.head.appendChild(s);
    });
    return loading;
  }
  function build() {
    var st = document.createElement("style");
    st.textContent = [
      ".ar-sheet{position:fixed;inset:0;z-index:60;display:grid;place-items:end center;background:rgba(22,53,54,.55);padding:0 max(10px,env(safe-area-inset-left,0px))}",
      ".ar-card{width:min(34rem,100%);background:var(--paper,#F7F6F2);color:var(--ink,#2A241F);border-radius:14px 14px 0 0;padding:16px 16px calc(14px + env(safe-area-inset-bottom,0px));box-shadow:0 -12px 40px rgba(0,0,0,.25);display:grid;gap:10px}",
      ".ar-head{display:flex;align-items:start;justify-content:space-between;gap:10px}",
      ".ar-card h2{font:600 1.3rem/1.2 var(--slab,serif);margin:0}",
      ".ar-x{border:0;background:none;font-size:1.8rem;line-height:1;color:var(--muted,#675E55);min-width:44px;min-height:44px;cursor:pointer}",
      ".ar-card model-viewer{width:100%;height:min(46vh,22rem);background:var(--lime,#ECEAE4);border-radius:10px;--poster-color:transparent}",
      ".ar-go{width:100%;min-height:52px;border:0;border-radius:10px;background:var(--river,#163536);color:var(--on-river,#E8EEEA);font:600 1.15rem var(--slab,serif);cursor:pointer}",
      ".ar-msg{margin:0;color:var(--muted,#675E55);font-size:.98rem;line-height:1.45}"
    ].join("\n");
    document.head.appendChild(st);
    sheet = document.createElement("div"); sheet.className = "ar-sheet"; sheet.hidden = true;
    sheet.setAttribute("role", "dialog"); sheet.setAttribute("aria-modal", "true"); sheet.setAttribute("aria-labelledby", "ar-h");
    sheet.innerHTML = '<div class="ar-card"><div class="ar-head"><h2 id="ar-h"></h2><button type="button" class="ar-x" aria-label="Close">&times;</button></div>' +
      '<div class="ar-view"></div><button type="button" class="ar-go" hidden>Open the camera</button><p class="ar-msg" id="ar-msg"></p></div>';
    document.body.appendChild(sheet);
    sheet.querySelector(".ar-x").addEventListener("click", close);
    sheet.querySelector(".ar-go").addEventListener("click", function () { if (mv && mv.activateAR) mv.activateAR(); });
    sheet.addEventListener("click", function (e) { if (e.target === sheet) close(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !sheet.hidden) close(); });
  }
  function msg(t) { sheet.querySelector("#ar-msg").textContent = t || ""; }
  function close() { sheet.hidden = true; btn.focus(); }
  function floorImage(f) {
    if (f.img && f.img.complete && f.img.naturalWidth) return Promise.resolve(f.img);
    return new Promise(function (ok, no) { var im = new Image(); im.onload = function () { ok(im); }; im.onerror = no; im.src = f.photo.image; });
  }
  function open() {
    var f = R.state.floor;
    if (!f) return;
    if (!sheet) build();
    sheet.querySelector("#ar-h").textContent = f.name;
    sheet.hidden = false;
    msg("Getting the floor ready…");
    var view = sheet.querySelector(".ar-view"), go = sheet.querySelector(".ar-go"); view.innerHTML = ""; go.hidden = true;
    Promise.all([loadViewer(), floorImage(f)]).then(function (got) {
      var img = got[1], canvas = bake(img, f, R.layoutOf(f), R.state.rot);
      return new Promise(function (ok) { canvas.toBlob(ok, "image/jpeg", 0.86); }).then(function (jb) { return jb.arrayBuffer(); }).then(function (ab) {
        if (url) URL.revokeObjectURL(url);
        url = URL.createObjectURL(glb(new Uint8Array(ab), ROUGH[f.type] || (f.look === "wood" ? 0.55 : 0.9)));
        mv = document.createElement("model-viewer");
        mv.setAttribute("alt", f.name + ", a 12 by 12 foot piece");
        mv.setAttribute("ar", "");
        mv.setAttribute("ar-modes", "webxr quick-look");
        mv.setAttribute("ar-placement", "floor");
        mv.setAttribute("ar-scale", "fixed");
        mv.setAttribute("camera-controls", "");
        mv.setAttribute("camera-orbit", "20deg 58deg 6m");
        mv.setAttribute("interaction-prompt", "none");
        mv.setAttribute("shadow-intensity", "0");
        mv.setAttribute("environment-image", "neutral");
        mv.setAttribute("touch-action", "pan-y");
        var none = document.createElement("span"); none.slot = "ar-button"; none.hidden = true; mv.appendChild(none);   /* our own button below instead */
        mv.addEventListener("load", function () {
          go.hidden = mv.canActivateAR === false;
          msg(mv.canActivateAR === false ? "This phone can’t open the camera view. Use a picture of your room instead." : "Point the phone at the floor and move it slowly until the floor appears. Drag it with a finger to move it.");
        });
        mv.addEventListener("ar-status", function (e) {
          if (e.detail && e.detail.status === "failed") msg("The camera view couldn’t start. Try again, or use a picture of your room.");
        });
        mv.addEventListener("error", function () { msg("The floor couldn’t be shown. Try again."); });
        mv.src = url;
        view.appendChild(mv);
      });
    }).catch(function () { msg("The camera view needs the internet. Check the connection and try again."); });
  }
  btn.addEventListener("click", open);
  window.KnockelsCamera = { bake: bake, glb: glb, open: open, SIZE_M: SIZE_M };
})();
