/* The floor under the page.
   First the rug, close up: as you scroll you travel through its pile, and the pointer (or a finger)
   parts the yarn the way a hand would. Near the end of the rug the view lifts out and looks down on it,
   the rug ends, adhesive is troweled onto the plywood, and marble-look vinyl tiles drop into it one by one.
   The yarn takes its colours from the rug photograph. The plywood is Poly Haven's; the tiles are cut from
   an ambientCG marble scan. Without WebGL the plain rug photo in site.css stays in place. */
(function(){
  "use strict";
  var reduce = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  var cv = document.createElement("canvas");
  cv.className = "floor-scene";
  cv.setAttribute("aria-hidden", "true");
  var gl = null;
  try { gl = cv.getContext("webgl", {alpha: false, antialias: true, depth: true, stencil: false, premultipliedAlpha: false}); } catch(e){}
  if (!gl) return;
  document.body.insertBefore(cv, document.body.firstChild);
  var inst = reduce ? null : gl.getExtension("ANGLE_instanced_arrays");

  var K = 0.55, anchorVh = 0;                    /* the flat floor passes at a little over half the scroll speed */
  var vw = 0, vh = 0, dpr = 1, small = false;
  var E = 1e9, G0 = 1e9, heroEnd = 0;            /* world y where the rug ends and the glue begins */
  var PW = 220, GH = 220;                        /* tile size, and the height of one pass of glue (world px) */

  /* ---------- shaders ---------- */
  var HP = "#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n";
  var VS_FULL = "attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }";

  /* the flat floor, seen from above: the end of the rug, plywood, glue */
  var FS_GROUND = HP + [
    "uniform vec2 uRes; uniform float uDpr, uScroll, uK, uEdge, uGlue0, uGlueH, uRidge, uYarn; uniform vec3 uBack;",
    "uniform sampler2D uRug, uPly; uniform vec2 uRugSize;",
    "vec3 rug(vec2 w){ vec2 t = vec2(clamp(w.x / uRugSize.x, 0.0, 1.0), clamp(fract(w.y / uRugSize.y), 0.0005, 0.9995)); return texture2D(uRug, t).rgb; }",
    "void main(){",
    "  vec2 p = gl_FragCoord.xy / uDpr;",
    "  vec2 s = vec2(p.x, uRes.y - p.y);",
    "  vec2 w = vec2(s.x, s.y + uScroll * uK);",
    "  vec3 carpet = rug(w);",
    "  float lum = dot(carpet, vec3(0.3, 0.59, 0.11));",
    /* its edge: brighter tufts reach a little further */
    "  float tuft = ((lum - 0.45) * 26.0 + sin(w.x * 0.09) * 2.5 + sin(w.x * 0.013 + 1.7) * 6.0) * (1.0 - uYarn);",
    /* when the yarn is drawn over it, only the backing shows here */
    "  carpet = mix(carpet, uBack, uYarn);",
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

  /* the rug close up. Units: one unit is about the length of a strand of yarn.
     x runs across the screen, y up out of the rug, z away from you. */
  var CAM = "uniform vec3 uC, uR, uU, uF; uniform vec2 uProj, uNF; uniform float uD, uZMin, uFog;\n";
  var VS_PILE = CAM + [
    "attribute vec2 a;",          /* along the strand 0..1, across it -1..1 */
    "attribute vec4 aB;",         /* base x, base z, length, seed */
    "attribute vec4 aL;",         /* how far it bends, which way, width */
    "attribute vec3 aC;",         /* colour */
    "uniform vec4 uHand[8]; uniform float uEdgeZ;",
    "varying vec3 vCol, vT, vP; varying vec2 vA; varying float vFog, vSeed, vLen;",
    "void main(){",
    "  float zr = mod(aB.y - uC.z - uZMin, uD) + uZMin;",
    "  vec3 base = vec3(aB.x, 0.0, uC.z + zr);",
    "  if (base.z < uEdgeZ){ gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }",   /* past the end of the rug */
    "  vec2 L = aL.x * vec2(cos(aL.y), sin(aL.y));",
    /* where the hand has been, the yarn is pushed aside and flattened */
    "  for (int i = 0; i < 8; i++){",
    "    vec2 d = base.xz - uHand[i].xy; float r = length(d);",
    "    L += d / max(r, 0.03) * uHand[i].w * (1.0 - smoothstep(uHand[i].z * 0.2, uHand[i].z, r)) * 2.0;",
    "  }",
    "  float th = max(length(L), 0.002); vec3 ld = vec3(L.x, 0.0, L.y) / th; th = min(th, 1.45);",
    "  float t = a.x, ang = th * t, h = aB.z;",
    "  vec3 p = base + h * ((1.0 - cos(ang)) / th * ld + vec3(0.0, sin(ang) / th, 0.0));",
    /* yarn doesn't stand straight: a slow wave to one side */
    "  vec3 side = vec3(-ld.z, 0.0, ld.x);",
    "  p += side * sin(t * 3.2 + aB.w * 6.28) * 0.06 * t * h;",
    /* and the ends curl, the way frieze yarn does */
    "  float cph = t * 6.0 + aB.w * 20.0;",
    "  p += (side * cos(cph) + ld * sin(cph)) * 0.02 * h * smoothstep(0.4, 1.0, t);",
    "  vec3 T = sin(ang) * ld + vec3(0.0, cos(ang), 0.0);",
    "  vec3 sd = cross(T, uC - p); float sl = length(sd);",
    "  sd = sl > 1e-5 ? sd / sl : uR;",
    "  p += sd * a.y * aL.z * mix(0.5, 0.46, t) * 1.3;",
    "  vec3 d = p - uC; vec3 q = vec3(dot(d, uR), dot(d, uU), dot(d, uF));",
    "  gl_Position = vec4(q.x * uProj.x, q.y * uProj.y, (q.z * (uNF.y + uNF.x) - 2.0 * uNF.y * uNF.x) / (uNF.y - uNF.x), q.z);",
    "  vCol = aC; vA = a; vT = T; vP = p; vSeed = aB.w; vLen = h / aL.z;",
    "  vFog = uFog * smoothstep(uD * 0.4, uD * 0.88, zr - uZMin);",
    "}"].join("\n");
  var FS_PILE = HP + CAM + [
    "uniform vec3 uLight, uFogCol;",
    "varying vec3 vCol, vT, vP; varying vec2 vA; varying float vFog, vSeed, vLen;",
    "float hash(float n){ return fract(sin(n) * 43758.5453); }",
    "void main(){",
    "  float s = vA.y * 1.3, t = vA.x, as = abs(s);",       /* the yarn's body is |s| < 1; loose fibres stand out past it */
    /* two plies twisted round each other: each shows as a rounded band running across the strand at a slant */
    "  float ph = t * vLen * 0.55 + s * 0.42 + vSeed * 7.0;",
    "  float ply = fract(ph), pid = floor(ph);",
    "  float bulge = sin(ply * 3.14159);",
    /* the fibres in each ply run steeper than the ply itself; each catches the light a little differently */
    "  float fq = (s * 2.6 - t * vLen * 0.7 + vSeed * 31.0) * 2.6, fid = floor(fq);",
    "  float fr = hash(fid * 1.31 + pid * 17.0 + vSeed * 3.0);",
    "  float near = smoothstep(5.0, 1.6, length(uC - vP));",
    "  float fibre = mix(1.0, (0.9 + 0.2 * fr) * mix(0.92, 1.0, sin(fract(fq) * 3.14159)), near);",
    /* the plies come apart at the end, each fibre a slightly different length; a few stray fibres at the sides */
    "  float cut = 1.0 - 0.07 * hash(pid * 1.7 + vSeed * 13.0) - 0.025 * hash(fid * 2.3 + vSeed);",
    "  float tc = clamp((t - cut + 0.07) / 0.07, 0.0, 1.0), allow = sqrt(max(0.0, 1.0 - tc * tc));",
    "  float stray = step(0.84, hash(fid * 5.7 + vSeed * 9.0)) * 0.22 * near * (1.0 - tc);",
    "  float alpha = (1.0 - smoothstep(allow - 0.06 + stray, allow + stray, as)) * step(t, cut);",
    "  float sb = clamp(s, -1.0, 1.0);",
    "  vec3 T = normalize(vT), V = normalize(uC - vP);",
    "  vec3 S = normalize(cross(T, V)), F = normalize(V - T * dot(V, T));",
    "  vec3 N = S * sb + F * sqrt(max(0.0, 1.0 - sb * sb));",
    "  float diff = max(0.0, dot(N, uLight) * 0.55 + 0.45);",
    "  float TL = dot(T, uLight), TV = dot(T, V);",
    "  float spec = pow(max(0.0, sqrt(max(0.0, 1.0 - TL * TL)) * sqrt(max(0.0, 1.0 - TV * TV)) - TL * TV), 10.0) * (0.5 + fr);",
    "  float ao = mix(0.4, 1.0, smoothstep(0.0, 0.7, t));",
    "  float round = sqrt(max(0.0, 1.0 - sb * sb));",
    "  float shade = (0.8 + 0.4 * diff) * ao * mix(0.6, 1.0, pow(bulge, 0.7)) * mix(0.66, 1.0, round) * fibre;",
    "  shade *= as > 1.0 ? 0.92 : 1.0;",
    "  vec3 c = vCol * shade + vec3(0.95, 0.97, 1.0) * spec * 0.2 * ao * bulge;",
    "  c += vec3(0.9, 0.95, 1.0) * pow(sb * sb, 2.0) * 0.07 * ao;",
    "  gl_FragColor = vec4(mix(c, uFogCol, vFog), alpha);",
    "}"].join("\n");
  /* the backing between the tufts, and the haze far off */
  var FS_BACK = HP + CAM + [
    "uniform vec2 uRes; uniform float uDpr; uniform vec3 uBack, uFogCol;",
    "void main(){",
    "  vec2 n = gl_FragCoord.xy / (uRes * uDpr) * 2.0 - 1.0;",
    "  vec3 dir = normalize(uF + uR * n.x / uProj.x + uU * n.y / uProj.y);",
    "  float t = dir.y < -1e-4 ? -uC.y / dir.y : 1e4;",
    "  float zr = dir.z * t;",
    "  gl_FragColor = vec4(mix(uBack, uFogCol, uFog * smoothstep(uD * 0.4, uD * 0.88, zr - uZMin)), 1.0);",
    "}"].join("\n");

  /* like a close-up photograph: sharp in a band across the middle, soft nearer and further */
  var FS_DOF = HP + [
    "uniform sampler2D uFrame; uniform vec2 uPx; uniform float uNear, uFar;",
    "void main(){",
    "  vec2 uv = gl_FragCoord.xy * uPx;",
    "  float r = uNear * pow(1.0 - smoothstep(0.0, 0.46, uv.y), 1.4) + uFar * smoothstep(0.64, 1.0, uv.y);",
    "  vec3 acc = texture2D(uFrame, uv).rgb;",
    "  if (r > 0.6){",
    "    float rot = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) * 6.2832;",
    "    for (int i = 1; i < 20; i++){",
    "      float fi = float(i), a = fi * 2.39996 + rot;",
    "      acc += texture2D(uFrame, uv + vec2(cos(a), sin(a)) * sqrt(fi / 19.0) * r * uPx).rgb;",
    "    }",
    "    acc /= 20.0;",
    "  }",
    "  gl_FragColor = vec4(acc, 1.0);",
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
  var ground, tile, shadow, pile = null, back = null, dof = null;
  try { ground = program(VS_FULL, FS_GROUND); tile = program(VS_RECT, FS_TILE); shadow = program(VS_RECT, FS_SHADOW); }
  catch(e){ cv.remove(); return; }
  if (inst){
    try { pile = program(VS_PILE, FS_PILE, ["a", "aB", "aL", "aC"]); back = program(VS_FULL, FS_BACK); }
    catch(e){ pile = back = null; }
    try { if (pile) dof = program(VS_FULL, FS_DOF); } catch(e){ dof = null; }
  }
  var tri = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, tri); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
  var quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,0, 1,0, 0,1, 1,1]), gl.STATIC_DRAW);
  var SEG = 8, strandShape = gl.createBuffer(), strandBuf = gl.createBuffer(), strands = 0;
  (function(){ var v = []; for (var i = 0; i <= SEG; i++) v.push(i/SEG, -1, i/SEG, 1); gl.bindBuffer(gl.ARRAY_BUFFER, strandShape); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW); })();
  gl.enableVertexAttribArray(0);

  /* ---------- textures ---------- */
  function tex(repeat){
    var t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    return t;
  }
  var T = {rug: tex(false), ply: tex(true), atlas: tex(false), frame: tex(false)}, rugSize = [1, 1], rugPix = null, loaded = 0;
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
  load(T.rug, base + "photos/" + (small ? "rug-1300-blue.jpg" : "rug-2400-blue.jpg"), false, function(img){
    rugSize = [img.naturalWidth, img.naturalHeight];
    /* a small copy of the photo to colour the yarn from */
    try {
      var c = document.createElement("canvas"); c.width = 120; c.height = Math.round(120*img.naturalHeight/img.naturalWidth);
      var x = c.getContext("2d"); x.drawImage(img, 0, 0, c.width, c.height);
      rugPix = {w: c.width, h: c.height, d: x.getImageData(0, 0, c.width, c.height).data};
    } catch(e){ rugPix = null; }
    buildPile();
  });
  load(T.ply, base + "photos/plywood.jpg", true);
  load(T.atlas, base + "photos/lvt-marble.jpg", true);

  /* ---------- the pile: tufts of yarn on a grid, each a few strands splaying from one point ---------- */
  var D = 9, tanY = 0.4, tanX = 0.7, YTOP = 7.5, P0 = -0.6;
  function seeded(n){ return function(){ n = (n + 0x6D2B79F5) | 0; var t = Math.imul(n ^ (n >>> 15), 1 | n); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0)/4294967296; }; }
  function buildPile(){
    if (!pile || !rugPix || !vw) return;
    var R = seeded(1907), W = 2*(D*1.02*tanX + 1.2), sp = 0.18, nx = Math.ceil(W/sp), nz = Math.round(D/sp), spz = D/nz;
    var out = [], pw = 9, ph = pw*rugPix.h/rugPix.w;
    for (var iz = 0; iz < nz; iz++) for (var ix = 0; ix < nx; ix++){
      var tx = -W/2 + (ix + 0.5 + (R() - 0.5)*0.8)*sp, tz = (iz + 0.5 + (R() - 0.5)*0.8)*spz;
      /* the tuft's colour from the photo, brought up to the brightness of lit yarn */
      var u = ((tx/pw)%1 + 1)%1, v = (tz/ph)%1, o = (Math.floor(v*rugPix.h)*rugPix.w + Math.floor(u*rugPix.w))*4;
      var cr = rugPix.d[o]/255, cg = rugPix.d[o+1]/255, cb = rugPix.d[o+2]/255, lum = 0.3*cr + 0.59*cg + 0.11*cb, k = 0.8/Math.max(lum, 0.3);
      cr *= k; cg *= k; cb *= k; lum = 0.3*cr + 0.59*cg + 0.11*cb;
      cr = Math.min(1, lum + (cr - lum)*1.3); cg = Math.min(1, lum + (cg - lum)*1.3); cb = Math.min(1, lum + (cb - lum)*1.3);
      var len = 0.9 + R()*0.4, bend = 0.45 + R()*0.7, dir = R()*6.2832, n = 5 + Math.floor(R()*3);
      for (var s = 0; s < n; s++){
        var white = R() < 0.14, lit = 0.9 + R()*0.16;
        var r = cr*lit, g = cg*lit, b = cb*lit;
        if (white){ r = 0.93 + R()*0.05; g = 0.96 + R()*0.03; b = 1.0; }
        out.push(tx + (R() - 0.5)*0.06, tz + (R() - 0.5)*0.06, len*(0.88 + R()*0.24), R(),
                 bend + (R() - 0.5)*0.5, dir + (R() - 0.5)*1.6, 0.085 + R()*0.035, 0,
                 r, g, b, 0);
      }
    }
    strands = out.length/12;
    gl.bindBuffer(gl.ARRAY_BUFFER, strandBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(out), gl.STATIC_DRAW);
    kick();
  }

  /* ---------- where things are ---------- */
  var sA = 0, sB = 0;                             /* scroll where the view starts to lift out of the rug, and where it is out */
  function docTop(el){ var r = el.getBoundingClientRect(); return r.top + window.pageYOffset; }
  function measure(){
    var sameWidth = window.innerWidth === vw;
    vw = window.innerWidth; vh = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, small ? 1.5 : 1.25);
    cv.width = Math.round(vw*dpr); cv.height = Math.round(vh*dpr);
    gl.bindTexture(gl.TEXTURE_2D, T.frame); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, cv.width, cv.height, 0, gl.RGB, gl.UNSIGNED_BYTE, null);
    PW = small ? 140 : 220; GH = PW;
    var hero = document.getElementById("hero"), floors = document.getElementById("floors");
    heroEnd = hero ? docTop(hero) + hero.offsetHeight : 0;
    var endDoc = floors ? docTop(floors) : document.documentElement.scrollHeight*0.5;
    /* the rug's edge crosses the middle of the screen as the floors section comes up */
    if (!sameWidth || !anchorVh) anchorVh = vh;      /* the address bar doesn't move the floor */
    E = anchorVh*0.62 + K*(endDoc - anchorVh*0.62);
    G0 = E + (small ? 34 : 56);
    var asp = vw/anchorVh, fov = asp >= 1 ? 44 : Math.min(60, 44 + (1 - asp)*28);
    tanY = Math.tan(fov*Math.PI/360); tanX = tanY*asp;
    P0 = -(fov*Math.PI/360 + 0.21);                  /* the top of the view stays a little below the far haze */
    /* by sB the view is straight down, and the rug's end is just below the screen */
    sB = (E - anchorVh)/K - anchorVh*0.05;
    sA = Math.max(sB - anchorVh*0.85, heroEnd - anchorVh*0.4);
    if (!sameWidth) buildPile();
  }

  /* ---------- the camera ---------- */
  function clamp01(x){ return x < 0 ? 0 : x > 1 ? 1 : x; }
  function smooth(a, b, x){ x = clamp01((x - a)/(b - a)); return x*x*(3 - 2*x); }
  /* forward through the pile as you scroll; then, lifting out, it eases into a slow drift back.
     From sB on it looks straight down from YTOP and the rug moves up the screen exactly as the flat
     floor does, so the yarn ends where the flat floor's rug edge is (z = zEdge). */
  var zB = 0, zEdge = -1e9;
  function travel(sc){
    var vf = 3.0/anchorVh, ppu = vh/(2*YTOP*tanY), vb = K/ppu, L = Math.max(1, sB - sA);
    zB = sA*vf + L*(vf - (vf + vb)*0.5);
    zEdge = zB + (vh/2 - (E - sB*K))/ppu;
    if (sc <= sA) return sc*vf;
    if (sc >= sB) return zB - (sc - sB)*vb;
    var u = (sc - sA)/L;
    return sA*vf + L*(vf*u - (vf + vb)*(u*u*u - u*u*u*u/2));
  }
  var pointer = null;
  function camera(sc){
    var u = clamp01((sc - sA)/Math.max(1, sB - sA)), lift = smooth(0.06, 1, u), turn = smooth(0, 0.85, u);
    var z = travel(sc), calm = 1 - lift, Y0 = 2.7;
    var lean = pointer ? (pointer.x/vw - 0.5) : 0;
    var yaw = (0.05*Math.sin(z*0.11) + 0.04*lean)*calm, pitch = P0 + (-Math.PI/2 - P0)*turn;
    var C = [0.3*Math.sin(z*0.07)*calm, Y0 + 0.07*Math.sin(z*0.9)*calm + (YTOP - Y0)*lift, z];
    var cp = Math.cos(pitch), sp = Math.sin(pitch);
    var R = [Math.cos(yaw), 0, -Math.sin(yaw)], F = [Math.sin(yaw)*cp, sp, Math.cos(yaw)*cp];
    var U = [F[1]*R[2] - F[2]*R[1], F[2]*R[0] - F[0]*R[2], F[0]*R[1] - F[1]*R[0]];
    return {C: C, R: R, U: U, F: F, zMin: -0.7 - 4.3*lift, fog: 1 - smooth(0.3, 0.85, u), blur: 1 - smooth(0, 0.6, u), edgeZ: sc >= sB ? zEdge : -1e9};
  }
  function setCam(pr, c){
    var u = pr.u;
    gl.uniform3fv(u.uC, c.C); gl.uniform3fv(u.uR, c.R); gl.uniform3fv(u.uU, c.U); gl.uniform3fv(u.uF, c.F);
    gl.uniform2f(u.uProj, 1/tanX, 1/tanY); gl.uniform2f(u.uNF, 0.04, 40);
    gl.uniform1f(u.uD, D); gl.uniform1f(u.uZMin, c.zMin); gl.uniform1f(u.uFog, c.fog);
  }

  /* ---------- the hand: where the pointer meets the pile, kept in the rug's own coordinates ---------- */
  var hands = [], handArr = new Float32Array(32), HAND_R = 0.62;
  function touchPile(c, now){
    if (!pointer) return;
    var nx = pointer.x/vw*2 - 1, ny = 1 - pointer.y/vh*2;
    var d = [c.F[0] + c.R[0]*nx*tanX + c.U[0]*ny*tanY, c.F[1] + c.R[1]*nx*tanX + c.U[1]*ny*tanY, c.F[2] + c.R[2]*nx*tanX + c.U[2]*ny*tanY];
    if (d[1] > -0.02) return;
    var t = (0.9 - c.C[1])/d[1], x = c.C[0] + d[0]*t, z = c.C[2] + d[2]*t, last = hands[hands.length - 1];
    if (last && Math.hypot(last.x - x, last.z - z) < 0.12){ last.t = now; return; }
    hands.push({x: x, z: z, t: now});
    if (hands.length > 8) hands.shift();
  }
  function handUniforms(now){
    var live = false;
    for (var i = 0; i < 8; i++){
      var h = hands[i], o = i*4;
      if (!h){ handArr[o] = handArr[o+1] = 1e4; handArr[o+2] = 1; handArr[o+3] = 0; continue; }
      /* the yarn stands back up over a couple of seconds */
      var age = now - h.t, w = age < 0 ? 1 : Math.exp(-age/1300);
      handArr[o] = h.x; handArr[o+1] = h.z; handArr[o+2] = HAND_R; handArr[o+3] = w;
      if (w > 0.01) live = true;
    }
    return live;
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
    if (loaded < 3) return false;
    if (scroll + vh < heroEnd - 4) return false;          /* the opening covers everything */
    gl.viewport(0, 0, cv.width, cv.height);
    gl.disable(gl.BLEND);
    var c = (pile && strands) ? camera(scroll) : null, busy = false;
    var flat = !c || scroll >= sB, yarn = c && E - scroll*K > -200;
    if (!yarn) hands.length = 0;
    if (flat){
      gl.useProgram(ground.p); var u = ground.u;
      gl.uniform2f(u.uRes, vw, vh); gl.uniform1f(u.uDpr, dpr); gl.uniform1f(u.uScroll, scroll); gl.uniform1f(u.uK, K);
      gl.uniform1f(u.uEdge, E); gl.uniform1f(u.uGlue0, G0); gl.uniform1f(u.uGlueH, GH); gl.uniform1f(u.uRidge, small ? 6.0 : 8.0);
      gl.uniform1f(u.uYarn, c ? 1 : 0); gl.uniform3fv(u.uBack, BACKING);
      gl.uniform2f(u.uRugSize, vw, vw*rugSize[1]/rugSize[0]);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, T.rug); gl.uniform1i(u.uRug, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, T.ply); gl.uniform1i(u.uPly, 1);
      gl.bindBuffer(gl.ARRAY_BUFFER, tri); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    if (yarn) busy = drawPile(c, now, !flat);
    if (flat && drawTiles(now)) busy = true;
    return busy;
  }
  var LIGHT = (function(v){ var l = Math.hypot(v[0], v[1], v[2]); return [v[0]/l, v[1]/l, v[2]/l]; })([-0.4, 0.75, 0.5]);
  var FOG = [0.8, 0.87, 0.94], BACKING = [0.2, 0.28, 0.4];
  function drawPile(c, now, backing){
    touchPile(c, now);
    var live = handUniforms(now);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    if (backing){
      gl.useProgram(back.p); setCam(back, c);
      gl.uniform2f(back.u.uRes, vw, vh); gl.uniform1f(back.u.uDpr, dpr); gl.uniform3fv(back.u.uBack, BACKING); gl.uniform3fv(back.u.uFogCol, FOG);
      gl.bindBuffer(gl.ARRAY_BUFFER, tri); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.depthMask(true);
    gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE);
    gl.useProgram(pile.p); setCam(pile, c);
    gl.uniform4fv(pile.u.uHand, handArr); gl.uniform3fv(pile.u.uLight, LIGHT); gl.uniform3fv(pile.u.uFogCol, FOG); gl.uniform1f(pile.u.uEdgeZ, c.edgeZ);
    gl.bindBuffer(gl.ARRAY_BUFFER, strandShape); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, strandBuf);
    for (var i = 1; i <= 3; i++){ gl.enableVertexAttribArray(i); inst.vertexAttribDivisorANGLE(i, 1); }
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 48, 0); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 48, 16); gl.vertexAttribPointer(3, 3, gl.FLOAT, false, 48, 32);
    inst.drawArraysInstancedANGLE(gl.TRIANGLE_STRIP, 0, (SEG + 1)*2, strands);
    for (i = 1; i <= 3; i++){ inst.vertexAttribDivisorANGLE(i, 0); gl.disableVertexAttribArray(i); }
    gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE); gl.disable(gl.DEPTH_TEST);
    if (dof && backing && c.blur > 0.02){
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, T.frame);
      gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, cv.width, cv.height);
      gl.useProgram(dof.p);
      gl.uniform1i(dof.u.uFrame, 0); gl.uniform2f(dof.u.uPx, 1/cv.width, 1/cv.height);
      gl.uniform1f(dof.u.uNear, 13*dpr*c.blur); gl.uniform1f(dof.u.uFar, 5*dpr*c.blur);
      gl.bindBuffer(gl.ARRAY_BUFFER, tri); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    return live;
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
  function point(x, y){ if (!pile) return; pointer = {x: x, y: y}; kick(); }
  window.addEventListener("pointermove", function(e){ if (e.pointerType === "mouse") point(e.clientX, e.clientY); }, {passive: true});
  window.addEventListener("touchstart", function(e){ var t = e.touches[0]; if (t) point(t.clientX, t.clientY); }, {passive: true});
  window.addEventListener("touchmove", function(e){ var t = e.touches[0]; if (t) point(t.clientX, t.clientY); }, {passive: true});
  window.addEventListener("touchend", function(){ pointer = null; }, {passive: true});
  document.documentElement.addEventListener("mouseleave", function(){ pointer = null; });
  window.addEventListener("scroll", kick, {passive: true});
  var rt = 0;
  window.addEventListener("resize", function(){ clearTimeout(rt); rt = setTimeout(function(){ measure(); kick(); }, 120); });
  if (window.ResizeObserver) new ResizeObserver(function(){ clearTimeout(rt); rt = setTimeout(function(){ var e0 = E; measure(); if (Math.abs(E - e0) > 40) rows = {}; kick(); }, 200); }).observe(document.body);
  cv.addEventListener("webglcontextlost", function(e){ e.preventDefault(); document.documentElement.classList.remove("has-scene"); });
  measure();
  window.KnockelsFloor = {anchors: function(){ return {E: E, G0: G0, K: K, PW: PW, heroEnd: heroEnd, sA: sA, sB: sB, zEdge: zEdge, strands: strands, pile: !!pile}; }, point: point};
  kick();
})();
