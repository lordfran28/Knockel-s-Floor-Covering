/* Knockel's: the floors in the two side bars of the room page.
   Reads catalog.json (see tools/inventory.py) and lays it out as shelves:
     In stock -> Carpet, Vinyl plank -> Glue-down / Click, Sheet vinyl, ...
     On sale  -> by kind
     Brands   -> Carpet: Mohawk, Shaw ... / Vinyl: ... -> that brand's floors
     Sample looks (the stand-in floors until the store's own are photographed)
   Every shelf shows all the floors under it; the buttons at the top narrow it down.
   window.KnockelsShelf.start(onPick) loads the catalog and calls onPick(product) when a floor is chosen. */
(function(){
  "use strict";
  var TYPE = {"carpet": "Carpet", "vinyl-plank": "Vinyl plank", "sheet-vinyl": "Sheet vinyl", "laminate": "Laminate", "hardwood": "Hardwood", "tile": "Tile and stone", "look": "Sample looks"};
  var TYPE_ORDER = ["carpet", "vinyl-plank", "sheet-vinyl", "laminate", "hardwood", "tile"];
  var INSTALL = {"glue-down": "Glue-down", "click": "Click"};
  var FAMILY = [["carpet", "Carpet", ["carpet"]], ["vinyl", "Vinyl", ["vinyl-plank", "sheet-vinyl"]], ["laminate", "Laminate", ["laminate"]], ["hardwood", "Hardwood", ["hardwood"]], ["tile", "Tile and stone", ["tile"]]];
  var LOOK = {"wood": "Wood and plank", "tile": "Tile and stone", "carpet": "Carpet"};

  function $(id){ return document.getElementById(id); }
  function esc(s){ return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){ return {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]; }); }
  function today(){ var d = new Date(); return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }
  function money(v){ return "$" + v.toFixed(2); }
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function shortDay(iso){ var m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(iso || ""); return m ? MONTHS[+m[2] - 1] + " " + (+m[3]) : ""; }

  var CAT = {brands: [], sales: [], products: []}, BRAND = {}, NODES = {}, ROOT = null, BYID = {};
  var cur = null, picked = null, onPick = function(){};

  /* ---------- Prices and sales ---------- */
  function live(s, d){ return s && (!s.starts || d >= s.starts) && (!s.ends || d <= s.ends); }
  function fits(s, p){
    return (!s.brand || s.brand === p.brand) && (!s.type || s.type === p.type) && (!s.install || s.install === p.install) &&
      (!s.inStock || p.inStock) && (!s.ids || s.ids.indexOf(p.id) >= 0);
  }
  function priceOf(p){
    if (typeof p.price !== "number") return null;
    var d = today(), best = null;
    function consider(s){
      if (!live(s, d)) return;
      var v = typeof s.price === "number" ? s.price : typeof s.percent === "number" ? p.price*(1 - s.percent/100) : null;
      if (v == null) return;
      v = Math.round(v*100)/100;
      if (v < p.price && (!best || v < best.now)) best = {now: v, ends: s.ends || null};
    }
    consider(p.sale);
    (CAT.sales || []).forEach(function(s){ if (fits(s, p)) consider(s); });
    return {now: best ? best.now : p.price, was: best ? p.price : null, unit: p.unit || "sq ft", ends: best ? best.ends : null};
  }
  function priceHTML(p){
    var pr = priceOf(p); if (!pr) return "";
    return '<span class="price">' + (pr.was ? '<s>' + money(pr.was) + '</s> <b class="now">' + money(pr.now) + "</b>" : "<b>" + money(pr.now) + "</b>") +
      '<small>/' + esc(pr.unit) + "</small>" + (typeof p.priceInstalled === "number" ? '<span class="inst">' + (p.wasInstalled > p.priceInstalled ? "<s>" + money(p.wasInstalled) + "</s> " : "") + money(p.priceInstalled) + " installed</span>" : "") +
      (pr.was && pr.ends ? '<em class="ends">Sale ends ' + shortDay(pr.ends) + "</em>" : "") + "</span>";
  }
  function hasPic(p){ return !!(p && p.photo && p.photo.image); }
  function amount(p){ return (+p.onHand).toLocaleString("en-US") + " " + (p.unit || "sq ft"); }
  /* how much is in the store */
  function stockLine(p){
    if (typeof p.onHand !== "number") return "";
    return p.reorder === false ? "Only " + amount(p) + " left" : amount(p) + " in stock" + (p.reorder ? ", more can be ordered" : "");
  }
  /* everything known about a floor, for the line under the room */
  function details(p){
    var out = [];
    var th = [typeof p.thickness === "number" ? p.thickness + " mm thick" : "", typeof p.wear === "number" ? p.wear + " mil wear layer" : "", p.ac ? p.ac + " rated" : ""].filter(Boolean).join(", ");
    if (th) out.push(th.charAt(0).toUpperCase() + th.slice(1));
    var roll = p.type === "carpet" || p.type === "sheet-vinyl", st = stockLine(p);
    /* carpet and sheet vinyl: the piece in the store, by its size */
    if (p.size && roll){
      var sq = typeof p.onHand === "number" ? " (" + amount(p) + ")" : "";
      st = (p.reorder === false ? "Only a " + p.size + " piece left" + sq : p.size + " in stock" + sq + (p.reorder ? ", more can be ordered" : ""));
    } else if (p.size) out.push("Planks " + p.size);
    if (p.notes) out.push(p.notes);
    if (p.install) out.push(INSTALL[p.install]);
    if (st) out.push(st);
    return out;
  }

  /* ---------- Shelves ---------- */
  function sortItems(a){
    return a.slice().sort(function(x, y){
      var bx = (BRAND[x.brand] || "") + " " + (x.collection || "") + " " + x.name, by = (BRAND[y.brand] || "") + " " + (y.collection || "") + " " + y.name;
      return (y.inStock ? 1 : 0) - (x.inStock ? 1 : 0) || bx.localeCompare(by);
    });
  }
  /* the store's floors in order (in stock first, then by brand and name); the sample looks keep the catalog's order */
  function mk(path, label, items, parent){ var n = {path: path, label: label, items: items.every(function(p){ return p.type === "look"; }) ? items.slice() : sortItems(items), kids: [], parent: parent || null}; NODES[path] = n; return n; }
  function byType(n, always){
    var types = TYPE_ORDER.filter(function(t){ return n.items.some(function(p){ return p.type === t; }); });
    if (types.length < 2 && !always) return byInstall(n);
    types.forEach(function(t){ var k = mk(n.path + "/" + t, TYPE[t], n.items.filter(function(p){ return p.type === t; }), n); n.kids.push(k); byInstall(k); });
  }
  function byInstall(n){
    var ins = Object.keys(INSTALL).filter(function(i){ return n.items.some(function(p){ return p.install === i; }); });
    if (!ins.length) return;
    ins.forEach(function(i){ n.kids.push(mk(n.path + "/" + i, INSTALL[i], n.items.filter(function(p){ return p.install === i; }), n)); });
  }
  function build(){
    NODES = {}; BYID = {}; BRAND = {};
    CAT.brands.forEach(function(b){ BRAND[b.id] = b.name; });
    /* the store's floors show even before they have a picture; the sample looks only with theirs */
    var all = CAT.products.filter(function(p){ return p.type !== "look" || hasPic(p); });
    all.forEach(function(p){ BYID[p.id] = p; });
    var real = all.filter(function(p){ return p.type !== "look"; }), looks = all.filter(function(p){ return p.type === "look"; });
    ROOT = mk("", "Floors", [], null);
    var stock = real.filter(function(p){ return p.inStock; });
    if (stock.length){ var s = mk("stock", "In stock", stock, ROOT); byType(s, true); ROOT.kids.push(s); }
    var sale = real.filter(function(p){ var pr = priceOf(p); return pr && pr.was; });
    if (sale.length){ var o = mk("sale", "On sale", sale, ROOT); byType(o, false); ROOT.kids.push(o); }
    ROOT.families = [];
    FAMILY.forEach(function(f){
      var inF = real.filter(function(p){ return f[2].indexOf(p.type) >= 0 && p.brand; });
      var ids = []; inF.forEach(function(p){ if (ids.indexOf(p.brand) < 0) ids.push(p.brand); });
      if (!ids.length) return;
      ids.sort(function(a, b){ return (BRAND[a] || a).localeCompare(BRAND[b] || b); });
      var fam = {label: f[1], brands: []};
      ids.forEach(function(id){
        var n = mk("brand/" + f[0] + "/" + id, BRAND[id] || id, inF.filter(function(p){ return p.brand === id; }), ROOT);
        n.family = f[1]; byType(n, false); fam.brands.push(n);
      });
      ROOT.families.push(fam);
    });
    var other = real.filter(function(p){ return !p.brand; });
    if (other.length){ var x = mk("other", "More floors", other, ROOT); byType(x, false); ROOT.kids.push(x); }
    if (looks.length){
      var l = mk("looks", "Sample looks", looks, ROOT);
      Object.keys(LOOK).forEach(function(k){ var it = looks.filter(function(p){ return p.look === k; }); if (it.length) l.kids.push(mk("looks/" + k, LOOK[k], it, l)); });
      ROOT.kids.push(l);
    }
    /* what the front shelf shows before anything is opened */
    ROOT.show = NODES.sale || NODES.stock || NODES.looks || null;
  }

  /* ---------- Drawing the bars ---------- */
  var wide = window.matchMedia ? window.matchMedia("(min-width: 1001px)") : {matches: true};
  function card(p, n){
    var sub = [BRAND[p.brand], p.collection].filter(Boolean).join(" · ");
    var pr = priceOf(p), tags = [];
    if (pr && pr.was) tags.push('<i class="tag sale">Sale</i>');
    if (p.tag) tags.push('<i class="tag sale">' + esc(p.tag) + "</i>");
    if (p.inStock && !/^stock/.test(n.path)) tags.push('<i class="tag stock">In stock</i>');
    return '<li><button type="button" class="sample" data-id="' + esc(p.id) + '" aria-pressed="' + (picked && picked.id === p.id ? "true" : "false") + '">' +
      (hasPic(p) ? '<span class="ph"><img src="' + esc(p.photo.thumb || p.photo.image) + '" alt="" loading="lazy" decoding="async" width="560" height="560">'
                 : '<span class="ph none"><span class="pc">Picture coming</span>') + (tags.length ? '<span class="tags">' + tags.join("") + "</span>" : "") + "</span>" +
      '<span class="nm">' + esc(p.name) + "</span>" + (sub ? '<span class="sub">' + esc(sub) + "</span>" : "") + priceHTML(p) +
      (stockLine(p) ? '<span class="left">' + esc(stockLine(p)) + "</span>" : "") + "</button></li>";
  }
  function count(n){ return n.items.length; }
  function crumbs(n){
    var trail = []; for (var x = n; x; x = x.parent) trail.unshift(x);
    if (trail.length < 2) return "";
    return trail.map(function(x, i){
      var label = x.parent === ROOT && x.family ? x.family + " · " + x.label : x.label;
      return i === trail.length - 1 ? '<span aria-current="page">' + esc(label) + "</span>" : '<a href="#shelf=' + esc(x.path) + '" data-go="' + esc(x.path) + '">' + esc(i ? label : "All floors") + "</a>";
    }).join('<span class="sep" aria-hidden="true">›</span>');
  }
  function menu(n){
    var h = "";
    if (n === ROOT){
      var big = ROOT.kids.filter(function(k){ return k.path === "stock" || k.path === "sale"; });
      if (big.length) h += '<ul class="shelves">' + big.map(function(k){ return '<li><button type="button" class="shelf' + (k.path === "sale" ? " is-sale" : "") + '" data-go="' + k.path + '">' + esc(k.label) + '<span class="n">' + count(k) + "</span></button></li>"; }).join("") + "</ul>";
      if (ROOT.families.length){
        h += '<div class="brands">' + ROOT.families.map(function(f){
          return '<div class="fam"><h3>' + esc(f.label) + ' brands</h3><ul class="chips">' + f.brands.map(function(b){ return '<li><button type="button" class="chip" data-go="' + esc(b.path) + '">' + esc(b.label) + '<span class="n">' + count(b) + "</span></button></li>"; }).join("") + "</ul></div>";
        }).join("") + "</div>";
      }
      var rest = ROOT.kids.filter(function(k){ return k.path !== "stock" && k.path !== "sale"; });
      if (rest.length && (big.length || ROOT.families.length)) h += '<h3 class="morehead">More to try</h3><ul class="chips more">' + rest.map(function(k){ return '<li><button type="button" class="chip" data-go="' + k.path + '">' + esc(k.label) + '<span class="n">' + count(k) + "</span></button></li>"; }).join("") + "</ul>";
      return h;
    }
    if (n.kids.length) h += '<ul class="chips">' + n.kids.map(function(k){ return '<li><button type="button" class="chip" data-go="' + esc(k.path) + '">' + esc(k.label) + '<span class="n">' + count(k) + "</span></button></li>"; }).join("") + "</ul>";
    return h;
  }
  function render(){
    var n = cur || ROOT, list = n === ROOT ? ROOT.show : n;
    $("crumbs").innerHTML = crumbs(n);
    $("crumbs").hidden = n === ROOT;
    $("shelf-h").textContent = n === ROOT ? "Floors" : n.label;
    $("menu").innerHTML = menu(n);
    /* on the front shelf with only the sample looks, open them straight away */
    if (n === ROOT && ROOT.kids.length === 1 && !ROOT.families.length && ROOT.show){ $("menu").innerHTML = menu(ROOT.show); }
    var items = list ? list.items : [];
    $("list-h").textContent = n === ROOT && list && (ROOT.kids.length > 1 || ROOT.families.length) ? list.label : "";
    $("list-h").hidden = !$("list-h").textContent;
    var a = [], b = [];
    if (wide.matches) items.forEach(function(p, i){ (i % 2 ? b : a).push(p); }); else a = items;
    $("s-left").innerHTML = a.map(function(p){ return card(p, list); }).join("");
    $("s-right").innerHTML = b.map(function(p){ return card(p, list); }).join("");
    document.querySelector(".rail.right").classList.toggle("empty", !b.length);
    $("empty-note").hidden = items.length > 0;
  }
  function go(path, keepScroll){
    cur = NODES[path] || ROOT;
    render();
    if (!keepScroll) document.querySelectorAll(".rail").forEach(function(r){ r.scrollTop = 0; });
    hash();
  }
  function hash(){
    var parts = [];
    if (cur && cur !== ROOT) parts.push("shelf=" + cur.path);
    if (picked) parts.push("floor=" + picked.id);
    try { history.replaceState(null, "", parts.length ? "#" + parts.join("&") : location.pathname + location.search); } catch(e){}
  }
  function pick(p){
    picked = p;
    document.querySelectorAll(".sample").forEach(function(b){ b.setAttribute("aria-pressed", b.getAttribute("data-id") === p.id ? "true" : "false"); });
    hash(); onPick(p);
  }
  function click(e){
    var g = e.target.closest("[data-go]");
    if (g){ e.preventDefault(); go(g.getAttribute("data-go")); var h = $("shelf-h"); if (h && !wide.matches) h.scrollIntoView({block: "nearest"}); return; }
    var s = e.target.closest(".sample");
    if (s && BYID[s.getAttribute("data-id")]) pick(BYID[s.getAttribute("data-id")]);
  }

  /* older catalogs listed "floors" with kind wood/tile/carpet */
  function normalize(c){
    if (c && Array.isArray(c.products)) return {brands: c.brands || [], sales: c.sales || [], products: c.products};
    var prods = ((c && c.floors) || []).map(function(f){ return {id: f.id, name: f.name, type: "look", look: f.kind, photo: {image: f.image, thumb: f.thumb, layout: "roll", widthM: f.size, across: !!f.across}}; });
    return {brands: [], sales: [], products: prods};
  }

  function start(cb){
    onPick = cb || onPick;
    document.querySelectorAll(".rail").forEach(function(r){ r.addEventListener("click", click); });
    if (wide.addEventListener) wide.addEventListener("change", render); else if (wide.addListener) wide.addListener(render);
    return fetch("catalog.json", {cache: "no-cache"}).then(function(r){ if (!r.ok) throw new Error(r.status); return r.json(); }).then(function(c){
      CAT = normalize(c); build();
      var q = {}; location.hash.replace(/^#/, "").split("&").forEach(function(kv){ var i = kv.indexOf("="); if (i > 0) q[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1)); });
      var want = BYID[q.floor];
      cur = NODES[q.shelf] || ROOT;
      if (want && cur === ROOT && want.type === "look") cur = ROOT;
      render();
      /* open on a floor the room can show */
      function firstPic(list){ return (list || []).filter(hasPic)[0] || null; }
      var first = want || (cur !== ROOT && firstPic(cur.items)) || (ROOT.show && firstPic(ROOT.show.items)) || firstPic(CAT.products) || null;
      if (first) pick(first);
      return CAT;
    });
  }
  window.KnockelsShelf = {start: start, go: go, priceOf: priceOf, details: details, hasPic: hasPic, brandName: function(id){ return BRAND[id] || ""; }, typeName: function(t){ return TYPE[t] || ""; }, nodes: function(){ return NODES; }};
})();
