(()=>{
const $=id=>document.getElementById(id);
const cv=$('cv'),ctx=cv.getContext('2d'),stage=$('stage');
let bg=null,L=null,lc=null,ops=[],tool='pen',s=1,ox=0,oy=0,cur=null,panning=false;
const widths={draw:6,erase:24};
const ptrs=new Map();let pinch=null,last=null;
const MAXDIM=2400;
const APP_VERSION='v10';   // keep in step with CACHE in sw.js
$('ver').textContent='Markup '+APP_VERSION;

function msg(t){const m=$('msg');m.textContent=t;m.style.display='block';clearTimeout(msg.t);msg.t=setTimeout(()=>m.style.display='none',3500)}

/* ---------- drawing primitives ---------- */
function drawOp(c,o){
  c.save();c.lineCap=c.lineJoin='round';c.lineWidth=o.w;c.strokeStyle=o.c||'#000';
  if(o.t==='erase')c.globalCompositeOperation='destination-out';
  c.beginPath();
  if(o.t==='pen'||o.t==='erase'){
    c.moveTo(o.p[0][0],o.p[0][1]);
    if(o.p.length===1)c.lineTo(o.p[0][0],o.p[0][1]);
    for(let i=1;i<o.p.length;i++)c.lineTo(o.p[i][0],o.p[i][1]);
  }else if(o.t==='line'){c.moveTo(...o.a);c.lineTo(...o.b)}
  else if(o.t==='rect'){c.rect(o.a[0],o.a[1],o.b[0]-o.a[0],o.b[1]-o.a[1])}
  else if(o.t==='circle'){c.arc(o.a[0],o.a[1],Math.hypot(o.b[0]-o.a[0],o.b[1]-o.a[1]),0,Math.PI*2)}
  c.stroke();c.restore();
}
function replay(){lc.clearRect(0,0,L.width,L.height);ops.forEach(o=>drawOp(lc,o))}

/* ---------- view ---------- */
function resize(){
  const r=stage.getBoundingClientRect(),d=devicePixelRatio||1;
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
  ctx.setTransform(d*s,0,0,d*s,d*ox,d*oy);
  ctx.strokeStyle='rgba(255,255,255,.25)';ctx.lineWidth=1/s;ctx.strokeRect(0,0,bg.width,bg.height);
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
  if(ptrs.size===2){cancelCur();startPinch();return}
  if(ptrs.size>2)return;
  if(tool==='pan'||spaceDown||e.button===1||e.button===2){panning=true;last=local(e);setCursor();return}
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
  if(cur&&e.type==='pointerup'){
    const o=cur;cur=null;
    const degenerate=!o.p&&o.a[0]===o.b[0]&&o.a[1]===o.b[1];
    if(!degenerate){ops.push(o);if(o.t==='pen'||o.t==='erase'){}else drawOp(lc,o);persist()}
    else replay();
    ui();render();
  }else if(cur)cancelCur();
  if(ptrs.size===0){panning=false;setCursor()}
}
cv.addEventListener('pointerup',end);cv.addEventListener('pointercancel',end);
function cancelCur(){if(cur){cur=null;replay();render()}}
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
  $('undo').disabled=!ops.length;$('miJpeg').disabled=!bg;$('miExport').disabled=!bg;$('clear').disabled=!bg;
  $('hint').style.display=bg?'none':'flex';
}
document.querySelectorAll('button[data-t]').forEach(b=>b.onclick=()=>{
  tool=b.dataset.t;
  document.querySelectorAll('button[data-t]').forEach(x=>x.setAttribute('aria-pressed',x===b));
  syncWidth();setCursor();
});
function syncWidth(){
  const v=tool==='erase'?widths.erase:widths.draw;$('width').value=v;$('wv').textContent=v;
}
const PK='markup.prefs';
function savePrefs(){try{localStorage.setItem(PK,JSON.stringify({color:$('color').value,draw:widths.draw,erase:widths.erase}))}catch(e){}}
try{
  const p=JSON.parse(localStorage.getItem(PK)||'null');
  if(p){
    if(/^#[0-9a-f]{6}$/i.test(p.color))$('color').value=p.color;
    if(p.draw>=1&&p.draw<=80)widths.draw=+p.draw;
    if(p.erase>=1&&p.erase<=80)widths.erase=+p.erase;
  }
}catch(e){}
syncWidth();
const PALETTE=['#e63946','#f77f00','#fcbf49','#2a9d8f','#06d6a0','#118ab2','#7b2cbf','#ff4da6',
  '#000000','#4a4a4a','#9a9a9a','#ffffff','#8b5a2b','#1d3557','#a7c957','#00b4d8'];
const sw=$('sw');
PALETTE.forEach(c=>{
  const b=document.createElement('button');b.style.background=c;b.dataset.c=c;b.title=c;b.setAttribute('aria-label','Color '+c);
  b.onclick=()=>{$('color').value=c;markSw();savePrefs()};sw.appendChild(b);
});
function markSw(){const v=$('color').value.toLowerCase();picker.set(v);sw.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.c===v))}
const picker=createColorPicker({mount:$('cp'),input:$('color'),onChange:(c,final)=>{markSw();if(final)savePrefs()}});
markSw();
$('width').oninput=e=>{const v=+e.target.value;widths[tool==='erase'?'erase':'draw']=v;$('wv').textContent=v;savePrefs()};
function clearWork(all){
  if(!all&&!ops.length){msg('Nothing to clear.');return}
  if(!confirm(all?'Remove the drawing AND the background image? This cannot be undone.':'Clear everything you have drawn? The background image stays. This cannot be undone.'))return;
  cur=null;ops=[];
  if(all){
    bg=L=lc=null;
    try{localStorage.removeItem('markup.bg');localStorage.removeItem('markup.ops')}catch(e){}
    msg('Drawing and image removed.');
  }else{replay();persist();msg('Drawing cleared.')}
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
$('undo').onclick=()=>{if(!ops.length)return;ops.pop();replay();persist();ui();render()};
$('zi').onclick=()=>{const r=cv.getBoundingClientRect();zoomAt(1.25,r.width/2,r.height/2)};
$('zo').onclick=()=>{const r=cv.getBoundingClientRect();zoomAt(.8,r.width/2,r.height/2)};
$('fit').onclick=fit;
let spaceDown=false;
function setCursor(){cv.style.cursor=panning?'grabbing':(tool==='pan'||spaceDown)?'grab':'crosshair'}
addEventListener('keydown',e=>{
  if(e.target.closest&&e.target.closest('dialog'))return;   // let dialogs handle their own keys
  if((e.ctrlKey||e.metaKey)&&e.key==='z'){e.preventDefault();$('undo').click();return}
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
  if(ops.length&&!confirm('Opening a new image discards the current drawing. Continue?'))return;
  const url=URL.createObjectURL(f),img=new Image();
  img.onload=()=>{setBackground(img);URL.revokeObjectURL(url);ops=[];persist(true);ui();fit()};
  img.onerror=()=>msg('That file could not be read as an image.');
  img.src=url;
};

/* ---------- local storage ---------- */
function persist(withBg){
  try{
    if(withBg)localStorage.setItem('markup.bg',bg.toDataURL('image/jpeg',.88));
    localStorage.setItem('markup.ops',JSON.stringify(ops));
  }catch(err){msg('Browser storage is full – your work is not being saved. Try a smaller image.')}
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
function saveJpeg(){
  const c=document.createElement('canvas');c.width=bg.width;c.height=bg.height;
  const x=c.getContext('2d');x.drawImage(bg,0,0);x.drawImage(L,0,0);
  c.toBlob(b=>download(b,'markup.jpg'),'image/jpeg',.92);
}
function exportStatus(){
  const st={
    format:'markup-status',version:1,exportedAt:new Date().toISOString(),
    background:bg.toDataURL('image/jpeg',.88),
    operations:ops,
    preferences:{color:$('color').value,drawWidth:widths.draw,eraseWidth:widths.erase}
  };
  download(new Blob([JSON.stringify(st)],{type:'application/json'}),'markup-status.json');
}
const num=v=>typeof v==='number'&&isFinite(v);
const pt=p=>Array.isArray(p)&&p.length===2&&num(p[0])&&num(p[1]);
function validOp(o){
  if(!o||typeof o!=='object'||!num(o.w)||typeof o.c!=='string')return false;
  if(o.t==='pen'||o.t==='erase')return Array.isArray(o.p)&&o.p.length>0&&o.p.every(pt);
  if(o.t==='line'||o.t==='rect'||o.t==='circle')return pt(o.a)&&pt(o.b);
  return false;
}
function importStatus(file){
  const fr=new FileReader();
  fr.onerror=()=>msg('The file could not be read.');
  fr.onload=()=>{
    let st;
    try{st=JSON.parse(fr.result)}catch(e){msg('This is not a valid JSON file.');return}
    if(!st||st.format!=='markup-status'||typeof st.background!=='string'||!st.background.startsWith('data:image/')||!Array.isArray(st.operations)||!st.operations.every(validOp)){
      msg('This file is not a valid Markup status export.');return;
    }
    if(bg&&!confirm('Importing replaces the current image and drawing. Continue?'))return;
    const img=new Image();
    img.onload=()=>{
      setBackground(img);cur=null;ops=st.operations;replay();
      const p=st.preferences||{};
      if(typeof p.color==='string'&&/^#[0-9a-f]{6}$/i.test(p.color))$('color').value=p.color;
      if(p.drawWidth>=1&&p.drawWidth<=80)widths.draw=+p.drawWidth;
      if(p.eraseWidth>=1&&p.eraseWidth<=80)widths.erase=+p.eraseWidth;
      syncWidth();markSw();savePrefs();persist(true);ui();fit();msg('Status imported.');
    };
    img.onerror=()=>msg('The background image in this file could not be loaded.');
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
  }
  function open(){
    toggleSub(false);list.hidden=false;list.style.left='0';
    const over=list.getBoundingClientRect().right-(innerWidth-6);
    if(over>0)list.style.left=(-over)+'px';
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
  $('miJpeg').onclick=()=>{close();saveJpeg()};
  $('miExport').onclick=()=>{close();exportStatus()};
  $('miImport').onclick=()=>{close();$('importFile').click()};
  $('importFile').onchange=e=>{const f=e.target.files[0];e.target.value='';if(f)importStatus(f)};
})();

/* ---------- new empty image ---------- */
const newDlg=$('newDlg');
const newPicker=createColorPicker({mount:$('newCp'),input:$('newColor'),inline:true,onChange(){}});
function openNewDialog(){
  $('newErr').hidden=true;$('newColor').value='#ffffff';newPicker.set('#ffffff');
  newDlg.showModal();
}
function createEmptyImage(){
  const w=parseInt($('newW').value,10),h=parseInt($('newH').value,10);
  if(!(w>=16&&w<=MAXDIM&&h>=16&&h<=MAXDIM)){
    const e=$('newErr');e.textContent='Width and height must be whole numbers between 16 and '+MAXDIM+' px.';e.hidden=false;return;
  }
  if(ops.length&&!confirm('Creating a new image discards the current drawing. Continue?'))return;
  const c=document.createElement('canvas');c.width=w;c.height=h;
  const x=c.getContext('2d');x.fillStyle=$('newColor').value;x.fillRect(0,0,w,h);
  setBackground(c);cur=null;ops=[];persist(true);ui();fit();newDlg.close();
}
$('newOk').onclick=createEmptyImage;
$('newCancel').onclick=()=>newDlg.close();
newDlg.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.tagName==='INPUT'&&e.target.type==='number'){e.preventDefault();createEmptyImage()}});

if('serviceWorker' in navigator){
  addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}));
}

new ResizeObserver(()=>{resize()}).observe(stage);
addEventListener('resize',()=>{resize();});
resize();ui();restore();
})();
