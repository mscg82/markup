/* Custom color picker (saturation/value square + hue bar + hex field).
   Draws its own UI so it looks the same in every browser.
   Its labels come from the global t() function (see js/i18n.js).

   createColorPicker({mount, input, onChange, inline}) -> {set(hex)}
   - mount:    element the picker builds its UI into
   - input:    element whose .value holds the current "#rrggbb" color
   - onChange: called as onChange(hex, final) when the USER changes the color
               (final=false while dragging, true when the gesture ends)
   - inline:   false (default) = a color button that opens a popover;
               true = the picker panel is always visible
   - set(hex): updates the picker UI from outside, without calling onChange */
function createColorPicker({mount,input,onChange,inline=false}){
  mount.classList.add('cp');mount.classList.toggle('inline',inline);
  mount.innerHTML=(inline?'':`<button type="button" class="cp-btn" aria-haspopup="dialog" aria-expanded="false" aria-label="${t('picker.button')}" title="${t('picker.button')}"><span class="cp-chip"></span></button>`)+
    `<div class="cp-pop" role="group" aria-label="${t('picker.panel')}"${inline?'':' hidden'}>
      <div class="cp-sv" tabindex="0" role="slider" aria-label="${t('picker.sv')}"><div class="cp-knob"></div></div>
      <div class="cp-hue" tabindex="0" role="slider" aria-label="${t('picker.hue')}"><div class="cp-knob"></div></div>
      <div class="cp-row"><span class="cp-prev"></span><input class="cp-hex" type="text" maxlength="7" spellcheck="false" autocomplete="off" aria-label="${t('picker.hex')}"></div>
    </div>`;
  const q=sel=>mount.querySelector(sel);
  const btn=q('.cp-btn'),chip=q('.cp-chip'),pop=q('.cp-pop');
  const svEl=q('.cp-sv'),svK=svEl.firstElementChild,hueEl=q('.cp-hue'),hueK=hueEl.firstElementChild;
  const hexIn=q('.cp-hex'),prev=q('.cp-prev');
  const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
  let h=0,s=1,v=1;

  function hsv2rgb(h,s,v){
    const f=n=>{const k=(n+h/60)%6;return v-v*s*Math.max(0,Math.min(k,4-k,1))};
    return[f(5),f(3),f(1)].map(x=>Math.round(x*255));
  }
  function rgb2hsv(r,g,b){
    r/=255;g/=255;b/=255;
    const mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn;let hh=0;
    if(d){
      if(mx===r)hh=((g-b)/d)%6;else if(mx===g)hh=(b-r)/d+2;else hh=(r-g)/d+4;
      hh*=60;if(hh<0)hh+=360;
    }
    return[hh,mx?d/mx:0,mx];
  }
  const toHex=(r,g,b)=>'#'+[r,g,b].map(x=>x.toString(16).padStart(2,'0')).join('');
  function parseHex(t){
    const m=/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(t.trim());if(!m)return null;
    let x=m[1].toLowerCase();if(x.length===3)x=x.split('').map(c=>c+c).join('');
    return'#'+x;
  }
  const fromHex=c=>[1,3,5].map(i=>parseInt(c.slice(i,i+2),16));
  const hex=()=>toHex(...hsv2rgb(h,s,v));

  function paint(c){
    c=c||hex();
    svEl.style.backgroundColor=`hsl(${h},100%,50%)`;
    svK.style.left=s*100+'%';svK.style.top=(1-v)*100+'%';svK.style.background=c;
    hueK.style.left=h/360*100+'%';hueK.style.background=`hsl(${h},100%,50%)`;
    if(chip)chip.style.background=c;
    prev.style.background=c;
    if(document.activeElement!==hexIn)hexIn.value=c;
  }
  function emit(final,c){
    c=c||hex();input.value=c;paint(c);onChange(c,final);
  }

  function drag(el,fn){
    const move=e=>{
      const r=el.getBoundingClientRect();
      fn(clamp((e.clientX-r.left)/r.width,0,1),clamp((e.clientY-r.top)/r.height,0,1));emit(false);
    };
    el.addEventListener('pointerdown',e=>{el.setPointerCapture(e.pointerId);el.focus();move(e)});
    el.addEventListener('pointermove',e=>{if(el.hasPointerCapture(e.pointerId))move(e)});
    const up=e=>{if(el.hasPointerCapture(e.pointerId)){el.releasePointerCapture(e.pointerId);emit(true)}};
    el.addEventListener('pointerup',up);el.addEventListener('pointercancel',up);
  }
  drag(svEl,(x,y)=>{s=x;v=1-y});
  drag(hueEl,x=>{h=Math.min(359.99,x*360)});

  // keyboard support
  svEl.addEventListener('keydown',e=>{
    const st=e.shiftKey?.1:.02;
    if(e.key==='ArrowLeft')s=clamp(s-st,0,1);else if(e.key==='ArrowRight')s=clamp(s+st,0,1);
    else if(e.key==='ArrowUp')v=clamp(v+st,0,1);else if(e.key==='ArrowDown')v=clamp(v-st,0,1);
    else return;
    e.preventDefault();emit(true);
  });
  hueEl.addEventListener('keydown',e=>{
    const st=e.shiftKey?20:3;
    if(e.key==='ArrowLeft'||e.key==='ArrowDown')h=(h-st+360)%360;
    else if(e.key==='ArrowRight'||e.key==='ArrowUp')h=(h+st)%360;
    else return;
    e.preventDefault();emit(true);
  });

  // hex field
  hexIn.addEventListener('input',()=>{
    const c=parseHex(hexIn.value);if(!c)return;
    const [nh,ns,nv]=rgb2hsv(...fromHex(c));
    if(ns>0&&nv>0)h=nh;s=ns;v=nv;emit(true,c);
  });
  hexIn.addEventListener('blur',()=>{hexIn.value=input.value});

  // popover (button mode only)
  pop.addEventListener('keydown',e=>{
    if(inline)return;
    e.stopPropagation();                 // keep arrows/space from panning the canvas
    if(e.key==='Escape'||e.key==='Enter'&&e.target!==hexIn)close(true);
  });
  function open(){
    pop.hidden=false;pop.style.left='0';
    const over=pop.getBoundingClientRect().right-(innerWidth-6);
    if(over>0)pop.style.left=(-over)+'px';
    btn.setAttribute('aria-expanded','true');
  }
  function close(focus){pop.hidden=true;btn.setAttribute('aria-expanded','false');if(focus)btn.focus()}
  if(!inline){
    btn.addEventListener('click',()=>pop.hidden?open():close());
    addEventListener('pointerdown',e=>{if(!pop.hidden&&!mount.contains(e.target))close()});
  }

  function set(c){
    c=(c||'').toLowerCase();
    if(!/^#[0-9a-f]{6}$/.test(c)||c===hex())return;
    const [nh,ns,nv]=rgb2hsv(...fromHex(c));
    if(ns>0&&nv>0)h=nh;s=ns;v=nv;paint(c);
  }
  set(input.value);paint(input.value);
  return{set};
}
