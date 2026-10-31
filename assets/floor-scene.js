/* The floor under the page.
   A deep rug that you brush as you scroll (or with your finger, or the mouse): the pile leans the way
   the hand went and catches the light, then slowly stands back up. Further down the rug ends, adhesive
   is troweled onto the plywood ahead of you, and luxury vinyl tiles drop into it one at a time.
   Drawn with WebGL from photographs: the rug, Poly Haven's plywood, and planks cut from a laminate scan.
   Without WebGL the plain rug photo in site.css stays in place. */
(function(){
  "use strict";
  var reduce = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  var cv = document.createElement("canvas");
  cv.className = "floor-scene";
  cv.setAttribute("aria-hidden", "true");
  var gl = null;
  try { gl = cv.getContext("webgl", {alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, powerPreference: "low-power"}); } catch(e){}
  if (!gl) return;
  document.body.insertBefore(cv, document.body.firstChild);

  var K = 0.55, anchorVh = 0;                                  /* the floor passes at a little over half the scroll speed */
  var vw = 0, vh = 0, dpr = 1, small = false;
  var E = 1e9, G0 = 1e9, heroEnd = 0;            /* world y where the rug ends and the glue begins */
  var PW = 170, PL = 170, GH = 170;              /* tile size, and the height of one pass of glue (world px) */

  /* ---------- shaders ---------- */
  var HP = "#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n";
  var VS_FULL = "attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }";
  var FS_GROUND = HP + [
    "uniform vec2 uRes; uniform float uDpr, uScroll, uK, uEdge, uGlue0, uGlueH, uFieldRem, uRidge;",
    "uniform sampler2D uRug, uField, uPly; uniform vec2 uRugSize;",
    "vec3 rug(vec2 w){ vec2 t = vec2(clamp(w.x / uRugSize.x, 0.0, 1.0), clamp(fract(w.y / uRugSize.y), 0.0005, 0.9995)); return texture2D(uRug, t).rgb; }",
    "void main(){",
    "  vec2 p = gl_FragCoord.xy / uDpr;",
    "  vec2 s = vec2(p.x, uRes.y - p.y);",
    "  vec2 w = vec2(s.x, s.y + uScroll * uK);",
    /* the rug, leaning where the hand passed */
    "  vec2 fu = clamp(vec2(s.x, s.y + uFieldRem) / uRes, 0.0, 1.0);",
    "  vec4 f = texture2D(uField, fu);",
    "  vec2 d = (f.rg - 0.5) * 2.0; float m = clamp(length(d), 0.0, 1.0);",
    /* where the hand passed the fibres lie down along its path: smeared that way, lower, and showing their sides */
    "  vec2 lean = d * 22.0;",
    "  vec3 c0 = rug(w);",
    "  float lum = dot(c0, vec3(0.3, 0.59, 0.11));",
    "  vec3 carpet = c0 * 0.3 + rug(w - lean * 0.25) * 0.22 + rug(w - lean * 0.5) * 0.18 + rug(w - lean * 0.75) * 0.16 + rug(w - lean) * 0.14;",
    "  carpet = mix(c0, carpet, smoothstep(0.0, 0.25, m));",
    "  float sheen = d.y * 0.85 + d.x * 0.3;",
    "  carpet *= 1.0 - 0.12 * m + 0.4 * sheen;",
    "  carpet = mix(carpet, carpet * vec3(1.08, 1.03, 0.95), m * 0.5);",
    /* the edges of each streak, where the pile still stands, catch the light */
    "  float bx = texture2D(uField, fu + vec2(8.0 / uRes.x, 0.0)).b - texture2D(uField, fu - vec2(8.0 / uRes.x, 0.0)).b;",
    "  float by = texture2D(uField, fu + vec2(0.0, 8.0 / uRes.y)).b - texture2D(uField, fu - vec2(0.0, 8.0 / uRes.y)).b;",
    "  carpet *= 1.0 + clamp(length(vec2(bx, by)) * 1.1, 0.0, 0.16) * lum * 1.6;",
    /* its edge: brighter tufts reach a little further */
    "  float tuft = (lum - 0.45) * 26.0 + sin(w.x * 0.09) * 2.5 + sin(w.x * 0.013 + 1.7) * 6.0;",
    "  float onRug = 1.0 - smoothstep(-1.2, 1.2, w.y - uEdge - tuft);",
    "  carpet *= 1.0 + 0.16 * smoothstep(-10.0, 0.0, w.y - uEdge - tuft);",
    /* plywood, shaded by the rug's thickness just past the edge */
    "  vec3 ply = texture2D(uPly, w / 760.0).rgb;",
    "  ply = mix(ply, vec3(dot(ply, vec3(0.3, 0.59, 0.11))), 0.25) * 1.18 + vec3(0.03, 0.02, 0.0);",
    "  float sh = smoothstep(uEdge + 60.0, uEdge + 2.0, w.y) * 0.55;",
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
    "  gl_FragColor = vec4(mix(floorc, carpet, onRug), 1.0);",
    "}"].join("\n");
  var VS_RECT = "attribute vec2 a; uniform vec2 uRes; uniform vec4 uRect; uniform float uRot; varying vec2 vUV; varying vec2 vPos;" +
    "void main(){ vUV = a; vec2 c = uRect.xy + uRect.zw * 0.5; vec2 q = (a - 0.5) * uRect.zw; float cs = cos(uRot), sn = sin(uRot);" +
    " vPos = c + vec2(q.x * cs - q.y * sn, q.x * sn + q.y * cs); gl_Position = vec4(vPos.x / uRes.x * 2.0 - 1.0, 1.0 - vPos.y / uRes.y * 2.0, 0.0, 1.0); }";
  var FS_PLANK = HP + [
    "uniform sampler2D uAtlas; uniform vec4 uSub; uniform float uTurn, uAlpha, uLight; uniform vec2 uSize; varying vec2 vUV;",
    "void main(){",
    "  vec2 q = vUV;",
    "  if (uTurn > 0.5) q = vec2(q.y, 1.0 - q.x);",
    "  if (uTurn > 1.5) q = vec2(q.y, 1.0 - q.x);",
    "  if (uTurn > 2.5) q = vec2(q.y, 1.0 - q.x);",
    "  vec3 c = texture2D(uAtlas, uSub.xy + q * uSub.zw).rgb;",
    "  vec2 px = vUV * uSize;",
    "  float e = min(min(px.x, uSize.x - px.x), min(px.y, uSize.y - px.y));",
    "  c *= mix(0.72, 1.0, smoothstep(0.0, 2.2, e));",
    "  c *= 1.0 + 0.06 * (1.0 - smoothstep(0.0, 3.0, px.y)) - 0.05 * (1.0 - smoothstep(0.0, 3.0, uSize.y - px.y));",
    "  gl_FragColor = vec4(c * uLight, uAlpha);",
    "}"].join("\n");
  var FS_SHADOW = HP + [
    "uniform vec4 uBox; uniform float uBlur, uAlpha; varying vec2 vPos;",
    "float box(vec2 p, vec2 b){ vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }",
    "void main(){ float d = box(vPos - uBox.xy, uBox.zw); gl_FragColor = vec4(0.16, 0.1, 0.05, uAlpha * (1.0 - smoothstep(-uBlur, uBlur, d))); }"].join("\n");

  function compile(type, src){ var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
  function program(vs, fs){
    var p = gl.createProgram(); gl.attachShader(p, compile(gl.VERTEX_SHADER, vs)); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, "a"); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < n; i++){ var info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
    return {p: p, u: u};
  }
  var ground, plank, shadow;
  try { ground = program(VS_FULL, FS_GROUND); plank = program(VS_RECT, FS_PLANK); shadow = program(VS_RECT, FS_SHADOW); }
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
  var T = {rug: tex(false), ply: tex(true), atlas: tex(false), field: tex(false)}, rugSize = [1, 1], loaded = 0;
  function load(t, src, mip, done){
    var img = new Image();
    img.onload = function(){
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
      if (mip){ gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); }
      if (done) done(img);
      if (++loaded === 3){ document.documentElement.classList.add("has-scene"); kick(); }
    };
    img.src = src;
  }
  var base = (document.currentScript && document.currentScript.src) ? document.currentScript.src.replace(/[^\/]*$/, "") : "assets/";
  small = Math.min(innerWidth, innerHeight) < 700;
  load(T.rug, base + "photos/" + (small ? "rug-1300-blue.jpg" : "rug-2400-blue.jpg"), false, function(img){ rugSize = [img.naturalWidth, img.naturalHeight]; });
  load(T.ply, base + "photos/plywood.jpg", true);
  load(T.atlas, base + "photos/lvt-terrazzo.jpg", true);

  /* ---------- the hand's trail: a small grid in screen space that moves with the floor ---------- */
  var FW = 0, FH = 0, field = null, fscale = 1, frem = 0, energy = 0, fdirty = true;
  function neutral(a, from, to){ for (var i = from; i < to; i += 4){ a[i] = 128; a[i+1] = 128; a[i+2] = 0; a[i+3] = 255; } }
  function makeField(keep){
    var oldFW = FW, oldFH = FH, old = field;
    FW = small ? 150 : 260; fscale = vw/FW; FH = Math.max(8, Math.round(vh/fscale));
    field = new Uint8Array(FW*FH*4); neutral(field, 0, field.length);
    /* the phone's address bar coming and going changes only the height: keep the trails */
    if (keep && old && oldFW === FW) field.set(old.subarray(0, Math.min(oldFH, FH)*FW*4));
    else { frem = 0; energy = 0; }
    upload();
  }
  function upload(){ gl.bindTexture(gl.TEXTURE_2D, T.field); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, FW, FH, 0, gl.RGBA, gl.UNSIGNED_BYTE, field); fdirty = false; }
  function shiftField(worldDy){
    frem += worldDy/fscale;
    var n = frem > 0 ? Math.floor(frem) : Math.ceil(frem);
    if (!n) return;
    frem -= n; fdirty = true;
    var row = FW*4;
    if (Math.abs(n) >= FH){ neutral(field, 0, field.length); return; }
    if (n > 0){ field.copyWithin(0, n*row); neutral(field, (FH - n)*row, FH*row); }
    else { field.copyWithin(-n*row, 0, (FH + n)*row); neutral(field, 0, -n*row); }
  }
  function dab(x, y, r, dx, dy, str){
    /* x, y, r in screen px; dx, dy the direction the hand moved over the rug */
    var cx = x/fscale, cy = y/fscale, rr = Math.max(1.2, r/fscale), x0 = Math.max(0, Math.floor(cx - rr)), x1 = Math.min(FW - 1, Math.ceil(cx + rr)), y0 = Math.max(0, Math.floor(cy - rr)), y1 = Math.min(FH - 1, Math.ceil(cy + rr));
    var tr = 128 + dx*127*str, tg = 128 + dy*127*str, tb = 255*str;
    for (var j = y0; j <= y1; j++) for (var i = x0; i <= x1; i++){
      var q = ((i - cx)*(i - cx) + (j - cy)*(j - cy))/(rr*rr); if (q >= 1) continue;
      var k = (1 - q)*(1 - q)*0.55, o = (j*FW + i)*4;
      field[o] += (tr - field[o])*k; field[o+1] += (tg - field[o+1])*k; field[o+2] += (tb - field[o+2])*k;
    }
    energy = 1; fdirty = true;
  }
  function stroke(x0, y0, x1, y1, wdx, wdy, kind){
    var len = Math.hypot(wdx, wdy); if (len < 0.5) return;
    var ux = wdx/len, uy = wdy/len, nx = -uy, ny = ux, str = Math.min(1, 0.6 + len/30);
    var steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)/(fscale*1.2)));
    for (var s = 0; s <= steps; s++){
      var t = s/steps, x = x0 + (x1 - x0)*t, y = y0 + (y1 - y0)*t;
      if (kind === "palm"){
        /* four fingers trailing streaks, the palm behind them */
        [-1.5, -0.5, 0.5, 1.5].forEach(function(f){ dab(x + nx*f*34 - ux*Math.abs(f)*10, y + ny*f*34 - uy*Math.abs(f)*10, 19, ux, uy, str); });
        dab(x - ux*58, y - uy*58, 66, ux, uy, str*0.4);
      } else dab(x, y, kind === "touch" ? 38 : 30, ux, uy, str);
    }
  }
  function decay(){
    if (!energy) return;
    var any = 0, f = field;
    for (var i = 0; i < f.length; i += 4){
      for (var c = 0; c < 3; c++){
        var v = f[i+c], t = c === 2 ? 0 : 128, dlt = t - v;
        if (dlt){ var st = dlt*0.022; f[i+c] = v + (Math.abs(st) < 1 ? (dlt > 0 ? 1 : -1) : Math.round(st)); any = 1; }
      }
    }
    if (!any) energy = 0; else fdirty = true;
  }

  /* ---------- where things are ---------- */
  function docTop(el){ var r = el.getBoundingClientRect(); return r.top + window.pageYOffset; }
  function measure(){
    var sameWidth = window.innerWidth === vw;
    vw = window.innerWidth; vh = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, small ? 1.5 : 1.25);
    cv.width = Math.round(vw*dpr); cv.height = Math.round(vh*dpr);
    PW = small ? 112 : 170; PL = PW; GH = PW;
    var hero = document.getElementById("hero"), floors = document.getElementById("floors");
    heroEnd = hero ? docTop(hero) + hero.offsetHeight : 0;
    var endDoc = floors ? docTop(floors) : document.documentElement.scrollHeight*0.5;
    /* the rug's edge crosses the middle of the screen as the floors section comes up */
    if (!sameWidth || !anchorVh) anchorVh = vh;      /* the address bar doesn't move the floor */
    E = anchorVh*0.62 + K*(endDoc - anchorVh*0.62);
    G0 = E + (small ? 34 : 56);
    makeField(sameWidth);
  }

  /* ---------- planks ---------- */
  var rows = {}, DUR = reduce ? 1 : 620, GAP = reduce ? 0 : 150;
  /* terrazzo tiles in a checkerboard: cream with coloured chips, and pale blue with coloured chips.
     Each tile is cut from a different part of the scan and turned a different way, like a real box of tiles. */
  function rand(a, b){ var x = Math.sin(a*78.233 + b*37.719 + 1.3)*24634.6345; return x - Math.floor(x); }
  function tileLook(r, c){
    var x = rand(r, c), y = rand(c + 11.1, r - 7.7), half = (r + c) % 2;
    return {sub: [half*0.5 + x*0.25, y*0.5, 0.25, 0.5], turn: Math.floor(rand(r*3.1, c*1.7)*4), light: 0.96 + rand(c, r*2.3)*0.07};
  }
  function rowStart(){ return vw/2 - Math.ceil(vw/2/PL)*PL; }
  function ease(p){ return p*p; }

  /* ---------- drawing ---------- */
  var scroll = window.pageYOffset, lastScroll = scroll, raf = 0, hand = null, lastT = 0;
  function frame(now){
    raf = 0;
    var sc = window.pageYOffset, moved = sc !== lastScroll;
    if (moved){
      shiftField(K*(sc - lastScroll));
      if (!reduce) scrollHand(sc, lastScroll);
      lastScroll = sc;
    }
    if (!reduce) decay();
    scroll = sc;
    var busy = draw(now);
    if (energy || busy) kick();
  }
  function kick(){ if (!raf) raf = requestAnimationFrame(frame); }
  function scrollHand(sc, prev){
    var hy = vh*0.58, wy = sc*K + hy;
    if (sc + vh < heroEnd || wy > E + 30){ hand = null; return; }
    var hx = vw*(0.5 + 0.44*Math.sin(sc*0.0021));
    if (hand) stroke(hand.x, hy, hx, hy, hx - hand.x, K*(sc - prev), "palm");
    hand = {x: hx};
  }
  function draw(now){
    if (loaded < 3) return false;
    if (scroll + vh < heroEnd - 4) return false;          /* the opening covers everything */
    gl.viewport(0, 0, cv.width, cv.height);
    gl.disable(gl.BLEND);
    gl.useProgram(ground.p); var u = ground.u;
    gl.uniform2f(u.uRes, vw, vh); gl.uniform1f(u.uDpr, dpr); gl.uniform1f(u.uScroll, scroll); gl.uniform1f(u.uK, K);
    gl.uniform1f(u.uEdge, E); gl.uniform1f(u.uGlue0, G0); gl.uniform1f(u.uGlueH, GH); gl.uniform1f(u.uRidge, small ? 6.0 : 8.0); gl.uniform1f(u.uFieldRem, frem*fscale);
    var rw = vw, rh = vw*rugSize[1]/rugSize[0];
    gl.uniform2f(u.uRugSize, rw, rh);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, T.rug); gl.uniform1i(u.uRug, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, T.field); if (fdirty) upload(); gl.uniform1i(u.uField, 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, T.ply); gl.uniform1i(u.uPly, 2);
    gl.bindBuffer(gl.ARRAY_BUFFER, tri); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return drawPlanks(now);
  }
  function drawPlanks(now){
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
      for (var c = 0, x = rowStart(); x < vw; c++, x += PL){
        var p = Math.min(1, Math.max(0, (now - rows[r] - c*GAP)/DUR));
        if (p <= 0){ busy = true; continue; }
        if (p < 1) busy = true;
        list.push({x: x, y: sy, p: p, look: tileLook(r, c)});
      }
    }
    if (!list.length) return busy;
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    /* shadows first, so a falling plank's shadow lies on the floor and not on its neighbours */
    gl.useProgram(shadow.p);
    gl.uniform2f(shadow.u.uRes, vw, vh);
    gl.uniform1f(shadow.u.uRot, 0);
    list.forEach(function(pk){
      var h = 1 - Math.min(1, ease(Math.min(1, pk.p/0.72)));
      var blur = 2 + 30*h, off = 2 + 34*h, a = pk.p < 1 ? (0.16 + 0.24*(1 - h))*Math.min(1, pk.p*6) : 0.3;
      gl.uniform4f(shadow.u.uBox, pk.x + PL/2 + off*0.3, pk.y + PW/2 + off, PL/2, PW/2);
      gl.uniform1f(shadow.u.uBlur, blur); gl.uniform1f(shadow.u.uAlpha, a);
      gl.uniform4f(shadow.u.uRect, pk.x - blur - 4, pk.y - blur - 4, PL + 2*blur + off + 8, PW + 2*blur + off + 8);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    });
    gl.useProgram(plank.p);
    gl.uniform2f(plank.u.uRes, vw, vh);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, T.atlas); gl.uniform1i(plank.u.uAtlas, 0);
    list.forEach(function(pk){
      var f = Math.min(1, pk.p/0.72), h = 1 - ease(f);
      /* a small bounce as it lands */
      if (pk.p > 0.72){ var b = (pk.p - 0.72)/0.28; h = -0.035*Math.sin(b*Math.PI)*(1 - b); }
      /* nearer the eye while it falls: bigger, a touch brighter, turned a little; it straightens as it lands */
      var s = 1 + 0.2*h, w = PL*s, ht = PW*s;
      gl.uniform4f(plank.u.uRect, pk.x + PL/2 - w/2 - 10*h, pk.y + PW/2 - ht/2 - 22*h, w, ht);
      gl.uniform1f(plank.u.uRot, (pk.look.turn % 2 ? 1 : -1)*0.06*Math.max(0, h));
      gl.uniform2f(plank.u.uSize, w, ht);
      gl.uniform4f(plank.u.uSub, pk.look.sub[0], pk.look.sub[1], pk.look.sub[2], pk.look.sub[3]); gl.uniform1f(plank.u.uTurn, pk.look.turn);
      gl.uniform1f(plank.u.uAlpha, Math.min(1, pk.p*14)); gl.uniform1f(plank.u.uLight, pk.look.light*(1 + 0.08*Math.max(0, h)));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    });
    gl.disable(gl.BLEND);
    return busy;
  }

  /* ---------- input ---------- */
  var lastPt = null;
  function point(x, y, kind){
    if (reduce) return;
    var wy = y + scroll*K;
    if (wy > E + 20 || scroll + vh < heroEnd){ lastPt = null; return; }
    if (lastPt) stroke(lastPt.x, lastPt.y, x, y, x - lastPt.x, (y - lastPt.y) + K*(scroll - lastPt.sc), kind);
    lastPt = {x: x, y: y, sc: scroll};
    kick();
  }
  window.addEventListener("pointermove", function(e){ if (e.pointerType === "mouse") point(e.clientX, e.clientY, "mouse"); }, {passive: true});
  window.addEventListener("touchmove", function(e){ var t = e.touches[0]; if (t) point(t.clientX, t.clientY, "touch"); }, {passive: true});
  window.addEventListener("touchend", function(){ lastPt = null; }, {passive: true});
  window.addEventListener("mouseleave", function(){ lastPt = null; });
  window.addEventListener("scroll", kick, {passive: true});
  var rt = 0;
  window.addEventListener("resize", function(){ clearTimeout(rt); rt = setTimeout(function(){ measure(); kick(); }, 120); });
  if (window.ResizeObserver) new ResizeObserver(function(){ clearTimeout(rt); rt = setTimeout(function(){ var e0 = E; measure(); if (Math.abs(E - e0) > 40) rows = {}; kick(); }, 200); }).observe(document.body);
  cv.addEventListener("webglcontextlost", function(e){ e.preventDefault(); document.documentElement.classList.remove("has-scene"); });
  measure();
  window.KnockelsFloor = {anchors: function(){ return {E: E, G0: G0, K: K, PW: PW, heroEnd: heroEnd}; }, brush: function(x0, y0, x1, y1){ stroke(x0, y0, x1, y1, x1 - x0, y1 - y0, "palm"); kick(); }};
  kick();
})();
