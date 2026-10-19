/* Markup - draw annotations over a background image, in the browser.
   Copyright (C) 2026 Giuseppe Miscione

   SPDX-License-Identifier: GPL-3.0-or-later

   This program is free software: you can redistribute it and/or modify it under
   the terms of the GNU General Public License as published by the Free Software
   Foundation, either version 3 of the License, or (at your option) any later
   version.

   This program is distributed in the hope that it will be useful, but WITHOUT ANY
   WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
   PARTICULAR PURPOSE. See the GNU General Public License for more details.

   You should have received a copy of the GNU General Public License along with
   this program (see the LICENSE file). If not, see <https://www.gnu.org/licenses/>.
*/
/* Minimal localisation support.
   All user-visible text lives in locale/<language>.json (flat "key": "text" files).
   English (locale/en.json) is always loaded first as the base, then the preferred
   language is loaded on top of it, so a partial translation falls back to English.

   Language choice: ?lang=xx in the URL, otherwise the language saved in the Settings
   dialog, otherwise the browser's language list (e.g. it-IT is tried as "it-IT" and then "it").
   The selectable languages are listed in locale/languages.json.

   In HTML:  data-i18n="key"              -> element text
             data-i18n-title="key"        -> title (tooltip)
             data-i18n-aria-label="key"   -> aria-label
   In JS:    t('key') or t('key', {name: value}) for "{name}" placeholders.
   A missing key is shown as the key itself. */
(()=>{
  const BASE='en';
  let dict={},lang=BASE;

  function t(key,params){
    let s=dict[key];
    if(s===undefined)return key;
    if(params)s=s.replace(/\{(\w+)\}/g,(m,k)=>k in params?String(params[k]):m);
    return s;
  }

  function apply(root=document){
    root.querySelectorAll('[data-i18n]').forEach(el=>{el.textContent=t(el.dataset.i18n)});
    root.querySelectorAll('[data-i18n-title]').forEach(el=>{el.title=t(el.dataset.i18nTitle)});
    root.querySelectorAll('[data-i18n-aria-label]').forEach(el=>{el.setAttribute('aria-label',t(el.dataset.i18nAriaLabel))});
  }

  async function load(code){
    const r=await fetch('locale/'+encodeURIComponent(code)+'.json');
    if(!r.ok)throw new Error('HTTP '+r.status);
    return r.json();
  }

  // Language saved by the Settings dialog: a language code or "auto" (use the browser's languages).
  function savedLang(){
    try{const l=JSON.parse(localStorage.getItem('markup.settings')||'{}').lang;return typeof l==='string'?l:'auto'}
    catch(e){return'auto'}
  }

  function candidates(){
    const out=[],add=c=>{if(c&&!out.includes(c))out.push(c)};
    const q=new URLSearchParams(location.search).get('lang');
    const saved=savedLang();
    const pick=q||(saved!=='auto'?saved:null);          // an explicit choice wins over the browser's languages
    const langs=pick?[pick]:(navigator.languages||[navigator.language]);
    for(const l of langs){
      if(!/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(l))continue;   // ignore odd values
      add(l);add(l.split('-')[0]);
    }
    return out.filter(c=>c.toLowerCase()!==BASE);   // English is always loaded as the base
  }

  const ready=(async()=>{
    try{dict=await load(BASE)}catch(e){console.error('Could not load the base locale:',e)}
    for(const code of candidates()){
      try{Object.assign(dict,await load(code));lang=code;break}catch(e){/* try the next candidate */}
    }
    document.documentElement.lang=lang;
    document.title=t('app.title');
    apply();
    document.documentElement.classList.add('i18n-ready');
  })();

  // List of selectable languages ({code, name}), from locale/languages.json.
  let langList=null;
  function languages(){
    return langList||(langList=fetch('locale/languages.json')
      .then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.json()})
      .catch(()=>[{code:BASE,name:'English'}]));
  }

  window.t=t;
  window.i18n={t,apply,ready,languages,get lang(){return lang}};
})();
