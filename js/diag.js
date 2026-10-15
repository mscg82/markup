/* Touch diagnostics: an on-screen panel that shows what the browser reports for every pointer
   (pen / touch / mouse, contact size, pressure...) and for the older touch events (radius, force, touchType).
   Meant for finding out whether a device can tell a stylus tip, a finger and a palm apart.
   It is switched on in Settings ("Show touch diagnostics") and only observes: it never changes the events.
   Its texts come from t() (see js/i18n.js). */
i18n.ready.then(()=>{
  const $=id=>document.getElementById(id);
  const T0=performance.now();
  const MAX_LOG=400,SHOW=9,SAMPLE_MS=250;
  let on=false,panel=null,live=null,logEl=null,sumEl=null;
  const log=[];                         // all entries, kept for Copy
  const active=new Map();               // pointerId -> latest info
  const stats={};                       // pointerType -> {n,minW,maxW,minH,maxH,maxP}
  const lastMove=new Map();

  const f=(v,d=2)=>typeof v==='number'&&isFinite(v)?(Math.round(v*10**d)/10**d).toString():'-';
  const where=e=>{const t=e.target;return t&&t.id?'#'+t.id:(t&&t.tagName?t.tagName.toLowerCase():'?')};

  function describe(e){
    return{type:e.pointerType,id:e.pointerId,w:e.width,h:e.height,p:e.pressure,tx:e.tiltX,ty:e.tiltY,btn:e.buttons,prim:e.isPrimary,at:where(e)};
  }
  function fmt(d){
    return d.type+' id='+d.id+' '+f(d.w,1)+'x'+f(d.h,1)+' p='+f(d.p)+' tilt='+f(d.tx,0)+','+f(d.ty,0)+' btn='+d.btn+(d.prim?' primary':'')+' @'+d.at;
  }
  function add(kind,text){
    const line='+'+((performance.now()-T0)/1000).toFixed(2)+'s '+kind+' '+text;
    log.push(line);if(log.length>MAX_LOG)log.shift();
    render();
  }
  function stat(d){
    const s=stats[d.type]||(stats[d.type]={n:0,minW:1e9,maxW:0,minH:1e9,maxH:0,maxP:0});
    s.n++;s.minW=Math.min(s.minW,d.w);s.maxW=Math.max(s.maxW,d.w);s.minH=Math.min(s.minH,d.h);s.maxH=Math.max(s.maxH,d.h);s.maxP=Math.max(s.maxP,d.p);
  }

  function onPointer(e){
    const d=describe(e);
    if(e.type==='pointermove'){
      active.set(e.pointerId,d);
      const now=performance.now();
      if(now-(lastMove.get(e.pointerId)||0)<SAMPLE_MS){renderLive();return}
      lastMove.set(e.pointerId,now);
    }
    if(e.type==='pointerdown'){active.set(e.pointerId,d);stat(d);lastMove.set(e.pointerId,performance.now())}
    if(e.type==='pointerup'||e.type==='pointercancel'){active.delete(e.pointerId);lastMove.delete(e.pointerId)}
    add(e.type.replace('pointer',''),fmt(d));
  }
  function onTouch(e){
    if(e.type==='touchmove'){
      const now=performance.now();if(now-(lastMove.get('touch')||0)<SAMPLE_MS)return;lastMove.set('touch',now);
    }
    const list=e.type==='touchend'||e.type==='touchcancel'?e.changedTouches:e.touches;
    const parts=[...list].map(x=>'['+x.identifier+' '+(x.touchType||'?')+' r='+f(x.radiusX,1)+'x'+f(x.radiusY,1)+' force='+f(x.force)+']');
    add(e.type,'touches='+e.touches.length+' '+parts.join(' '));
  }

  function summary(){
    const mq=q=>matchMedia(q).matches;
    const ua=(navigator.userAgent.match(/(Chrom(e|ium)|Firefox|Edg|SamsungBrowser)\/[\d.]+/)||['?'])[0];
    return ua+' | maxTouchPoints='+navigator.maxTouchPoints+' | pointer:'+(mq('(pointer:fine)')?'fine':mq('(pointer:coarse)')?'coarse':'none')+
      ' hover:'+(mq('(hover:hover)')?'yes':'no')+' | any-pointer:'+(mq('(any-pointer:fine)')?'fine ':'')+(mq('(any-pointer:coarse)')?'coarse':'')+
      ' | dpr='+devicePixelRatio+' | PointerEvent='+('PointerEvent' in window)+' | TouchEvent='+('TouchEvent' in window);
  }
  function statsText(){
    const k=Object.keys(stats);if(!k.length)return t('diag.noData');
    return k.map(n=>{const s=stats[n];return n+': n='+s.n+' w '+f(s.minW,1)+'-'+f(s.maxW,1)+' h '+f(s.minH,1)+'-'+f(s.maxH,1)+' pmax='+f(s.maxP)}).join('\n');
  }
  function renderLive(){
    if(!live)return;
    live.textContent=active.size?[...active.values()].map(fmt).join('\n'):t('diag.none');
  }
  function render(){
    if(!panel)return;
    renderLive();
    sumEl.textContent=statsText();
    logEl.textContent=log.slice(-SHOW).join('\n');
  }
  function report(){
    return [t('diag.title'),summary(),'','-- '+t('diag.stats')+' --',statsText(),'','-- '+t('diag.log')+' --',...log].join('\n');
  }
  async function copy(){
    const text=report();
    try{await navigator.clipboard.writeText(text);msgCopied(true);return}catch(e){}
    try{                                                // older browsers / no HTTPS
      const ta=document.createElement('textarea');ta.value=text;ta.style.cssText='position:fixed;left:0;top:0;opacity:0';
      document.body.appendChild(ta);ta.select();const ok=document.execCommand('copy');ta.remove();msgCopied(ok);
    }catch(e){msgCopied(false)}
  }
  function msgCopied(ok){const b=$('diagCopy');if(!b)return;b.textContent=t(ok?'diag.copied':'diag.copyFailed');setTimeout(()=>{b.textContent=t('diag.copy')},1500)}

  function build(){
    panel=document.createElement('div');panel.id='diagPanel';panel.setAttribute('role','region');panel.setAttribute('aria-label',t('diag.title'));
    panel.innerHTML='<div class="dg-head"><strong></strong><span class="dg-btns"><button type="button" id="diagCopy"></button><button type="button" id="diagClear"></button><button type="button" id="diagClose" aria-label=""></button></span></div>'+
      '<div class="dg-sum"></div><div class="dg-h"></div><pre class="dg-live"></pre><div class="dg-h"></div><pre class="dg-stats"></pre><div class="dg-h"></div><pre class="dg-log"></pre>';
    const q=s=>panel.querySelector(s),hs=panel.querySelectorAll('.dg-h');
    q('strong').textContent=t('diag.title');
    q('.dg-sum').textContent=summary();
    hs[0].textContent=t('diag.active');hs[1].textContent=t('diag.stats');hs[2].textContent=t('diag.log');
    $('stage')?.appendChild(panel);
    $('diagCopy').textContent=t('diag.copy');$('diagClear').textContent=t('diag.clear');
    $('diagClose').textContent='✕';$('diagClose').setAttribute('aria-label',t('diag.close'));$('diagClose').title=t('diag.close');
    live=q('.dg-live');sumEl=q('.dg-stats');logEl=q('.dg-log');
    $('diagCopy').onclick=copy;
    $('diagClear').onclick=()=>{log.length=0;for(const k in stats)delete stats[k];active.clear();render()};
    $('diagClose').onclick=()=>{enable(false);window.dispatchEvent(new CustomEvent('markup:diag-closed'))};
  }
  const PE=['pointerdown','pointermove','pointerup','pointercancel'],TE=['touchstart','touchmove','touchend','touchcancel'];
  function enable(v){
    if(v===on)return;on=v;
    if(on){
      build();
      for(const n of PE)addEventListener(n,onPointer,{capture:true,passive:true});
      for(const n of TE)addEventListener(n,onTouch,{capture:true,passive:true});
      render();
    }else{
      for(const n of PE)removeEventListener(n,onPointer,{capture:true});
      for(const n of TE)removeEventListener(n,onTouch,{capture:true});
      panel&&panel.remove();panel=null;
    }
  }
  window.addEventListener('markup:diag',e=>enable(!!e.detail));
  try{if(JSON.parse(localStorage.getItem('markup.settings')||'{}').diag===true)enable(true)}catch(e){}
});
