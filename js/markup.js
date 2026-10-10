i18n.ready.then(()=>{          // wait until the locale strings are loaded
const $=id=>document.getElementById(id);
const cv=$('cv'),ctx=cv.getContext('2d'),stage=$('stage');
let bg=null,L=null,lc=null,ops=[],redoStack=[],tool='pen',s=1,ox=0,oy=0,viewW=0,viewH=0,cur=null,panning=false;
const widths={draw:6,erase:24};
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
  el.style.left=Math.max(m,Math.min(b.right+6,vw-w-m))+'px';
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
const APP_VERSION='v18';   // keep in step with CACHE in sw.js
$('ver').textContent=t('app.version',{version:APP_VERSION});

/* ---------- settings (persisted in localStorage) ---------- */
const SETTINGS_KEY='markup.settings';
const validSize=v=>Number.isInteger(v)&&v>=16&&v<=MAXDIM;
let settings={lang:'auto',newW:1600,newH:1200};
try{
  const p=JSON.parse(localStorage.getItem(SETTINGS_KEY)||'null');
  if(p){
    if(typeof p.lang==='string'&&/^(auto|[a-z]{2,3}(-[A-Za-z0-9]{2,8})*)$/.test(p.lang))settings.lang=p.lang;
    if(validSize(p.newW))settings.newW=p.newW;
    if(validSize(p.newH))settings.newH=p.newH;
  }
}catch(e){}
function saveSettings(){
  try{localStorage.setItem(SETTINGS_KEY,JSON.stringify(settings))}catch(e){msg(t('msg.storageFull'))}
}


function msg(t){const m=$('msg');m.textContent=t;m.style.display='block';clearTimeout(msg.t);msg.t=setTimeout(()=>m.style.display='none',3500)}

/* ---------- drawing primitives ---------- */
const STAR_INNER=Math.cos(Math.PI*2/5)/Math.cos(Math.PI/5);   // inner/outer radius ratio of a regular pentagram outline (~0.382)
function drawOp(c,o){
  if(o.t==='fill'){applyFill(o);return}
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
function replay(){lc.clearRect(0,0,L.width,L.height);ops.forEach(o=>drawOp(lc,o))}

/* ---------- view ---------- */
function resize(){
  const r=stage.getBoundingClientRect(),d=devicePixelRatio||1;
  // When the view changes shape (device rotation, toolbar wrapping...) keep the same part of the image
  // in the center of the view: same zoom, and the image point that was at the old center stays at the new one.
  if(bg&&viewW&&viewH&&(r.width!==viewW||r.height!==viewH)){
    const ix=(viewW/2-ox)/s,iy=(viewH/2-oy)/s;
    ox=r.width/2-ix*s;oy=r.height/2-iy*s;
  }
  viewW=r.width;viewH=r.height;
  cv.width=Math.round(r.width*d);cv.height=Math.round(r.height*d);render();
}
function render(){
  const d=devicePixelRatio||1;
  ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#1f2326';ctx.fillRect(0,0,cv.width,cv.height);
  if(!bg)return;
  ctx.setTransform(d*s,0,0,d*s,d*ox,d*oy);
  ctx.imageSmoothingQuality='high';
  ctx.drawImage(bg,0,0);ctx.drawImage(L,0,0);
  if(cur&&!(cur.t==='pen'||cur.t==='erase'))drawOp(ctx,cur);
  if(pending)drawOp(ctx,pending);
  ctx.setTransform(d*s,0,0,d*s,d*ox,d*oy);
  ctx.strokeStyle='rgba(255,255,255,.25)';ctx.lineWidth=1/s;ctx.strokeRect(0,0,bg.width,bg.height);
  positionMove();
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
const toImg=e=>{const r=cv.getBoundingClientRect();return[(e.clientX-r.left-ox)/s,(e.clientY-r.top-oy)/s]};
const local=e=>{const r=cv.getBoundingClientRect();return[e.clientX-r.left,e.clientY-r.top]};

/* ---------- pointer handling ---------- */
cv.addEventListener('pointerdown',e=>{
  if(!bg)return;cv.setPointerCapture(e.pointerId);
  ptrs.set(e.pointerId,local(e));
  if(ptrs.size===2){fillTap=null;tapTrack=null;cancelCur();startPinch();return}
  if(ptrs.size>2)return;
  if(tool==='pan'||spaceDown||e.button===1||e.button===2){panning=true;last=local(e);setCursor();return}
  if(tool==='fill'){fillTap={id:e.pointerId,p:toImg(e),sx:e.clientX,sy:e.clientY,c:$('color').value};return}   // applied on release
  if(pending){tapTrack={id:e.pointerId,sx:e.clientX,sy:e.clientY,p0:toImg(e)};return}   // a tap places the pending shape; a drag places it and starts a new one
  const p=toImg(e),w=tool==='erase'?widths.erase:widths.draw,c=$('color').value;
  if(tool==='pen'||tool==='erase'){cur={t:tool,c,w,p:[p]};drawOp(lc,cur);}
  else cur={t:tool,c,w,a:p,b:p};
  render();
});
cv.addEventListener('pointermove',e=>{
  if(!ptrs.has(e.pointerId))return;
  ptrs.set(e.pointerId,local(e));
  if(ptrs.size===2&&pinch){updatePinch();return}
  if(panning){const q=local(e);ox+=q[0]-last[0];oy+=q[1]-last[1];last=q;render();return}
  if(fillTap&&fillTap.id===e.pointerId&&Math.hypot(e.clientX-fillTap.sx,e.clientY-fillTap.sy)>10)fillTap=null;   // it was a drag, not a tap
  if(tapTrack&&tapTrack.id===e.pointerId){
    if(Math.hypot(e.clientX-tapTrack.sx,e.clientY-tapTrack.sy)>10){
      const t0=tapTrack;tapTrack=null;commitPending();
      cur={t:tool,c:$('color').value,w:widths.draw,a:t0.p0,b:toImg(e)};render();
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
    }else cur.b=p;
  }
  render();
});
function end(e){
  if(!ptrs.has(e.pointerId))return;ptrs.delete(e.pointerId);
  if(ptrs.size<2)pinch=null;
  if(fillTap&&fillTap.id===e.pointerId){const f=fillTap;fillTap=null;if(e.type==='pointerup')commitFill(f)}
  if(tapTrack&&tapTrack.id===e.pointerId){tapTrack=null;if(e.type==='pointerup')commitPending()}
  if(cur&&e.type==='pointerup'){
    const o=cur;cur=null;
    const degenerate=!o.p&&o.a[0]===o.b[0]&&o.a[1]===o.b[1];
    if(degenerate)replay();
    else if(MOVABLE.has(o.t))setPending(o);   // rectangle/circle/star: wait for the user to place it
    else{ops.push(o);redoStack=[];if(o.t==='pen'||o.t==='erase'){}else drawOp(lc,o);persist()}
    ui();render();
  }else if(cur)cancelCur();
  if(ptrs.size===0){panning=false;setCursor()}
}
cv.addEventListener('pointerup',end);cv.addEventListener('pointercancel',end);
function cancelCur(){if(cur){cur=null;replay();render()}}

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
  $('undo').disabled=!ops.length&&!pending;$('redo').disabled=!redoStack.length;$('miJpeg').disabled=!bg;$('miExport').disabled=!bg;$('clear').disabled=!bg;
  $('hint').style.display=bg?'none':'flex';
}
document.querySelectorAll('button[data-t]').forEach(b=>b.onclick=()=>{
  commitPending();
  tool=b.dataset.t;
  document.querySelectorAll('button[data-t]').forEach(x=>x.setAttribute('aria-pressed',x===b));
  const isShape=!!b.closest('#shapesList');
  $('shapesBtn').setAttribute('aria-pressed',String(isShape));
  if(isShape){   // the Shapes button shows the icon of the chosen shape; close its menu
    $('shapesIcon').innerHTML=b.querySelector('svg').outerHTML;
    $('shapesList').hidden=true;$('shapesBtn').setAttribute('aria-expanded','false');
  }
  syncWidth();setCursor();
});
function syncWidth(){
  const v=tool==='erase'?widths.erase:widths.draw;
  $('width').value=v;$('widthL').value=v;                       // inline slider and popup slider
  $('wv').textContent=v;$('wvPop').textContent=v;$('wvBtn').textContent=v;
}
function setWidth(v){widths[tool==='erase'?'erase':'draw']=v;if(pending&&tool!=='erase'){pending.w=v;render()}syncWidth();savePrefs()}
const PK='markup.prefs';
function savePrefs(){try{localStorage.setItem(PK,JSON.stringify({color:$('color').value,draw:widths.draw,erase:widths.erase}))}catch(e){}}
try{
  const p=JSON.parse(localStorage.getItem(PK)||'null');
  if(p){
    if(/^#[0-9a-f]{6}$/i.test(p.color))$('color').value=p.color;
    if(p.draw>=1&&p.draw<=80)widths.draw=(+p.draw);
    if(p.erase>=1&&p.erase<=80)widths.erase=(+p.erase);
  }
}catch(e){}
syncWidth();
const PALETTE=['#e63946','#f77f00','#fcbf49','#2a9d8f','#06d6a0','#118ab2','#7b2cbf','#ff4da6',
  '#000000','#4a4a4a','#9a9a9a','#ffffff','#8b5a2b','#1d3557','#a7c957','#00b4d8'];
const sw=$('sw');
PALETTE.forEach(c=>{
  const b=document.createElement('button');b.style.background=c;b.dataset.c=c;b.title=c;b.setAttribute('aria-label',t('color.swatch',{color:c}));
  b.onclick=()=>{$('color').value=c;if(pending){pending.c=c;render()}markSw();savePrefs()};sw.appendChild(b);
});
function markSw(){const v=$('color').value.toLowerCase();picker.set(v);sw.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.c===v))}
const picker=createColorPicker({mount:$('cp'),input:$('color'),palette:PALETTE,onChange:(c,final)=>{markSw();if(pending){pending.c=c;render()}if(final)savePrefs()}});
markSw();
$('width').oninput=e=>setWidth((+e.target.value));
$('widthL').oninput=e=>setWidth((+e.target.value));
function clearWork(all){
  if(!all&&!ops.length&&!pending){msg(t('msg.nothingToClear'));return}
  if(!confirm(t(all?'confirm.clearAll':'confirm.clearDrawing')))return;
  cur=null;ops=[];redoStack=[];discardPending();resetNames();
  if(all){
    bg=L=lc=null;
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
$('undo').onclick=()=>{commitPending();if(!ops.length)return;redoStack.push(ops.pop());replay();persist();ui();render()};
$('redo').onclick=()=>{commitPending();if(!redoStack.length)return;const o=redoStack.pop();ops.push(o);drawOp(lc,o);persist();ui();render()};
$('zi').onclick=()=>{const r=cv.getBoundingClientRect();zoomAt(1.25,r.width/2,r.height/2)};
$('zo').onclick=()=>{const r=cv.getBoundingClientRect();zoomAt(.8,r.width/2,r.height/2)};
$('fit').onclick=fit;
let spaceDown=false;
function setCursor(){cv.style.cursor=panning?'grabbing':(tool==='pan'||spaceDown)?'grab':'crosshair'}
addEventListener('keydown',e=>{
  if(e.target.closest&&e.target.closest('dialog'))return;   // let dialogs handle their own keys
  if(e.ctrlKey||e.metaKey){
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
function setBackground(img){
  const k=Math.min(1,MAXDIM/Math.max(img.width,img.height));
  const c=document.createElement('canvas');c.width=Math.round(img.width*k);c.height=Math.round(img.height*k);
  const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height);x.drawImage(img,0,0,c.width,c.height);
  bg=c;L=document.createElement('canvas');L.width=c.width;L.height=c.height;lc=L.getContext('2d');
}
$('file').onchange=e=>{
  const f=e.target.files[0];e.target.value='';if(!f)return;
  if((ops.length||pending)&&!confirm(t('confirm.openImage')))return;
  const url=URL.createObjectURL(f),img=new Image();
  img.onload=()=>{setBackground(img);URL.revokeObjectURL(url);ops=[];redoStack=[];discardPending();resetNames();persist(true);ui();fit()};
  img.onerror=()=>msg(t('msg.badImage'));
  img.src=url;
};

/* ---------- local storage ---------- */
function persist(withBg){
  try{
    if(withBg)localStorage.setItem('markup.bg',bg.toDataURL('image/jpeg',.88));
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
function exportStatus(name){
  const st={
    format:'markup-status',version:1,exportedAt:new Date().toISOString(),
    background:bg.toDataURL('image/jpeg',.88),
    operations:ops,
    preferences:{color:$('color').value,drawWidth:widths.draw,eraseWidth:widths.erase}
  };
  download(new Blob([JSON.stringify(st)],{type:'application/json'}),name);
}
const num=v=>typeof v==='number'&&isFinite(v);
const pt=p=>Array.isArray(p)&&p.length===2&&num(p[0])&&num(p[1]);
function validOp(o){
  if(o&&o.t==='fill')return typeof o.c==='string'&&num(o.x)&&num(o.y)&&num(o.tol);
  if(!o||typeof o!=='object'||!num(o.w)||typeof o.c!=='string')return false;
  if(o.t==='pen'||o.t==='erase')return Array.isArray(o.p)&&o.p.length>0&&o.p.every(pt);
  if(o.t==='line'||o.t==='rect'||o.t==='circle'||o.t==='star')return pt(o.a)&&pt(o.b);
  return false;
}
function importStatus(file){
  const fr=new FileReader();
  fr.onerror=()=>msg(t('msg.fileRead'));
  fr.onload=()=>{
    let st;
    try{st=JSON.parse(fr.result)}catch(e){msg(t('msg.badJson'));return}
    if(!st||st.format!=='markup-status'||typeof st.background!=='string'||!st.background.startsWith('data:image/')||!Array.isArray(st.operations)||!st.operations.every(validOp)){
      msg(t('msg.badStatus'));return;
    }
    if(bg&&!confirm(t('confirm.import')))return;
    const img=new Image();
    img.onload=()=>{
      setBackground(img);cur=null;ops=st.operations;redoStack=[];discardPending();resetNames();replay();
      const p=st.preferences||{};
      if(typeof p.color==='string'&&/^#[0-9a-f]{6}$/i.test(p.color))$('color').value=p.color;
      if(p.drawWidth>=1&&p.drawWidth<=80)widths.draw=(+p.drawWidth);
      if(p.eraseWidth>=1&&p.eraseWidth<=80)widths.erase=(+p.eraseWidth);
      syncWidth();markSw();savePrefs();persist(true);ui();fit();msg(t('msg.imported'));
    };
    img.onerror=()=>msg(t('msg.badBackground'));
    img.src=st.background;
  };
  fr.readAsText(file);
}

/* ---------- main menu ---------- */
(()=>{
  const btn=$('menuBtn'),list=$('menuList'),sub=$('subNew'),miNew=$('miNew');
  const items=()=>[...list.querySelectorAll('button:not(:disabled)')].filter(b=>b.offsetParent!==null);
  function toggleSub(show){
    sub.hidden=!show;miNew.setAttribute('aria-expanded',String(show));
    if(!list.hidden)placePopup(list,btn);     // the menu got taller or shorter
  }
  function open(){
    toggleSub(false);list.hidden=false;placePopup(list,btn);
    btn.setAttribute('aria-expanded','true');
  }
  function close(focusBtn){list.hidden=true;btn.setAttribute('aria-expanded','false');if(focusBtn)btn.focus()}
  btn.onclick=()=>{list.hidden?(open(),items()[0]?.focus()):close()};
  addEventListener('pointerdown',e=>{if(!list.hidden&&!$('mainMenu').contains(e.target))close()});
  list.addEventListener('keydown',e=>{
    const it=items(),i=it.indexOf(document.activeElement);
    if(e.key==='Escape'){close(true)}
    else if(e.key==='ArrowDown'){it[(i+1)%it.length]?.focus()}
    else if(e.key==='ArrowUp'){it[(i-1+it.length)%it.length]?.focus()}
    else if(e.key==='ArrowRight'&&document.activeElement===miNew){toggleSub(true);items()[i+1]?.focus()}
    else if(e.key==='ArrowLeft'&&sub.contains(document.activeElement)){toggleSub(false);miNew.focus()}
    else return;
    e.preventDefault();e.stopPropagation();
  });
  miNew.onclick=()=>toggleSub(sub.hidden);
  $('miOpen').onclick=()=>{close();$('file').click()};
  $('miEmpty').onclick=()=>{close();openNewDialog()};
  $('miJpeg').onclick=()=>{close();commitPending();askFileName('jpeg')};
  $('miExport').onclick=()=>{close();commitPending();askFileName('status')};
  $('miImport').onclick=()=>{close();$('importFile').click()};
  $('miSettings').onclick=()=>{close();openSettings()};
  $('importFile').onchange=e=>{const f=e.target.files[0];e.target.value='';if(f)importStatus(f)};
})();

/* ---------- shapes menu ---------- */
(()=>{
  const btn=$('shapesBtn'),list=$('shapesList');
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
  addEventListener('pointerdown',e=>{if(!list.hidden&&!$('shapesMenu').contains(e.target))close()});
  list.addEventListener('keydown',e=>{
    const it=items(),i=it.indexOf(document.activeElement);
    if(e.key==='Escape'){close(true)}
    else if(e.key==='ArrowDown'){it[(i+1)%it.length].focus()}
    else if(e.key==='ArrowUp'){it[(i-1+it.length)%it.length].focus()}
    else return;
    e.preventDefault();e.stopPropagation();
  });
})();

/* ---------- settings dialog ---------- */
const setDlg=$('settingsDlg');
async function openSettings(){
  $('setErr').hidden=true;
  const sel=$('setLang'),langs=await i18n.languages();
  sel.innerHTML='';
  sel.add(new Option(t('settings.langAuto'),'auto'));
  langs.forEach(l=>sel.add(new Option(l.name,l.code)));
  sel.value=[...sel.options].some(o=>o.value===settings.lang)?settings.lang:'auto';
  $('setW').value=settings.newW;$('setH').value=settings.newH;
  setDlg.showModal();
}
function applySettings(){
  const w=parseInt($('setW').value,10),h=parseInt($('setH').value,10);
  if(!validSize(w)||!validSize(h)){
    const e=$('setErr');e.textContent=t('newdlg.error',{min:16,max:MAXDIM});e.hidden=false;return;
  }
  const lang=$('setLang').value,langChanged=lang!==settings.lang;
  settings={lang,newW:w,newH:h};saveSettings();setDlg.close();
  if(langChanged){            // strings are applied at startup, so reload to use the new language
    const u=new URL(location.href);
    if(u.searchParams.has('lang')){u.searchParams.delete('lang');location.replace(u.href)}   // ?lang= would override the setting
    else location.reload();
  }
}
$('setOk').onclick=applySettings;
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
function layoutWidth(){
  const hdr=document.querySelector('header');
  hdr.classList.remove('wpop');
  const collapse=document.documentElement.classList.contains('tb-left')   // the left toolbar is too narrow for a slider
    ||$('width').getBoundingClientRect().width<MIN_INLINE_WIDTH;
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
  setBackground(c);cur=null;ops=[];redoStack=[];discardPending();resetNames();persist(true);ui();fit();newDlg.close();
}
$('newOk').onclick=createEmptyImage;
$('newCancel').onclick=()=>newDlg.close();
newDlg.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.tagName==='INPUT'&&e.target.type==='number'){e.preventDefault();createEmptyImage()}});

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
  addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}));
}

new ResizeObserver(()=>{resize()}).observe(stage);
addEventListener('resize',()=>{resize();layoutWidth()});
new ResizeObserver(()=>requestAnimationFrame(layoutWidth)).observe(document.querySelector('header'));
if(document.fonts&&document.fonts.ready)document.fonts.ready.then(layoutWidth);
applyToolbar();
resize();ui();restore();
});
