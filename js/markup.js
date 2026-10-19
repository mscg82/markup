i18n.ready.then(()=>{          // wait until the locale strings are loaded
const $=id=>document.getElementById(id);
const cv=$('cv'),ctx=cv.getContext('2d'),stage=$('stage');
let bg=null,bg0=null,L=null,lc=null,ops=[],redoStack=[],tool='pen',s=1,ox=0,oy=0,viewW=0,viewH=0,cur=null,panning=false;
// Every tool that has a width remembers its own: the pen, each shape, the eraser and each stencil type (for a stencil
// the width is the side of its bounding box, hence the larger limit).
const WKEYS=['pen','line','arrow','rect','circle','star','erase','stencil.x','stencil.circle','stencil.tri','stencil.square','stencil.char'];
const SHAPE_KEYS=['line','arrow','rect','circle','star'],STENCIL_KEYS=WKEYS.filter(k=>k.startsWith('stencil.'));
const widths={},WMAX={};
for(const k of WKEYS){widths[k]=k==='erase'?24:k.startsWith('stencil.')?40:6;WMAX[k]=k.startsWith('stencil.')?200:80}
// Restore remembered widths from a saved object. w: {key:width} (current format); leg: the single widths of older
// saves, {draw,erase,stencil}, which are applied to every tool of their group first, so that w can refine them.
function applyWidths(w,leg){
  const set=(k,v)=>{if(typeof v==='number'&&v>=1&&v<=WMAX[k])widths[k]=v};
  if(leg){for(const k of['pen',...SHAPE_KEYS])set(k,leg.draw);set('erase',leg.erase);for(const k of STENCIL_KEYS)set(k,leg.stencil)}
  if(w&&typeof w==='object')for(const k of WKEYS)set(k,w[k]);
}
let lastSharp=1;   // sharpness used by the last Resize background (0 off, 1 normal, 2 strong); remembered with the pen widths
let stencilKind='x',stencilChar='A',eraseSt=[];   // current stencil, its letter; stencils the running eraser stroke could still remove
let viaSpot=false,spotId=null,spotPt=null;   // viaSpot: the pointer event being handled comes from the spotlight box; spotId: pointer drawing through it; spotPt: pointer position over it (its pixels) for the eraser footprint
let crop=null,spot=null;   // spot: the floating spotlight box {x,y,collapsed} while one exists
let cropKind='crop';   // crop selection {x0,y0,x1,y1} in image pixels while the crop mode is active
const ptrs=new Map();let pinch=null,last=null,fillTap=null,tapTrack=null;
let pending=null;   // rectangle/circle/star that has been drawn but not placed yet (see "pending shape" below)
const MAXDIM=2400;
// Place a popup (absolutely positioned inside a position:relative wrapper) so that it never goes past the
// screen edges. On mobile browsers window.innerWidth GROWS when a popup overflows to the right, so the
// stable documentElement.clientWidth is used instead.
// Popups of the toolbar: below the button when the toolbar is on top, to the right of it (in viewport
// coordinates) when the toolbar is on the left.
function placePopup(el,btn){
  if(!document.documentElement.classList.contains('tb-left')){el.style.top='';keepOnScreen(el);return}
  const b=btn.getBoundingClientRect(),w=el.offsetWidth,h=el.offsetHeight,m=6;
  const vw=document.documentElement.clientWidth,vh=document.documentElement.clientHeight;
  el.style.left=Math.max(m,Math.min(b.right+6,vw-w-m))+'px';   // right next to the button
  el.style.top=Math.max(m,Math.min(b.top,vh-h-m))+'px';
}
function keepOnScreen(el){
  el.style.left='0';
  const vw=document.documentElement.clientWidth,r=el.getBoundingClientRect(),m=6;
  let shift=0;
  if(r.right>vw-m)shift=(vw-m)-r.right;     // too far right: move left
  if(r.left+shift<m)shift=m-r.left;         // never past the left edge either
  el.style.left=shift+'px';
}
const APP_VERSION='v32';   // keep in step with CACHE in sw.js
$('ver').textContent=t('app.version',{version:APP_VERSION});

/* ---------- settings (persisted in localStorage) ---------- */
const SETTINGS_KEY='markup.settings';
const validSize=v=>Number.isInteger(v)&&v>=16&&v<=MAXDIM;
let settings={lang:'auto',newW:1600,newH:1200,diag:false,palm:false,palmMs:250};
try{
  const p=JSON.parse(localStorage.getItem(SETTINGS_KEY)||'null');
  if(p){
    if(typeof p.lang==='string'&&/^(auto|[a-z]{2,3}(-[A-Za-z0-9]{2,8})*)$/.test(p.lang))settings.lang=p.lang;
    if(validSize(p.newW))settings.newW=p.newW;
    if(validSize(p.newH))settings.newH=p.newH;
    if(typeof p.diag==='boolean')settings.diag=p.diag;
    if(typeof p.palm==='boolean')settings.palm=p.palm;
    if(Number.isInteger(p.palmMs)&&p.palmMs>=0&&p.palmMs<=1000)settings.palmMs=p.palmMs;
  }
}catch(e){}
/* ---------- palm rejection (opt-in) ----------
   Off by default: every hook below is a single test of the boolean palmOn, nothing else runs.
   Rules are relative (no pixel thresholds): a second touch must land soon after the first (pinch),
   a much smaller late touch means the first was a palm, and a much bigger touch right after one ends is a palm. */
let palmOn=settings.palm;
const palmInfo=new Map(),palmRej=new Set();let palmLast=null;   // accepted id -> {t,sz}; rejected ids; last ended contact
const PALM_SMALLER=0.6,PALM_BIGGER=1.8,PALM_AFTER=1000;
function palmReset(){palmInfo.clear();palmRej.clear();palmLast=null}
function palmDown(e){                                // true = ignore this contact
  if(e.pointerType!=='touch')return false;
  const sz=Math.max(e.width,e.height),now=e.timeStamp;
  if(ptrs.size===0){
    if(palmLast&&now-palmLast.t<=PALM_AFTER&&sz>PALM_BIGGER*palmLast.sz){palmRej.add(e.pointerId);return true}
  }else if(palmMs()>0){
    let first=null;for(const id of ptrs.keys()){first=id;break}
    const f=palmInfo.get(first);
    if(ptrs.size>=2||!f||now-f.t>palmMs()){
      if(ptrs.size===1&&f&&sz<PALM_SMALLER*f.sz){     // the contact already down was the palm: drop it, keep this one
        palmRej.add(first);palmInfo.delete(first);ptrs.delete(first);
        fillTap=null;tapTrack=null;press=null;tapSeq.n=0;endTemp();cancelCur();pinch=null;panning=false;
      }else{palmRej.add(e.pointerId);return true}
    }
  }
  if(palmRej.size>32)palmRej.clear();
  palmInfo.set(e.pointerId,{t:now,sz});return false;
}
function palmUp(e){const f=palmInfo.get(e.pointerId);palmInfo.delete(e.pointerId);if(f)palmLast={t:e.timeStamp,sz:f.sz}}
function palmMs(){return settings.palmMs}
function saveSettings(){
  try{localStorage.setItem(SETTINGS_KEY,JSON.stringify(settings))}catch(e){msg(t('msg.storageFull'))}
}


function msg(t){const m=$('msg');m.textContent=t;m.style.display='block';clearTimeout(msg.t);msg.t=setTimeout(()=>m.style.display='none',3500)}

/* ---------- drawing primitives ---------- */
const STAR_INNER=Math.cos(Math.PI*2/5)/Math.cos(Math.PI/5);   // inner/outer radius ratio of a regular pentagram outline (~0.382)
// Stencils: a ready-made figure inside a square bounding box of side o.w centred on (o.cx,o.cy); every stroke stays
// inside that square. Stroke thicknesses (relative to the side) were chosen so that the share of the square that is
// painted is close to the reference X (about 54%): X 0.23, circle and square outlines 0.16, triangle outline 0.12.
const ST_X=0.23,ST_RING=0.16,ST_TRI=0.12;
function drawStencil(c,o,g=0){   // g > 0 widens the strokes by g px on each side (used to wipe a stencil without leaving an antialiasing fringe)
  const w=o.w,x0=o.cx-w/2,y0=o.cy-w/2;
  c.save();c.fillStyle=c.strokeStyle=o.c||'#000';c.lineJoin='miter';c.lineCap='butt';
  if(o.k==='x'){
    const t=w*ST_X+2*g;c.beginPath();c.rect(x0-g,y0-g,w+2*g,w+2*g);c.clip();   // the diagonals run past the corners; the box cuts them flat
    c.lineWidth=t;c.beginPath();
    c.moveTo(x0-t,y0-t);c.lineTo(x0+w+t,y0+w+t);c.moveTo(x0+w+t,y0-t);c.lineTo(x0-t,y0+w+t);c.stroke();
  }else if(o.k==='circle'){
    const t=w*ST_RING;c.lineWidth=t+2*g;c.beginPath();c.arc(o.cx,o.cy,(w-t)/2,0,Math.PI*2);c.stroke();
  }else if(o.k==='square'){
    const t=w*ST_RING;c.lineWidth=t+2*g;c.strokeRect(x0+t/2,y0+t/2,w-t,w-t);
  }else if(o.k==='tri'){   // equilateral, base = the box width, centred vertically; the outline lies inside the triangle
    const t=w*ST_TRI,h=w*Math.sqrt(3)/2,r=h/3,k=(r-t/2)/r,gx=o.cx,gy=o.cy+h/6;
    const V=[[o.cx,o.cy-h/2],[x0+w,o.cy+h/2],[x0,o.cy+h/2]].map(v=>[gx+(v[0]-gx)*k,gy+(v[1]-gy)*k]);
    c.lineWidth=t+2*g;c.beginPath();c.moveTo(...V[0]);c.lineTo(...V[1]);c.lineTo(...V[2]);c.closePath();c.stroke();
  }else if(o.k==='char'){   // a bold glyph scaled to fit the square
    const ch=o.ch||'A';c.font='bold 100px "DejaVu Sans",Arial,Helvetica,sans-serif';c.textBaseline='alphabetic';c.textAlign='left';
    const m=c.measureText(ch),l=m.actualBoundingBoxLeft,r=m.actualBoundingBoxRight,a=m.actualBoundingBoxAscent,d=m.actualBoundingBoxDescent,gw=l+r,gh=a+d;
    if(gw>0&&gh>0){const k=Math.min(w/gw,w/gh);c.translate(o.cx,o.cy);c.scale(k,k);c.fillText(ch,-(r-l)/2,(a-d)/2);if(g>0){c.lineWidth=2*g/k;c.lineJoin='round';c.strokeText(ch,-(r-l)/2,(a-d)/2)}}
  }
  c.restore();
}
function drawOp(c,o){
  if(o.t==='fill'){applyFill(o);return}
  if(o.t==='stencil'){drawStencil(c,o);return}
  c.save();c.lineCap=c.lineJoin='round';c.lineWidth=o.w;c.strokeStyle=o.c||'#000';
  if(o.t==='erase')c.globalCompositeOperation='destination-out';
  c.beginPath();
  if(o.t==='pen'||o.t==='erase'){
    const q=o.p[0];
    if(o.p.every(r=>r[0]===q[0]&&r[1]===q[1])){
      // A single touch point: fill a circle of the pen width. A zero-length stroke with round caps is
      // not drawn reliably by every browser/GPU, a filled circle is.
      c.fillStyle=c.strokeStyle;c.arc(q[0],q[1],o.w/2,0,Math.PI*2);c.fill();
      c.restore();return;
    }
    c.moveTo(q[0],q[1]);
    for(let i=1;i<o.p.length;i++)c.lineTo(o.p[i][0],o.p[i][1]);
  }else if(o.t==='line'){c.moveTo(...o.a);c.lineTo(...o.b)}
  else if(o.t==='arrow'){   // a line with a filled triangular head whose tip is exactly the end point
    const dx=o.b[0]-o.a[0],dy=o.b[1]-o.a[1],len=Math.hypot(dx,dy);
    if(len>0){
      const ux=dx/len,uy=dy/len,hl=Math.min(Math.max(20,o.w*4),len),hw=hl*0.45;
      const bx=o.b[0]-ux*hl,by=o.b[1]-uy*hl;   // middle of the head's base
      c.moveTo(...o.a);c.lineTo(bx,by);c.stroke();
      c.beginPath();c.moveTo(...o.b);c.lineTo(bx-uy*hw,by+ux*hw);c.lineTo(bx+uy*hw,by-ux*hw);c.closePath();
      c.fillStyle=c.strokeStyle;c.fill();c.restore();return;
    }
  }
  else if(o.t==='rect'){c.rect(o.a[0],o.a[1],o.b[0]-o.a[0],o.b[1]-o.a[1])}
  else if(o.t==='circle'){c.arc(o.a[0],o.a[1],Math.hypot(o.b[0]-o.a[0],o.b[1]-o.a[1]),0,Math.PI*2)}
  else if(o.t==='star'){   // classic 5-pointed star inscribed in the circle drawn from the center a through b, one point up
    const r=Math.hypot(o.b[0]-o.a[0],o.b[1]-o.a[1]),ri=r*STAR_INNER;
    for(let i=0;i<10;i++){
      const ang=-Math.PI/2+i*Math.PI/5,rad=i%2?ri:r,x=o.a[0]+rad*Math.cos(ang),y=o.a[1]+rad*Math.sin(ang);
      if(i)c.lineTo(x,y);else c.moveTo(x,y);
    }
    c.closePath();
  }
  c.stroke();c.restore();
}
// Flood fill. A fill op stores only {color, seed point, tolerance}; its pixels are recomputed
// from the drawing layer (all earlier operations) whenever the history is replayed.
// The background image is ignored: only what the user drew acts as a boundary.
const FILL_TOL=32;   // max difference per channel for drawn pixels to count as "the same color"
function applyFill(o){
  const w=bg.width,h=bg.height,sx=Math.floor(o.x),sy=Math.floor(o.y);
  const m=/^#([0-9a-f]{6})$/i.exec(o.c);
  if(!m||sx<0||sy<0||sx>=w||sy>=h)return;
  const fr=parseInt(m[1].slice(0,2),16),fg=parseInt(m[1].slice(2,4),16),fb=parseInt(m[1].slice(4,6),16);
  const img=lc.getImageData(0,0,w,h),d=img.data,tol=o.tol;
  const i0=(sy*w+sx)*4,tr=d[i0],tg=d[i0+1],tb=d[i0+2],ta=d[i0+3];
  const EMPTY=40;   // alpha at or below this counts as "nothing drawn here"
  const ok=ta<=EMPTY
    ? p=>d[p*4+3]<=EMPTY                                  // started on empty space: spread over empty space
    : p=>{const i=p*4;return d[i+3]>EMPTY&&Math.abs(d[i]-tr)<=tol&&Math.abs(d[i+1]-tg)<=tol&&Math.abs(d[i+2]-tb)<=tol&&Math.abs(d[i+3]-ta)<=tol};
  const mask=new Uint8Array(w*h),stack=[sx,sy];
  while(stack.length){                      // scanline flood fill
    const y=stack.pop();let x=stack.pop(),p=y*w+x;
    if(mask[p]||!ok(p))continue;
    while(x>0&&!mask[p-1]&&ok(p-1)){x--;p--}
    let up=false,down=false;
    while(x<w&&!mask[p]&&ok(p)){
      mask[p]=1;
      if(y>0){const q=p-w,mm=!mask[q]&&ok(q);if(mm&&!up){stack.push(x,y-1);up=true}else if(!mm)up=false}
      if(y<h-1){const q=p+w,mm=!mask[q]&&ok(q);if(mm&&!down){stack.push(x,y+1);down=true}else if(!mm)down=false}
      x++;p++;
    }
  }
  for(let y=0,p=0;y<h;y++)for(let x=0;x<w;x++,p++){
    const i=p*4;
    if(mask[p]){d[i]=fr;d[i+1]=fg;d[i+2]=fb;d[i+3]=255;continue}
    // one-pixel ring around the region: paint *under* existing strokes so their anti-aliased edges blend with the fill
    if((x>0&&mask[p-1])||(x<w-1&&mask[p+1])||(y>0&&mask[p-w])||(y<h-1&&mask[p+w])){
      const a=d[i+3];
      if(a<255){const t=a/255;d[i]=Math.round(d[i]*t+fr*(1-t));d[i+1]=Math.round(d[i+1]*t+fg*(1-t));d[i+2]=Math.round(d[i+2]*t+fb*(1-t));d[i+3]=255}
    }
  }
  lc.putImageData(img,0,0);
}
function commitFill(f){
  if(!bg)return;
  const x=Math.floor(f.p[0]),y=Math.floor(f.p[1]);
  if(x<0||y<0||x>=bg.width||y>=bg.height)return;
  const o={t:'fill',c:f.c,x,y,tol:FILL_TOL};
  applyFill(o);ops.push(o);redoStack=[];persist();ui();render();
}
// bg0 is the background as loaded or created; bg is what is shown: bg0 enlarged by the "frame" operations of the
// history (Resize frame). The drawing layer L always has the size of bg. Coordinates of an operation are
// those of the image as it was when the operation was made, so frames never rewrite earlier operations.
function newLayer(w,h){L=document.createElement('canvas');L.width=w;L.height=h;lc=L.getContext('2d')}
function frameBg(b,o){   // enlarge the background (new area filled with o.c), content shifted by left/top
  const w=b.width+o.left+o.right,h=b.height+o.top+o.bottom;
  const nb=document.createElement('canvas');nb.width=w;nb.height=h;
  const x=nb.getContext('2d');x.fillStyle=o.c;x.fillRect(0,0,w,h);x.drawImage(b,o.left,o.top);
  return nb;
}
function cropBg(b,o){   // keep only the box x,y,w,h (clamped to the image, so a damaged history cannot fail)
  const x=Math.min(o.x,b.width-1),y=Math.min(o.y,b.height-1),w=Math.min(o.w,b.width-x),h=Math.min(o.h,b.height-y);
  const nb=document.createElement('canvas');nb.width=w;nb.height=h;
  nb.getContext('2d').drawImage(b,x,y,w,h,0,0,w,h);
  return nb;
}
// Bicubic resampling (Keys kernel, a = -0.5, the same as Pillow's BICUBIC): two separable passes. When the image is
// reduced the kernel is stretched by the scale factor, so shrinking is smooth instead of aliased.
const lanczos=x=>{x=Math.abs(x);if(x<1e-8)return 1;if(x>=3)return 0;const px=Math.PI*x;return 3*Math.sin(px)*Math.sin(px/3)/(px*px)};
const cubic=x=>{x=Math.abs(x);return x<1?(1.5*x-2.5)*x*x+1:x<2?((-0.5*x+2.5)*x-4)*x+2:0};
function cubicWeights(srcN,dstN,lz){
  const kern=lz?lanczos:cubic,sc=srcN/dstN,fs=Math.max(1,sc),support=(lz?3:2)*fs,out=new Array(dstN);
  for(let i=0;i<dstN;i++){
    const c=(i+0.5)*sc,x0=Math.max(0,Math.floor(c-support+0.5)),x1=Math.min(srcN,Math.floor(c+support+0.5)),w=new Float32Array(Math.max(1,x1-x0));
    let sum=0;
    for(let x=x0;x<x1;x++){const v=kern((x-c+0.5)/fs);w[x-x0]=v;sum+=v}
    if(sum)for(let k=0;k<w.length;k++)w[k]/=sum;else w[0]=1;
    out[i]={x0,w};
  }
  return out;
}
function resampleCanvas(src,dw,dh,sharp){   // sharp: 0 = bicubic as before, 1/2 = Lanczos-3 + limited sharpening (normal / strong)
  const sw=src.width,sh=src.height,sd=src.getContext('2d').getImageData(0,0,sw,sh).data;
  const tmp=new Uint8ClampedArray(dw*sh*4),wx=cubicWeights(sw,dw,sharp>0),wy=cubicWeights(sh,dh,sharp>0);
  for(let y=0;y<sh;y++){                       // horizontal pass
    const row=y*sw*4;
    for(let i=0;i<dw;i++){
      const {x0,w}=wx[i];let r=0,g=0,b=0,a=0;
      for(let k=0;k<w.length;k++){const p=row+(x0+k)*4,v=w[k];r+=sd[p]*v;g+=sd[p+1]*v;b+=sd[p+2]*v;a+=sd[p+3]*v}
      const o=(y*dw+i)*4;tmp[o]=r;tmp[o+1]=g;tmp[o+2]=b;tmp[o+3]=a;
    }
  }
  const out=document.createElement('canvas');out.width=dw;out.height=dh;
  const oc=out.getContext('2d'),img=oc.createImageData(dw,dh),od=img.data;
  for(let j=0;j<dh;j++){                       // vertical pass
    const {x0,w}=wy[j];
    for(let i=0;i<dw;i++){
      let r=0,g=0,b=0,a=0;
      for(let k=0;k<w.length;k++){const p=((x0+k)*dw+i)*4,v=w[k];r+=tmp[p]*v;g+=tmp[p+1]*v;b+=tmp[p+2]*v;a+=tmp[p+3]*v}
      const o=(j*dw+i)*4;od[o]=r;od[o+1]=g;od[o+2]=b;od[o+3]=a;
    }
  }
  if(sharp>0){const f=Math.max(sw/dw,sh/dh),amt=(sharp===2?1:0.6)*Math.min(1,(f-1)*2);if(amt>0)unsharp(od,dw,dh,amt)}   // only when reducing
  oc.putImageData(img,0,0);
  return out;
}
// Unsharp mask (Gaussian sigma ~0.7 px) whose result is clamped to the min/max of each pixel's 3x3 neighbourhood, so it
// restores edge contrast (text) without halos or ringing. Alpha is left alone.
function unsharp(d,w,h,amt){
  const K=[0.0702,0.2311,0.3974,0.2311,0.0702];   // 5-tap Gaussian
  const n=w*h*4,tmp=new Float32Array(n),bl=new Float32Array(n);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const o=(y*w+x)*4;
    for(let c=0;c<3;c++){let a=0;for(let k=-2;k<=2;k++){const xx=Math.min(w-1,Math.max(0,x+k));a+=d[(y*w+xx)*4+c]*K[k+2]}tmp[o+c]=a}
  }
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const o=(y*w+x)*4;
    for(let c=0;c<3;c++){let a=0;for(let k=-2;k<=2;k++){const yy=Math.min(h-1,Math.max(0,y+k));a+=tmp[(yy*w+x)*4+c]*K[k+2]}bl[o+c]=a}
  }
  const src=new Uint8ClampedArray(d);                // untouched copy for the neighbourhood limits
  for(let y=0;y<h;y++){
    const y0=Math.max(0,y-1),y1=Math.min(h-1,y+1);
    for(let x=0;x<w;x++){
      const x0=Math.max(0,x-1),x1=Math.min(w-1,x+1),o=(y*w+x)*4;
      for(let c=0;c<3;c++){
        let lo=255,hi=0;
        for(let yy=y0;yy<=y1;yy++)for(let xx=x0;xx<=x1;xx++){const v=src[(yy*w+xx)*4+c];if(v<lo)lo=v;if(v>hi)hi=v}
        const v=src[o+c],r=v+amt*(v-bl[o+c]);
        d[o+c]=r<lo?lo:r>hi?hi:r;
      }
    }
  }
}
let scaleCache=null;   // replay() runs on every undo: remember the last resampled background instead of recomputing it
function scaleBg(b,o){   // "scale" operation: the background is resampled to o.w x o.h
  if(!(scaleCache&&scaleCache.src===b&&scaleCache.w===o.w&&scaleCache.h===o.h&&scaleCache.s===(o.s|0)))scaleCache={src:b,w:o.w,h:o.h,s:o.s|0,c:resampleCanvas(b,o.w,o.h,o.s|0)};
  return scaleCache.c;
}
const isResizeOp=o=>o.t==='frame'||o.t==='scale'||o.t==='crop';
const bgStep=(b,o)=>o.t==='frame'?frameBg(b,o):o.t==='crop'?cropBg(b,o):scaleBg(b,o);   // the background after one resize operation
function applyResizeOp(o){   // applies one resize operation to the current background and drawing layer
  const ol=L,nb=bgStep(bg,o);newLayer(nb.width,nb.height);
  if(o.t==='frame')lc.drawImage(ol,o.left,o.top);
  else if(o.t==='crop')lc.drawImage(ol,-o.x,-o.y);
  else{lc.imageSmoothingQuality='high';lc.drawImage(ol,0,0,nb.width,nb.height)}
  bg=nb;
}
// Cache of the background produced by the leading resize operations of the history (any number of frames, scales
// and crops made before the first drawing mark). replay() runs often (every undo, every cancelled stroke...), so it
// starts from this canvas instead of redoing the resizes. It is valid while bg0 and the cached operations are the same.
let bgCache=null;   // {src:bg0, ops:[...], bg:canvas}
function syncBgCache(){if(ops.every(isResizeOp))bgCache={src:bg0,ops:ops.slice(),bg}}   // after a resize op was applied directly
function replay(){
  crop=null;
  let p=0;while(p<ops.length&&isResizeOp(ops[p]))p++;
  let from=0,b=bg0;
  const c=bgCache;
  if(p>0&&c&&c.src===bg0&&c.ops.length<=p){
    let ok=true;for(let i=0;i<c.ops.length;i++)if(c.ops[i]!==ops[i]){ok=false;break}
    if(ok){from=c.ops.length;b=c.bg}
  }
  for(let i=from;i<p;i++)b=bgStep(b,ops[i]);
  if(p>0&&from<p)bgCache={src:bg0,ops:ops.slice(0,p),bg:b};
  bg=b;
  if(L.width!==b.width||L.height!==b.height)newLayer(b.width,b.height);else lc.clearRect(0,0,L.width,L.height);
  for(let i=p;i<ops.length;i++){const o=ops[i];if(isResizeOp(o))applyResizeOp(o);else{drawOp(lc,o);if(o.t==='erase'&&o.d)wipeStencils(o.d)}}
}
// A stencil removed by the eraser is listed (by its index in the history) in the "d" field of the erase operation
// that touched it, so removing, undoing and redoing it are one history step. At that point of the history the
// stencil is drawn again with destination-out (1 px wider), which clears exactly what it painted: earlier fills
// and strokes see the stencil, later ones do not.
function wipeStencils(list){
  lc.save();lc.globalCompositeOperation='destination-out';
  for(const i of list){const o=ops[i];if(o&&o.t==='stencil')drawStencil(lc,o,1)}
  lc.restore();
}
function deadStencils(){
  const dead=new Set();
  for(const o of ops)if(o.t==='erase'&&o.d)for(const i of o.d)dead.add(i);
  if(cur&&cur.d)for(const i of cur.d)dead.add(i);
  return dead;
}

/* ---------- view ---------- */
function resize(){
  const r=stage.getBoundingClientRect(),d=devicePixelRatio||1;
  // When the view changes shape (device rotation, toolbar wrapping...) keep the same part of the image
  // in the center of the view: same zoom, and the image point that was at the old center stays at the new one.
  if(bg&&viewW&&viewH&&(r.width!==viewW||r.height!==viewH)){
    const ix=(viewW/2-ox)/s,iy=(viewH/2-oy)/s;
    ox=r.width/2-ix*s;oy=r.height/2-iy*s;
  }
  viewW=r.width;viewH=r.height;clampSpot();
  cv.width=Math.round(r.width*d);cv.height=Math.round(r.height*d);render();
}
function render(){
  const d=devicePixelRatio||1;
  ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#1f2326';ctx.fillRect(0,0,cv.width,cv.height);
  if(!bg){crop=null;dropSpot();positionCrop();return}
  ctx.setTransform(d*s,0,0,d*s,d*ox,d*oy);
  ctx.imageSmoothingQuality='high';
  ctx.drawImage(bg,0,0);ctx.drawImage(L,0,0);
  if(cur&&!(cur.t==='pen'||cur.t==='erase'))drawOp(ctx,cur);
  if(pending)drawOp(ctx,pending);
  if(eraserPt&&tool==='erase'&&ptrs.size<2&&!tmp&&!panning&&!spaceDown){   // eraser footprint: what a touch here would clean
    const rr=widths.erase/2*s*d;
    ctx.setTransform(1,0,0,1,0,0);ctx.beginPath();ctx.arc(eraserPt[0]*d,eraserPt[1]*d,rr,0,Math.PI*2);
    ctx.fillStyle='rgba(255,255,255,.35)';ctx.fill();
    ctx.lineWidth=d*2;ctx.strokeStyle='rgba(255,255,255,.9)';ctx.stroke();
    ctx.lineWidth=d;ctx.strokeStyle='rgba(0,0,0,.65)';ctx.stroke();
  }
  ctx.setTransform(d*s,0,0,d*s,d*ox,d*oy);
  ctx.strokeStyle='rgba(255,255,255,.25)';ctx.lineWidth=1/s;ctx.strokeRect(0,0,bg.width,bg.height);
  if(crop){   // crop area: the rest is dimmed, thin lines (dark under light, readable on any image) mark the box
    const {x0,y0,x1,y1}=crop,W=bg.width,H=bg.height;
    ctx.fillStyle='rgba(0,0,0,.5)';
    ctx.fillRect(0,0,W,y0);ctx.fillRect(0,y1,W,H-y1);ctx.fillRect(0,y0,x0,y1-y0);ctx.fillRect(x1,y0,W-x1,y1-y0);
    ctx.strokeStyle='rgba(0,0,0,.7)';ctx.lineWidth=3/s;ctx.strokeRect(x0,y0,x1-x0,y1-y0);
    ctx.strokeStyle='#fff';ctx.lineWidth=1/s;ctx.strokeRect(x0,y0,x1-x0,y1-y0);
  }
  positionMove();positionCrop();
  if(spot)scheduleSpot();
}
function fit(){
  if(!bg)return;const r=stage.getBoundingClientRect();
  s=Math.min(r.width/bg.width,r.height/bg.height)*.96;
  ox=(r.width-bg.width*s)/2;oy=(r.height-bg.height*s)/2;render();
}
function zoomAt(f,px,py){
  const n=Math.min(40,Math.max(.05,s*f));
  ox=px-(px-ox)/s*n;oy=py-(py-oy)/s*n;s=n;render();
}
const toImg=e=>{
  if(viaSpot){   // through the spotlight: its box shows spotRect() of the image, at its own scale
    const r=spotCv.getBoundingClientRect(),q=spotRect()||{x:0,y:0,w:r.width,h:r.height};
    return[q.x+(e.clientX-r.left)/r.width*q.w,q.y+(e.clientY-r.top)/r.height*q.h];
  }
  const r=cv.getBoundingClientRect();return[(e.clientX-r.left-ox)/s,(e.clientY-r.top-oy)/s];
};
const local=e=>{const r=cv.getBoundingClientRect();return[e.clientX-r.left,e.clientY-r.top]};

/* ---------- temporary zoom / move (multi-tap and hold) ---------- */
// Double tap (or double click) and keep the second press down: temporary ZOOM mode, moving up zooms in and
// moving down zooms out around the pressed point. Triple tap and hold: temporary MOVE mode, any movement pans.
// Releasing goes back to normal: the selected tool is never changed, so it is simply active again.
// A quick tap is also a normal action (a pen dot, a fill...), so when the gesture is recognized the effects of
// the preceding taps are removed from the history again.
const TAP_MAX_DUR=250,TAP_GAP=350,TAP_DIST=24,TAP_SLOP=8,ZOOM_SENS=150;   // ms, ms, px, px, px per e-fold
let eraserPt=null;                                  // pointer position (view pixels) for the eraser footprint
let eraserRaf=0;
let tmp=null;                                       // active temporary mode: {id,mode,t0,x,y,moved,ly,ax,ay}
let tapSeq={n:0,tEnd:0,x:0,y:0,type:'',tracked:[]}; // consecutive quick taps so far
let press=null;                                     // the single press being watched to see if it is a quick tap
const SHAPE_TOOLS=new Set(['line','arrow','rect','circle','star']);
function showToolButtons(active){                   // highlight one toolbar tool (null: none) without changing the tool
  document.querySelectorAll('button[data-t]').forEach(x=>x.setAttribute('aria-pressed',String(x.dataset.t===active&&(active!=='stencil'||x.dataset.k===stencilKind))));
  $('shapesBtn').setAttribute('aria-pressed',String(SHAPE_TOOLS.has(active)));
  $('stencilsBtn').setAttribute('aria-pressed',String(active==='stencil'));
}
function undoTapOps(){                              // drop what the preceding quick taps did
  let removed=false;
  for(const k of tapSeq.tracked.reverse()){
    if(ops[ops.length-1]===k.op){ops.pop();redoStack=k.redo;removed=true}
  }
  tapSeq.tracked=[];
  if(removed){replay();persist();ui();render()}
}
function startTemp(e,mode){
  undoTapOps();
  fillTap=null;tapTrack=null;press=null;
  const q=local(e);
  tmp={id:e.pointerId,mode,t0:performance.now(),x:e.clientX,y:e.clientY,moved:false,ly:e.clientY,ax:q[0],ay:q[1]};
  if(mode==='move'){panning=true;last=q;showToolButtons('pan')}
  else{$('zo').setAttribute('aria-pressed','true');$('zi').setAttribute('aria-pressed','true')}
  setCursor();
}
function endTemp(){
  if(!tmp)return;
  tmp=null;panning=false;
  showToolButtons(tool);$('zo').setAttribute('aria-pressed','false');$('zi').setAttribute('aria-pressed','false');
  setCursor();
}

/* ---------- pointer handling ---------- */
function onDown(e){   // pointer down on the canvas, or on the spotlight box (single pointer, drawing tools only)
  viaSpot=e.currentTarget===spotCv;
  if(!bg)return;
  if(viaSpot?(!spot||crop||ptrs.size>0||tool==='pan'||e.button!==0):spotId!==null)return;
  if(palmOn&&palmDown(e))return;
  if(viaSpot)spotId=e.pointerId;
  (viaSpot?spotCv:cv).setPointerCapture(e.pointerId);
  ptrs.set(e.pointerId,local(e));
  if(ptrs.size===2){fillTap=null;tapTrack=null;press=null;tapSeq.n=0;endTemp();cancelCur();startPinch();return}
  if(ptrs.size>2)return;
  if(crop){panning=true;last=local(e);setCursor();return}   // while cropping, a single touch only pans the view
  if(viaSpot){press=null;tapSeq.n=0}
  else if(e.button===0){
    const now=performance.now();
    if(tapSeq.n>=1&&now-tapSeq.tEnd<=TAP_GAP&&e.pointerType===tapSeq.type&&Math.hypot(e.clientX-tapSeq.x,e.clientY-tapSeq.y)<=TAP_DIST){
      startTemp(e,tapSeq.n>=2?'move':'zoom');return;   // second press: zoom, third press: move
    }
    press={id:e.pointerId,t0:now,x:e.clientX,y:e.clientY,moved:false,redo:redoStack};
  }else press=null;
  if(!viaSpot&&(tool==='pan'||spaceDown||e.button===1||e.button===2)){panning=true;last=local(e);setCursor();return}
  if(tool==='fill'){fillTap={id:e.pointerId,p:toImg(e),sx:e.clientX,sy:e.clientY,c:$('color').value};return}   // applied on release
  if(pending){tapTrack={id:e.pointerId,sx:e.clientX,sy:e.clientY,p0:toImg(e)};return}   // a tap places the pending shape; a drag places it and starts a new one
  if(tool==='erase')viaSpot?spotEraserAt(e):eraserPt=local(e);
  const p=toImg(e),w=widths[wkey()],c=$('color').value;
  if(tool==='stencil')cur={t:'stencil',k:stencilKind,ch:stencilKind==='char'?stencilChar:undefined,c,w,cx:p[0],cy:p[1]};   // follows the pointer, placed on release
  else if(tool==='pen'||tool==='erase'){cur={t:tool,c,w,p:[p]};drawOp(lc,cur);if(tool==='erase'){startEraseSt();eraseTouch(p,p)}}
  else cur={t:tool,c,w,a:p,b:p};
  render();
}
function onMove(e){
  viaSpot=e.currentTarget===spotCv;
  if(palmOn&&palmRej.has(e.pointerId))return;
  if(tool==='erase'&&bg&&viaSpot)spotEraserAt(e);
  else if(tool==='erase'&&bg){
    eraserPt=local(e);
    if(!ptrs.has(e.pointerId)&&!eraserRaf)eraserRaf=requestAnimationFrame(()=>{eraserRaf=0;render()});   // mouse hover: redraw once per frame
  }
  if(!ptrs.has(e.pointerId))return;
  ptrs.set(e.pointerId,local(e));
  if(ptrs.size===2&&pinch){updatePinch();return}
  if(press&&press.id===e.pointerId&&Math.hypot(e.clientX-press.x,e.clientY-press.y)>TAP_SLOP)press.moved=true;
  if(tmp&&tmp.id===e.pointerId){
    if(Math.hypot(e.clientX-tmp.x,e.clientY-tmp.y)>TAP_SLOP)tmp.moved=true;
    if(tmp.mode==='zoom'){
      const dy=tmp.ly-e.clientY;tmp.ly=e.clientY;     // up = positive = zoom in
      if(dy)zoomAt(Math.exp(dy/ZOOM_SENS),tmp.ax,tmp.ay);
      return;
    }                                                 // move mode: the panning branch below does the work
  }
  if(panning){const q=local(e);ox+=q[0]-last[0];oy+=q[1]-last[1];last=q;render();return}
  if(fillTap&&fillTap.id===e.pointerId&&Math.hypot(e.clientX-fillTap.sx,e.clientY-fillTap.sy)>10)fillTap=null;   // it was a drag, not a tap
  if(tapTrack&&tapTrack.id===e.pointerId){
    if(Math.hypot(e.clientX-tapTrack.sx,e.clientY-tapTrack.sy)>10){
      const t0=tapTrack;tapTrack=null;commitPending();
      cur={t:tool,c:$('color').value,w:widths[wkey()],a:t0.p0,b:toImg(e)};render();
    }
    return;
  }
  if(!cur)return;
  const evs=e.getCoalescedEvents?e.getCoalescedEvents():[e];
  for(const ev of (evs.length?evs:[e])){
    const p=toImg(ev);
    if(cur.t==='pen'||cur.t==='erase'){
      const prev=cur.p[cur.p.length-1];cur.p.push(p);
      drawOp(lc,{...cur,p:[prev,p]});
      if(cur.t==='erase'&&eraseSt.length)eraseTouch(prev,p);
    }else if(cur.t==='stencil'){cur.cx=p[0];cur.cy=p[1]}
    else cur.b=p;
  }
  render();
}
cv.addEventListener('pointerdown',onDown);cv.addEventListener('pointermove',onMove);
function end(e){
  if(palmOn&&palmRej.delete(e.pointerId))return;
  if(e.pointerId===spotId)spotId=null;
  if(!ptrs.has(e.pointerId))return;
  if(palmOn)palmUp(e);
  ptrs.delete(e.pointerId);
  if(ptrs.size<2)pinch=null;
  const now=performance.now();
  if(e.pointerType!=='mouse'&&eraserPt){eraserPt=null;render()}   // a finger left the screen: no footprint any more
  if(e.pointerType!=='mouse'&&spotPt){spotPt=null;scheduleSpot()}
  if(tmp&&tmp.id===e.pointerId){                   // end of a temporary zoom / move press
    const quick=e.type==='pointerup'&&!tmp.moved&&now-tmp.t0<=TAP_MAX_DUR,mode=tmp.mode;
    endTemp();
    if(mode==='zoom'&&quick){tapSeq.n=2;tapSeq.tEnd=now;tapSeq.x=e.clientX;tapSeq.y=e.clientY;tapSeq.tracked=[]}   // may become a triple tap
    else tapSeq.n=0;
    return;
  }
  const n0=ops.length;let created=null;
  if(fillTap&&fillTap.id===e.pointerId){const f=fillTap;fillTap=null;if(e.type==='pointerup')commitFill(f)}
  if(ops.length>n0)created=ops[ops.length-1];
  if(tapTrack&&tapTrack.id===e.pointerId){tapTrack=null;if(e.type==='pointerup')commitPending()}
  const n1=ops.length;
  if(cur&&e.type==='pointerup'){
    const o=cur;cur=null;eraseSt=[];
    const degenerate=!o.p&&o.a&&o.a[0]===o.b[0]&&o.a[1]===o.b[1];   // a shape with no length (stencils have no end point)
    if(degenerate)replay();
    else if(MOVABLE.has(o.t))setPending(o);   // rectangle/circle/star: wait for the user to place it
    else{ops.push(o);redoStack=[];if(o.t==='pen'||o.t==='erase'){}else drawOp(lc,o);persist()}
    ui();render();
  }else if(cur)cancelCur();
  if(!created&&ops.length>n1)created=ops[ops.length-1];
  if(press&&press.id===e.pointerId){                // was it a quick tap? then it may be the first tap of a double/triple tap
    const isTap=e.type==='pointerup'&&!press.moved&&now-press.t0<=TAP_MAX_DUR;
    if(isTap)tapSeq={n:1,tEnd:now,x:e.clientX,y:e.clientY,type:e.pointerType,tracked:created?[{op:created,redo:press.redo}]:[]};
    else tapSeq.n=0;
    press=null;
  }
  if(ptrs.size===0){panning=false;setCursor()}
}
cv.addEventListener('pointerleave',e=>{if(e.pointerType==='mouse'&&eraserPt&&!ptrs.size){eraserPt=null;render()}});
cv.addEventListener('pointerup',end);cv.addEventListener('pointercancel',end);
function cancelCur(){if(cur){cur=null;eraseSt=[];replay();render()}}
// Eraser vs stencils: a stencil is removed as soon as the eraser touches its bounding box.
function startEraseSt(){
  eraseSt=[];const dead=deadStencils();
  ops.forEach((o,i)=>{if(o.t==='stencil'&&!dead.has(i))eraseSt.push({i,b:[o.cx-o.w/2,o.cy-o.w/2,o.cx+o.w/2,o.cy+o.w/2]})});
}
function eraseTouch(a,b){   // marks (in cur.d) the stencils within the eraser radius of the segment a-b; true when any was hit
  const r=cur.w/2,len=Math.hypot(b[0]-a[0],b[1]-a[1]),n=Math.min(400,Math.max(1,Math.ceil(len/Math.max(1,r/2))));let any=false;
  for(let k=eraseSt.length-1;k>=0;k--){
    const q=eraseSt[k].b;
    for(let j=0;j<=n;j++){
      const x=a[0]+(b[0]-a[0])*j/n,y=a[1]+(b[1]-a[1])*j/n,dx=Math.max(q[0]-x,0,x-q[2]),dy=Math.max(q[1]-y,0,y-q[3]);
      if(dx*dx+dy*dy<=r*r){(cur.d||(cur.d=[])).push(eraseSt[k].i);wipeStencils([eraseSt[k].i]);eraseSt.splice(k,1);any=true;break}
    }
  }
  return any;
}

/* ---------- pending shape ---------- */
// After the drag, a rectangle, circle or star is not committed right away. It stays "pending":
// it is previewed on the canvas with a Move button next to it. Dragging that button moves the
// shape (its size does not change). The shape is committed to the image and to the history,
// as a single operation, as soon as the user does anything else.
const MOVABLE=new Set(['rect','circle','star']);
const mvBtn=$('moveBtn');
function setPending(o){
  if(o.t==='rect'){const x0=Math.min(o.a[0],o.b[0]),x1=Math.max(o.a[0],o.b[0]),y0=Math.min(o.a[1],o.b[1]),y1=Math.max(o.a[1],o.b[1]);o.a=[x0,y0];o.b=[x1,y1]}   // a = top-left, b = bottom-right
  pending=o;setHandles();ui();render();
}
function commitPending(){
  if(!pending)return;
  const o=pending;pending=null;
  drawOp(lc,o);ops.push(o);redoStack=[];persist();ui();render();
}
function discardPending(){if(pending){pending=null;tapTrack=null;ui();render()}}
function shapeBox(o){                    // bounding box in image coordinates, stroke included
  const pad=o.w/2;
  if(o.t==='rect')return[Math.min(o.a[0],o.b[0])-pad,Math.min(o.a[1],o.b[1])-pad,Math.max(o.a[0],o.b[0])+pad,Math.max(o.a[1],o.b[1])+pad];
  const r=Math.hypot(o.b[0]-o.a[0],o.b[1]-o.a[1])+pad;   // circle and star: the circle through b
  return[o.a[0]-r,o.a[1]-r,o.a[0]+r,o.a[1]+r];
}
const hA=$('hA'),hB=$('hB'),HB=32;
const ICON_CORNER='<svg viewBox="0 0 24 24"><path d="M5 5l14 14M5 5h6M5 5v6M19 19h-6M19 19v-6"/></svg>';
const ICON_RADIUS='<svg viewBox="0 0 24 24"><path d="M12 4v16M8 8l4-4 4 4M8 16l4 4 4-4"/></svg>';
function setHandles(){   // icons and tooltips depend on the kind of the pending shape
  if(!pending)return;
  for(const h of [hA,hB]){h.style.width=h.style.height=HB+'px';h.style.minHeight='0'}   // round even if an older cached stylesheet still has the 36px minimum for buttons
  const rect=pending.t==='rect';
  hA.innerHTML=rect?ICON_CORNER:ICON_RADIUS;hA.classList.toggle('rad',!rect);
  hA.title=t(rect?'tool.resizeCorner.title':'tool.resizeRadius.title');
  hA.setAttribute('aria-label',t(rect?'tool.resizeCorner.label':'tool.resizeRadius.label'));
  hB.innerHTML=ICON_CORNER;hB.title=t('tool.resizeCorner.title');hB.setAttribute('aria-label',t('tool.resizeCorner.label'));
}
function positionMove(){
  if(!pending){mvBtn.hidden=true;hA.hidden=true;hB.hidden=true;return}
  const [x0,y0,x1,y1]=shapeBox(pending),W=stage.clientWidth,H=stage.clientHeight,B=36,gap=8;
  let top=y1*s+oy+gap,below=true;                        // below the shape...
  if(top+B>H-4){top=y0*s+oy-gap-B;below=false}           // ...or above it when there is no room
  const left=Math.min(Math.max((x0+x1)/2*s+ox-B/2,4),W-B-4);
  top=Math.min(Math.max(top,4),H-B-4);
  mvBtn.style.left=left+'px';mvBtn.style.top=top+'px';mvBtn.hidden=false;
  const put=(h,cx,cy)=>{h.style.left=Math.min(Math.max(cx-HB/2,4),W-HB-4)+'px';h.style.top=Math.min(Math.max(cy-HB/2,4),H-HB-4)+'px';h.hidden=false};
  if(pending.t==='rect'){   // handles just outside the top-left and bottom-right corners
    const o=HB*0.45;
    put(hA,pending.a[0]*s+ox-o,pending.a[1]*s+oy-o);put(hB,pending.b[0]*s+ox+o,pending.b[1]*s+oy+o);
  }else{                    // one radius handle on the side opposite to the Move button
    hB.hidden=true;
    const cx=(x0+x1)/2*s+ox;
    put(hA,cx,below?y0*s+oy-gap-HB/2:y1*s+oy+gap+HB/2);
  }
}
let mvDrag=null;
mvBtn.addEventListener('pointerdown',e=>{
  if(!pending)return;e.preventDefault();mvBtn.setPointerCapture(e.pointerId);
  mvDrag={id:e.pointerId,x:e.clientX,y:e.clientY,a:[...pending.a],b:[...pending.b]};
});
mvBtn.addEventListener('pointermove',e=>{
  if(!mvDrag||mvDrag.id!==e.pointerId||!pending)return;
  const dx=(e.clientX-mvDrag.x)/s,dy=(e.clientY-mvDrag.y)/s;   // screen movement -> image units
  pending.a=[mvDrag.a[0]+dx,mvDrag.a[1]+dy];pending.b=[mvDrag.b[0]+dx,mvDrag.b[1]+dy];
  render();
});
const mvEnd=e=>{if(mvDrag&&mvDrag.id===e.pointerId)mvDrag=null};
mvBtn.addEventListener('pointerup',mvEnd);mvBtn.addEventListener('pointercancel',mvEnd);
// Resize handles: delta based, so the shape follows the finger without jumping. Rectangle: the handles
// move the top-left (a) and bottom-right (b) corners. Circle/star: the handle at the top of the shape
// sets the radius. Like moving, resizing is part of the preview and not a history entry.
let hDrag=null;
for(const [h,which] of [[hA,'a'],[hB,'b']]){
  h.addEventListener('pointerdown',e=>{
    if(!pending)return;e.preventDefault();h.setPointerCapture(e.pointerId);
    hDrag={id:e.pointerId,which,x:e.clientX,y:e.clientY,a:[...pending.a],b:[...pending.b]};
  });
  h.addEventListener('pointermove',e=>{
    if(!hDrag||hDrag.id!==e.pointerId||!pending)return;
    const dx=(e.clientX-hDrag.x)/s,dy=(e.clientY-hDrag.y)/s,d=hDrag;
    if(pending.t==='rect'){pending[d.which]=[d[d.which][0]+dx,d[d.which][1]+dy]}
    else{
      const r0=Math.hypot(d.b[0]-d.a[0],d.b[1]-d.a[1]);
      const r=Math.max(1,Math.hypot(dx,dy-r0));   // the handle starts r0 above the center; r = its new distance from it
      pending.a=[...d.a];pending.b=[d.a[0],d.a[1]-r];
    }
    render();
  });
  const hEnd=e=>{
    if(!hDrag||hDrag.id!==e.pointerId)return;hDrag=null;
    if(pending&&pending.t==='rect'){setPending(pending)}   // normalize the corners again
  };
  h.addEventListener('pointerup',hEnd);h.addEventListener('pointercancel',hEnd);
}
addEventListener('pagehide',commitPending);
// Two-finger gesture: starts as pan only; once the fingers spread/close by more than
// PINCH_THRESHOLD px it locks into zoom only, until a finger is lifted.
const PINCH_THRESHOLD=28;
function pinchState(){
  const [a,b]=[...ptrs.values()];
  return{d:Math.hypot(a[0]-b[0],a[1]-b[1])||1,mx:(a[0]+b[0])/2,my:(a[1]+b[1])/2};
}
function startPinch(){
  const c=pinchState();
  pinch={mode:'pan',d0:c.d,d:c.d,mx:c.mx,my:c.my,ax:0,ay:0};
}
function updatePinch(){
  const c=pinchState();
  if(pinch.mode==='pan'){
    if(Math.abs(c.d-pinch.d0)>PINCH_THRESHOLD){
      // lock into zoom: anchor at the current midpoint, no jump in scale
      pinch.mode='zoom';pinch.ax=c.mx;pinch.ay=c.my;pinch.d=c.d;
    }else{
      ox+=c.mx-pinch.mx;oy+=c.my-pinch.my;pinch.mx=c.mx;pinch.my=c.my;render();return;
    }
  }
  const n=Math.min(40,Math.max(.05,s*c.d/pinch.d));
  ox=pinch.ax-(pinch.ax-ox)/s*n;oy=pinch.ay-(pinch.ay-oy)/s*n;
  s=n;pinch.d=c.d;render();
}
cv.addEventListener('wheel',e=>{
  e.preventDefault();const q=local(e);zoomAt(Math.exp(-e.deltaY*(e.ctrlKey?.01:.0015)),q[0],q[1]);
},{passive:false});

/* ---------- UI ---------- */
function ui(){
  showSize();
  $('undo').disabled=!ops.length&&!pending;$('redo').disabled=!redoStack.length;$('miJpeg').disabled=!bg;$('miResize').disabled=!bg;$('miSpot').disabled=!bg||!!spot;$('miExport').disabled=!bg;$('miSnapNew').disabled=!bg;$('clear').disabled=!bg;
  $('hint').style.display=bg?'none':'flex';
}
// The last drawing tool used before the eraser (not Move, not the eraser itself). Choosing a color while the
// eraser is active switches back to it, or to the pen when there is none.
function leaveEraser(){
  if(tool!=='erase')return;
  selectToolButton(lastEditBtn||document.querySelector('button[data-t="pen"]'));
}
let lastEditBtn=null;
function selectToolButton(b){
  commitPending();
  tool=b.dataset.t;
  if(tool!=='erase'&&tool!=='pan')lastEditBtn=b;
  document.querySelectorAll('button[data-t]').forEach(x=>x.setAttribute('aria-pressed',x===b));
  const isShape=!!b.closest('#shapesList'),isStencil=tool==='stencil';
  $('shapesBtn').setAttribute('aria-pressed',String(isShape));
  $('stencilsBtn').setAttribute('aria-pressed',String(isStencil));
  if(isShape){   // the Shapes button shows the icon of the chosen shape; close its menu
    $('shapesIcon').innerHTML=b.querySelector('svg').outerHTML;
    $('shapesList').hidden=true;$('shapesBtn').setAttribute('aria-expanded','false');
  }
  if(isStencil){stencilKind=b.dataset.k;$('stencilsIcon').innerHTML=b.querySelector('svg').outerHTML;$('stencilsList').hidden=true;$('stencilsBtn').setAttribute('aria-expanded','false')}
  eraserPt=null;spotPt=null;syncWidth();setCursor();render();   // render: the eraser outline disappears when another tool is chosen
}
document.querySelectorAll('button[data-t]').forEach(b=>b.onclick=()=>{
  if(b.dataset.k==='char')openCharDialog(b);   // the letter stencil first asks which letter
  else selectToolButton(b);
});
const wkey=()=>tool==='stencil'?'stencil.'+stencilKind:(tool==='erase'||SHAPE_KEYS.includes(tool))?tool:'pen';   // which remembered width the current tool uses (fill and pan show the pen's)
function syncWidth(){
  const v=widths[wkey()],mx=WMAX[wkey()];
  $('width').max=$('widthL').max=mx;
  $('width').value=v;$('widthL').value=v;                       // inline slider and popup slider
  for(const el of[$('wv'),$('wvPop')])if(document.activeElement!==el){el.value=v;el.classList.remove('bad');el.removeAttribute('aria-invalid')}   // a box being edited keeps what is typed
  $('wvBtn').textContent=v;
}
function setWidth(v){widths[wkey()]=v;if(tool==='erase')render();if(pending&&tool!=='erase'&&tool!=='stencil'){pending.w=v;render()}syncWidth();savePrefs()}
const PK='markup.prefs';
function savePrefs(){try{localStorage.setItem(PK,JSON.stringify({color:$('color').value,widths,sharp:lastSharp}))}catch(e){}}
try{
  const p=JSON.parse(localStorage.getItem(PK)||'null');
  if(p){
    if(/^#[0-9a-f]{6}$/i.test(p.color))$('color').value=p.color;
    applyWidths(p.widths,{draw:p.draw,erase:p.erase,stencil:p.stencil});   // p.draw/erase/stencil: saved by older versions
    if(p.sharp===0||p.sharp===1||p.sharp===2)lastSharp=p.sharp;
  }
}catch(e){}
syncWidth();
const PALETTE=['#e63946','#f77f00','#fcbf49','#2a9d8f','#06d6a0','#118ab2','#7b2cbf','#ff4da6',
  '#000000','#4a4a4a','#9a9a9a','#ffffff','#8b5a2b','#1d3557','#a7c957','#00b4d8'];
const sw=$('sw');
PALETTE.forEach(c=>{
  const b=document.createElement('button');b.style.background=c;b.dataset.c=c;b.title=c;b.setAttribute('aria-label',t('color.swatch',{color:c}));
  b.onclick=()=>{leaveEraser();$('color').value=c;if(pending){pending.c=c;render()}markSw();savePrefs()};sw.appendChild(b);
});
function markSw(){const v=$('color').value.toLowerCase();picker.set(v);sw.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.c===v))}
const picker=createColorPicker({mount:$('cp'),input:$('color'),palette:PALETTE,onChange:(c,final)=>{leaveEraser();markSw();if(pending){pending.c=c;render()}if(final)savePrefs()}});
markSw();
$('width').oninput=e=>setWidth((+e.target.value));
// Typed width: valid whole numbers move the slider at once; invalid ones are flagged and, when the box loses focus
// (or Enter is pressed), a number out of range is clamped to the nearest limit and anything else reverts.
for(const el of[$('wv'),$('wvPop')]){
  const lo=1,hi=()=>WMAX[wkey()];   // the upper limit depends on the tool
  const inRange=s=>/^\d{1,3}$/.test(s)&&Number(s)>=lo&&Number(s)<=hi();
  const flag=bad=>{el.classList.toggle('bad',bad);if(bad)el.setAttribute('aria-invalid','true');else el.removeAttribute('aria-invalid')};
  el.addEventListener('focus',()=>el.select());
  el.addEventListener('input',()=>{
    const s=el.value.trim();
    if(inRange(s)){flag(false);setWidth(Number(s))}
    else flag(s!=='');
  });
  const commit=()=>{
    const s=el.value.trim();
    if(/^\d+$/.test(s))setWidth(Math.min(hi(),Math.max(lo,Number(s))));   // out of range: nearest limit
    flag(false);syncWidth();                                              // empty or not a number: back to the current width
  };
  el.addEventListener('blur',commit);
  el.addEventListener('keydown',e=>{
    if(e.key==='Enter'){e.preventDefault();el.blur()}
    else if(e.key==='Escape'){e.preventDefault();el.value='';el.blur()}    // revert
  });
}
$('widthL').oninput=e=>setWidth((+e.target.value));
function clearWork(all){
  if(!all&&!pending&&ops.every(isResizeOp)){msg(t('msg.nothingToClear'));return}   // resize/crop steps are not drawings
  if(!confirm(t(all?'confirm.clearAll':'confirm.clearDrawing')))return;
  cur=null;ops=all?[]:ops.filter(isResizeOp);redoStack=[];discardPending();resetNames();resetSnapshots();   // clearing the drawing keeps the resize / crop steps in the history
  if(all){
    bg=bg0=L=lc=null;
    try{localStorage.removeItem('markup.bg');localStorage.removeItem('markup.ops')}catch(e){}
    msg(t('msg.removedAll'));
  }else{replay();persist();msg(t('msg.cleared'))}
  ui();render();
}
(()=>{
  const b=$('clear');let timer=null;
  const stop=()=>{b.classList.remove('holding');const t=timer;clearTimeout(timer);timer=null;return t};
  b.addEventListener('pointerdown',e=>{
    if(b.disabled||e.button>0)return;
    b.classList.add('holding');
    timer=setTimeout(()=>{timer=null;b.classList.remove('holding');clearWork(true)},700);
  });
  b.addEventListener('pointerup',()=>{if(stop())clearWork(false)});
  b.addEventListener('pointerleave',stop);
  b.addEventListener('pointercancel',stop);
  b.addEventListener('contextmenu',e=>e.preventDefault());
  b.addEventListener('click',e=>{if(e.detail===0&&!b.disabled)clearWork(false)}); // keyboard
})();
$('undo').onclick=()=>{commitPending();if(!ops.length)return;const o=ops.pop();redoStack.push(o);replay();persist();ui();if(isResizeOp(o))fit();else render()};
$('redo').onclick=()=>{commitPending();if(!redoStack.length)return;const o=redoStack.pop();ops.push(o);if(isResizeOp(o)){applyResizeOp(o);syncBgCache();persist();ui();fit()}else{if(o.t==='erase'&&o.d)replay();else drawOp(lc,o);persist();ui();render()}};
// Long press: jump to the very first (Undo) or the very last (Redo) step of the history.
function undoAll(){commitPending();if(!ops.length)return;redoStack.push(...ops.reverse());ops=[];replay();persist();ui();fit()}   // reversed, so Redo gives the steps back in order
function redoAll(){commitPending();if(!redoStack.length)return;ops.push(...redoStack.reverse());redoStack=[];replay();persist();ui();fit()}
function longPress(b,action,ms=600){
  let timer=null,fired=false;
  const stop=()=>{b.classList.remove('holding');clearTimeout(timer);timer=null};
  b.addEventListener('pointerdown',e=>{
    if(b.disabled||e.button>0)return;
    fired=false;b.classList.add('holding');
    timer=setTimeout(()=>{timer=null;fired=true;b.classList.remove('holding');action()},ms);
  });
  b.addEventListener('pointerup',()=>{stop();setTimeout(()=>{fired=false},60)});b.addEventListener('pointerleave',stop);b.addEventListener('pointercancel',stop);
  b.addEventListener('contextmenu',e=>e.preventDefault());
  b.addEventListener('click',e=>{if(fired){fired=false;e.stopImmediatePropagation()}},true);   // the click that ends a long press is not a short press
}
longPress($('undo'),undoAll);longPress($('redo'),redoAll);
$('zi').onclick=()=>{const r=cv.getBoundingClientRect();zoomAt(1.25,r.width/2,r.height/2)};
$('zo').onclick=()=>{const r=cv.getBoundingClientRect();zoomAt(.8,r.width/2,r.height/2)};
$('fit').onclick=fit;
let spaceDown=false;
function setCursor(){$('spotCv').style.cursor=tool==='pan'?'default':'crosshair';cv.style.cursor=panning?'grabbing':tmp?'ns-resize':(tool==='pan'||spaceDown)?'grab':'crosshair'}
addEventListener('keydown',e=>{
  if(e.target.closest&&e.target.closest('dialog'))return;   // let dialogs handle their own keys
  if((e.ctrlKey||e.metaKey)&&!(e.target.tagName==='INPUT'&&e.target.type==='text')){   // in a text box Ctrl+Z edits the text
    const k=e.key.toLowerCase();
    if(k==='z'&&!e.shiftKey){e.preventDefault();$('undo').click();return}
    if(k==='y'||(k==='z'&&e.shiftKey)){e.preventDefault();$('redo').click();return}
  }
  if(e.code==='Space'&&e.target.tagName!=='BUTTON'&&e.target.tagName!=='INPUT'){e.preventDefault();spaceDown=true;setCursor()}
  const k={ArrowLeft:[60,0],ArrowRight:[-60,0],ArrowUp:[0,60],ArrowDown:[0,-60]}[e.key];
  if(k&&e.target.tagName!=='INPUT'){ox+=k[0];oy+=k[1];render()}
});
addEventListener('keyup',e=>{if(e.code==='Space'){spaceDown=false;setCursor()}});
cv.addEventListener('contextmenu',e=>e.preventDefault());

/* ---------- image loading ---------- */
function showSize(){$('dim').textContent=bg?t('app.imageSize',{w:bg.width,h:bg.height}):''}   // size of the edited image, bottom-left
function setBackground(img){
  const k=Math.min(1,MAXDIM/Math.max(img.width,img.height));
  const c=document.createElement('canvas');c.width=Math.round(img.width*k);c.height=Math.round(img.height*k);
  const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height);x.drawImage(img,0,0,c.width,c.height);
  crop=null;dropSpot();bg=bg0=c;newLayer(c.width,c.height);showSize();
}
$('file').onchange=e=>{
  const f=e.target.files[0];e.target.value='';if(!f)return;
  if((ops.length||pending)&&!confirm(t('confirm.openImage')))return;
  const url=URL.createObjectURL(f),img=new Image();
  img.onload=()=>{setBackground(img);URL.revokeObjectURL(url);ops=[];redoStack=[];discardPending();resetNames();resetSnapshots();persist(true);ui();fit()};
  img.onerror=()=>msg(t('msg.badImage'));
  img.src=url;
};

/* ---------- local storage ---------- */
function persist(withBg){
  try{
    if(withBg)localStorage.setItem('markup.bg',bg0.toDataURL('image/jpeg',.88));
    localStorage.setItem('markup.ops',JSON.stringify(ops));
  }catch(err){msg(t('msg.storageFull'))}
}
function restore(){
  try{
    const data=localStorage.getItem('markup.bg');if(!data)return;
    const img=new Image();
    img.onload=()=>{
      setBackground(img);
      try{ops=JSON.parse(localStorage.getItem('markup.ops')||'[]')}catch(e){ops=[]}
      replay();ui();fit();
    };
    img.src=data;
  }catch(e){}
}

/* ---------- export / import ---------- */
function download(blob,name){
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;
  document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),2000);
}
function saveJpeg(name){
  const c=document.createElement('canvas');c.width=bg.width;c.height=bg.height;
  const x=c.getContext('2d');x.drawImage(bg,0,0);x.drawImage(L,0,0);
  c.toBlob(b=>download(b,name),'image/jpeg',.92);
}
function buildStatus(){   // the application status; shared by Export status and Snapshots
  return{
    format:'markup-status',version:2,exportedAt:new Date().toISOString(),
    background:bg0.toDataURL('image/jpeg',.88),   // the original background; the frames are in the operations
    operations:ops,
    preferences:{color:$('color').value,widths:{...widths}}
  };
}
function exportStatus(name){
  download(new Blob([JSON.stringify(buildStatus())],{type:'application/json'}),name);
}
const num=v=>typeof v==='number'&&isFinite(v);
const pt=p=>Array.isArray(p)&&p.length===2&&num(p[0])&&num(p[1]);
function validOp(o){
  if(o&&o.t==='scale')return (o.s===undefined||o.s===0||o.s===1||o.s===2)&&Number.isInteger(o.w)&&Number.isInteger(o.h)&&o.w>=1&&o.h>=1&&o.w<=MAXDIM&&o.h<=MAXDIM;
  if(o&&o.t==='crop')return [o.x,o.y,o.w,o.h].every(Number.isInteger)&&o.x>=0&&o.y>=0&&o.w>=1&&o.h>=1&&o.x<=MAXDIM&&o.y<=MAXDIM&&o.w<=MAXDIM&&o.h<=MAXDIM;
  if(o&&o.t==='frame')return [o.top,o.right,o.bottom,o.left].every(v=>Number.isInteger(v)&&v>=0&&v<=MAXDIM)&&typeof o.c==='string'&&/^#[0-9a-f]{6}$/i.test(o.c);
  if(o&&o.t==='fill')return typeof o.c==='string'&&num(o.x)&&num(o.y)&&num(o.tol);
  if(!o||typeof o!=='object'||!num(o.w)||typeof o.c!=='string')return false;
  if(o.t==='stencil')return ['x','circle','tri','square','char'].includes(o.k)&&num(o.cx)&&num(o.cy)&&o.w>0&&(o.k!=='char'||(typeof o.ch==='string'&&o.ch.length>=1&&o.ch.length<=4));
  if(o.t==='erase'&&o.d!==undefined&&!(Array.isArray(o.d)&&o.d.every(Number.isInteger)))return false;
  if(o.t==='pen'||o.t==='erase')return Array.isArray(o.p)&&o.p.length>0&&o.p.every(pt);
  if(o.t==='line'||o.t==='arrow'||o.t==='rect'||o.t==='circle'||o.t==='star')return pt(o.a)&&pt(o.b);
  return false;
}
function validStatus(st){
  return!!st&&st.format==='markup-status'&&typeof st.background==='string'&&st.background.startsWith('data:image/')&&Array.isArray(st.operations)&&st.operations.every(validOp);
}
// Replace the current work with a status object (from a file or a snapshot). The caller has validated it
// and asked for confirmation. It replaces the background, so the snapshots are dropped.
function restoreStatus(st,okMsg){
  const img=new Image();
  img.onload=()=>{
    const k=Math.min(1,MAXDIM/Math.max(img.width,img.height));let W=Math.round(img.width*k),H=Math.round(img.height*k);
    for(const o of st.operations){if(o.t==='frame'){W+=o.left+o.right;H+=o.top+o.bottom}else if(o.t==='scale'||o.t==='crop'){W=o.w;H=o.h}}
    if(W>MAXDIM||H>MAXDIM){msg(t('msg.badStatus'));return}   // the frames would make the image too large
    setBackground(img);cur=null;ops=JSON.parse(JSON.stringify(st.operations));redoStack=[];discardPending();resetNames();resetSnapshots();replay();   // the background changes, so the snapshots go
    const p=st.preferences||{};
    if(typeof p.color==='string'&&/^#[0-9a-f]{6}$/i.test(p.color))$('color').value=p.color;
    applyWidths(p.widths,{draw:p.drawWidth,erase:p.eraseWidth,stencil:p.stencilWidth});   // version 1 files have only drawWidth/eraseWidth
    syncWidth();markSw();savePrefs();persist(true);ui();fit();msg(okMsg);
  };
  img.onerror=()=>msg(t('msg.badBackground'));
  img.src=st.background;
}
function importStatus(file){
  const fr=new FileReader();
  fr.onerror=()=>msg(t('msg.fileRead'));
  fr.onload=()=>{
    let st;
    try{st=JSON.parse(fr.result)}catch(e){msg(t('msg.badJson'));return}
    if(!validStatus(st)){msg(t('msg.badStatus'));return}
    if(bg&&!confirm(t('confirm.import')))return;
    restoreStatus(st,t('msg.imported'));
  };
  fr.readAsText(file);
}

/* ---------- snapshots ---------- */
// Named copies of the work, kept in localStorage, newest first. A snapshot stores only the operation list and
// the preferences, deflate-compressed: the background is NOT copied, because it is always the one already saved
// in markup.bg. That is safe since everything that replaces the background (Open image, Empty image, Clear,
// Import status) also clears the snapshots. They are not part of the exported JSON.
// Entry: {id,name,created,enc,data}; enc 'deflate' = base64 of the deflated JSON, 'json' = plain JSON
// (used when the browser has no CompressionStream).
const SNAP_KEY='markup.snapshots';
let snaps=[],saveSnapsLater=false;
try{
  const a=JSON.parse(localStorage.getItem(SNAP_KEY)||'[]');
  if(Array.isArray(a)){
    snaps=a.filter(x=>x&&typeof x.name==='string'&&num(x.created)&&typeof x.id==='string'&&typeof x.data==='string'&&(x.enc==='deflate'||x.enc==='json'));
    if(snaps.length!==a.length)saveSnapsLater=true;   // entries from an older format were dropped
  }
}catch(e){snaps=[]}
function saveSnaps(){
  try{if(snaps.length)localStorage.setItem(SNAP_KEY,JSON.stringify(snaps));else localStorage.removeItem(SNAP_KEY);return true}
  catch(e){return false}
}
if(saveSnapsLater)saveSnaps();
async function streamBytes(bytes,stream){
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}
function toBase64(u8){let s='';for(let i=0;i<u8.length;i+=0x8000)s+=String.fromCharCode.apply(null,u8.subarray(i,i+0x8000));return btoa(s)}
function fromBase64(b){const s=atob(b),u=new Uint8Array(s.length);for(let i=0;i<s.length;i++)u[i]=s.charCodeAt(i);return u}
async function packSnapshot(obj){
  const json=JSON.stringify(obj);
  if(!window.CompressionStream)return{enc:'json',data:json};
  try{return{enc:'deflate',data:toBase64(await streamBytes(new TextEncoder().encode(json),new CompressionStream('deflate')))}}
  catch(e){return{enc:'json',data:json}}
}
async function unpackSnapshot(s){
  if(s.enc==='json')return JSON.parse(s.data);
  return JSON.parse(new TextDecoder().decode(await streamBytes(fromBase64(s.data),new DecompressionStream('deflate'))));
}
function resetSnapshots(){snaps=[];try{localStorage.removeItem(SNAP_KEY)}catch(e){}renderSnaps()}
let renderSnaps=()=>{};   // replaced by the menu code below
const snapDlg=$('snapDlg');
function openSnapDialog(){
  $('snapErr').hidden=true;$('snapOk').disabled=false;$('snapInput').value=String(snaps.length+1).padStart(2,'0');
  snapDlg.showModal();$('snapInput').select();
}
async function confirmSnapshot(){
  const n=$('snapInput').value.trim();
  if(!n){const e=$('snapErr');e.textContent=t('snapdlg.error');e.hidden=false;return}
  $('snapOk').disabled=true;                                   // compressing is asynchronous: ignore a second click
  const entry={id:Date.now().toString(36)+Math.random().toString(36).slice(2,6),name:n,created:Date.now(),
    ...await packSnapshot({operations:ops,preferences:{color:$('color').value,widths:{...widths}}})};   // packing copies the ops
  snaps.push(entry);
  if(!saveSnaps()){snaps.pop();const e=$('snapErr');e.textContent=t('snapdlg.full');e.hidden=false;$('snapOk').disabled=false;return}   // quota exceeded: nothing was changed
  snapDlg.close();renderSnaps();msg(t('msg.snapSaved',{name:n}));
}
$('snapOk').onclick=confirmSnapshot;
$('snapCancel').onclick=()=>snapDlg.close();
$('snapInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();if(!$('snapOk').disabled)confirmSnapshot()}});
async function restoreSnapshot(id){
  const s=snaps.find(x=>x.id===id);if(!s)return;
  if(!confirm(t('confirm.snapRestore',{name:s.name})))return;
  try{
    const d=await unpackSnapshot(s);
    if(!bg0||!d||!Array.isArray(d.operations)||!d.operations.every(validOp))throw new Error('bad snapshot');
    let W=bg0.width,H=bg0.height;
    for(const o of d.operations){if(o.t==='frame'){W+=o.left+o.right;H+=o.top+o.bottom}else if(o.t==='scale'||o.t==='crop'){W=o.w;H=o.h}}
    if(W>MAXDIM||H>MAXDIM)throw new Error('too large');
    cur=null;ops=d.operations;redoStack=[];discardPending();resetNames();replay();   // same background, new history
    const p=d.preferences||{};
    if(typeof p.color==='string'&&/^#[0-9a-f]{6}$/i.test(p.color))$('color').value=p.color;
    applyWidths(p.widths,{draw:p.drawWidth,erase:p.eraseWidth,stencil:p.stencilWidth});   // version 1 files have only drawWidth/eraseWidth
    syncWidth();markSw();savePrefs();persist();ui();fit();showSize();msg(t('msg.snapRestored',{name:s.name}));
  }catch(e){msg(t('msg.badStatus'))}
}
function deleteSnapshot(id){
  const s=snaps.find(x=>x.id===id);if(!s)return;
  if(!confirm(t('confirm.snapDelete',{name:s.name})))return;
  snaps=snaps.filter(x=>x!==s);saveSnaps();renderSnaps();
}

/* ---------- main menu ---------- */
(()=>{
  const btn=$('menuBtn'),list=$('menuList');
  const subs=[{mi:$('miNew'),sub:$('subNew')},{mi:$('miResize'),sub:$('subResize')},{mi:$('miSnap'),sub:$('subSnap')}];   // submenus: the parent entry and its list
  const items=()=>[...list.querySelectorAll('button:not(:disabled)')].filter(b=>b.offsetParent!==null);
  function toggleSub(sb,show){
    for(const x of subs){const v=x===sb&&show;x.sub.hidden=!v;x.mi.setAttribute('aria-expanded',String(v))}   // one at a time
    closeSnapPop();
    if(!list.hidden)placePopup(list,btn);     // the menu got taller or shorter
  }
  // The existing snapshots are listed in their own popup next to the "Existing snapshots" entry.
  // It never exceeds the visible area; longer lists scroll.
  const pop=$('snapPop'),miList=$('miSnapList');
  function placeSnapPop(){
    const vw=document.documentElement.clientWidth,vh=document.documentElement.clientHeight,m=6;
    pop.style.maxHeight=(vh-2*m)+'px';pop.style.left='0px';pop.style.top='0px';
    const e=miList.getBoundingClientRect(),w=pop.offsetWidth,h=pop.offsetHeight;
    let x=e.right+4;if(x+w>vw-m)x=e.left-4-w;      // right of the entry, else left of it, else just kept on screen
    pop.style.left=Math.min(Math.max(m,x),Math.max(m,vw-w-m))+'px';
    pop.style.top=Math.min(Math.max(m,e.top),Math.max(m,vh-h-m))+'px';
  }
  function openSnapPop(){
    if(!snaps.length)return;
    pop.hidden=false;miList.setAttribute('aria-expanded','true');placeSnapPop();
    pop.querySelector('button')?.focus();
  }
  function closeSnapPop(focusEntry){
    pop.hidden=true;miList.setAttribute('aria-expanded','false');
    if(focusEntry&&!list.hidden)miList.focus();
  }
  renderSnaps=()=>{
    pop.textContent='';
    const sorted=snaps.slice().sort((a,b)=>b.created-a.created);
    miList.disabled=!sorted.length;
    if(!sorted.length&&!pop.hidden)closeSnapPop(true);
    for(const s of sorted){
      const row=document.createElement('div');row.className='snap-row';row.setAttribute('role','none');
      const nb=document.createElement('button');nb.type='button';nb.setAttribute('role','menuitem');nb.className='snap-name';
      nb.textContent=s.name;nb.title=t('snap.restore.title',{name:s.name,date:new Date(s.created).toLocaleString(i18n.lang)});
      nb.onclick=()=>{close();restoreSnapshot(s.id)};
      const del=document.createElement('button');del.type='button';del.setAttribute('role','menuitem');del.className='snap-del';
      del.title=t('snap.delete.title',{name:s.name});del.setAttribute('aria-label',t('snap.delete.title',{name:s.name}));
      del.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';
      del.onclick=()=>{deleteSnapshot(s.id)};
      row.append(nb,del);pop.appendChild(row);
    }
    if(!pop.hidden)placeSnapPop();
  };
  renderSnaps();
  miList.onclick=()=>pop.hidden?openSnapPop():closeSnapPop();
  pop.addEventListener('keydown',e=>{
    const it=[...pop.querySelectorAll('button')],i=it.indexOf(document.activeElement);
    if(e.key==='Escape'||e.key==='ArrowLeft')closeSnapPop(true);
    else if(e.key==='ArrowDown')it[(i+1)%it.length]?.focus();
    else if(e.key==='ArrowUp')it[(i-1+it.length)%it.length]?.focus();
    else if(e.key==='ArrowRight'&&document.activeElement.classList.contains('snap-name'))pop.querySelectorAll('.snap-del')[Math.floor(i/2)]?.focus();
    else return;
    e.preventDefault();e.stopPropagation();
  });
  addEventListener('resize',()=>{if(!pop.hidden)placeSnapPop()});
  function open(){
    toggleSub(null,false);list.hidden=false;placePopup(list,btn);
    btn.setAttribute('aria-expanded','true');
  }
  function close(focusBtn){closeSnapPop();list.hidden=true;btn.setAttribute('aria-expanded','false');if(focusBtn)btn.focus()}
  btn.onclick=()=>{list.hidden?(open(),items()[0]?.focus()):close()};
  addEventListener('pointerdown',e=>{if(!list.hidden&&!$('mainMenu').contains(e.target))close()});
  list.addEventListener('keydown',e=>{
    const it=items(),i=it.indexOf(document.activeElement);
    const parent=subs.find(x=>x.mi===document.activeElement),inSub=subs.find(x=>x.sub.contains(document.activeElement));
    if(e.key==='Escape'){close(true)}
    else if(e.key==='ArrowDown'){it[(i+1)%it.length]?.focus()}
    else if(e.key==='ArrowUp'){it[(i-1+it.length)%it.length]?.focus()}
    else if(e.key==='ArrowRight'&&parent){toggleSub(parent,true);items()[i+1]?.focus()}
    else if(e.key==='ArrowLeft'&&inSub){toggleSub(inSub,false);inSub.mi.focus()}
    else return;
    e.preventDefault();e.stopPropagation();
  });
  for(const x of subs)x.mi.onclick=()=>toggleSub(x,x.sub.hidden);
  $('miFrame').onclick=()=>{close();openFrameDialog()};
  $('miScale').onclick=()=>{close();openScaleDialog()};
  $('miCrop').onclick=()=>{close();openCrop()};
  $('miSpot').onclick=()=>{close();openSpot()};
  $('miOpen').onclick=()=>{close();$('file').click()};
  $('miEmpty').onclick=()=>{close();openNewDialog()};
  $('miSnapNew').onclick=()=>{close();commitPending();openSnapDialog()};
  $('miJpeg').onclick=()=>{close();commitPending();askFileName('jpeg')};
  $('miExport').onclick=()=>{close();commitPending();askFileName('status')};
  $('miImport').onclick=()=>{close();$('importFile').click()};
  $('miSettings').onclick=()=>{close();openSettings()};
  // Force-reload: drop the service worker and its cached files, then reload so everything is fetched
  // again from the server. The drawing and settings live in localStorage and are not touched.
  $('miReload').onclick=async()=>{
    close();
    if(!navigator.onLine){msg(t('msg.reloadOffline'));return}   // without a connection the cleared cache could not be refilled
    commitPending();
    try{
      if('serviceWorker' in navigator)await Promise.all((await navigator.serviceWorker.getRegistrations()).map(r=>r.unregister()));
      if(window.caches)await Promise.all((await caches.keys()).map(k=>caches.delete(k)));
    }catch(e){}
    // The browser's own HTTP cache can still hold old copies (translations included): fetch every file
    // listed in sw.js again, bypassing it, so that the reloaded page gets the server's current versions.
    try{
      const sw=await(await fetch('sw.js',{cache:'reload'})).text();
      const list=/ASSETS\s*=\s*\[([\s\S]*?)\]/.exec(sw);
      const urls=list?[...list[1].matchAll(/'([^']+)'/g)].map(x=>x[1]):[];
      for(const l of(i18n.lang?[i18n.lang]:[]))urls.push('./locale/'+l+'.json');
      await Promise.all([...new Set(urls)].map(u=>fetch(u,{cache:'reload'}).catch(()=>{})));
    }catch(e){}
    location.reload();
  };
  $('importFile').onchange=e=>{const f=e.target.files[0];e.target.value='';if(f)importStatus(f)};
})();

/* ---------- shapes and stencils menus ---------- */
function dropMenu(btnId,listId,menuId){
  const btn=$(btnId),list=$(listId);
  const items=()=>[...list.querySelectorAll('button')];
  function open(){
    list.hidden=false;placePopup(list,btn);
    btn.setAttribute('aria-expanded','true');
  }
  function close(focusBtn){list.hidden=true;btn.setAttribute('aria-expanded','false');if(focusBtn)btn.focus()}
  btn.onclick=()=>{
    if(!list.hidden){close();return}
    open();(items().find(b=>b.getAttribute('aria-pressed')==='true')||items()[0]).focus();
  };
  addEventListener('pointerdown',e=>{if(!list.hidden&&!$(menuId).contains(e.target))close()});
  list.addEventListener('keydown',e=>{
    const it=items(),i=it.indexOf(document.activeElement);
    if(e.key==='Escape'){close(true)}
    else if(e.key==='ArrowDown'){it[(i+1)%it.length].focus()}
    else if(e.key==='ArrowUp'){it[(i-1+it.length)%it.length].focus()}
    else return;
    e.preventDefault();e.stopPropagation();
  });
  return close;
}
dropMenu('shapesBtn','shapesList','shapesMenu');
const closeStencils=dropMenu('stencilsBtn','stencilsList','stencilsMenu');

/* ---------- letter stencil dialog ---------- */
const charDlg=$('charDlg');let charBtn=null;
function openCharDialog(b){
  charBtn=b;closeStencils();commitPending();
  $('charInput').value=stencilChar;$('charErr').hidden=true;
  charDlg.showModal();$('charInput').focus();$('charInput').select();
}
function confirmChar(){
  const v=$('charInput').value.trim(),cs=Array.from(v);
  if(cs.length!==1){$('charErr').textContent=t('chardlg.error');$('charErr').hidden=false;return}
  stencilChar=cs[0];charDlg.close();selectToolButton(charBtn);
}
$('charOk').onclick=confirmChar;
$('charCancel').onclick=()=>charDlg.close();
$('charInput').addEventListener('input',()=>{$('charErr').hidden=true});
$('charInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();confirmChar()}});

/* ---------- settings dialog ---------- */
const setDlg=$('settingsDlg');
async function openSettings(){
  $('setErr').hidden=true;
  const sel=$('setLang'),langs=await i18n.languages();
  sel.innerHTML='';
  sel.add(new Option(t('settings.langAuto'),'auto'));
  langs.forEach(l=>sel.add(new Option(l.name,l.code)));
  sel.value=[...sel.options].some(o=>o.value===settings.lang)?settings.lang:'auto';
  $('setW').value=settings.newW;$('setH').value=settings.newH;$('setDiag').checked=settings.diag;$('setPalm').checked=settings.palm;$('setPalmMs').value=settings.palmMs;setDlg.querySelectorAll('.help').forEach(b=>{$(b.dataset.help).hidden=true;b.setAttribute('aria-expanded','false')});
  setDlg.showModal();
}
function applySettings(){
  const w=parseInt($('setW').value,10),h=parseInt($('setH').value,10);
  if(!validSize(w)||!validSize(h)){
    const e=$('setErr');e.textContent=t('newdlg.error',{min:16,max:MAXDIM});e.hidden=false;return;
  }
  let pm=parseInt($('setPalmMs').value,10);if(!(pm>=0&&pm<=1000))pm=250;
  const lang=$('setLang').value,langChanged=lang!==settings.lang;
  settings={lang,newW:w,newH:h,diag:$('setDiag').checked,palm:$('setPalm').checked,palmMs:pm};palmOn=settings.palm;palmReset();saveSettings();setDlg.close();
  dispatchEvent(new CustomEvent('markup:diag',{detail:settings.diag}));
  if(langChanged){            // strings are applied at startup, so reload to use the new language
    const u=new URL(location.href);
    if(u.searchParams.has('lang')){u.searchParams.delete('lang');location.replace(u.href)}   // ?lang= would override the setting
    else location.reload();
  }
}
$('setOk').onclick=applySettings;
setDlg.querySelectorAll('.help').forEach(b=>b.onclick=()=>{const n=$(b.dataset.help),show=n.hidden;n.hidden=!show;b.setAttribute('aria-expanded',show)});   // ? button shows / hides its explanation
addEventListener('markup:diag-closed',()=>{settings.diag=false;saveSettings()});   // the panel's own close button
$('setCancel').onclick=()=>setDlg.close();
setDlg.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.tagName==='INPUT'){e.preventDefault();applySettings()}});

/* ---------- line width: inline slider or popup ---------- */
// If the inline slider would end up shorter than MIN_INLINE_WIDTH, the width control collapses into
// a button that opens a popup with a longer slider. Each pass starts from the inline layout and
// measures it, so the result depends only on the available space (no flip-flopping).
const MIN_INLINE_WIDTH=250;
const widthBtn=$('widthBtn'),widthPop=$('widthPop');
function closeWidthPop(focusBtn){
  widthPop.hidden=true;widthBtn.setAttribute('aria-expanded','false');if(focusBtn)widthBtn.focus();
}
function openWidthPop(){
  widthPop.hidden=false;placePopup(widthPop,widthBtn);
  widthBtn.setAttribute('aria-expanded','true');
}
widthBtn.onclick=()=>{if(widthPop.hidden){openWidthPop();$('widthL').focus()}else closeWidthPop()};
addEventListener('pointerdown',e=>{if(!widthPop.hidden&&!$('widthMenu').contains(e.target))closeWidthPop()});
widthPop.addEventListener('keydown',e=>{
  e.stopPropagation();                       // keep arrows/space from panning the canvas
  if(e.key==='Escape'||e.key==='Enter'){e.preventDefault();closeWidthPop(true)}
});
// While a width box is being edited the layout is left alone: the on-screen keyboard shrinks the window, which
// would collapse the controls and make the box (and the keyboard) disappear under the user's fingers.
const editingWidth=()=>{const a=document.activeElement;return a===$('wv')||a===$('wvPop')};
for(const el of[$('wv'),$('wvPop')])el.addEventListener('blur',()=>requestAnimationFrame(layoutWidth));   // layout catches up when the editing ends
function layoutWidth(){
  if(editingWidth())return;
  const hdr=document.querySelector('header');
  hdr.classList.remove('wpop','vexp');
  let collapse;
  if(document.documentElement.classList.contains('tb-left')){   // too narrow for a horizontal slider; a vertical one needs height
    hdr.classList.add('vexp');   // try the expanded controls (open color picker, vertical slider) and measure
    collapse=hdr.scrollHeight>hdr.clientHeight+1;
    if(collapse)hdr.classList.remove('vexp');
  }else collapse=$('width').getBoundingClientRect().width<MIN_INLINE_WIDTH;
  hdr.classList.toggle('wpop',collapse);
  if(!collapse)closeWidthPop();
  else if(!widthPop.hidden)openWidthPop();   // keep an open popup inside the screen
}

/* ---------- toolbar position (top / left / automatic) ---------- */
// Mode 'top' or 'left' fixes the toolbar there; 'auto' puts it on the left in landscape and on top in
// portrait. Click toggles top <-> left, a long press switches to 'auto'. Stored in localStorage.
const TB_KEY='markup.toolbar';
let tbMode='top';
try{const m=localStorage.getItem(TB_KEY);if(m==='top'||m==='left'||m==='auto')tbMode=m}catch(e){}
const landscapeMQ=matchMedia('(orientation: landscape)');
const tbEffective=()=>tbMode==='auto'?(landscapeMQ.matches?'left':'top'):tbMode;
const layoutBtn=$('layoutBtn');
const TB_ICONS={
  // toolbar is on top: a vertical bar and an arrow pointing left (click moves it to the left)
  top:'<svg viewBox="0 0 24 24"><rect x="3" y="4" width="5" height="16" rx="1"/><path d="M21 12h-9M15.5 8.5L12 12l3.5 3.5"/></svg>',
  // toolbar is on the left: a horizontal bar and an arrow pointing up (click moves it to the top)
  left:'<svg viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="5" rx="1"/><path d="M12 21v-9M8.5 15.5L12 12l3.5 3.5"/></svg>',
  // automatic: a phone surrounded by rotation arrows
  auto:'<svg viewBox="0 0 24 24"><rect x="9.5" y="8" width="5" height="8" rx="1"/><path d="M19.5 10A8 8 0 0 0 6 6.5M6 3v3.5h3.5M4.5 14A8 8 0 0 0 18 17.5M18 21v-3.5h-3.5"/></svg>'
};
function closePopups(){document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))}   // every popup closes on an outside press
function applyToolbar(){
  const eff=tbEffective(),key=tbMode==='auto'?'auto':eff;
  document.documentElement.classList.toggle('tb-left',eff==='left');
  layoutBtn.innerHTML=TB_ICONS[key];
  layoutBtn.title=t('toolbar.'+key+'.title');
  layoutBtn.setAttribute('aria-label',layoutBtn.title);
  layoutWidth();
}
function setToolbarMode(m){
  tbMode=m;try{localStorage.setItem(TB_KEY,m)}catch(e){}
  closePopups();applyToolbar();
}
landscapeMQ.addEventListener('change',()=>{if(tbMode==='auto'){closePopups();applyToolbar()}});
(()=>{
  let timer=0;
  const stop=()=>{clearTimeout(timer);timer=0;layoutBtn.classList.remove('holding')};
  layoutBtn.addEventListener('pointerdown',e=>{
    if(e.button>0)return;
    layoutBtn.classList.add('holding');
    timer=setTimeout(()=>{timer=0;layoutBtn.classList.remove('holding');setToolbarMode('auto');msg(t('msg.toolbarAuto'))},600);
  });
  layoutBtn.addEventListener('pointerup',()=>{if(timer){stop();setToolbarMode(tbEffective()==='top'?'left':'top')}else stop()});
  layoutBtn.addEventListener('pointerleave',stop);
  layoutBtn.addEventListener('pointercancel',stop);
  layoutBtn.addEventListener('contextmenu',e=>e.preventDefault());
  layoutBtn.addEventListener('click',e=>{if(e.detail===0)setToolbarMode(tbEffective()==='top'?'left':'top')});   // keyboard
})();

/* ---------- new empty image ---------- */
const newDlg=$('newDlg');
const newPicker=createColorPicker({mount:$('newCp'),input:$('newColor'),palette:PALETTE,fixed:true,onChange(){}});
function openNewDialog(){
  $('newErr').hidden=true;$('newColor').value='#ffffff';newPicker.set('#ffffff');newPicker.close();
  $('newW').value=settings.newW;$('newH').value=settings.newH;   // the default size from Settings
  newDlg.showModal();
  // Don't let the browser focus the first text field: on phones that opens the on-screen keyboard.
  $('newTitle').focus({preventScroll:true});
}
function createEmptyImage(){
  const w=parseInt($('newW').value,10),h=parseInt($('newH').value,10);
  if(!(w>=16&&w<=MAXDIM&&h>=16&&h<=MAXDIM)){
    const e=$('newErr');e.textContent=t('newdlg.error',{min:16,max:MAXDIM});e.hidden=false;return;
  }
  if((ops.length||pending)&&!confirm(t('confirm.newImage')))return;
  const c=document.createElement('canvas');c.width=w;c.height=h;
  const x=c.getContext('2d');x.fillStyle=$('newColor').value;x.fillRect(0,0,w,h);
  setBackground(c);cur=null;ops=[];redoStack=[];discardPending();resetNames();resetSnapshots();persist(true);ui();fit();newDlg.close();
}
$('newOk').onclick=createEmptyImage;
$('newCancel').onclick=()=>newDlg.close();
/* ---------- resize background ---------- */
// Scales the background (bicubic, or Lanczos with sharpening) to new dimensions. Only possible when the history is empty, because the
// operations already drawn are in the coordinates of the current size; the scaling itself is a "scale"
// operation in the history, so it can be undone and redone.
const scaleDlg=$('scaleDlg');
let scaleRatio=1;
function scaleValues(){
  const w=$('scW').value.trim(),h=$('scH').value.trim();
  if(!/^\d{1,5}$/.test(w)||!/^\d{1,5}$/.test(h))return null;
  return [parseInt(w,10),parseInt(h,10)];
}
function openScaleDialog(){
  if(!bg)return;
  if(ops.some(o=>!isResizeOp(o))||pending){alert(t('scaledlg.needClear'));return}   // only resize operations may precede it
  scaleRatio=bg.width/bg.height;
  $('scW').value=bg.width;$('scH').value=bg.height;$('scKeep').checked=true;$('scSharp').value=String(lastSharp);$('scaleErr').hidden=true;
  $('scaleCur').textContent=t('scaledlg.current',{w:bg.width,h:bg.height});
  scaleDlg.showModal();
  $('scaleTitle').focus({preventScroll:true});   // no on-screen keyboard
}
function applyScaleDialog(){
  const v=scaleValues();
  if(!v||!v.every(x=>x>=16&&x<=MAXDIM)){$('scaleErr').textContent=t('scaledlg.err',{min:16,max:MAXDIM});$('scaleErr').hidden=false;return}
  if(v[0]===bg.width&&v[1]===bg.height){$('scaleErr').textContent=t('scaledlg.same');$('scaleErr').hidden=false;return}
  const o={t:'scale',w:v[0],h:v[1],s:(+$('scSharp').value)};
  lastSharp=o.s;savePrefs();
  scaleDlg.close();
  ops.push(o);redoStack=[];applyResizeOp(o);syncBgCache();persist();ui();fit();
  msg(t('msg.scaled',{w:o.w,h:o.h}));
}
$('scW').addEventListener('input',()=>{
  $('scaleErr').hidden=true;
  const w=parseInt($('scW').value,10);
  if($('scKeep').checked&&w>0)$('scH').value=Math.max(1,Math.round(w/scaleRatio));
});
$('scH').addEventListener('input',()=>{
  $('scaleErr').hidden=true;
  const h=parseInt($('scH').value,10);
  if($('scKeep').checked&&h>0)$('scW').value=Math.max(1,Math.round(h*scaleRatio));
});
$('scKeep').addEventListener('change',()=>{   // switching the lock on snaps the height to the width
  if($('scKeep').checked){const w=parseInt($('scW').value,10);if(w>0)$('scH').value=Math.max(1,Math.round(w/scaleRatio))}
});
$('scaleOk').onclick=applyScaleDialog;
$('scaleCancel').onclick=()=>scaleDlg.close();
scaleDlg.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.tagName==='INPUT'&&e.target.type==='number'){e.preventDefault();applyScaleDialog()}});

/* ---------- resize frame ---------- */
// Adds a band of the chosen color around the background. It is a "frame" operation in the history, so it can
// be undone and redone like any drawing; the image grows, the existing content keeps its look.
const frameDlg=$('frameDlg'),FR_IDS=['frT','frR','frB','frL'];
const frameColorPicker=createColorPicker({mount:$('frameCp'),input:$('frameColor'),palette:PALETTE,fixed:true,onChange(){}});
let lastFrameColor='#ffffff';
function frameAmounts(){   // [top,right,bottom,left], or null when a field is not a whole number >= 0
  const v=FR_IDS.map(id=>$(id).value.trim()||'0');
  return v.every(x=>/^\d{1,5}$/.test(x))?v.map(x=>parseInt(x,10)):null;
}
function updateFrameInfo(){
  const a=frameAmounts();
  $('frameInfo').textContent=a?t('framedlg.size',{w:bg.width+a[1]+a[3],h:bg.height+a[0]+a[2]}):'';
}
function openFrameDialog(){
  if(!bg)return;
  commitPending();
  FR_IDS.forEach(id=>$(id).value='0');
  $('frameErr').hidden=true;$('frameColor').value=lastFrameColor;frameColorPicker.set(lastFrameColor);frameColorPicker.close();
  updateFrameInfo();
  frameDlg.showModal();
  $('frameTitle').focus({preventScroll:true});   // no on-screen keyboard
}
function applyFrameDialog(){
  const a=frameAmounts(),err=k=>{$('frameErr').textContent=t(k,{max:MAXDIM});$('frameErr').hidden=false};
  if(!a){err('framedlg.errNum');return}
  if(!a.some(v=>v>0)){err('framedlg.errNone');return}
  const w=bg.width+a[1]+a[3],h=bg.height+a[0]+a[2];
  if(w>MAXDIM||h>MAXDIM){err('framedlg.errSize');return}
  const o={t:'frame',top:a[0],right:a[1],bottom:a[2],left:a[3],c:$('frameColor').value};
  lastFrameColor=o.c;frameDlg.close();
  ops.push(o);redoStack=[];applyResizeOp(o);syncBgCache();persist();ui();fit();
  msg(t('msg.framed',{w,h}));
}
FR_IDS.forEach(id=>$(id).addEventListener('input',()=>{$('frameErr').hidden=true;updateFrameInfo()}));
$('frameOk').onclick=applyFrameDialog;
$('frameCancel').onclick=()=>frameDlg.close();
frameDlg.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.tagName==='INPUT'&&e.target.type==='number'){e.preventDefault();applyFrameDialog()}});
newDlg.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.tagName==='INPUT'&&e.target.type==='number'){e.preventDefault();createEmptyImage()}});

/* ---------- crop background ---------- */
// Crop mode: two corner handles (top-left, bottom-right) select the part of the background to keep, thin lines mark
// the box and a check button at its top-right corner confirms. The result is a "crop" operation {x,y,w,h} in the
// history (in the pixels of the image as it was), so it can be undone and redone. Like resizing, it is only possible
// before any drawing mark exists. the X button, Escape or any replay (undo, clear, import...) leaves the mode.
const cropA=$('cropA'),cropB=$('cropB'),cropOk=$('cropOk'),cropNo=$('cropNo');
function openCrop(){
  if(!bg)return;
  if(ops.some(o=>!isResizeOp(o))||pending){alert(t('crop.needClear'));return}
  startSelect('crop');
}
function startSelect(kind){   // the same rectangle selector serves the crop and the spotlight
  cropKind=kind;
  cropOk.title=t(kind==='spot'?'spot.ok.title':'crop.ok.title');cropOk.setAttribute('aria-label',t(kind==='spot'?'spot.ok.label':'crop.ok.label'));
  const f=kind==='spot'?1/3:1;   // the spotlight starts as a third of the image, at its top-left corner; the crop as the whole image
  crop={x0:0,y0:0,x1:Math.max(1,Math.round(bg.width*f)),y1:Math.max(1,Math.round(bg.height*f))};render();msg(t(kind==='spot'?'spot.hint':'crop.hint'));
}
function cancelCrop(){if(crop){crop=null;render()}}
function positionCrop(){
  if(!crop){cropA.hidden=cropB.hidden=cropOk.hidden=cropNo.hidden=true;return}
  const W=stage.clientWidth,H=stage.clientHeight,o=HB*0.45,B=36,gap=6;
  const put=(h,cx,cy,sz)=>{h.style.left=Math.min(Math.max(cx-sz/2,4),W-sz-4)+'px';h.style.top=Math.min(Math.max(cy-sz/2,4),H-sz-4)+'px';h.hidden=false};
  put(cropA,crop.x0*s+ox-o,crop.y0*s+oy-o,HB);
  put(cropB,crop.x1*s+ox+o,crop.y1*s+oy+o,HB);
  put(cropOk,crop.x1*s+ox+B/2+gap,crop.y0*s+oy-B/2-gap,B);   // just outside the top-right corner
  const okTop=parseFloat(cropOk.style.top);
  put(cropNo,parseFloat(cropOk.style.left)+B/2,okTop+B+gap+B/2,B);   // cancel, right under it (follows the check when that one is kept on screen)
}
let cDrag=null;
for(const [h,which] of [[cropA,0],[cropB,1]]){
  h.style.minHeight='0';
  h.addEventListener('pointerdown',e=>{
    if(!crop)return;e.preventDefault();h.setPointerCapture(e.pointerId);
    cDrag={id:e.pointerId,which,x:e.clientX,y:e.clientY,c:{...crop}};
  });
  h.addEventListener('pointermove',e=>{
    if(!cDrag||cDrag.id!==e.pointerId||!crop)return;
    const dx=(e.clientX-cDrag.x)/s,dy=(e.clientY-cDrag.y)/s,c=cDrag.c,W=bg.width,H=bg.height,M=Math.min(16,W,H);
    const cl=(v,a,b)=>Math.round(Math.min(Math.max(v,a),b));
    if(which===0){crop.x0=cl(c.x0+dx,0,crop.x1-M);crop.y0=cl(c.y0+dy,0,crop.y1-M)}
    else{crop.x1=cl(c.x1+dx,crop.x0+M,W);crop.y1=cl(c.y1+dy,crop.y0+M,H)}
    render();
  });
  const end=e=>{if(cDrag&&cDrag.id===e.pointerId)cDrag=null};
  h.addEventListener('pointerup',end);h.addEventListener('pointercancel',end);
}
cropOk.onclick=()=>{
  if(!crop)return;
  const x=Math.round(crop.x0),y=Math.round(crop.y0),w=Math.round(crop.x1)-x,h=Math.round(crop.y1)-y;
  if(cropKind==='spot'){crop=null;createSpot(x,y,w,h);return}
  if(x===0&&y===0&&w===bg.width&&h===bg.height){msg(t('crop.same'));return}
  const o={t:'crop',x,y,w,h};crop=null;
  ops.push(o);redoStack=[];applyResizeOp(o);syncBgCache();persist();ui();fit();
  msg(t('msg.cropped',{w,h}));
};
cropNo.onclick=cancelCrop;   // touch devices have no Escape key
addEventListener('keydown',e=>{if(e.key==='Escape'&&crop&&!(e.target.closest&&e.target.closest('dialog')))cancelCrop()});

/* ---------- spotlight ---------- */
// A live view of a part of the image (background + drawing + the shape being drawn) in a floating box over the canvas.
// The view follows the changes made to that part, and follows the part itself through the resize operations (frame,
// scale, crop) of the history. The box does not take part in the drawing, zoom or pan, it is not in the history, in
// exported status or in snapshots, and there is only one at a time. Move / roll up / close buttons sit in its top-right corner.
const SP_RING=3;   // width of the coloured outline around the box (drawn outside it, so the box has exactly the picture's size)
const spotBox=$('spot'),spotCv=$('spotCv'),spMove=$('spMove'),spCol=$('spCol'),spClose=$('spClose');
const SP_ICON={move:'<svg viewBox="0 0 24 24"><path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/></svg>',
  up:'<svg viewBox="0 0 24 24"><path d="M6 15l6-6 6 6"/></svg>',down:'<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>'};
function openSpot(){
  if(!bg||spot)return;
  commitPending();startSelect('spot');
}
function setSpotPos(x,y){
  const W=stage.clientWidth,H=stage.clientHeight;
  spot.x=Math.min(Math.max(x,SP_RING),Math.max(SP_RING,W-SP_RING-spotBox.offsetWidth));spot.y=Math.min(Math.max(y,SP_RING),Math.max(SP_RING,H-SP_RING-spotBox.offsetHeight));
  spotBox.style.left=spot.x+'px';spotBox.style.top=spot.y+'px';
}
function spotLabels(){
  spCol.innerHTML=SP_ICON[spot&&spot.collapsed?'down':'up'];
  const k=spot&&spot.collapsed?'spot.expand':'spot.collapse';spCol.title=t(k+'.title');spCol.setAttribute('aria-label',t(k+'.title'));
}
// The resize operations of the history, cached. The spotlight only survives frame resizes: it follows the image
// content through them (and through their undo / redo); any other resize operation, or a new background, closes it.
let chainCache=null;
function resizeChain(){
  const c=chainCache,last=ops[ops.length-1];
  if(c&&c.arr===ops&&c.len===ops.length&&c.last===last)return c.list;
  const list=ops.filter(isResizeOp);
  chainCache={arr:ops,len:ops.length,last,list};return list;
}
function spotRect(){   // where the watched part of the image is now (null: the spotlight had to be closed)
  const cur=resizeChain();
  if(spot.chain===cur)return spot.rect;
  const ref=spot.ref;let p=0;while(p<ref.length&&p<cur.length&&ref[p]===cur[p])p++;
  let dx=0,dy=0;
  for(let i=ref.length-1;i>=p;i--){if(ref[i].t!=='frame'){dropSpot();return null}dx-=ref[i].left;dy-=ref[i].top}   // frames no longer in the history
  for(let i=p;i<cur.length;i++){if(cur[i].t!=='frame'){dropSpot();return null}dx+=cur[i].left;dy+=cur[i].top}      // frames added since
  spot.chain=cur;spot.rect={x:spot.base.x+dx,y:spot.base.y+dy,w:spot.base.w,h:spot.base.h};return spot.rect;
}
let spotRaf=0;
function scheduleSpot(){if(!spotRaf)spotRaf=requestAnimationFrame(()=>{spotRaf=0;drawSpot()})}   // render() asks for it; at most one redraw per frame
function drawSpot(){
  if(!spot||spot.collapsed||!bg)return;
  if(spot.bg0!==bg0){dropSpot();return}
  const r=spotRect();if(!r)return;
  const c=spotCv.getContext('2d'),cw=spotCv.width,ch=spotCv.height,kx=cw/r.w,ky=ch/r.h;
  c.setTransform(1,0,0,1,0,0);c.fillStyle='#1f2326';c.fillRect(0,0,cw,ch);   // outside the image
  c.imageSmoothingQuality='high';
  const ix0=Math.max(0,r.x),iy0=Math.max(0,r.y),ix1=Math.min(bg.width,r.x+r.w),iy1=Math.min(bg.height,r.y+r.h);
  if(ix1>ix0&&iy1>iy0){
    const sw=ix1-ix0,sh=iy1-iy0,dx=(ix0-r.x)*kx,dy=(iy0-r.y)*ky;
    c.drawImage(bg,ix0,iy0,sw,sh,dx,dy,sw*kx,sh*ky);c.drawImage(L,ix0,iy0,sw,sh,dx,dy,sw*kx,sh*ky);
  }
  if(spotPt&&tool==='erase'){   // eraser footprint, like on the canvas: what a touch here would clean (the width is in image pixels)
    const d=cw/Math.max(1,spotCv.clientWidth),rx=widths.erase/2*kx,ry=widths.erase/2*ky;
    c.setTransform(1,0,0,1,0,0);c.beginPath();c.ellipse(spotPt[0],spotPt[1],rx,ry,0,0,Math.PI*2);
    c.fillStyle='rgba(255,255,255,.35)';c.fill();
    c.lineWidth=2*d;c.strokeStyle='rgba(255,255,255,.9)';c.stroke();
    c.lineWidth=d;c.strokeStyle='rgba(0,0,0,.65)';c.stroke();
  }
  if((cur&&!(cur.t==='pen'||cur.t==='erase'))||pending){   // shapes still being drawn or placed
    c.setTransform(kx,0,0,ky,-r.x*kx,-r.y*ky);
    if(cur&&!(cur.t==='pen'||cur.t==='erase'))drawOp(c,cur);
    if(pending)drawOp(c,pending);
  }
}
function createSpot(x,y,w,h){
  const W=stage.clientWidth,H=stage.clientHeight;   // same size as the selection rectangle had on screen; only enlarged if too small for its buttons, or shrunk if it cannot fit the stage
  let k=s;
  k=Math.max(k,110/w,44/h);k=Math.min(k,(W-2*SP_RING)/w,(H-2*SP_RING)/h);
  const cw=Math.max(1,Math.round(w*k)),ch=Math.max(1,Math.round(h*k)),d=Math.min(2,devicePixelRatio||1);
  spotCv.style.width=cw+'px';spotCv.style.height=ch+'px';spotCv.width=Math.round(cw*d);spotCv.height=Math.round(ch*d);
  spot={x:0,y:0,collapsed:false,bg0,ref:resizeChain(),base:{x,y,w,h},chain:null,rect:null};
  spotBox.classList.remove('collapsed');spotBox.hidden=false;
  spMove.innerHTML=SP_ICON.move;spClose.innerHTML='<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';spotLabels();
  setSpotPos((W-spotBox.offsetWidth)/2,(H-spotBox.offsetHeight)/2);
  drawSpot();ui();render();
}
function closeSpot(){
  if(!spot)return;
  if(!confirm(t('spot.confirmClose')))return;
  dropSpot();
}
function dropSpot(){   // removes the spotlight without asking (used when the image it watches goes away)
  if(!spot)return;
  spot=null;spotPt=null;spotBox.hidden=true;spotCv.width=spotCv.height=1;ui();
}
function toggleSpot(){
  if(!spot)return;
  const right=spot.x+spotBox.offsetWidth;
  spot.collapsed=!spot.collapsed;spotBox.classList.toggle('collapsed',spot.collapsed);spotLabels();
  setSpotPos(right-spotBox.offsetWidth,spot.y);   // the right edge stays where it was
  if(!spot.collapsed)drawSpot();
}
function clampSpot(){if(spot)setSpotPos(spot.x,spot.y)}
let spDrag=null;
spMove.addEventListener('pointerdown',e=>{if(!spot)return;e.preventDefault();spMove.setPointerCapture(e.pointerId);spDrag={id:e.pointerId,x:e.clientX,y:e.clientY,bx:spot.x,by:spot.y}});
spMove.addEventListener('pointermove',e=>{if(spDrag&&spDrag.id===e.pointerId&&spot)setSpotPos(spDrag.bx+e.clientX-spDrag.x,spDrag.by+e.clientY-spDrag.y)});
const spEnd=e=>{if(spDrag&&spDrag.id===e.pointerId)spDrag=null};
spMove.addEventListener('pointerup',spEnd);spMove.addEventListener('pointercancel',spEnd);
spCol.onclick=toggleSpot;spClose.onclick=closeSpot;
// Drawing through the box: the same handlers as the canvas, with the pointer position mapped through the box's view.
spotCv.addEventListener('pointerdown',onDown);spotCv.addEventListener('pointermove',onMove);
spotCv.addEventListener('pointerup',end);spotCv.addEventListener('pointercancel',end);
function spotEraserAt(e){   // the pointer position in the box's own pixels, drawn by drawSpot()
  const r=spotCv.getBoundingClientRect();
  spotPt=[(e.clientX-r.left)/r.width*spotCv.width,(e.clientY-r.top)/r.height*spotCv.height];scheduleSpot();
}
spotCv.addEventListener('pointerleave',e=>{if(e.pointerType==='mouse'&&spotPt&&!ptrs.size){spotPt=null;scheduleSpot()}});
spMove.title=t('spot.move.title');spMove.setAttribute('aria-label',t('spot.move.title'));
spClose.title=t('spot.close.title');spClose.setAttribute('aria-label',t('spot.close.title'));
spotBox.setAttribute('aria-label',t('spot.box.label'));

/* ---------- file names (Save JPEG / Export status) ---------- */
// The last name used is remembered separately for each action; it is forgotten
// whenever the canvas is cleared or replaced (clear, open image, empty image, import).
const NAMES_KEY='markup.names';
let names={};
try{names=JSON.parse(localStorage.getItem(NAMES_KEY)||'{}')||{}}catch(e){names={}}
function resetNames(){names={};try{localStorage.removeItem(NAMES_KEY)}catch(e){}}
const FILE_KINDS={
  jpeg:{key:'file.jpeg',ext:'.jpg',strip:/\.jpe?g$/i,run:n=>saveJpeg(n)},
  status:{key:'file.status',ext:'.json',strip:/\.json$/i,run:n=>exportStatus(n)}
};
const nameDlg=$('nameDlg');let nameKind=null;
function askFileName(kind){
  nameKind=kind;const k=FILE_KINDS[kind];
  $('nameTitle').textContent=t(k.key+'.title');$('nameExt').textContent=k.ext;$('nameOk').textContent=t(k.key+'.button');
  $('nameErr').hidden=true;$('nameInput').value=names[kind]||t(k.key+'.default');
  nameDlg.showModal();$('nameInput').select();
}
function confirmFileName(){
  const k=FILE_KINDS[nameKind];
  const n=$('nameInput').value.replace(/[\\/:*?"<>|\u0000-\u001f]/g,'').trim().replace(k.strip,'').replace(/[. ]+$/,'');
  if(!n){const e=$('nameErr');e.textContent=t('namedlg.error');e.hidden=false;return}
  names[nameKind]=n;
  try{localStorage.setItem(NAMES_KEY,JSON.stringify(names))}catch(e){}
  nameDlg.close();k.run(n+k.ext);
}
$('nameOk').onclick=confirmFileName;
$('nameCancel').onclick=()=>nameDlg.close();
$('nameInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();confirmFileName()}});

if('serviceWorker' in navigator){
  const reg=()=>navigator.serviceWorker.register('sw.js').catch(()=>{});
  // this code runs after the locale files are loaded, which can be after the window's load event
  if(document.readyState==='complete')reg();else addEventListener('load',reg);
}

new ResizeObserver(()=>{resize()}).observe(stage);
addEventListener('resize',()=>{resize();layoutWidth()});
new ResizeObserver(()=>requestAnimationFrame(layoutWidth)).observe(document.querySelector('header'));
if(document.fonts&&document.fonts.ready)document.fonts.ready.then(layoutWidth);
applyToolbar();
resize();ui();restore();
});
