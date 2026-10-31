/* Knockel's: lays a real floor material under each section and lets one dissolve into the next. */
(function(){
  "use strict";
  var bg = document.getElementById("floorbg"); if (!bg) return;
  var TINT = {light: "236,234,228", dark: "13,28,29"}, ALPHA = {light: 0.66, dark: 0.56};
  var parts = Array.prototype.slice.call(document.querySelectorAll("[data-floor]"));
  var bands = parts.map(function(sec){
    var b = document.createElement("div"); b.className = "band"; bg.appendChild(b);
    return {sec: sec, el: b, img: "assets/floors/" + sec.getAttribute("data-floor") + ".jpg", tone: sec.getAttribute("data-tone") || "light", size: parseFloat(sec.getAttribute("data-size")) || 900};
  });
  function lay(){
    var phone = window.innerWidth < 700, f = phone ? 90 : 150, scale = phone ? 0.62 : 1;
    var docH = document.documentElement.scrollHeight;
    bg.style.height = docH + "px";
    bands.forEach(function(b){
      var r = b.sec.getBoundingClientRect(), top = r.top + window.pageYOffset, h = r.height;
      var t = b.tone, a = ALPHA[t];
      b.el.style.top = (top - f) + "px"; b.el.style.height = (h + 2*f) + "px"; b.el.style.setProperty("--f", 2*f + "px");
      b.el.style.backgroundImage = "linear-gradient(rgba(" + TINT[t] + "," + a + "),rgba(" + TINT[t] + "," + a + ")),url(" + b.img + ")";
      b.el.style.backgroundSize = "auto," + Math.round(b.size*scale) + "px";
      b.el.style.backgroundPosition = "0 0,center " + (-(top % 400)) + "px";
    });
  }
  var queued = false;
  function soon(){ if (queued) return; queued = true; requestAnimationFrame(function(){ queued = false; lay(); }); }
  window.addEventListener("resize", soon);
  window.addEventListener("load", soon);
  if (window.ResizeObserver) new ResizeObserver(soon).observe(document.body);
  lay();
})();
