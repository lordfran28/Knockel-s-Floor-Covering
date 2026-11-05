/* Knockel's: try a floor in your room.
   Everything happens on the visitor's device. The four corners mark a rectangle on the floor; from
   them the page works out the plane of the floor and its perspective. Then it finds the floor itself
   the way a green screen works: it learns the colours of the floor inside the corners and, everywhere on
   that plane, swaps in the chosen sample only where the photo still shows that floor and it joins up with
   the marked part. Furniture, rugs, people and walls stay in front, and the room keeps its own light and
   shadows. The same works on the live camera. Painting fixes anything the finder got wrong. */
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
  var cam = {on: false, video: null, stream: null, n: 0};
  var S = {room: 0, iw: 1, ih: 1, quad: null, floor: null, rot: false, size: 1, mode: "corners", before: false, user: false, widthM: 3.6};
  var cache = {};

  function say(t){ msgEl.textContent = t || ""; msgEl.hidden = !t; }
  var HELP = {
    corners: "Drag the yellow dots to the corners of the floor, where it meets the walls; the near two can sit at the bottom of the picture. The new floor goes only where the old one shows, so furniture stays in front.",
    keep: "Paint over anything the new floor still covers, to keep it as it is.",
    add: "Paint any floor that didn’t change, like a patch of sun or a doorway past the corners."
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
    "precision highp float;uniform sampler2D uPhoto,uFloor,uAdd,uKeep,uLight,uGate;uniform mat3 uH;uniform vec2 uImg,uRoom,uUnit;" +
    "uniform vec3 uMu[4],uIs[4];uniform float uK,uT,uKey;" +
    "vec3 ycc(vec3 c){float y=dot(c,vec3(0.299,0.587,0.114));return vec3(y,(c.b-y)*0.564,(c.r-y)*0.713);}" +
    "uniform float uRot,uShade,uAvg,uOn,uLayout,uN,uPL,uSeam,uTurn,uBreak;uniform vec3 uGrout,uMean;uniform vec4 uWin;varying vec2 vImg;" +
    "float h1(float n){return fract(sin(n*91.3458)*47453.5453);}" +
    "float h2(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}" +
    "vec3 tex(vec2 t,vec2 gx,vec2 gy){" + (lod ? "return texture2DGradEXT(uFloor,t,gx,gy).rgb;" : "return texture2D(uFloor,t).rgb;") + "}" +
    /* Carpet: the floor is cut into small overlapping pieces, each taken from a different spot of the untouched
       middle of the sample photo, so no spot of the photo lines up in rows across the room. Where two pieces
       meet they are mixed so the fibres keep their contrast instead of going soft. */
    "vec3 roll(vec2 m,vec2 dx,vec2 dy){vec2 sc=1.0/uUnit;if(uBreak<0.5)return tex(m*sc,dx*sc,dy*sc);" +
      "float cell=0.42,band=0.16,slack=1.0-cell*(1.0+2.0*band);vec2 C=uUnit*uWin.zw*cell;" +
      "vec2 g=m/C;vec2 i0=floor(g);vec2 t=g-i0;vec2 b=smoothstep(0.5-band,0.5+band,t);" +
      "vec3 s=vec3(0.0);float ww=0.0;" +
      "for(int k=0;k<4;k++){vec2 o=vec2(mod(float(k),2.0),floor(float(k)/2.0));vec2 id=i0+o;" +
        "vec2 wv=mix(1.0-b,b,o);float w=wv.x*wv.y;" +
        "vec2 r=vec2(h2(id+0.37),h2(id.yx+5.17));" +
        "vec2 tc=uWin.xy+uWin.zw*(0.5+(r-0.5)*slack)+(g-id)*C*sc;" +
        "s+=w*(tex(tc,dx*sc,dy*sc)-uMean);ww+=w*w;}" +
      "return clamp(uMean+s/sqrt(max(ww,1e-4)),0.0,1.0);}" +
    "float aa(float e,float w){" + (deriv ? "float px=max(fwidth(e),1e-6);" : "float px=w*0.5;") +
    "return (1.0-smoothstep(w-px*0.5,w+px*0.5,e))*clamp(2.0*w/px,0.2,1.0);}" +
    "void main(){vec2 st=vImg/uImg;vec3 ph=texture2D(uPhoto,st).rgb;vec3 p=uH*vec3(vImg,1.0);vec2 uv=p.xy/p.z;" +
    "float d=min(min(uv.x,1.0-uv.x),min(uv.y,1.0-uv.y));" +
    (deriv ? "float w=max(fwidth(d),1e-5)*1.2;" : "float w=0.003;") +
    "float inside=smoothstep(0.0,w,d)*step(0.0,p.z);" +
    /* the green screen: how near this pixel is to one of the old floor's colours, softened over a few pixels,
       and only where the floor joins up with the marked part (uGate, worked out at low size on the device) */
    "float key=inside;if(uKey>0.5){vec2 o=1.5/uImg;" +
      "vec3 sm=(ph+texture2D(uPhoto,st+vec2(o.x,0.0)).rgb+texture2D(uPhoto,st-vec2(o.x,0.0)).rgb+texture2D(uPhoto,st+vec2(0.0,o.y)).rgb+texture2D(uPhoto,st-vec2(0.0,o.y)).rgb)*0.2;" +
      "vec3 f=ycc(sm);float dm=1e6;for(int k=0;k<4;k++){if(float(k)<uK){vec3 z=(f-uMu[k])*uIs[k];dm=min(dm,dot(z,z));}}" +
      "key=(1.0-smoothstep(uT*0.6,uT*1.5,dm))*texture2D(uGate,st).r;}" +
    "float area=clamp(max(key,texture2D(uAdd,st).a)-texture2D(uKeep,st).a,0.0,1.0)*step(0.0,p.z);" +
    "vec2 m=uv*uRoom;if(uRot>0.5)m=vec2(m.y,-m.x);" +
    (deriv ? "vec2 dx=dFdx(m),dy=dFdy(m);" : "vec2 dx=vec2(0.0),dy=vec2(0.0);") +
    "vec3 fl;" +
    "if(uLayout<0.5){fl=roll(m,dx,dy);}" +
    "else if(uLayout<1.5){" +
      "float row=floor(m.y/uUnit.y);float x=m.x+h1(row+0.5)*uUnit.x;float col=floor(x/uUnit.x);" +
      "vec2 loc=vec2(fract(x/uUnit.x),fract(m.y/uUnit.y));float id=h2(vec2(row,col));" +
      "float k=min(floor(id*uN),uN-1.0);vec2 l=loc;if(fract(id*17.13)>0.5)l=1.0-l;" +
      "float tx=uPL>=0.999?l.x:fract(l.x/uPL+fract(id*5.71));" +
      "vec2 sc=vec2(1.0/(uUnit.x*uPL),1.0/(uUnit.y*uN));" +
      "fl=tex(vec2(tx,(k+l.y)/uN),dx*sc,dy*sc)*(0.95+0.1*fract(id*31.7));" +
      "vec2 e=min(loc,1.0-loc)*uUnit;fl*=1.0-0.45*max(aa(e.x,uSeam),aa(e.y,uSeam));}" +
    "else if(uLayout<2.5){" +
      "vec2 c=floor(m/uUnit);vec2 loc=fract(m/uUnit);float id=h2(c);vec2 l=loc;" +
      "if(uTurn>0.5){if(fract(id*7.31)>0.5)l=1.0-l;if(uTurn>1.5&&fract(id*3.17)>0.5)l=vec2(l.y,1.0-l.x);}" +
      "vec2 sc=1.0/uUnit;fl=tex(l,dx*sc,dy*sc);" +
      "vec2 e=min(loc,1.0-loc)*uUnit;fl=mix(fl,uGrout,max(aa(e.x,uSeam),aa(e.y,uSeam)));}" +
    /* herringbone: boards uUnit.x long and uUnit.y wide, n = length/width, the zigzag running across the room.
       In board widths, turned 45 degrees, a lying board covers [0,n)x[0,1) and a standing one [n,n+1)x[0,n),
       repeated by (1,-1) and (n,n); each point belongs to exactly one board. */
    "else{" +
      "float n=max(2.0,floor(uUnit.x/uUnit.y+0.5));vec2 q=m/uUnit.y;q=vec2(q.x+q.y,q.y-q.x)*0.70710678;" +
      "float Y=floor(q.y);float j=floor((q.x+Y)/(2.0*n));float rx=q.x+Y-2.0*n*j;vec2 L;vec2 cid;" +
      "if(rx<n){L=vec2(rx/n,q.y-Y);cid=vec2(j,Y);}" +
      "else{float X=floor(q.x);j=floor((q.y+X-n)/(2.0*n));L=vec2((q.y+X-n-2.0*n*j)/n,q.x-X);cid=vec2(j+0.5,X);}" +
      "float id=h2(cid*vec2(1.37,0.71));float k=min(floor(id*uN),uN-1.0);vec2 l=L;if(fract(id*17.13)>0.5)l=1.0-l;" +
      "vec2 sc=vec2(1.0/(n*uUnit.y),1.0/(uUnit.y*uN));" +
      "fl=tex(vec2(l.x,(k+l.y)/uN),dx*sc,dy*sc)*(0.95+0.1*fract(id*31.7));" +
      "vec2 e=vec2(min(L.x,1.0-L.x)*n,min(L.y,1.0-L.y))*uUnit.y;fl*=1.0-0.45*max(aa(e.x,uSeam),aa(e.y,uSeam));}" +
    "float l=texture2D(uLight,st).r;float light=mix(1.0,clamp(pow(l/uAvg,0.75),0.38,1.45),uShade);" +
    "gl_FragColor=vec4(mix(ph,fl*light,area*uOn),1.0);}";
  function shader(type, src){ var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
  var prog = gl.createProgram();
  gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog); gl.useProgram(prog);
  var U = {}; ["uScale","uOff","uCanvas","uPhoto","uFloor","uAdd","uKeep","uLight","uGate","uH","uImg","uRoom","uUnit","uRot","uShade","uAvg","uOn","uLayout","uN","uPL","uSeam","uTurn","uGrout","uBreak","uMean","uWin","uMu","uIs","uK","uT","uKey"].forEach(function(n){ U[n] = gl.getUniformLocation(prog, n); });
  var buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  var aPos = gl.getAttribLocation(prog, "aPos"); gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  function texture(unit){ var t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); return t; }
  var T = {photo: texture(0), floor: texture(1), add: texture(2), keep: texture(3), light: texture(4), gate: texture(5)};
  gl.uniform1i(U.uPhoto, 0); gl.uniform1i(U.uFloor, 1); gl.uniform1i(U.uAdd, 2); gl.uniform1i(U.uKeep, 3); gl.uniform1i(U.uLight, 4); gl.uniform1i(U.uGate, 5);
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
    var x = c.getContext("2d"); x.drawImage(cam.on ? cam.video : photoC, 0, 0, lightW, lightH);
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
      var on = KEY.gate ? KEY.gate[Math.min(KEY.h - 1, Math.floor((y + 0.5)/lightH*KEY.h))*KEY.w + Math.min(KEY.w - 1, Math.floor((x + 0.5)/lightW*KEY.w))] > 200 : insideQuad(ix, iy, S.quad);
      if (on){ s += lightData[y*lightW + x]; n++; }
    }
    avgLight = n ? Math.max(0.05, s/n) : 0.5;
  }


  /* ---------- Finding the floor ----------
     At low size: the photo's colours as brightness and two colour differences (brightness counts for less,
     so shadows on the floor still count as floor). The colours inside the marked rectangle are grouped into
     up to four kinds (k-means); a pixel is floor-coloured when it is near one of them. The floor is the
     floor-coloured pixels on the floor's side of the horizon that join up with the marked part. */
  var KW = 192, kc = document.createElement("canvas"), kx = kc.getContext("2d", {willReadFrequently: true});
  var KEY = {w: 0, h: 0, F: null, gate: null, mu: [], is: [], ok: false, T: 7};
  var CHW = [0.3, 1, 1], SDMIN = [0.05, 0.01, 0.01], SDMAX = [0.12, 0.03, 0.03];
  /* how far apart two neighbouring pixels may be and still be the same floor: an edge stops the floor */
  var STEP_Y = 0.13, STEP_C = 0.03;
  function features(src, sw, sh){
    var w = KW, h = Math.max(8, Math.round(KW*sh/sw));
    kc.width = w; kc.height = h; kx.drawImage(src, 0, 0, w, h);
    var d = kx.getImageData(0, 0, w, h).data, F = new Float32Array(w*h*3);
    for (var i = 0, j = 0; i < d.length; i += 4, j += 3){
      var r = d[i]/255, g = d[i + 1]/255, b = d[i + 2]/255, y = 0.299*r + 0.587*g + 0.114*b;
      F[j] = y; F[j + 1] = (b - y)*0.564; F[j + 2] = (r - y)*0.713;
    }
    KEY.w = w; KEY.h = h; KEY.F = F;
  }
  function inPoly(x, y, poly){
    var c = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++){
      var a = poly[i], b = poly[j];
      if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0])*(y - a[1])/(b[1] - a[1]) + a[0]) c = !c;
    }
    return c;
  }
  /* pixels taken to be floor: inside the corners, pulled in a little from the edges (or a sample room's floor outline) */
  function seeds(){
    var w = KEY.w, h = KEY.h, out = [], q = S.quad, cx = 0, cy = 0;
    q.forEach(function(p){ cx += p[0]/4; cy += p[1]/4; });
    var inner = q.map(function(p){ return [cx + (p[0] - cx)*0.88, cy + (p[1] - cy)*0.88]; });
    /* a small patch just inside each dot: the dots sit on the floor, so these are the surest floor pixels */
    out.dots = q.map(function(p){
      var a = [cx + (p[0] - cx)*0.92, cy + (p[1] - cy)*0.92], r = Math.max(2, Math.round(w*0.025)), list = [];
      var x0 = Math.round(a[0]/S.iw*w), y0 = Math.round(a[1]/S.ih*h);
      for (var y = y0 - r; y <= y0 + r; y++) for (var x = x0 - r; x <= x0 + r; x++) if (x >= 0 && y >= 0 && x < w && y < h) list.push(y*w + x);
      return list;
    });
    var area = S.preset ? S.preset.area.map(function(p){ return [p[0]*S.iw/S.preset.w, p[1]*S.iw/S.preset.w]; }) : null;
    var pd = painted(), keep = pd.keep, add = pd.add, kk = pd.k;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++){
      var ix = (x + 0.5)/w*S.iw, iy = (y + 0.5)/h*S.ih, at = -1;
      if (keep){ var kx2 = Math.min(pd.w - 1, Math.floor(ix*kk)), ky2 = Math.min(pd.h - 1, Math.floor(iy*kk)); at = (ky2*pd.w + kx2)*4 + 3; if (keep[at] > 64) continue; }
      /* floor painted by hand counts too, so a dab on a patch the finder missed brings in the whole patch */
      if ((area ? inPoly(ix, iy, area) : insideQuad(ix, iy, inner)) || (add && !S.preset && add[at] > 64)) out.push(y*w + x);
    }
    return out;
  }
  function learn(idx, dots){
    var F = KEY.F, n = idx.length;
    if (n < 24){ KEY.ok = false; return; }
    var step = Math.max(1, Math.floor(n/2500)), P = [];
    for (var i = 0; i < n; i += step) P.push(idx[i]);
    var m = P.length, K = Math.min(4, Math.max(1, Math.floor(m/40)));
    function dist(p, c){ var a = (F[p*3] - c[0])*CHW[0]*3, b = (F[p*3 + 1] - c[1])*12, d = (F[p*3 + 2] - c[2])*12; return a*a + b*b + d*d; }
    /* start from the most common colour, then each next start the farthest from those so far */
    var C = [[0, 0, 0]];
    P.forEach(function(p){ C[0][0] += F[p*3]/m; C[0][1] += F[p*3 + 1]/m; C[0][2] += F[p*3 + 2]/m; });
    while (C.length < K){
      var far = -1, fp = P[0];
      P.forEach(function(p){ var dd = Infinity; C.forEach(function(c){ dd = Math.min(dd, dist(p, c)); }); if (dd > far){ far = dd; fp = p; } });
      C.push([F[fp*3], F[fp*3 + 1], F[fp*3 + 2]]);
    }
    var lab = new Int32Array(m);
    for (var it = 0; it < 10; it++){
      var sum = C.map(function(){ return [0, 0, 0, 0]; });
      for (i = 0; i < m; i++){
        var p = P[i], best = 0, bd = Infinity;
        for (var k = 0; k < C.length; k++){ var dd = dist(p, C[k]); if (dd < bd){ bd = dd; best = k; } }
        lab[i] = best; sum[best][0] += F[p*3]; sum[best][1] += F[p*3 + 1]; sum[best][2] += F[p*3 + 2]; sum[best][3]++;
      }
      C = C.map(function(c, k){ return sum[k][3] ? [sum[k][0]/sum[k][3], sum[k][1]/sum[k][3], sum[k][2]/sum[k][3]] : c; });
    }
    /* a colour is the floor's when it is common inside the corners and it is what lies at the dots
       (a sofa or a table can fill much of the rectangle, but the dots sit on the floor) */
    function nearest(p){ var best = 0, bd = Infinity; for (var k = 0; k < C.length; k++){ var dd = dist(p, C[k]); if (dd < bd){ bd = dd; best = k; } } return best; }
    var atDots = C.map(function(){ return 0; });
    (dots || []).forEach(function(list){
      if (!list.length) return;
      var cnt = C.map(function(){ return 0; });
      list.forEach(function(p){ cnt[nearest(p)]++; });
      cnt.forEach(function(c, k){ if (c >= list.length*0.3) atDots[k]++; });
    });
    var mu = [], is = [], best = -1, bestN = -1, stats = [];
    C.forEach(function(c, k){
      var v = [0, 0, 0], cnt = 0;
      for (i = 0; i < m; i++) if (lab[i] === k){ var p = P[i]; for (var ch = 0; ch < 3; ch++){ var e = F[p*3 + ch] - c[ch]; v[ch] += e*e; } cnt++; }
      stats.push([c, v.map(function(x, ch){ return CHW[ch]/Math.min(SDMAX[ch], Math.max(SDMIN[ch], Math.sqrt(x/Math.max(1, cnt)))); })]);
      if (cnt > bestN){ bestN = cnt; best = k; }
      if (cnt < m*0.15 || (dots && atDots[k] < 2)) return;
      mu.push(stats[k][0]); is.push(stats[k][1]);
    });
    if (!mu.length && best >= 0){ mu.push(stats[best][0]); is.push(stats[best][1]); }
    KEY.mu = mu; KEY.is = is; KEY.ok = mu.length > 0;
  }
  function floorish(){
    var F = KEY.F, n = KEY.w*KEY.h, out = new Uint8Array(n), T = KEY.T;
    for (var p = 0; p < n; p++){
      var dm = Infinity;
      for (var k = 0; k < KEY.mu.length; k++){
        var c = KEY.mu[k], s2 = KEY.is[k], a = (F[p*3] - c[0])*s2[0], b = (F[p*3 + 1] - c[1])*s2[1], d = (F[p*3 + 2] - c[2])*s2[2];
        dm = Math.min(dm, a*a + b*b + d*d);
      }
      out[p] = dm < T ? 1 : 0;
    }
    return out;
  }
  function grow(M, w, h, on){ /* 3 by 3 dilate (on = 1) or erode (on = 0) */
    var o = new Uint8Array(M.length);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++){
      var v = on ? 0 : 1;
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++){
        var xx = Math.min(w - 1, Math.max(0, x + dx)), yy = Math.min(h - 1, Math.max(0, y + dy)), m = M[yy*w + xx];
        if (on ? m : !m){ v = on; dy = 2; break; }
      }
      o[y*w + x] = v;
    }
    return o;
  }
  var gateBytes = null, paintCache = null;
  /* the painted layers read back once after each change, not on every camera frame */
  function painted(){
    if (paintCache) return paintCache;
    try { paintCache = {keep: keepX.getImageData(0, 0, keepC.width, keepC.height).data, add: addX.getImageData(0, 0, addC.width, addC.height).data, w: keepC.width, h: keepC.height, k: keepC.width/S.iw}; }
    catch (e){ paintCache = {keep: null, add: null, w: 1, h: 1, k: 1}; }
    return paintCache;
  }
  function findFloor(src, relearn){
    features(src, S.iw, S.ih);
    var sd = seeds();
    if (relearn || !KEY.ok) learn(sd, sd.dots);
    if (!KEY.ok){ KEY.gate = null; return; }
    var w = KEY.w, h = KEY.h, n = w*h, M = floorish();
    /* only on the floor the corners mark out: not past the far edge or the sides, where the walls stand
       (a little slack for the edge itself), but all the way to you at the near side; floor painted by hand too */
    var H = homography(S.quad), SL = 0.04, pd = painted(), add = pd.add, ak = pd.k;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++){
      var ix = (x + 0.5)/w*S.iw, iy = (y + 0.5)/h*S.ih, z = H[6]*ix + H[7]*iy + H[8];
      var u = (H[0]*ix + H[1]*iy + H[2])/z, v = (H[3]*ix + H[4]*iy + H[5])/z;
      var ok = z > 0 && u > -SL && u < 1 + SL && v > -SL;
      if (!ok && add){ var ax = Math.min(pd.w - 1, Math.floor(ix*ak)), ay = Math.min(pd.h - 1, Math.floor(iy*ak)); ok = add[(ay*pd.w + ax)*4 + 3] > 64; }
      if (!ok) M[y*w + x] = 0;
    }
    /* keep what joins up with the marked part without crossing an edge, like a magic wand */
    var F = KEY.F, C = new Uint8Array(n), Q = new Int32Array(n), qh = 0, qt = 0;
    /* a step in colour stops it; a step only in brightness, with the colour the same, is light or shadow on the floor */
    function near(a, b){ var dc = Math.abs(F[a*3 + 1] - F[b*3 + 1]) + Math.abs(F[a*3 + 2] - F[b*3 + 2]); return dc < STEP_C*0.6 || (dc < STEP_C && Math.abs(F[a*3] - F[b*3]) < STEP_Y); }
    sd.forEach(function(p){ if (M[p] && !C[p]){ C[p] = 1; Q[qt++] = p; } });
    while (qh < qt){
      var p = Q[qh++], px = p % w, py = (p - px)/w;
      if (px > 0 && M[p - 1] && !C[p - 1] && near(p, p - 1)){ C[p - 1] = 1; Q[qt++] = p - 1; }
      if (px < w - 1 && M[p + 1] && !C[p + 1] && near(p, p + 1)){ C[p + 1] = 1; Q[qt++] = p + 1; }
      if (py > 0 && M[p - w] && !C[p - w] && near(p, p - w)){ C[p - w] = 1; Q[qt++] = p - w; }
      if (py < h - 1 && M[p + w] && !C[p + w] && near(p, p + w)){ C[p + w] = 1; Q[qt++] = p + w; }
    }
    C = grow(grow(C, w, h, 1), w, h, 0);          /* close the grain's small holes */
    C = grow(C, w, h, 1);                          /* and let the sharp key decide the last pixel of each edge */
    if (!gateBytes || gateBytes.length !== n) gateBytes = new Uint8Array(n);
    for (y = 0; y < h; y++) for (x = 0; x < w; x++){
      var s3 = 0, c3 = 0;
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++){ var xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; s3 += C[yy*w + xx]; c3++; }
      gateBytes[y*w + x] = Math.round(255*s3/c3);
    }
    KEY.gate = gateBytes;
    gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, T.gate);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, w, h, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, gateBytes);
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
    gl.uniform1f(U.uBreak, L.breakup ? 1 : 0); gl.uniform4f(U.uWin, L.win[0], L.win[1], L.win[2], L.win[3]);
    var mean = (S.floor && S.floor.mean) || [0.5, 0.5, 0.5]; gl.uniform3f(U.uMean, mean[0], mean[1], mean[2]);
    /* planks run away from you unless turned; some photos have their boards lying across */
    gl.uniform1f(U.uRot, (S.rot !== L.across) ? 1 : 0); gl.uniform1f(U.uShade, 0.8); gl.uniform1f(U.uAvg, avgLight);
    gl.uniform1f(U.uOn, S.floor && S.floor.ready && !S.before && convex(S.quad) ? 1 : 0);
    var mu = new Float32Array(12), is = new Float32Array(12);
    KEY.mu.forEach(function(c, k){ for (var ch = 0; ch < 3; ch++){ mu[k*3 + ch] = c[ch]; is[k*3 + ch] = KEY.is[k][ch]; } });
    gl.uniform3fv(U.uMu, mu); gl.uniform3fv(U.uIs, is); gl.uniform1f(U.uK, KEY.mu.length); gl.uniform1f(U.uT, KEY.T);
    gl.uniform1f(U.uKey, KEY.ok && KEY.gate ? 1 : 0);
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
  function redraw(){ if (pending) return; pending = true; requestAnimationFrame(function(){ pending = false;
    if (paintDirty){ paintDirty = false; upload(2, T.add, addC); upload(3, T.keep, keepC); }
    if (KEY.dirty && !cam.on){ KEY.dirty = false; findFloor(photoC, true); measureLight(); }
    draw(); }); }

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
      S.quad[i] = p; placeHandles(); KEY.dirty = true; redraw();
    });
    function end(e){ if (e.pointerId !== id) return; id = null; KEY.dirty = true; redraw(); }
    h.addEventListener("pointerup", end); h.addEventListener("pointercancel", end);
    h.addEventListener("keydown", function(e){
      var step = 4/view.s, d = {ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step]}[e.key];
      if (!d) return; e.preventDefault(); S.quad[i] = [Math.max(0, Math.min(S.iw, S.quad[i][0] + d[0])), Math.max(0, Math.min(S.ih, S.quad[i][1] + d[1]))]; placeHandles(); KEY.dirty = true; redraw();
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
    paintDirty = true; paintCache = null; redraw();
    return [px, py];
  }
  cv.addEventListener("pointerdown", function(e){
    if (S.mode === "corners") return;
    cv.setPointerCapture(e.pointerId); painting = {id: e.pointerId, last: paintAt(e.clientX, e.clientY, null)}; e.preventDefault();
  });
  cv.addEventListener("pointermove", function(e){ if (painting && e.pointerId === painting.id) painting.last = paintAt(e.clientX, e.clientY, painting.last); });
  function stopPaint(){ if (painting) KEY.dirty = true; painting = null; redraw(); }
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
    upload(2, T.add, addC); upload(3, T.keep, keepC); paintCache = null; KEY.dirty = true; redraw();
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
    upload(2, T.add, addC); upload(3, T.keep, keepC); paintCache = null;
    makeLight(); findFloor(photoC, true); measureLight(); fit();
  }
  function presetArea(){
    var pr = S.preset; if (!pr) return;
    var k = S.iw/pr.w*addC.width/S.iw;
    addX.globalCompositeOperation = "source-over"; addX.fillStyle = "#000"; addX.beginPath();
    pr.area.forEach(function(p, i){ var x = p[0]*k, y = p[1]*k; if (i) addX.lineTo(x, y); else addX.moveTo(x, y); });
    addX.closePath(); addX.fill();
  }
  function loadRoom(n){
    stopCamera();
    S.room = n % ROOMS.length; S.user = false; var room = ROOMS[S.room];
    var img = new Image(); img.onload = function(){ useImage(img, room); setMode("corners"); help.textContent = "This is a sample room. Tap a floor on the side, or use a picture of your own room."; };
    img.src = room.src;
  }
  $("nextroom").addEventListener("click", function(){ loadRoom(S.user ? S.room : S.room + 1); $("nextroom").textContent = "Another sample room"; });
  $("photo").addEventListener("change", function(e){
    var f = e.target.files && e.target.files[0]; if (!f) return;
    stopCamera();
    var url = URL.createObjectURL(f), img = new Image();
    img.onload = function(){ S.user = true; useImage(img, null); URL.revokeObjectURL(url); setMode("corners"); $("nextroom").textContent = "Back to a sample room"; say(""); };
    img.onerror = function(){ say("That picture couldn't be opened. Try a JPG or PNG photo."); };
    img.src = url; e.target.value = "";
  });


  /* ---------- The camera ----------
     The phone's camera fills the same view. The corners are set on the live picture as on a photo; each frame
     the floor is found again (its colours are learnt again twice a second) and the sample laid in it.
     "Keep this picture" holds the frame still, to fine-tune it and save it. */
  function startCamera(){
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){ say("This browser can't open the camera. Use a picture of your room instead."); return; }
    navigator.mediaDevices.getUserMedia({audio: false, video: {facingMode: {ideal: "environment"}, width: {ideal: 1280}, height: {ideal: 960}}}).then(function(stream){
      var v = document.createElement("video"); v.muted = true; v.playsInline = true; v.setAttribute("playsinline", ""); v.srcObject = stream;
      cam.video = v; cam.stream = stream;
      v.addEventListener("loadedmetadata", function(){
        var p = v.play(); if (p && p.catch) p.catch(function(){});
        cam.on = true; cam.n = 0; S.user = true; S.preset = null; S.widthM = 3.6;
        S.iw = v.videoWidth; S.ih = v.videoHeight;
        photoC.width = S.iw; photoC.height = S.ih;
        var mk = Math.min(1, 1024/Math.max(S.iw, S.ih));
        [addC, keepC].forEach(function(c){ c.width = Math.round(S.iw*mk); c.height = Math.round(S.ih*mk); });
        addX.clearRect(0, 0, addC.width, addC.height); keepX.clearRect(0, 0, keepC.width, keepC.height);
        upload(2, T.add, addC); upload(3, T.keep, keepC); paintCache = null;
        S.quad = [[S.iw*0.3, S.ih*0.62], [S.iw*0.7, S.ih*0.62], [S.iw*0.9, S.ih*0.95], [S.iw*0.1, S.ih*0.95]];
        setMode("corners"); fit();
        $("camera").textContent = "Keep this picture"; $("nextroom").textContent = "Back to a sample room";
        help.textContent = "Point the camera at the floor and hold it steady. Drag the dots to the corners of the floor, where it meets the walls.";
        say(""); frame();
      }, {once: true});
    }).catch(function(){ say("The camera couldn't be opened. Allow the camera for this page, or use a picture of your room."); });
  }
  function frame(){
    if (!cam.on) return;
    var v = cam.video;
    if (v.readyState >= 2 && v.videoWidth){
      upload(0, T.photo, v);
      if (cam.n % 6 === 0){ makeLight(); }
      findFloor(v, cam.n % 15 === 0 || KEY.dirty); KEY.dirty = false;
      if (cam.n % 6 === 0) measureLight();
      cam.n++; draw();
    }
    requestAnimationFrame(frame);
  }
  function stopCamera(keep){
    if (!cam.on && !cam.stream) return;
    var v = cam.video;
    if (keep && v && v.videoWidth){
      var c = document.createElement("canvas"); c.width = v.videoWidth; c.height = v.videoHeight; c.getContext("2d").drawImage(v, 0, 0);
      var q = S.quad.slice();
      cam.on = false; useImage(c, null); S.quad = q; KEY.dirty = true; fit(); redraw();
    }
    cam.on = false;
    if (cam.stream) cam.stream.getTracks().forEach(function(t){ t.stop(); });
    cam.stream = null; cam.video = null;
    $("camera").textContent = "See it through your camera";
  }
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) $("camera").hidden = false;
  $("camera").addEventListener("click", function(){
    if (cam.on){ stopCamera(true); help.textContent = "Your picture. Move the dots, paint anything the floor missed, or save it."; }
    else startCamera();
  });

  /* ---------- Floors ---------- */
  var IN = 0.0254;
  function hex(c){ var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c || ""); return m ? [parseInt(m[1], 16)/255, parseInt(m[2], 16)/255, parseInt(m[3], 16)/255] : [0.74, 0.71, 0.67]; }
  /* How a product's photo is laid, in metres (see the shader). */
  function layoutOf(f){
    var ph = (f && f.photo) || {}, asp = ph.aspect || (f && f.img ? f.img.naturalWidth/f.img.naturalHeight : 1) || 1;
    var out = {kind: 0, unit: [2, 2], n: 1, pl: 1, seam: 0.0004, turn: 0, grout: [0.74, 0.71, 0.67], across: !!ph.across, breakup: false, win: [0, 0, 1, 1]};
    if (ph.layout === "plank"){
      var pw = (ph.plankIn || [7, 48]);
      out.kind = 1; out.unit = [pw[1]*IN, pw[0]*IN]; out.n = Math.max(1, ph.planks || 1);
      out.pl = Math.min(1, (ph.photoLengthIn || pw[1])/pw[1]);
      out.seam = (ph.jointIn || 0.03)*IN;
      out.across = !ph.across;   /* the photo's boards lie left to right; on the floor they run away from you */
    } else if (ph.layout === "herringbone"){
      var hb = (ph.plankIn || [6, 24]);
      out.kind = 3; out.unit = [hb[1]*IN, hb[0]*IN]; out.n = Math.max(1, ph.planks || 1); out.seam = (ph.jointIn || 0.03)*IN;
    } else if (ph.layout === "tile"){
      var tw = (ph.tileIn || [12, 12]);
      out.kind = 2; out.unit = [tw[1]*IN, tw[0]*IN]; out.seam = Math.max(0.0003, (ph.groutIn == null ? 0.125 : ph.groutIn)*IN/2);
      out.turn = ph.turn === false ? 0 : (tw[0] === tw[1] ? 2 : 1); out.grout = hex(ph.grout || "#BDB6AA");
    } else {
      var wm = ph.widthM || (ph.widthIn ? ph.widthIn*IN : 2);
      out.unit = [wm, wm/asp];
      /* carpet photos had their edges blended into each other to repeat; only the middle two thirds is the carpet as photographed */
      if (f && f.type === "carpet" && !ph.pattern){
        out.breakup = true;
        out.win = ph.seamless === false ? [0.03, 0.03, 0.94, 0.94] : [0.18, 0.18, 0.64, 0.64];
      }
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
    /* the floor on screen stays until the new one's picture is in, so the room never shows its old floor in between */
    S.want = f;
    function show(){
      if (S.want !== f) return;
      var wasCarpet = S.floor && S.floor.type === "carpet";
      S.floor = f; f.ready = true;
      var lk = layoutOf(f).kind, sz = $("size");
      if (f.type === "carpet"){ sz.value = sz.max; S.size = Math.pow(2, parseFloat(sz.max)/100); }
      else if (wasCarpet){ sz.value = 0; S.size = 1; }
      $("turn").textContent = lk === 1 || lk === 3 || (f.type === "look" && f.look === "wood") || (!lk && /plank|laminate|hardwood/.test(f.type)) ? "Turn the planks" : lk === 2 ? "Turn the tiles" : "Turn the pattern";
      bindFloor(cache[f.id], f);
    }
    if (cache[f.id]){ show(); return; }
    var img = new Image();
    img.onload = function(){ f.img = img; cache[f.id] = prepared(img); show(); };
    img.onerror = function(){ if (S.want === f) say("That floor's picture couldn't be loaded. Try another, or reload the page."); };
    img.src = f.photo.image;
  }
  function meanOf(src, L){
    try {
      var c = document.createElement("canvas"); c.width = c.height = 24; var x = c.getContext("2d");
      var w = src.naturalWidth || src.width, h = src.naturalHeight || src.height;
      x.drawImage(src, L.win[0]*w, L.win[1]*h, L.win[2]*w, L.win[3]*h, 0, 0, 24, 24);
      var d = x.getImageData(0, 0, 24, 24).data, m = [0, 0, 0];
      for (var i = 0; i < d.length; i += 4){ m[0] += d[i]; m[1] += d[i + 1]; m[2] += d[i + 2]; }
      return m.map(function(v){ return v/(255*576); });
    } catch (e){ return null; }
  }
  function bindFloor(src, f){
    var L = layoutOf(f), wrapMode = L.kind ? gl.CLAMP_TO_EDGE : (f.photo.seamless === false ? gl.MIRRORED_REPEAT : gl.REPEAT);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, T.floor);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    if (L.breakup && !f.mean) f.mean = meanOf(src, L);
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
  window.KnockelsRoom = {state: S, choose: chooseFloor, layoutOf: layoutOf, draw: draw, key: KEY, findFloor: function(){ findFloor(photoC, true); measureLight(); draw(); }};
  loadRoom(0);
})();
