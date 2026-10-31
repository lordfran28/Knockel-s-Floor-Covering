/* The floor under the page.
   First a carpet is laid: as you scroll, the roll moves down the floor ahead of you and unrolls it, and the
   carpet behind it lies in loose waves until it is stretched flat. Further down the carpet ends, adhesive is
   troweled onto the plywood, and marble-look vinyl tiles drop into it one by one.
   Photos: the carpet and the back of a carpet roll (see the credits), plywood from Poly Haven, and tiles
   cut from an ambientCG marble scan. Without WebGL the plain carpet photo in site.css stays in place. */
(function(){
  "use strict";
  var reduce = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  var cv = document.createElement("canvas");
  cv.className = "floor-scene";
  cv.setAttribute("aria-hidden", "true");
  var gl = null;
  try { gl = cv.getContext("webgl", {alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false}); } catch(e){}
  if (!gl) return;
  document.body.insertBefore(cv, document.body.firstChild);

  var K = 0.55, anchorVh = 0;                    /* the flat floor passes at a little over half the scroll speed */
  var vw = 0, vh = 0, dpr = 1, small = false;
  var E = 1e9, G0 = 1e9, heroEnd = 0;            /* world y where the rug ends and the glue begins */
  var PW = 220, GH = 220;                        /* tile size, and the height of one pass of glue (world px) */

  /* ---------- shaders ---------- */
  var HP = "#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n";
  var VS_FULL = "attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }";

  /* the flat floor, seen from above: the end of the rug, plywood, glue */
  var FS_GROUND = HP + [
    "uniform vec2 uRes; uniform float uDpr, uScroll, uK, uEdge, uGlue0, uGlueH, uRidge;",
    "uniform float uFront, uLaid, uRoll, uTurn, uRollA, uStretch;",
    "uniform sampler2D uRug, uPly, uJute; uniform vec2 uRugSize;",
    "vec3 rug(vec2 w){ vec2 t = vec2(clamp(w.x / uRugSize.x, 0.0, 1.0), clamp(fract(w.y / uRugSize.y), 0.0005, 0.9995)); return texture2D(uRug, t).rgb; }",
    "void main(){",
    "  vec2 p = gl_FragCoord.xy / uDpr;",
    "  vec2 s = vec2(p.x, uRes.y - p.y);",
    "  vec2 w = vec2(s.x, s.y + uScroll * uK);",
    /* just behind the roll the carpet lies in loose waves; further back it has been stretched flat */
    "  float back = uFront - uRoll - w.y;",
    "  float loose = smoothstep(0.0, 60.0, back) * (1.0 - smoothstep(uStretch * 0.3, uStretch, back)) * uRollA;",
    "  float wv = w.y * 0.05 + sin(w.x * 0.0042 + 1.3) * 2.6 + sin(w.x * 0.0117 + 0.4) * 0.9 + sin(w.x * 0.0021 - w.y * 0.002) * 1.5;",
    "  float hump = sin(wv) * loose, lean = cos(wv) * loose;",
    "  vec3 carpet = rug(w + vec2(0.0, hump * 7.0));",
    "  float lum = dot(carpet, vec3(0.3, 0.59, 0.11));",
    "  carpet *= 1.0 + 0.2 * lean;",
    "  carpet *= 1.0 - 0.22 * (1.0 - smoothstep(0.0, 14.0, back)) * step(0.0, back) * uRollA;",
    /* its edge: brighter tufts reach a little further */
    "  float tuft = (lum - 0.45) * 26.0 + sin(w.x * 0.09) * 2.5 + sin(w.x * 0.013 + 1.7) * 6.0;",
    "  float onRug = 1.0 - smoothstep(-1.2, 1.2, w.y - min(uEdge + tuft, uLaid));",
    "  carpet *= 1.0 + 0.16 * smoothstep(-10.0, 0.0, w.y - uEdge - tuft);",
    /* plywood, shaded by the rug's thickness just past the edge */
    "  vec3 ply = texture2D(uPly, w / 760.0).rgb;",
    "  ply = mix(ply, vec3(dot(ply, vec3(0.3, 0.59, 0.11))), 0.25) * 1.18 + vec3(0.03, 0.02, 0.0);",
    "  float sh = smoothstep(uEdge + 60.0, uEdge + 2.0, w.y) * 0.55 * step(uEdge, uFront);",
    /* the roll's shadow on the bare floor ahead of it */
    "  sh = max(sh, (1.0 - smoothstep(0.0, uRoll * 0.9 + 12.0, w.y - uFront - uRoll)) * step(uFront + uRoll * 0.2, w.y) * 0.42 * uRollA);",
    "  vec3 floorc = ply * (1.0 - sh);",
    /* adhesive, troweled on in sweeps, one pass after another as you come down */
    "  float gy = w.y - uGlue0;",
    "  if (gy > 0.0){",
    "    float row = floor(gy / uGlueH);",
    "    float sy = uGlue0 + (row + 0.5) * uGlueH - uScroll * uK;",
    "    float pr = clamp((uRes.y * 0.98 - sy) / (uRes.y * 0.4), 0.0, 1.0);",
    "    float local = (gy - row * uGlueH) / uGlueH;",
    "    float xs = mod(row, 2.0) < 1.0 ? w.x : uRes.x - w.x;",
    "    float front = pr * (uRes.x + uGlueH * 1.6) - uGlueH * 0.8 + sin(local * 3.14159) * uGlueH * 0.22;",
    "    float cov = 1.0 - smoothstep(front - 3.0, front + 1.5, xs);",
    /* each sweep of a notched trowel leaves a fan of rounded ridges; neighbouring sweeps overlap */
    "    float sw = uGlueH * 1.15;",
    "    float k = floor(xs / sw);",
    "    float jit = fract(sin(k * 91.7 + row * 13.3) * 4375.85);",
    "    vec2 ctr = vec2((k + 0.5 + (jit - 0.5) * 0.3) * sw, uGlue0 + (row + 1.35 + jit * 0.3) * uGlueH);",
    "    float warp = (texture2D(uPly, vec2(xs / 520.0, w.y / 260.0) + row * 0.21).r - 0.5) * 2.2;",
    "    float rc = length(vec2(xs, w.y) - ctr) / uRidge + warp;",
    "    float ph = rc * 6.2832;",
    "    float n = texture2D(uPly, vec2(xs / 140.0, w.y / 23.0) + row * 0.37).g;",
    "    float amp = smoothstep(0.18, 0.55, n) * 0.8 + 0.2;",
    "    float slope = -sin(ph) * amp;",
    "    float crest = (0.5 + 0.5 * cos(ph)) * amp;",
    "    vec3 glue = vec3(0.88, 0.85, 0.78) * (0.95 + 0.17 * slope - 0.1 * (1.0 - crest)) + pow(max(0.0, slope), 10.0) * 0.07;",
    "    float bead = smoothstep(front - 30.0, front - 4.0, xs) * cov;",
    "    glue = mix(glue, vec3(0.9, 0.87, 0.8) * (0.96 + 0.08 * smoothstep(front - 30.0, front - 12.0, xs)), bead * 0.85);",
    "    float film = mix(0.7, 1.0, smoothstep(0.05, 0.45, crest));",
    "    floorc = mix(floorc, glue, cov * max(film, bead));",
    "    floorc *= 1.0 - (1.0 - smoothstep(0.0, 9.0, xs - front)) * step(front, xs) * 0.25;",
    "  }",
    "  vec3 c = mix(floorc, carpet, onRug);",
    /* the roll itself, seen from above: jute backing outside, lit from the top of the screen, turning as it goes */
    "  float d = w.y - uFront;",
    "  if (abs(d) < uRoll && uRollA > 0.0){",
    "    float th = asin(clamp(d / uRoll, -1.0, 1.0)), nz = cos(th), ny = sin(th);",
    /* the back of a real carpet roll, photographed: jute, with the rows of stitches showing through */
    "    float lit = max(0.0, -0.6 * ny + 0.8 * nz);",
    "    vec3 back = texture2D(uJute, vec2(w.x / 140.0, (th + uTurn) * uRoll / 248.0)).rgb;",
    "    vec3 rc = back * (0.34 + 0.74 * lit);",
    "    rc *= mix(0.5, 1.0, smoothstep(0.0, 0.5, nz));",
    "    c = mix(c, rc, uRollA * smoothstep(uRoll, uRoll - 1.5, abs(d)));",
    "  }",
    "  gl_FragColor = vec4(c, 1.0);",
    "}"].join("\n");

  var VS_RECT = "attribute vec2 a; uniform vec2 uRes; uniform vec4 uRect; uniform float uRot; varying vec2 vUV; varying vec2 vPos;" +
    "void main(){ vUV = a; vec2 c = uRect.xy + uRect.zw * 0.5; vec2 q = (a - 0.5) * uRect.zw; float cs = cos(uRot), sn = sin(uRot);" +
    " vPos = c + vec2(q.x * cs - q.y * sn, q.x * sn + q.y * cs); gl_Position = vec4(vPos.x / uRes.x * 2.0 - 1.0, 1.0 - vPos.y / uRes.y * 2.0, 0.0, 1.0); }";
  var FS_TILE = HP + [
    "uniform sampler2D uAtlas; uniform vec4 uSub; uniform float uTurn, uAlpha, uLight; uniform vec2 uSize; varying vec2 vUV;",
    "void main(){",
    "  vec2 q = vUV;",
    "  if (uTurn > 0.5) q = vec2(q.y, 1.0 - q.x);",
    "  if (uTurn > 1.5) q = vec2(q.y, 1.0 - q.x);",
    "  if (uTurn > 2.5) q = vec2(q.y, 1.0 - q.x);",
    "  vec3 c = texture2D(uAtlas, uSub.xy + q * uSub.zw).rgb;",
    /* a small eased edge, the way vinyl tiles meet */
    "  vec2 px = vUV * uSize;",
    "  float e = min(min(px.x, uSize.x - px.x), min(px.y, uSize.y - px.y));",
    "  c *= mix(0.8, 1.0, smoothstep(0.0, 1.8, e));",
    "  c *= 1.0 + 0.03 * (1.0 - smoothstep(0.0, 3.0, px.y)) - 0.04 * (1.0 - smoothstep(0.0, 3.0, uSize.y - px.y));",
    "  gl_FragColor = vec4(c * uLight, uAlpha);",
    "}"].join("\n");
  var FS_SHADOW = HP + [
    "uniform vec4 uBox; uniform float uBlur, uAlpha; varying vec2 vPos;",
    "float box(vec2 p, vec2 b){ vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }",
    "void main(){ float d = box(vPos - uBox.xy, uBox.zw); gl_FragColor = vec4(0.16, 0.1, 0.05, uAlpha * (1.0 - smoothstep(-uBlur, uBlur, d))); }"].join("\n");

  function compile(type, src){ var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
  function program(vs, fs, attrs){
    var p = gl.createProgram(); gl.attachShader(p, compile(gl.VERTEX_SHADER, vs)); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    (attrs || ["a"]).forEach(function(n, i){ gl.bindAttribLocation(p, i, n); });
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < n; i++){ var info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); u[info.name.replace(/\[0\]$/, "")] = u[info.name]; }
    return {p: p, u: u};
  }
  var ground, tile, shadow;
  try { ground = program(VS_FULL, FS_GROUND); tile = program(VS_RECT, FS_TILE); shadow = program(VS_RECT, FS_SHADOW); }
  catch(e){ cv.remove(); return; }
  var tri = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, tri); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
  var quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,0, 1,0, 0,1, 1,1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);

  /* ---------- textures ---------- */
  function tex(repeat){
    var t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    return t;
  }
  var T = {rug: tex(false), ply: tex(true), atlas: tex(false), jute: tex(true)}, rugSize = [1, 1], loaded = 0;
  function load(t, src, mip, done){
    var img = new Image();
    img.onload = function(){
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
      if (mip){ gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); }
      if (done) done(img);
      if (++loaded === 4){ document.documentElement.classList.add("has-scene"); kick(); }
    };
    img.src = src;
  }
  var base = (document.currentScript && document.currentScript.src) ? document.currentScript.src.replace(/[^\/]*$/, "") : "assets/";
  small = Math.min(innerWidth, innerHeight) < 700;
  load(T.rug, base + "photos/" + (small ? "carpet-1200.jpg" : "carpet-2000.jpg"), false, function(img){
    rugSize = [img.naturalWidth, img.naturalHeight];
  });
  load(T.ply, base + "photos/plywood.jpg", true);
  load(T.jute, base + "photos/carpet-back.jpg", true);
  load(T.atlas, base + "photos/lvt-marble.jpg", true);

  /* ---------- where things are ---------- */
  function docTop(el){ var r = el.getBoundingClientRect(); return r.top + window.pageYOffset; }
  function measure(){
    var sameWidth = window.innerWidth === vw;
    vw = window.innerWidth; vh = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, small ? 1.5 : 1.25);
    cv.width = Math.round(vw*dpr); cv.height = Math.round(vh*dpr);
    PW = small ? 140 : 220; GH = PW;
    var hero = document.getElementById("hero"), floors = document.getElementById("floors");
    heroEnd = hero ? docTop(hero) + hero.offsetHeight : 0;
    var endDoc = floors ? docTop(floors) : document.documentElement.scrollHeight*0.5;
    /* the rug's edge crosses the middle of the screen as the floors section comes up */
    if (!sameWidth || !anchorVh) anchorVh = vh;      /* the address bar doesn't move the floor */
    E = anchorVh*0.62 + K*(endDoc - anchorVh*0.62);
    G0 = E + (small ? 34 : 56);
  }

  /* ---------- the carpet roll ----------
     It stays a little below the middle of the screen, moving down the floor as you scroll, until it reaches
     the end of the carpet. It gets thinner as it goes (what's left on it), and at the end only the cardboard
     core is left, which is taken away. */
  var ROLL_Y = 0.7, R0 = 78, CORE = 14;
  function roll(sc){
    if (reduce) return {front: 1e9, radius: 0, turn: 0, alpha: 0};
    var start = Math.max(0, heroEnd - anchorVh)*K + anchorVh*ROLL_Y, end = E;
    var f = sc*K + anchorVh*ROLL_Y, done = (f - start)/Math.max(1, end - start);
    var front = Math.min(f, end), left = 1 - Math.min(1, Math.max(0, done));
    var r0 = small ? R0*0.7 : R0, core = small ? CORE*0.75 : CORE;
    var radius = Math.sqrt(core*core + (r0*r0 - core*core)*left);
    var gone = Math.min(1, Math.max(0, (f - end)/(anchorVh*0.18)));
    return {front: front, radius: radius*(1 - 0.6*gone), turn: -front/radius, alpha: 1 - gone};
  }

  /* ---------- tiles ---------- */
  var rows = {}, DUR = reduce ? 1 : 620, GAP = reduce ? 0 : 150;
  /* large white marble-look tiles. Each is cut from a different part of the scan and turned a different way,
     the way the prints vary in a real box of vinyl tile */
  function rand(a, b){ var x = Math.sin(a*78.233 + b*37.719 + 1.3)*24634.6345; return x - Math.floor(x); }
  function tileLook(r, c){
    return {sub: [rand(r, c)*0.45, rand(c + 11.1, r - 7.7)*0.45, 0.55, 0.55], turn: Math.floor(rand(r*3.1, c*1.7)*4), light: 0.985 + rand(c, r*2.3)*0.03};
  }
  function rowStart(){ return vw/2 - Math.ceil(vw/2/PW)*PW; }
  function ease(p){ return p*p; }

  /* ---------- drawing ---------- */
  var scroll = window.pageYOffset, raf = 0;
  function frame(now){
    raf = 0;
    scroll = window.pageYOffset;
    if (draw(now)) kick();
  }
  function kick(){ if (!raf) raf = requestAnimationFrame(frame); }
  function draw(now){
    if (loaded < 4) return false;
    if (scroll + vh < heroEnd - 4) return false;          /* the opening covers everything */
    gl.viewport(0, 0, cv.width, cv.height);
    gl.disable(gl.BLEND);
    gl.useProgram(ground.p); var u = ground.u;
    gl.uniform2f(u.uRes, vw, vh); gl.uniform1f(u.uDpr, dpr); gl.uniform1f(u.uScroll, scroll); gl.uniform1f(u.uK, K);
    gl.uniform1f(u.uEdge, E); gl.uniform1f(u.uGlue0, G0); gl.uniform1f(u.uGlueH, GH); gl.uniform1f(u.uRidge, small ? 6.0 : 8.0);
    gl.uniform2f(u.uRugSize, vw, vw*rugSize[1]/rugSize[0]);
    var r = roll(scroll);
    gl.uniform1f(u.uFront, r.front); gl.uniform1f(u.uLaid, r.front < E ? r.front : 1e9); gl.uniform1f(u.uRoll, r.radius); gl.uniform1f(u.uTurn, r.turn); gl.uniform1f(u.uRollA, r.alpha); gl.uniform1f(u.uStretch, vh*0.5);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, T.jute); gl.uniform1i(u.uJute, 2);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, T.rug); gl.uniform1i(u.uRug, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, T.ply); gl.uniform1i(u.uPly, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, tri); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return drawTiles(now);
  }
  function drawTiles(now){
    var top = scroll*K, r0 = Math.max(0, Math.floor((top - G0)/PW) - 1), r1 = Math.floor((top + vh - G0)/PW) + 1;
    if (r1 < 0) return false;
    var busy = false, list = [];
    for (var r = r0; r <= r1; r++){
      var y = G0 + r*PW, sy = y - top;
      if (rows[r] === undefined){
        if (sy < -PW) rows[r] = -1e9;                       /* already passed: lay it without a show */
        else if (sy < vh*0.52) rows[r] = now;
      }
      if (rows[r] === undefined) continue;
      for (var c = 0, x = rowStart(); x < vw; c++, x += PW){
        var p = Math.min(1, Math.max(0, (now - rows[r] - c*GAP)/DUR));
        if (p <= 0){ busy = true; continue; }
        if (p < 1) busy = true;
        list.push({x: x, y: sy, p: p, look: tileLook(r, c)});
      }
    }
    if (!list.length) return busy;
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    /* shadows first, so a falling tile's shadow lies on the floor and not on its neighbours */
    gl.useProgram(shadow.p);
    gl.uniform2f(shadow.u.uRes, vw, vh);
    gl.uniform1f(shadow.u.uRot, 0);
    list.forEach(function(pk){
      var h = 1 - Math.min(1, ease(Math.min(1, pk.p/0.72)));
      var blur = 2 + 30*h, off = 2 + 34*h, a = pk.p < 1 ? (0.16 + 0.24*(1 - h))*Math.min(1, pk.p*6) : 0.3;
      gl.uniform4f(shadow.u.uBox, pk.x + PW/2 + off*0.3, pk.y + PW/2 + off, PW/2, PW/2);
      gl.uniform1f(shadow.u.uBlur, blur); gl.uniform1f(shadow.u.uAlpha, a);
      gl.uniform4f(shadow.u.uRect, pk.x - blur - 4, pk.y - blur - 4, PW + 2*blur + off + 8, PW + 2*blur + off + 8);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    });
    gl.useProgram(tile.p);
    gl.uniform2f(tile.u.uRes, vw, vh);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, T.atlas); gl.uniform1i(tile.u.uAtlas, 0);
    list.forEach(function(pk){
      var f = Math.min(1, pk.p/0.72), h = 1 - ease(f);
      /* a small bounce as it lands */
      if (pk.p > 0.72){ var b = (pk.p - 0.72)/0.28; h = -0.035*Math.sin(b*Math.PI)*(1 - b); }
      /* nearer the eye while it falls: bigger, a touch brighter, turned a little; it straightens as it lands */
      var s = 1 + 0.2*h, w = PW*s;
      gl.uniform4f(tile.u.uRect, pk.x + PW/2 - w/2 - 10*h, pk.y + PW/2 - w/2 - 22*h, w, w);
      gl.uniform1f(tile.u.uRot, (pk.look.turn % 2 ? 1 : -1)*0.06*Math.max(0, h));
      gl.uniform2f(tile.u.uSize, w, w);
      gl.uniform4f(tile.u.uSub, pk.look.sub[0], pk.look.sub[1], pk.look.sub[2], pk.look.sub[3]); gl.uniform1f(tile.u.uTurn, pk.look.turn);
      gl.uniform1f(tile.u.uAlpha, Math.min(1, pk.p*14)); gl.uniform1f(tile.u.uLight, pk.look.light*(1 + 0.05*Math.max(0, h)));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    });
    gl.disable(gl.BLEND);
    return busy;
  }

  /* ---------- input ---------- */
  window.addEventListener("scroll", kick, {passive: true});
  var rt = 0;
  window.addEventListener("resize", function(){ clearTimeout(rt); rt = setTimeout(function(){ measure(); kick(); }, 120); });
  if (window.ResizeObserver) new ResizeObserver(function(){ clearTimeout(rt); rt = setTimeout(function(){ var e0 = E; measure(); if (Math.abs(E - e0) > 40) rows = {}; kick(); }, 200); }).observe(document.body);
  cv.addEventListener("webglcontextlost", function(e){ e.preventDefault(); document.documentElement.classList.remove("has-scene"); });
  measure();
  window.KnockelsFloor = {anchors: function(){ return {E: E, G0: G0, K: K, PW: PW, heroEnd: heroEnd}; }};
  kick();
})();
