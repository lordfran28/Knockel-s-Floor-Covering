/* Knockel's: try a floor in your room.
   Everything happens on the visitor's device. The four corners mark a rectangle on the floor; from
   them the page works out the floor's perspective and lays the chosen sample in it, keeping the
   room's own light and shadows. Painting protects furniture or adds floor the corners missed. */
(function(){
  "use strict";
  function $(id){ return document.getElementById(id); }
  var wrap = $("viewwrap"), cv = $("view"), svg = $("overlay"), quadline = $("quadline"), msgEl = $("msg"), help = $("help");

  var ROOMS = [
    {src: "assets/photos/room-bay.jpg", w: 786, h: 629, widthM: 2.6,
     quad: [[188,497],[598,497],[728,612],[58,612]],
     area: [[0,512],[97,497],[100,472],[176,443],[304,441],[380,475],[492,488],[500,512],[538,512],[545,472],[786,468],[786,629],[0,629]]},
    {src: "assets/photos/room-corner.jpg", w: 1600, h: 1200, widthM: 1.8,
     quad: [[810,764],[1240,860],[830,1075],[440,830]],
     area: [[0,1006],[592,864],[596,820],[810,764],[1600,942],[1600,1200],[0,1200]]}
  ];
  var S = {room: 0, iw: 1, ih: 1, quad: null, floor: null, rot: false, size: 1, mode: "corners", before: false, user: false, widthM: 3.6};
  var cache = {};

  function say(t){ msgEl.textContent = t || ""; msgEl.hidden = !t; }
  var HELP = {
    corners: "Drag the four yellow dots to the corners of the floor, where it meets the walls. Any four points that make a rectangle on the floor will do.",
    keep: "Paint over furniture, rugs or anything standing on the floor to keep it as it is.",
    add: "Paint any floor the corners missed, like a hallway or a corner behind a door."
  };

  /* ---------- WebGL ---------- */
  var gl = cv.getContext("webgl", {antialias: true, premultipliedAlpha: false}) || cv.getContext("experimental-webgl");
  if (!gl){
    document.querySelector(".work").innerHTML = '<p class="nogl">This browser can\'t draw the floors. Try a recent Chrome, Safari, Firefox or Edge, or call us at <a href="tel:+15635392772">563-539-2772</a> and we\'ll help.</p>';
    return;
  }
  var deriv = gl.getExtension("OES_standard_derivatives");
  var lod = deriv && gl.getExtension("EXT_shader_texture_lod");
  var aniso = gl.getExtension("EXT_texture_filter_anisotropic") || gl.getExtension("WEBKIT_EXT_texture_filter_anisotropic");
  var VS = "attribute vec2 aPos;uniform vec2 uScale,uOff,uCanvas;varying vec2 vImg;" +
    "void main(){vImg=aPos;vec2 c=(aPos*uScale+uOff)/uCanvas*2.0-1.0;gl_Position=vec4(c.x,-c.y,0.0,1.0);}";
  /* The floor is laid in metres: m runs across the marked rectangle (x) and away from you (y).
     uLayout 0: a roll (carpet, sheet vinyl, the sample looks), the photo repeated at its real size.
     uLayout 1: planks. The photo holds uN boards lengthwise; each board on the floor takes one of them,
                some turned end for end, rows staggered, a fine dark joint between boards.
     uLayout 2: tiles, one photo per tile, some turned, with grout lines. */
  var FS = (deriv ? "#extension GL_OES_standard_derivatives : enable\n" : "") + (lod ? "#extension GL_EXT_shader_texture_lod : enable\n" : "") +
    "precision highp float;uniform sampler2D uPhoto,uFloor,uAdd,uKeep,uLight;uniform mat3 uH;uniform vec2 uImg,uRoom,uUnit;" +
    "uniform float uRot,uShade,uAvg,uOn,uLayout,uN,uPL,uSeam,uTurn;uniform vec3 uGrout;varying vec2 vImg;" +
    "float h1(float n){return fract(sin(n*91.3458)*47453.5453);}" +
    "float h2(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}" +
    "vec3 tex(vec2 t,vec2 gx,vec2 gy){" + (lod ? "return texture2DGradEXT(uFloor,t,gx,gy).rgb;" : "return texture2D(uFloor,t).rgb;") + "}" +
    "float aa(float e,float w){" + (deriv ? "float px=max(fwidth(e),1e-6);" : "float px=w*0.5;") +
    "return (1.0-smoothstep(w-px*0.5,w+px*0.5,e))*clamp(2.0*w/px,0.2,1.0);}" +
    "void main(){vec2 st=vImg/uImg;vec3 ph=texture2D(uPhoto,st).rgb;vec3 p=uH*vec3(vImg,1.0);vec2 uv=p.xy/p.z;" +
    "float d=min(min(uv.x,1.0-uv.x),min(uv.y,1.0-uv.y));" +
    (deriv ? "float w=max(fwidth(d),1e-5)*1.2;" : "float w=0.003;") +
    "float inside=smoothstep(0.0,w,d)*step(0.0,p.z);" +
    "float area=clamp(max(inside,texture2D(uAdd,st).a)-texture2D(uKeep,st).a,0.0,1.0)*step(0.0,p.z);" +
    "vec2 m=uv*uRoom;if(uRot>0.5)m=vec2(m.y,-m.x);" +
    (deriv ? "vec2 dx=dFdx(m),dy=dFdy(m);" : "vec2 dx=vec2(0.0),dy=vec2(0.0);") +
    "vec3 fl;" +
    "if(uLayout<0.5){fl=texture2D(uFloor,m/uUnit).rgb;}" +
    "else if(uLayout<1.5){" +
      "float row=floor(m.y/uUnit.y);float x=m.x+h1(row+0.5)*uUnit.x;float col=floor(x/uUnit.x);" +
      "vec2 loc=vec2(fract(x/uUnit.x),fract(m.y/uUnit.y));float id=h2(vec2(row,col));" +
      "float k=min(floor(id*uN),uN-1.0);vec2 l=loc;if(fract(id*17.13)>0.5)l=1.0-l;" +
      "float tx=uPL>=0.999?l.x:fract(l.x/uPL+fract(id*5.71));" +
      "vec2 sc=vec2(1.0/(uUnit.x*uPL),1.0/(uUnit.y*uN));" +
      "fl=tex(vec2(tx,(k+l.y)/uN),dx*sc,dy*sc)*(0.95+0.1*fract(id*31.7));" +
      "vec2 e=min(loc,1.0-loc)*uUnit;fl*=1.0-0.45*max(aa(e.x,uSeam),aa(e.y,uSeam));}" +
    "else{" +
      "vec2 c=floor(m/uUnit);vec2 loc=fract(m/uUnit);float id=h2(c);vec2 l=loc;" +
      "if(uTurn>0.5){if(fract(id*7.31)>0.5)l=1.0-l;if(uTurn>1.5&&fract(id*3.17)>0.5)l=vec2(l.y,1.0-l.x);}" +
      "vec2 sc=1.0/uUnit;fl=tex(l,dx*sc,dy*sc);" +
      "vec2 e=min(loc,1.0-loc)*uUnit;fl=mix(fl,uGrout,max(aa(e.x,uSeam),aa(e.y,uSeam)));}" +
    "float l=texture2D(uLight,st).r;float light=mix(1.0,clamp(pow(l/uAvg,0.75),0.38,1.45),uShade);" +
    "gl_FragColor=vec4(mix(ph,fl*light,area*uOn),1.0);}";
  function shader(type, src){ var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
  var prog = gl.createProgram();
  gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog); gl.useProgram(prog);
  var U = {}; ["uScale","uOff","uCanvas","uPhoto","uFloor","uAdd","uKeep","uLight","uH","uImg","uRoom","uUnit","uRot","uShade","uAvg","uOn","uLayout","uN","uPL","uSeam","uTurn","uGrout"].forEach(function(n){ U[n] = gl.getUniformLocation(prog, n); });
  var buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  var aPos = gl.getAttribLocation(prog, "aPos"); gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  function texture(unit){ var t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); return t; }
  var T = {photo: texture(0), floor: texture(1), add: texture(2), keep: texture(3), light: texture(4)};
  gl.uniform1i(U.uPhoto, 0); gl.uniform1i(U.uFloor, 1); gl.uniform1i(U.uAdd, 2); gl.uniform1i(U.uKeep, 3); gl.uniform1i(U.uLight, 4);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  function upload(unit, tex, source){ gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source); }

  /* paint layers, at up to 1024 px */
  var addC = document.createElement("canvas"), keepC = document.createElement("canvas"), addX = addC.getContext("2d"), keepX = keepC.getContext("2d");
  var photoC = document.createElement("canvas");
  var avgLight = 0.5;

  /* ---------- Geometry ---------- */
  function solve(A, b){ /* Gaussian elimination, n x n */
    var n = b.length;
    for (var i = 0; i < n; i++){
      var m = i; for (var r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[m][i])) m = r;
      var tA = A[i]; A[i] = A[m]; A[m] = tA; var tb = b[i]; b[i] = b[m]; b[m] = tb;
      for (r = i + 1; r < n; r++){ var f = A[r][i]/A[i][i]; for (var c = i; c < n; c++) A[r][c] -= f*A[i][c]; b[r] -= f*b[i]; }
    }
    var x = new Array(n);
    for (i = n - 1; i >= 0; i--){ var s = b[i]; for (c = i + 1; c < n; c++) s -= A[i][c]*x[c]; x[i] = s/A[i][i]; }
    return x;
  }
  function homography(src){ /* image px -> unit square, corners TL TR BR BL */
    var dst = [[0,0],[1,0],[1,1],[0,1]], A = [], b = [];
    for (var i = 0; i < 4; i++){
      var x = src[i][0], y = src[i][1], u = dst[i][0], v = dst[i][1];
      A.push([x, y, 1, 0, 0, 0, -u*x, -u*y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v*x, -v*y]); b.push(v);
    }
    var h = solve(A, b); h.push(1);
    var cx = (src[0][0] + src[1][0] + src[2][0] + src[3][0])/4, cy = (src[0][1] + src[1][1] + src[2][1] + src[3][1])/4;
    if (h[6]*cx + h[7]*cy + h[8] < 0) h = h.map(function(v){ return -v; });
    return h;
  }
  /* Width/height of the marked rectangle, from its perspective (Zhang & He, 2007). */
  function aspect(q){
    var u0 = S.iw/2, v0 = S.ih/2;
    function P(p){ return [p[0], p[1], 1]; }
    function cross(a, b){ return [a[1]*b[2] - a[2]*b[1], a[2]*b[0] - a[0]*b[2], a[0]*b[1] - a[1]*b[0]]; }
    function dot(a, b){ return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }
    var m1 = P(q[0]), m2 = P(q[1]), m3 = P(q[3]), m4 = P(q[2]);
    var k2 = dot(cross(m1, m4), m3)/dot(cross(m2, m4), m3), k3 = dot(cross(m1, m4), m2)/dot(cross(m3, m4), m2);
    var n2 = [k2*m2[0] - m1[0], k2*m2[1] - m1[1], k2 - 1], n3 = [k3*m3[0] - m1[0], k3*m3[1] - m1[1], k3 - 1];
    var f2 = -((n2[0] - n2[2]*u0)*(n3[0] - n3[2]*u0) + (n2[1] - n2[2]*v0)*(n3[1] - n3[2]*v0))/(n2[2]*n3[2]);
    var guess = Math.pow(Math.max(S.iw, S.ih)*0.85, 2);
    if (!(f2 > guess*0.08 && f2 < guess*25)) f2 = guess;
    var f = Math.sqrt(f2);
    function len(n){ var a = (n[0] - n[2]*u0)/f, b = (n[1] - n[2]*v0)/f; return a*a + b*b + n[2]*n[2]; }
    var r = Math.sqrt(len(n2)/len(n3));
    return isFinite(r) && r > 0.08 && r < 12 ? r : 1;
  }
  function insideQuad(x, y, q){
    var s = 0;
    for (var i = 0; i < 4; i++){ var a = q[i], b = q[(i + 1) % 4], c = (b[0] - a[0])*(y - a[1]) - (b[1] - a[1])*(x - a[0]); if (c !== 0){ if (s === 0) s = c > 0 ? 1 : -1; else if ((c > 0 ? 1 : -1) !== s) return false; } }
    return true;
  }

  /* ---------- The room's light, blurred so the old floor's grain doesn't show through ---------- */
  var lightW = 0, lightH = 0, lightData = null;
  function makeLight(){
    lightW = 160; lightH = Math.max(1, Math.round(160*S.ih/S.iw));
    var c = document.createElement("canvas"); c.width = lightW; c.height = lightH;
    var x = c.getContext("2d"); x.drawImage(photoC, 0, 0, lightW, lightH);
    var d = x.getImageData(0, 0, lightW, lightH).data, L = new Float32Array(lightW*lightH);
    for (var i = 0; i < L.length; i++) L[i] = (0.2126*d[i*4] + 0.7152*d[i*4 + 1] + 0.0722*d[i*4 + 2])/255;
    for (var pass = 0; pass < 2; pass++){ L = blur(L, lightW, lightH, 2, true); L = blur(L, lightW, lightH, 2, false); }
    lightData = L;
    var bytes = new Uint8Array(L.length); for (i = 0; i < L.length; i++) bytes[i] = Math.max(0, Math.min(255, Math.round(L[i]*255)));
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, T.light);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, lightW, lightH, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, bytes);
  }
  function blur(src, w, h, r, horiz){
    var out = new Float32Array(src.length);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++){
      var s = 0, n = 0;
      for (var k = -r; k <= r; k++){ var xx = horiz ? x + k : x, yy = horiz ? y : y + k; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; s += src[yy*w + xx]; n++; }
      out[y*w + x] = s/n;
    }
    return out;
  }
  function measureLight(){
    if (!lightData) return;
    var s = 0, n = 0;
    for (var y = 0; y < lightH; y++) for (var x = 0; x < lightW; x++){
      var ix = (x + 0.5)/lightW*S.iw, iy = (y + 0.5)/lightH*S.ih;
      if (insideQuad(ix, iy, S.quad)){ s += lightData[y*lightW + x]; n++; }
    }
    avgLight = n ? Math.max(0.05, s/n) : 0.5;
  }

  /* ---------- Drawing ---------- */
  var view = {s: 1, ox: 0, oy: 0, cw: 1, ch: 1};
  function fit(){
    var r = wrap.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    view.cw = Math.max(1, r.width); view.ch = Math.max(1, r.height);
    cv.width = Math.round(view.cw*dpr); cv.height = Math.round(view.ch*dpr);
    view.s = Math.min(view.cw/S.iw, view.ch/S.ih); view.ox = (view.cw - S.iw*view.s)/2; view.oy = (view.ch - S.ih*view.s)/2;
    svg.setAttribute("viewBox", "0 0 " + view.cw + " " + view.ch);
    draw(); placeHandles();
  }
  function setUniforms(cw, ch, s, ox, oy){
    gl.uniform2f(U.uCanvas, cw, ch); gl.uniform2f(U.uScale, s, s); gl.uniform2f(U.uOff, ox, oy);
    gl.uniform2f(U.uImg, S.iw, S.ih);
    var h = homography(S.quad);
    gl.uniformMatrix3fv(U.uH, false, new Float32Array([h[0], h[3], h[6], h[1], h[4], h[7], h[2], h[5], h[8]]));
    var r = aspect(S.quad), L = layoutOf(S.floor);
    gl.uniform2f(U.uRoom, S.widthM/S.size, S.widthM/r/S.size);
    gl.uniform2f(U.uUnit, L.unit[0], L.unit[1]);
    gl.uniform1f(U.uLayout, L.kind); gl.uniform1f(U.uN, L.n); gl.uniform1f(U.uPL, L.pl); gl.uniform1f(U.uSeam, L.seam); gl.uniform1f(U.uTurn, L.turn);
    gl.uniform3f(U.uGrout, L.grout[0], L.grout[1], L.grout[2]);
    /* planks run away from you unless turned; some photos have their boards lying across */
    gl.uniform1f(U.uRot, (S.rot !== L.across) ? 1 : 0); gl.uniform1f(U.uShade, 0.8); gl.uniform1f(U.uAvg, avgLight);
    gl.uniform1f(U.uOn, S.floor && S.floor.ready && !S.before && convex(S.quad) ? 1 : 0);
  }
  /* the four corners must make a shape that doesn't fold over itself */
  function convex(q){
    var sign = 0;
    for (var i = 0; i < 4; i++){
      var a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
      var z = (b[0] - a[0])*(c[1] - b[1]) - (b[1] - a[1])*(c[0] - b[0]);
      if (Math.abs(z) < 1e-6) return false;
      if (!sign) sign = z > 0 ? 1 : -1; else if ((z > 0 ? 1 : -1) !== sign) return false;
    }
    return true;
  }
  var crossedSaid = false;
  function draw(){
    if (!S.quad) return;
    var ok = convex(S.quad);
    if (!ok && !crossedSaid){ say("Two corners have crossed. Drag them back so the dots go around the floor."); crossedSaid = true; }
    else if (ok && crossedSaid){ say(""); crossedSaid = false; }
    gl.viewport(0, 0, cv.width, cv.height);
    gl.clearColor(0.106, 0.098, 0.086, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, S.iw, 0, 0, S.ih, S.iw, S.ih]), gl.DYNAMIC_DRAW);
    setUniforms(view.cw, view.ch, view.s, view.ox, view.oy);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  var pending = false, paintDirty = false;
  function redraw(){ if (pending) return; pending = true; requestAnimationFrame(function(){ pending = false; if (paintDirty){ paintDirty = false; upload(2, T.add, addC); upload(3, T.keep, keepC); } draw(); }); }

  /* ---------- Corners ---------- */
  var handles = [];
  for (var i = 0; i < 4; i++){
    var hb = document.createElement("button"); hb.type = "button"; hb.className = "handle"; hb.setAttribute("aria-label", ["Far left corner", "Far right corner", "Near right corner", "Near left corner"][i]);
    wrap.appendChild(hb); handles.push(hb); drag(hb, i);
  }
  function toScreen(p){ return [view.ox + p[0]*view.s, view.oy + p[1]*view.s]; }
  function toImage(x, y){ return [(x - view.ox)/view.s, (y - view.oy)/view.s]; }
  function placeHandles(){
    if (!S.quad) return;
    var pts = S.quad.map(toScreen);
    handles.forEach(function(h, i){ h.style.left = pts[i][0] + "px"; h.style.top = pts[i][1] + "px"; });
    quadline.setAttribute("points", pts.map(function(p){ return p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" "));
    quadline.style.display = S.mode === "corners" ? "" : "none";
  }
  function drag(h, i){
    var id = null;
    h.addEventListener("pointerdown", function(e){ id = e.pointerId; h.setPointerCapture(id); e.preventDefault(); });
    h.addEventListener("pointermove", function(e){
      if (e.pointerId !== id) return;
      var r = wrap.getBoundingClientRect(), p = toImage(e.clientX - r.left, e.clientY - r.top);
      p[0] = Math.max(0, Math.min(S.iw, p[0])); p[1] = Math.max(0, Math.min(S.ih, p[1]));
      S.quad[i] = p; placeHandles(); redraw();
    });
    function end(e){ if (e.pointerId !== id) return; id = null; measureLight(); redraw(); }
    h.addEventListener("pointerup", end); h.addEventListener("pointercancel", end);
    h.addEventListener("keydown", function(e){
      var step = 4/view.s, d = {ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step]}[e.key];
      if (!d) return; e.preventDefault(); S.quad[i] = [Math.max(0, Math.min(S.iw, S.quad[i][0] + d[0])), Math.max(0, Math.min(S.ih, S.quad[i][1] + d[1]))]; placeHandles(); measureLight(); redraw();
    });
  }

  /* ---------- Painting ---------- */
  var painting = null;
  function brushR(){ return parseFloat($("brush").value)/view.s*(addC.width/S.iw); }
  function paintAt(x, y, prev){
    var r = wrap.getBoundingClientRect(), p = toImage(x - r.left, y - r.top), k = addC.width/S.iw;
    var px = p[0]*k, py = p[1]*k, rad = brushR();
    var on = S.mode === "add" ? addX : keepX, off = S.mode === "add" ? keepX : addX;
    [on, off].forEach(function(ctx, j){
      ctx.globalCompositeOperation = j ? "destination-out" : "source-over";
      ctx.fillStyle = "#000"; ctx.strokeStyle = "#000"; ctx.lineWidth = rad*2; ctx.lineCap = "round";
      ctx.beginPath();
      if (prev){ ctx.moveTo(prev[0], prev[1]); ctx.lineTo(px, py); ctx.stroke(); }
      else { ctx.arc(px, py, rad, 0, Math.PI*2); ctx.fill(); }
    });
    paintDirty = true; redraw();
    return [px, py];
  }
  cv.addEventListener("pointerdown", function(e){
    if (S.mode === "corners") return;
    cv.setPointerCapture(e.pointerId); painting = {id: e.pointerId, last: paintAt(e.clientX, e.clientY, null)}; e.preventDefault();
  });
  cv.addEventListener("pointermove", function(e){ if (painting && e.pointerId === painting.id) painting.last = paintAt(e.clientX, e.clientY, painting.last); });
  function stopPaint(){ painting = null; }
  cv.addEventListener("pointerup", stopPaint); cv.addEventListener("pointercancel", stopPaint);

  function setMode(m){
    S.mode = m;
    document.querySelectorAll(".seg button").forEach(function(b){ b.setAttribute("aria-pressed", b.getAttribute("data-mode") === m ? "true" : "false"); });
    wrap.classList.toggle("painting", m !== "corners");
    $("brushwrap").hidden = m === "corners"; $("clearpaint").hidden = m === "corners";
    help.textContent = HELP[m]; placeHandles();
  }
  document.querySelectorAll(".seg button").forEach(function(b){ b.addEventListener("click", function(){ setMode(b.getAttribute("data-mode")); }); });
  $("clearpaint").addEventListener("click", function(){
    addX.clearRect(0, 0, addC.width, addC.height); keepX.clearRect(0, 0, keepC.width, keepC.height); presetArea();
    upload(2, T.add, addC); upload(3, T.keep, keepC); redraw();
  });

  /* ---------- Loading a room ---------- */
  function useImage(img, preset){
    var max = 2048, sc = Math.min(1, max/Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
    S.iw = Math.round((img.naturalWidth || img.width)*sc); S.ih = Math.round((img.naturalHeight || img.height)*sc);
    photoC.width = S.iw; photoC.height = S.ih; photoC.getContext("2d").drawImage(img, 0, 0, S.iw, S.ih);
    upload(0, T.photo, photoC);
    var mk = Math.min(1, 1024/Math.max(S.iw, S.ih));
    [addC, keepC].forEach(function(c){ c.width = Math.round(S.iw*mk); c.height = Math.round(S.ih*mk); });
    addX.clearRect(0, 0, addC.width, addC.height); keepX.clearRect(0, 0, keepC.width, keepC.height);
    S.widthM = preset ? preset.widthM : 3.6;
    S.preset = preset;
    if (preset){
      var k = S.iw/preset.w;
      S.quad = preset.quad.map(function(p){ return [p[0]*k, p[1]*k]; });
      presetArea();
    } else {
      S.quad = [[S.iw*0.27, S.ih*0.6], [S.iw*0.73, S.ih*0.6], [S.iw*0.97, S.ih*0.97], [S.iw*0.03, S.ih*0.97]];
    }
    upload(2, T.add, addC); upload(3, T.keep, keepC);
    makeLight(); measureLight(); fit();
  }
  function presetArea(){
    var pr = S.preset; if (!pr) return;
    var k = S.iw/pr.w*addC.width/S.iw;
    addX.globalCompositeOperation = "source-over"; addX.fillStyle = "#000"; addX.beginPath();
    pr.area.forEach(function(p, i){ var x = p[0]*k, y = p[1]*k; if (i) addX.lineTo(x, y); else addX.moveTo(x, y); });
    addX.closePath(); addX.fill();
  }
  function loadRoom(n){
    S.room = n % ROOMS.length; S.user = false; var room = ROOMS[S.room];
    var img = new Image(); img.onload = function(){ useImage(img, room); setMode("corners"); help.textContent = "This is a sample room. Tap a floor on the side, or use a picture of your own room."; };
    img.src = room.src;
  }
  $("nextroom").addEventListener("click", function(){ loadRoom(S.user ? S.room : S.room + 1); $("nextroom").textContent = "Another sample room"; });
  $("photo").addEventListener("change", function(e){
    var f = e.target.files && e.target.files[0]; if (!f) return;
    var url = URL.createObjectURL(f), img = new Image();
    img.onload = function(){ S.user = true; useImage(img, null); URL.revokeObjectURL(url); setMode("corners"); $("nextroom").textContent = "Back to a sample room"; say(""); };
    img.onerror = function(){ say("That picture couldn't be opened. Try a JPG or PNG photo."); };
    img.src = url; e.target.value = "";
  });

  /* ---------- Floors ---------- */
  var IN = 0.0254;
  function hex(c){ var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c || ""); return m ? [parseInt(m[1], 16)/255, parseInt(m[2], 16)/255, parseInt(m[3], 16)/255] : [0.74, 0.71, 0.67]; }
  /* How a product's photo is laid, in metres (see the shader). */
  function layoutOf(f){
    var ph = (f && f.photo) || {}, asp = ph.aspect || (f && f.img ? f.img.naturalWidth/f.img.naturalHeight : 1) || 1;
    var out = {kind: 0, unit: [2, 2], n: 1, pl: 1, seam: 0.0004, turn: 0, grout: [0.74, 0.71, 0.67], across: !!ph.across};
    if (ph.layout === "plank"){
      var pw = (ph.plankIn || [7, 48]);
      out.kind = 1; out.unit = [pw[1]*IN, pw[0]*IN]; out.n = Math.max(1, ph.planks || 1);
      out.pl = Math.min(1, (ph.photoLengthIn || pw[1])/pw[1]);
      out.seam = (ph.jointIn || 0.03)*IN;
      out.across = !ph.across;   /* the photo's boards lie left to right; on the floor they run away from you */
    } else if (ph.layout === "tile"){
      var tw = (ph.tileIn || [12, 12]);
      out.kind = 2; out.unit = [tw[1]*IN, tw[0]*IN]; out.seam = Math.max(0.0003, (ph.groutIn == null ? 0.125 : ph.groutIn)*IN/2);
      out.turn = ph.turn === false ? 0 : (tw[0] === tw[1] ? 2 : 1); out.grout = hex(ph.grout || "#BDB6AA");
    } else {
      var wm = ph.widthM || (ph.widthIn ? ph.widthIn*IN : 2);
      out.unit = [wm, wm/asp];
    }
    return out;
  }
  /* WebGL 1 repeats and smooths only pictures whose sides are powers of two */
  function pow2(n){ var p = 1; while (p*2 <= n*1.33 && p < 2048) p *= 2; return Math.max(64, p); }
  function prepared(img){
    var w = pow2(img.naturalWidth), h = pow2(img.naturalHeight);
    if (w === img.naturalWidth && h === img.naturalHeight) return img;
    var c = document.createElement("canvas"); c.width = w; c.height = h;
    var x = c.getContext("2d"); x.imageSmoothingQuality = "high"; x.drawImage(img, 0, 0, w, h); return c;
  }
  function chooseFloor(f){
    var B = window.KnockelsShelf, pr = B.priceOf(f), el = $("chosen"); el.innerHTML = "";
    var what = [f.name, [B.brandName(f.brand), f.collection].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    var price = pr ? "$" + pr.now.toFixed(2) + " a " + pr.unit + (pr.installed ? " installed" + (pr.unit === "sq yd" ? " ($" + (pr.now/9).toFixed(2) + " a sq ft)" : "") : "") + (pr.was ? ", on sale from $" + pr.was.toFixed(2) : "") : "";
    if (pr && !pr.installed && typeof f.priceInstalled === "number") price += ", $" + f.priceInstalled.toFixed(2) + " installed" + (f.wasInstalled > f.priceInstalled ? ", on sale from $" + f.wasInstalled.toFixed(2) : "");
    var more = B.details ? B.details(f) : [];
    var line = [what, price].concat(more).filter(Boolean).join(". ") + (!more.length && f.inStock ? ". In stock" : "") + ". ";
    el.appendChild(document.createTextNode(line));
    var a = document.createElement("a"); a.href = "tel:+15635392772"; a.textContent = "Call 563-539-2772"; el.appendChild(a);
    el.appendChild(document.createTextNode(f.type === "look" ? " and ask about floors like this one." : " to order it or see the sample."));
    /* a floor without its picture yet: the room keeps the floor it has */
    if (!(f.photo && f.photo.image)){ say("There’s no picture of this floor yet. Call and we’ll show you the sample."); return; }
    S.floor = f;
    var lk = layoutOf(f).kind;
    $("turn").textContent = lk === 1 || (f.type === "look" && f.look === "wood") ? "Turn the planks" : lk === 2 ? "Turn the tiles" : "Turn the pattern";
    if (cache[f.id]){ f.ready = true; bindFloor(cache[f.id], f); return; }
    f.ready = false; redraw();
    var img = new Image();
    img.onload = function(){ f.img = img; cache[f.id] = prepared(img); if (S.floor === f){ f.ready = true; bindFloor(cache[f.id], f); } };
    img.onerror = function(){ if (S.floor === f) say("That floor's picture couldn't be loaded. Try another, or reload the page."); };
    img.src = f.photo.image;
  }
  function bindFloor(src, f){
    var L = layoutOf(f), wrapMode = L.kind ? gl.CLAMP_TO_EDGE : (f.photo.seamless === false ? gl.MIRRORED_REPEAT : gl.REPEAT);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, T.floor);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapMode); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrapMode);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    say(""); redraw();
  }
  window.KnockelsShelf.start(chooseFloor).catch(function(){ say("The floor samples couldn't be loaded. Check the connection and reload the page."); });

  /* ---------- Tools ---------- */
  $("turn").addEventListener("click", function(){ S.rot = !S.rot; redraw(); });
  $("size").addEventListener("input", function(){ S.size = Math.pow(2, parseFloat(this.value)/100); redraw(); });
  var bf = $("before");
  function holdOn(e){ e.preventDefault(); S.before = true; redraw(); }
  function holdOff(){ if (!S.before) return; S.before = false; redraw(); }
  bf.addEventListener("pointerdown", holdOn); bf.addEventListener("pointerup", holdOff); bf.addEventListener("pointerleave", holdOff); bf.addEventListener("pointercancel", holdOff);
  bf.addEventListener("keydown", function(e){ if (e.key === " " || e.key === "Enter"){ S.before = true; redraw(); } });
  bf.addEventListener("keyup", holdOff);
  bf.addEventListener("contextmenu", function(e){ e.preventDefault(); });
  bf.style.webkitUserSelect = bf.style.userSelect = "none"; bf.style.webkitTouchCallout = "none"; bf.style.touchAction = "none";

  function download(blob, name){
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  $("save").addEventListener("click", function(){
    /* draw once at the photo's own size, then hand it over */
    var w = cv.width, h = cv.height, big = Math.min(1, 2048/Math.max(S.iw, S.ih));
    cv.width = Math.round(S.iw*big); cv.height = Math.round(S.ih*big);
    gl.viewport(0, 0, cv.width, cv.height); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, S.iw, 0, 0, S.ih, S.iw, S.ih]), gl.DYNAMIC_DRAW);
    setUniforms(S.iw, S.ih, 1, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    var name = "Knockels-" + (S.floor ? S.floor.id : "floor") + ".jpg";
    cv.toBlob(function(blob){
      cv.width = w; cv.height = h; draw();
      if (!blob) return;
      var file = null; try { file = new File([blob], name, {type: "image/jpeg"}); } catch(e){}
      if (file && navigator.canShare && navigator.canShare({files: [file]})){
        navigator.share({files: [file], title: "My room with " + (S.floor ? S.floor.name : "a new floor")}).catch(function(e){ if (!e || e.name !== "AbortError") download(blob, name); });
      } else download(blob, name);
    }, "image/jpeg", 0.9);
  });

  cv.addEventListener("webglcontextlost", function(e){ e.preventDefault(); say("Reloading the picture…"); });
  cv.addEventListener("webglcontextrestored", function(){ location.reload(); });
  window.addEventListener("resize", fit);
  if (window.ResizeObserver) new ResizeObserver(fit).observe(wrap);
  /* for checking the drawing without a screen */
  window.KnockelsRoom = {state: S, choose: chooseFloor, layoutOf: layoutOf, draw: draw};
  loadRoom(0);
})();
