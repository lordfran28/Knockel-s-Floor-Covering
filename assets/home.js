/* Knockel's: the opening floor, the sample wall, the before-and-after picture */
(function(){
  "use strict";
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Header and call bar ---------- */
  var bar = document.getElementById("top-bar"), callbar = document.getElementById("callbar"), hero = document.getElementById("hero");
  function chrome(){
    var past = hero.getBoundingClientRect().bottom < 70;
    bar.classList.toggle("solid", past);
    callbar.classList.toggle("on", past);
  }

  /* ---------- The floor that lays itself ----------
     Real oak, photographed: each plank shows its own stretch of the board photo. As you scroll
     through the opening, the planks float down from the far wall toward you and settle into place. */
  var floor = document.getElementById("floor"), sparks = document.getElementById("sparks"), hint = document.getElementById("hint");
  var TEX = "assets/floors/brown-oak.jpg", TEXPX = 1024, COLPX = 1024/9;   /* the photo holds nine boards across */
  var planks = [], built = false, lastP = -1;
  function rand(a, b){ return a + Math.random()*(b - a); }
  function build(){
    floor.innerHTML = ""; planks = [];
    var vw = window.innerWidth, vh = window.innerHeight, phone = vw < 700;
    var colW = phone ? Math.max(70, vw/4.6) : Math.max(110, vw/9), k = colW/COLPX;   /* screen px per photo px */
    var cols = Math.ceil(2.4*vw/colW), W = cols*colW, L = vh*3.2;
    floor.style.width = W + "px"; floor.style.height = L + "px";
    floor.style.marginLeft = (-W/2) + "px"; floor.style.bottom = (-0.04*vh) + "px";
    floor.style.transform = "rotateX(" + (phone ? 73 : 75) + "deg)";
    var bgSize = (TEXPX*k) + "px " + (TEXPX*k) + "px";
    for (var c = 0; c < cols; c++){
      var y = -rand(0, 520)*k;
      while (y < L){
        var len = rand(380, 780)*k;
        if (L - (y + len) < 240*k) len = L - y;               /* no slivers at the near edge */
        var top = Math.max(0, y), h = y + len - top;
        if (h > 20){
          var el = document.createElement("div"); el.className = "plank";
          var shade = rand(-0.08, 0.07), tint = shade < 0 ? "0,0,0," + (-shade).toFixed(3) : "255,240,215," + shade.toFixed(3);
          el.style.cssText = "left:" + (c*colW).toFixed(1) + "px;top:" + top.toFixed(1) + "px;width:" + colW.toFixed(1) + "px;height:" + h.toFixed(1) + "px;" +
            "background-image:linear-gradient(rgba(" + tint + "),rgba(" + tint + ")),url(" + TEX + ");" +
            "background-size:auto," + bgSize + ";background-position:0 0," + (-(c % 9)*colW).toFixed(1) + "px " + (-rand(0, TEXPX)*k).toFixed(1) + "px;opacity:1";
          floor.appendChild(el);
          planks.push({el: el, dx: rand(-140, 140), dy: rand(-50, 50), rz: rand(-26, 26), rx: rand(-16, 16), z: rand(240, 480), t: -1, start: 0});
        }
        y += len;
      }
    }
    /* Order by where each plank sits on screen once laid: the far ones under the dark wall are
       already down; the rest land from the far end toward you over the first few swipes. */
    var from = vh*0.40;
    planks.forEach(function(q){
      var r = q.el.getBoundingClientRect();
      if (r.bottom < from) { q.start = -1; return; }
      var n = Math.min(1, Math.max(0, (r.top - from)/(vh - from)));
      q.start = 0.01 + n*0.72 + rand(0, 0.07);
    });
    built = true; lastP = -1;
    frame();
  }
  function easeOutBack(t){ var c = 1.5; return 1 + (c + 1)*Math.pow(t - 1, 3) + c*Math.pow(t - 1, 2); }
  function progress(){
    if (reduce) return 1;
    var r = hero.getBoundingClientRect(), span = hero.offsetHeight - window.innerHeight;
    return span > 0 ? Math.min(1, Math.max(0, -r.top/span)) : 1;
  }
  function spark(el){
    var b = el.getBoundingClientRect(); if (b.bottom < 0 || b.top > window.innerHeight) return;
    for (var i = 0; i < 4; i++){
      var s = document.createElement("span"); s.className = "spark";
      s.style.left = (b.left + Math.random()*b.width) + "px"; s.style.top = (b.top + Math.random()*b.height) + "px";
      s.style.setProperty("--dx", (Math.random()*30 - 15) + "px"); s.style.setProperty("--dy", (-20 - Math.random()*35) + "px");
      sparks.appendChild(s);
      setTimeout(function(n){ return function(){ n.remove(); }; }(s), 950);
    }
  }
  var DUR = 0.16;
  function frame(){
    if (!built) return;
    var p = progress();
    if (Math.abs(p - lastP) < 0.0005) return;
    var goingDown = p > lastP; lastP = p;
    hint.classList.toggle("gone", p > 0.55);
    for (var i = 0; i < planks.length; i++){
      var q = planks[i], t = Math.min(1, Math.max(0, (p - q.start)/DUR));
      if (t === q.t) continue;
      var was = q.t; q.t = t;
      if (t <= 0){ q.el.style.opacity = "0"; q.el.style.transform = ""; q.el.classList.remove("set"); continue; }
      if (t >= 1){
        q.el.style.opacity = "1"; q.el.style.transform = "none";
        if (was < 1 && goingDown && !reduce){ q.el.classList.remove("set"); void q.el.offsetWidth; q.el.classList.add("set"); spark(q.el); }
        continue;
      }
      q.el.classList.remove("set");
      var e = 1 - easeOutBack(t), lift = Math.pow(1 - t, 2);
      q.el.style.opacity = String(Math.min(1, t*2.4));
      q.el.style.transform = "translate3d(" + (q.dx*e) + "px," + (q.dy*e) + "px," + (q.z*lift) + "px) rotateZ(" + (q.rz*e) + "deg) rotateX(" + (q.rx*e) + "deg)";
    }
  }
  var ticking = false;
  function onScroll(){ if (ticking) return; ticking = true; requestAnimationFrame(function(){ ticking = false; frame(); chrome(); }); }
  window.addEventListener("scroll", onScroll, {passive: true});
  var rw = window.innerWidth;
  window.addEventListener("resize", function(){ if (Math.abs(window.innerWidth - rw) > 40){ rw = window.innerWidth; build(); } chrome(); });
  var tex = new Image(); tex.onload = tex.onerror = build; tex.src = TEX;
  chrome();

  /* ---------- Sample wall ---------- */
  var wall = document.getElementById("wall");
  fetch("catalog.json").then(function(r){ return r.json(); }).then(function(cat){
    var pick = ["washed-oak","brown-oak","honey-oak","oak-herringbone","white-pine","walnut-basketweave","limestone","marble-checkerboard","white-porcelain","slate-flagstone","terracotta","wheat","cream-berber","pewter"];
    var byId = {}; cat.floors.forEach(function(f){ byId[f.id] = f; });
    wall.innerHTML = pick.filter(function(id){ return byId[id]; }).map(function(id){
      var f = byId[id];
      return '<li><a class="chip" href="room.html#floor=' + f.id + '"><img src="' + f.thumb + '" alt="" loading="lazy" width="560" height="560"><span>' + f.name + "</span></a></li>";
    }).join("");
  }).catch(function(){ wall.hidden = true; });

  /* ---------- Before and after ---------- */
  var cmp = document.getElementById("compare");
  function setCut(pc){ pc = Math.max(0, Math.min(100, pc)); cmp.style.setProperty("--cut", pc + "%"); cmp.setAttribute("aria-valuenow", Math.round(pc)); }
  function fromEvent(e){ var b = cmp.getBoundingClientRect(); setCut((e.clientX - b.left)/b.width*100); }
  var dragging = false;
  cmp.addEventListener("pointerdown", function(e){ dragging = true; cmp.setPointerCapture(e.pointerId); fromEvent(e); });
  cmp.addEventListener("pointermove", function(e){ if (dragging) fromEvent(e); });
  cmp.addEventListener("pointerup", function(){ dragging = false; });
  cmp.addEventListener("pointercancel", function(){ dragging = false; });
  cmp.addEventListener("keydown", function(e){
    var v = parseFloat(cmp.getAttribute("aria-valuenow"));
    if (e.key === "ArrowLeft"){ setCut(v - 5); e.preventDefault(); } else if (e.key === "ArrowRight"){ setCut(v + 5); e.preventDefault(); }
  });
  setCut(50);
})();
