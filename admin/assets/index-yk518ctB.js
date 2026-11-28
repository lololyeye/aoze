(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const i of document.querySelectorAll('link[rel="modulepreload"]'))s(i);new MutationObserver(i=>{for(const r of i)if(r.type==="childList")for(const l of r.addedNodes)l.tagName==="LINK"&&l.rel==="modulepreload"&&s(l)}).observe(document,{childList:!0,subtree:!0});function a(i){const r={};return i.integrity&&(r.integrity=i.integrity),i.referrerPolicy&&(r.referrerPolicy=i.referrerPolicy),i.crossOrigin==="use-credentials"?r.credentials="include":i.crossOrigin==="anonymous"?r.credentials="omit":r.credentials="same-origin",r}function s(i){if(i.ep)return;i.ep=!0;const r=a(i);fetch(i.href,r)}})();class E extends Error{constructor(t,a){super(a),this.status=t}}let Ie="";async function k(e,t){const a=t!==void 0,s=await fetch(`/admin/api/${e}`,{method:a?"POST":"GET",credentials:"same-origin",headers:a?{"Content-Type":"application/json","X-CSRF-Token":Ie}:{},body:a?JSON.stringify(t):null}),i=await s.json().catch(()=>({}));if(s.status===401&&e!=="login"&&window.dispatchEvent(new Event("admin:signed-out")),!s.ok)throw new E(s.status,i.error??"Le serveur ne répond pas correctement.");return i}async function Ve(){const e=await k("session");return Ie=e.csrf??"",e}const dt={"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"};class be{constructor(t){this.value=t}toString(){return this.value}}const pt=e=>e.replace(/[&<>"']/g,t=>dt[t]),z=e=>new be(e);function He(e){return e instanceof be?e.value:Array.isArray(e)?e.map(He).join(""):e==null||e===!1?"":pt(String(e))}function n(e,...t){let a=e[0];return t.forEach((s,i)=>a+=He(s)+e[i+1]),new be(a)}const mt={overview:'<path d="M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-3H4zM14 7h6V4h-6z"/>',analytics:'<path d="M4 4v16h16"/><path d="m8 14 3.5-4 3 2.5L20 7"/>',application:'<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',website:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',infrastructure:'<rect x="4" y="4" width="16" height="7" rx="1.5"/><rect x="4" y="13" width="16" height="7" rx="1.5"/><path d="M8 7.5h.01M8 16.5h.01"/>',security:'<path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6z"/><path d="m9 12 2 2 4-4"/>',settings:'<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',download:'<path d="M12 3v12m0 0-4-4m4 4 4-4M5 21h14"/>',refresh:'<path d="M20 11a8 8 0 0 0-14.9-3M4 4v4h4M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4"/>',update:'<path d="M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5"/><path d="m9 12 2 2 4-4"/>',tag:'<path d="M3 12V4h8l10 10-8 8z"/><path d="M7.5 7.5h.01"/>',users:'<circle cx="9" cy="8" r="3.5"/><path d="M3 20a6 6 0 0 1 12 0M16 4.5a3.5 3.5 0 0 1 0 7M21 20a6 6 0 0 0-4-5.6"/>',pulse:'<path d="M3 12h4l3-7 4 14 3-7h4"/>',funnel:'<path d="M3 4h18l-7 8v6l-4 2v-8z"/>',link:'<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',file:'<path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/>',lock:'<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',external:'<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',logout:'<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10"/>',menu:'<path d="M4 7h16M4 12h16M4 17h16"/>',close:'<path d="M6 6l12 12M18 6 6 18"/>',check:'<path d="m5 12 5 5 9-10"/>',alert:'<path d="M12 4 2.5 20h19z"/><path d="M12 10v4M12 17h.01"/>',info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',calendar:'<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'},$=e=>z(`<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${mt[e]}</svg>`),ge=[{id:"7",label:"7 j",days:7},{id:"30",label:"30 j",days:30},{id:"90",label:"90 j",days:90},{id:"365",label:"12 mois",days:365}],Re="aoze-admin-period",vt=760,ht=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}),ft=new Intl.DateTimeFormat("fr-FR",{day:"numeric",month:"short",timeZone:"UTC"}),bt=new Intl.DateTimeFormat("fr-FR",{day:"numeric",month:"short",year:"numeric",timeZone:"UTC"}),Y=()=>ht.format(new Date);function _e(e,t){const a=new Date(`${e}T00:00:00Z`);return a.setUTCDate(a.getUTCDate()+t),a.toISOString().slice(0,10)}const gt=e=>Math.round((Date.parse(e.to)-Date.parse(e.from))/864e5)+1,$t=(e,t=!1)=>(t?bt:ft).format(new Date(`${e}T00:00:00Z`)),$e=(e,t)=>a=>$t(a,e.slice(0,4)!==t.slice(0,4));function yt(){try{const e=JSON.parse(sessionStorage.getItem(Re)??"null");if(e&&(e.preset==="custom"||ge.some(t=>t.id===e.preset)))return e}catch{}return{preset:"30"}}let T=yt();function ye(){var a;const e=Y();if(T.preset==="custom"&&"from"in T)return{from:T.from,to:T.to>e?e:T.to};const t=((a=ge.find(s=>s.id===T.preset))==null?void 0:a.days)??30;return{from:_e(e,1-t),to:e}}function Ee(e){T=e;try{sessionStorage.setItem(Re,JSON.stringify(e))}catch{}window.dispatchEvent(new Event("admin:refresh"))}function ie(e=ye()){const t=$e(e.from,e.to);return e.from===e.to?t(e.from):`du ${t(e.from)} au ${t(e.to)}`}function wt(){const e=ye(),t=T.preset==="custom";return n`<div class="range">
    <div class="segmented" role="group" aria-label="Période">
      ${ge.map(a=>n`<button type="button" data-preset="${a.id}" aria-pressed="${String(T.preset===a.id)}">${a.label}</button>`)}
      <button type="button" data-custom aria-pressed="${String(t)}" aria-expanded="false" aria-controls="range-form">${$("calendar")}<span>${t?ie(e):"Personnalisée"}</span></button>
    </div>
    <form class="range-form card" id="range-form" hidden>
      <label class="field"><span>Du</span><input type="date" name="from" value="${e.from}" max="${Y()}" required /></label>
      <label class="field"><span>Au</span><input type="date" name="to" value="${e.to}" max="${Y()}" required /></label>
      <p class="form-error" role="alert" hidden></p>
      <button class="btn btn-primary btn-sm" type="submit">Afficher</button>
    </form>
  </div>`}function kt(e){e.addEventListener("click",t=>{const a=t.target,s=a.closest("[data-preset]");if(s)return Ee({preset:s.dataset.preset});const i=a.closest("[data-custom]");if(i){const r=e.querySelector("#range-form");r.hidden=!r.hidden,i.setAttribute("aria-expanded",String(!r.hidden)),r.hidden||r.querySelector("input").focus()}}),e.addEventListener("submit",t=>{const a=t.target.closest("#range-form");if(!a)return;t.preventDefault();const s=String(new FormData(a).get("from")),i=String(new FormData(a).get("to")),r=a.querySelector(".form-error"),l=s>i?"La date de début doit précéder la date de fin.":i>Y()?"La période ne peut pas dépasser aujourd'hui.":gt({from:s,to:i})>vt?"25 mois au plus.":"";r.textContent=l,r.hidden=!l,l||Ee({preset:"custom",from:s,to:i})})}const At=new Intl.NumberFormat("fr-FR"),St=new Intl.DateTimeFormat("fr-FR",{day:"numeric",month:"long",year:"numeric"}),xt=new Intl.DateTimeFormat("fr-FR",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}),Lt=new Intl.RelativeTimeFormat("fr-FR",{numeric:"auto"}),c=e=>At.format(e),W=e=>St.format(new Date(e)),re=e=>xt.format(new Date(e));function we(e){if(e<1024)return`${e} o`;const t=["Ko","Mo","Go"];let a=e/1024,s=0;for(;a>=1024&&s<t.length-1;)a/=1024,s++;return`${a.toFixed(a<10?1:0).replace(".",",")} ${t[s]}`}function L(e){const t=(new Date(e).getTime()-Date.now())/1e3,a=[["day",86400],["hour",3600],["minute",60]];for(const[s,i]of a)if(Math.abs(t)>=i)return Lt.format(Math.round(t/i),s);return"à l'instant"}const te=e=>Math.floor((new Date(e).getTime()-Date.now())/864e5),Fe=e=>e.slice(0,7),f=(e,t)=>n`<span class="pill pill-${e}">${t}</span>`;function qt(e){switch(e.state){case"live":return n`<span class="source source-live" data-tip="${`Données mises à jour ${L(e.fetchedAt)}`}">${L(e.fetchedAt)}</span>`;case"unavailable":return n`<span class="source source-off">Indisponible</span>`}}function d(e,t,a={}){return n`<section class="${`card${a.wide?" card-wide":""}`}">
    <header class="card-head">
      ${a.icon?n`<span class="card-icon">${$(a.icon)}</span>`:""}
      <h2>${e}</h2>${a.action??""}${a.tag??""}
    </header>
    ${t}
  </section>`}function h(e,t,a,s={}){const i=t.state==="unavailable"?n`<p class="unavailable">${t.reason}</p>`:a(t.data);return d(e,i,{...s,tag:qt(t)})}const v=e=>n`<div class="card kpi">
    <div class="kpi-top"><span class="kpi-icon">${$(e.icon)}</span><span>${e.label}</span></div>
    <strong class="kpi-value">${e.value}</strong>
    ${e.hint?n`<span class="kpi-hint">${e.hint}</span>`:""}
  </div>`,I=e=>n`<div class="kpis">${e}</div>`,p=(e,t)=>n`<div class="kv"><dt>${e}</dt><dd>${t}</dd></div>`,Mt=e=>n`<div class="empty">
    <span class="empty-icon">${$(e.icon)}</span>
    <h3>${e.title}</h3>
    <p>${e.text}</p>
    ${e.list?n`<ul class="chips">${e.list.map(t=>n`<li>${t}</li>`)}</ul>`:""}
    ${e.action??""}
  </div>`,Et=()=>n`<div class="skeleton" aria-hidden="true">
  <div class="kpis">${[1,2,3,4].map(()=>n`<div class="card skel skel-kpi"></div>`)}</div>
  <div class="grid"><div class="card skel skel-wide"></div><div class="card skel"></div><div class="card skel"></div></div>
</div>`;function Tt(e){e.querySelectorAll("[data-h]").forEach(t=>t.style.setProperty("--h",`${t.dataset.h}%`)),e.querySelectorAll("[data-w]").forEach(t=>t.style.setProperty("--w",`${t.dataset.w}%`))}function Ct(e){const t=s=>{const i=s.target.closest("[data-tip]");if(!i)return;e.textContent=i.dataset.tip??"",e.hidden=!1;const r=i.getBoundingClientRect(),l=Math.min(Math.max(r.left+r.width/2,e.offsetWidth/2+8),innerWidth-e.offsetWidth/2-8),o=r.top>e.offsetHeight+16;e.classList.toggle("tip-below",!o),e.style.setProperty("left",`${l}px`),e.style.setProperty("top",`${o?r.top-10:r.bottom+10}px`)},a=s=>{s.target.closest("[data-tip]")&&(e.hidden=!0)};document.addEventListener("pointerover",t),document.addEventListener("focusin",t),document.addEventListener("pointerout",a),document.addEventListener("focusout",a),addEventListener("scroll",()=>e.hidden=!0,{passive:!0,capture:!0})}const Dt={ok:"check",warn:"alert",bad:"alert",muted:"info"};function S(e,t="ok"){const a=document.querySelector("#toasts"),s=document.createElement("div");s.className=`toast toast-${t}`,s.setAttribute("role",t==="bad"?"alert":"status"),s.innerHTML=n`<span class="toast-icon">${$(Dt[t])}</span><p>${e}</p>
    <button class="icon-btn" type="button" aria-label="Fermer">${$("close")}</button>`.value;const i=()=>{s.classList.add("toast-out"),s.addEventListener("animationend",()=>s.remove(),{once:!0}),setTimeout(()=>s.remove(),400)};for(s.querySelector("button").addEventListener("click",i),a.append(s);a.children.length>3;)a.firstElementChild.remove();setTimeout(i,t==="bad"?7e3:4e3)}function J(e){const t=document.querySelector("#confirm");return t.innerHTML=n`<form method="dialog" class="confirm">
    <span class="${`confirm-icon${e.danger?" confirm-danger":""}`}">${$(e.danger?"alert":"info")}</span>
    <h2>${e.title}</h2>
    <p>${e.text}</p>
    <div class="confirm-actions">
      <button class="btn btn-ghost" value="cancel">Annuler</button>
      <button class="${`btn ${e.danger?"btn-danger":"btn-primary"}`}" value="ok">${e.confirm}</button>
    </div>
  </form>`.value,t.showModal(),new Promise(a=>t.addEventListener("close",()=>a(t.returnValue==="ok"),{once:!0}))}function Ne(e){if(e<=4)return 4;const t=10**Math.floor(Math.log10(e));return[1,2,2.5,5,10].map(a=>a*t).find(a=>a>=e)}function Oe(e,t){const a=Ne(Math.max(...e.map(s=>s.value),0));return n`<div class="chart-bars" role="img" aria-label="${t}">
    <div class="chart-axis" aria-hidden="true">
      <span class="at-100">${c(a)}</span><span class="at-50">${c(a/2)}</span><span class="at-0">0</span>
    </div>
    <div class="chart-plot">
      <div class="chart-grid" aria-hidden="true"></div>
      ${e.map(s=>n`<div class="cbar" tabindex="0" data-tip="${s.tip??`${s.label} : ${c(s.value)}`}">
        <div class="cbar-col"><span class="cbar-fill" data-h="${s.value/a*100}"><span class="cbar-value">${c(s.value)}</span></span></div>
        <span class="cbar-label">${s.label}</span>
      </div>`)}
    </div>
  </div>`}const ae=(e,t)=>`${t?Math.round(e/t*100):0} %`;function F(e,t){const a=e.reduce((l,o)=>l+o.value,0),s=e.filter(l=>l.value>0).length>1?.8:0;let i=0;const r=e.map((l,o)=>{const m=a?l.value/a*100:0,b=m>0?n`<circle class="${`donut-seg s${o+1}`}" cx="50" cy="50" r="42" pathLength="100"
          stroke-dasharray="${`${Math.max(m-s,.01)} ${100-Math.max(m-s,.01)}`}" stroke-dashoffset="${-i}"
          tabindex="0" data-tip="${`${l.label} : ${c(l.value)} (${ae(l.value,a)})`}"></circle>`:"";return i+=m,b});return n`<div class="donut">
    <div class="donut-ring">
      <svg viewBox="0 0 100 100" role="img" aria-label="${t.label}">
        <circle class="donut-track" cx="50" cy="50" r="42"></circle>
        <g transform="rotate(-90 50 50)">${r}</g>
      </svg>
      <div class="donut-center"><strong>${t.value}</strong><span>${t.label}</span></div>
    </div>
    <ul class="legend">${e.map((l,o)=>n`<li>
      <span class="${`swatch s${o+1}`}"></span>
      <span class="legend-label">${l.label}${l.hint?n`<small>${l.hint}</small>`:""}</span>
      <strong>${c(l.value)}</strong>
      <span class="legend-pct">${ae(l.value,a)}</span>
    </li>`)}</ul>
  </div>`}function x(e,t=""){const a=Math.max(...e.map(s=>s.value),1);return n`<ol class="ranking">${e.map(s=>n`<li>
    <span class="ranking-label">${s.label}</span>
    <strong>${c(s.value)}${t}</strong>
    <span class="ranking-track"><span class="ranking-fill" data-w="${s.value/a*100}"></span></span>
  </li>`)}</ol>`}const Te=(e,t)=>e.map((a,s)=>`${s?"L":"M"}${s+.5},${(100-a/t*100).toFixed(2)}`).join("");function Ge(e){const t=e.format??c,a=e.values.length,s=Ne(Math.max(...e.values,...e.previous??[],0)),i=Te(e.values,s),r=e.days[Math.floor((a-1)/2)];return n`<div class="chart-line" role="img" aria-label="${e.label}">
    <div class="chart-axis" aria-hidden="true">
      <span class="at-100">${t(s)}</span><span class="at-50">${t(s/2)}</span><span class="at-0">0</span>
    </div>
    <div class="tl-plot">
      <div class="chart-grid" aria-hidden="true"></div>
      <svg viewBox="${`0 0 ${a} 100`}" preserveAspectRatio="none" aria-hidden="true">
        <path class="tl-area" d="${`${i}L${a-.5},100L0.5,100Z`}"></path>
        ${e.previous?n`<path class="tl-prev" d="${Te(e.previous,s)}"></path>`:""}
        <path class="tl-line" d="${i}"></path>
        ${e.values.map((l,o)=>n`<rect class="tl-hit" x="${o}" y="0" width="1" height="100"
          data-tip="${`${e.dayLabel(e.days[o])} : ${t(l)}${e.previous?` (période précédente : ${t(e.previous[o]??0)})`:""}`}"></rect>`)}
      </svg>
      <div class="tl-days" aria-hidden="true"><span>${e.dayLabel(e.days[0])}</span>${a>2?n`<span>${e.dayLabel(r)}</span>`:""}<span>${e.dayLabel(e.days[a-1])}</span></div>
    </div>
  </div>
  ${e.previous?n`<p class="tl-legend"><span class="tl-key"></span>Période choisie<span class="tl-key tl-key-prev"></span>Période précédente</p>`:""}`}function Pt(e){var a;const t=((a=e[0])==null?void 0:a.value)??0;return n`<ol class="funnel">${e.map((s,i)=>{var l;const r=((l=e[i-1])==null?void 0:l.value)??0;return n`<li>
      <span class="funnel-label">${s.label}</span>
      <strong>${c(s.value)}</strong>
      <span class="funnel-share">${ae(s.value,t)}</span>
      <span class="ranking-track"><span class="ranking-fill" data-w="${t?s.value/t*100:0}"></span></span>
      ${i?n`<small>${r?`${ae(s.value,r)} de l'étape précédente`:"aucune visite à l'étape précédente"}</small>`:""}
    </li>`})}</ol>`}function Be(e,t,a=!1){if(!t)return e?n`<span class="delta">nouveau</span>`:n`<span class="delta">=</span>`;const s=(e-t)/t,i=Math.round(s*100);if(!i)return n`<span class="delta">=</span>`;const r=i>0!==a;return n`<span class="${`delta ${r?"delta-good":"delta-bad"}`}">${i>0?"+":"−"}${c(Math.abs(i))} %</span>`}async function P(e){try{const{data:t,fetchedAt:a}=await k(e);return{state:"live",data:t,fetchedAt:a}}catch(t){return{state:"unavailable",reason:t instanceof E?t.message:"Le serveur ne répond pas."}}}async function V(e){try{return{state:"live",data:await k(e),fetchedAt:new Date().toISOString()}}catch(t){return{state:"unavailable",reason:t instanceof E?t.message:"Le serveur ne répond pas."}}}const K=()=>P("releases"),Ue=()=>P("manifest"),Ye=()=>P("build"),Je=()=>P("deploy"),We=()=>P("certificates"),ke=()=>P("pages"),jt=()=>P("server"),zt=()=>P("announcement"),Ke=()=>V("activity"),It=()=>V("logins"),Vt=()=>V("sessions"),Ze=()=>V("security"),Ht=()=>V("analytics/settings"),Qe=(e,t)=>V(`analytics/report?from=${e}&to=${t}`),Rt=()=>V("analytics/live"),Xe="updates",et="https://github.com/lololyeye/aoze/releases",O=e=>e.filter(t=>!t.prerelease),de=e=>{var t;return((t=e.assets.find(a=>a.name==="latest.json"))==null?void 0:t.downloads)??0};function Ae(e){var a;const t=O(e);return{installer:t.reduce((s,i)=>{var r;return s+(((r=i.installer)==null?void 0:r.downloads)??0)},0),updater:((a=e.find(s=>s.tag===Xe))==null?void 0:a.downloads)??0,checks:t.reduce((s,i)=>s+de(i),0)}}const se={direct:"Accès direct",search:"Moteurs de recherche",discord:"Discord",tiktok:"TikTok",website:"Autres sites",campaign:"Campagnes (UTM)"},_t={desktop:"Ordinateur",mobile:"Mobile",tablet:"Tablette"},Se={fr:"Français",en:"Anglais"},Ft=/^\/(fr\/)?download\/$/,Nt="https://db-ip.com",Ot=new Intl.DisplayNames(["fr"],{type:"region"}),tt=e=>{if(!e)return"Inconnu";try{return Ot.of(e)??e}catch{return e}},G=(e,t)=>t?`${c(Math.round(e/t*1e3)/10)} %`:"—";function pe(e){const t=Math.round(e/1e3);return t<60?`${t} s`:`${Math.floor(t/60)} min${t%60?` ${t%60} s`:""}`}const u=(e,t)=>e.totals[t]??0;function w(e,t){return Object.entries(e.current.dimensions[t]??{}).sort((a,s)=>s[1]-a[1])}function M(e,t,a=8){const s=e.slice(0,a).map(([r,l])=>({label:t(r),value:l})),i=e.slice(a).reduce((r,[,l])=>r+l,0);return i?[...s,{label:"Autres",value:i}]:s}function me(e,t){return M(e,t,3).map(a=>({label:a.label,value:a.value}))}const q=e=>t=>e[t]??(t||"Inconnu");async function B(){const e=ye(),t=await Qe(e.from,e.to);if(t.state==="unavailable")return{missing:n`<p class="unavailable">${t.reason}</p>`};const a=t.data;return a.measuredSince?{report:a,comparable:a.measuredSince<=a.previous.from}:{missing:Mt({icon:"analytics",title:a.enabled?"Rien d'enregistré pour l'instant":"Pas encore active",text:a.enabled?"La mesure est active : les chiffres apparaîtront ici dès la première visite comptée.":"Le site ne compte pas ses visites. Activez la mesure dans les réglages une fois la politique de confidentialité en ligne.",action:n`<a class="btn btn-ghost btn-sm" href="#/settings">Voir les réglages</a>`})}}const Z=e=>n`<div class="grid">${d("Mesure d'audience",e.missing,{wide:!0})}</div>`;function U(e){const{report:t}=e,a=[];return t.enabled||a.push(n`<p class="notice notice-warn">${$("alert")}<span>La mesure est désactivée : plus rien n'est compté depuis. <a href="#/settings">Réglages</a></span></p>`),t.measuredSince>t.current.from&&a.push(n`<p class="notice">${$("info")}<span>Mesure depuis le ${W(t.measuredSince)} : les jours d'avant sont à zéro et la comparaison n'est pas affichée.</span></p>`),n`${a}`}function C(e,t,a,s=!1){return e.comparable?n`${Be(t,a,s)} vs période précédente`:ie()}function N(e,t,a){const{current:s,previous:i}=e.report;return Ge({label:a,days:s.series.map(r=>r.day),values:s.series.map(r=>r[t]),previous:e.comparable?i.series.map(r=>r[t]):void 0,dayLabel:$e(s.from,s.to)})}function at(e,t,a){return d(e,n`${a.map(([,s],i)=>n`<div data-chart="${i}" ${i?"hidden":""}>${s}</div>`)}`,{wide:!0,icon:t,action:n`<div class="segmented chart-switch" role="group" aria-label="Mesure affichée">
      ${a.map(([s],i)=>n`<button type="button" data-show-chart="${i}" aria-pressed="${String(!i)}">${s}</button>`)}
    </div>`})}function R(e){e.querySelectorAll(".chart-switch").forEach(t=>t.addEventListener("click",a=>{const s=a.target.closest("[data-show-chart]");if(!s)return;const i=t.closest(".card");t.querySelectorAll("[data-show-chart]").forEach(r=>r.setAttribute("aria-pressed",String(r===s))),i.querySelectorAll("[data-chart]").forEach(r=>r.hidden=r.dataset.chart!==s.dataset.showChart)}))}function Gt(e){return h("En ce moment",e,t=>n`
    <div class="live-count"><span class="live-dot"></span><strong>${c(t.active)}</strong><span class="muted">${t.active>1?"visites actives":"visite active"} (5 dernières minutes)</span></div>
    ${t.recent.length?n`<ul class="timeline compact">${t.recent.map(a=>n`<li><span class="when">${L(a.at)}</span><strong>${a.path}</strong><span>${tt(a.country)}</span></li>`)}</ul>`:n`<p class="unavailable">Aucune page vue dans la dernière demi-heure.</p>`}`,{icon:"pulse"})}async function Bt(){const[e,t]=await Promise.all([B(),Rt()]);if(!("report"in e))return Z(e);const{current:a,previous:s}=e.report,i=u(a,"sessions"),r=u(s,"sessions"),l=(m,b)=>u(m,"sessions")?u(m,b)/u(m,"sessions"):0,o=a.visitors??u(a,"visitors");return n`${U(e)}
    ${I([v({icon:"users",label:"Visiteurs uniques",value:a.visitors===null?n`≤ ${c(o)}`:c(o),hint:a.visitors===null?"somme par jour : visites anciennes déjà effacées":s.visitors===null?ie():C(e,o,s.visitors)}),v({icon:"pulse",label:"Visites",value:c(i),hint:C(e,i,r)}),v({icon:"file",label:"Pages vues",value:c(u(a,"pageviews")),hint:C(e,u(a,"pageviews"),u(s,"pageviews"))}),v({icon:"analytics",label:"Pages par visite",value:c(Math.round(l(a,"pageviews")*10)/10),hint:n`${G(u(a,"bounces"),i)} repartent après une page`}),v({icon:"clock",label:"Durée moyenne",value:pe(l(a,"engaged_ms")),hint:C(e,l(a,"engaged_ms"),l(s,"engaged_ms"))}),v({icon:"update",label:"Visiteurs qui reviennent",value:G(u(a,"returning_sessions"),i),hint:"part des visites"})])}
    <div class="grid">
      ${at("Évolution par jour","analytics",[["Visites",N(e,"sessions","Visites par jour")],["Visiteurs",N(e,"visitors","Visiteurs par jour")],["Pages vues",N(e,"pageviews","Pages vues par jour")]])}
      ${Gt(t)}
      ${d("Nouveaux et connus",F([{label:"Première visite",value:i-u(a,"returning_sessions")},{label:"Visiteur déjà venu",value:u(a,"returning_sessions")}],{value:c(i),label:"visites"}),{icon:"users"})}
    </div>`}async function Ut(){const e=await B();if(!("report"in e))return Z(e);const t=e.report,a=u(t.current,"sessions"),s={value:c(a),label:"visites"};return n`${U(e)}
    <div class="grid">
      ${d("Pays",n`${x(M(w(t,"country"),tt,10))}
        <p class="credit">Pays déduit de l'adresse IP avec <a href="${Nt}" target="_blank" rel="noopener">IP to Country Lite de DB-IP</a> (CC BY 4.0). L'adresse n'est pas enregistrée.</p>`,{icon:"website"})}
      ${d("Appareils",F(me(w(t,"device"),q(_t)),s),{icon:"application"})}
      ${d("Navigateurs",x(M(w(t,"browser"),q({}))),{icon:"website"})}
      ${d("Systèmes",x(M(w(t,"os"),q({}))),{icon:"settings"})}
      ${d("Langue du site",F(me(w(t,"lang"),q(Se)),s),{icon:"file"})}
      ${d("Nouveaux et connus",F([{label:"Première visite",value:a-u(t.current,"returning_sessions")},{label:"Visiteur déjà venu",value:u(t.current,"returning_sessions")}],s),{icon:"users"})}
    </div>`}function ve(e,t,a,s){const i=w(e,t);if(!i.length)return n`<p class="unavailable">Aucune visite sur la période.</p>`;const r=(l,o)=>{var m;return((m=e.current.dimensions[`${l}_by_${t==="source_type"?"source":"lang"}`])==null?void 0:m[o])??0};return n`<div class="table-wrap"><table class="table">
    <thead><tr><th>${s}</th><th class="num">Visites</th><th class="num">Clics sur Télécharger</th><th class="num">Téléchargement demandé</th><th class="num">Taux</th></tr></thead>
    <tbody>${i.map(([l,o])=>n`<tr>
      <td>${a(l)}</td><td class="num">${c(o)}</td><td class="num">${c(r("clicked",l))}</td>
      <td class="num">${c(r("requested",l))}</td><td class="num">${G(r("requested",l),o)}</td>
    </tr>`)}</tbody>
  </table></div>`}async function Yt(){const e=await B();if(!("report"in e))return Z(e);const t=e.report,a=w(t,"source").filter(([i])=>i!==""),s=w(t,"campaign").filter(([i])=>i!=="");return n`${U(e)}
    <div class="grid">
      ${d("Sources",x(M(w(t,"source_type"),q(se))),{icon:"link"})}
      ${d("Sites et applications",a.length?x(M(a,i=>i,10)):n`<p class="unavailable">Aucun site référent sur la période.</p>`,{icon:"external"})}
      ${d("Visites et téléchargements par source",ve(t,"source_type",q(se),"Source"),{wide:!0,icon:"funnel"})}
      ${d("Campagnes UTM",s.length?x(M(s,i=>i,10)):n`<p class="unavailable">Aucune campagne sur la période. Ajoutez <code>?utm_source=…&amp;utm_campaign=…</code> aux liens partagés pour les suivre.</p>`,{wide:!0,icon:"tag"})}
    </div>`}async function Jt(){const e=await B();if(!("report"in e))return Z(e);const t=e.report,a=Object.fromEntries(w(t,"page")),s=t.current.dimensions.page_engaged_ms??{},i=t.current.dimensions.entry??{},r=t.current.dimensions.exit??{},l=u(t.current,"pageviews"),o=Object.entries(a).filter(([b])=>Ft.test(b)).reduce((b,[,D])=>b+D,0),m=w(t,"page").slice(0,30);return n`${U(e)}
    ${I([v({icon:"file",label:"Pages vues",value:c(l),hint:C(e,l,u(t.previous,"pageviews"))}),v({icon:"download",label:"Vues de la page Téléchargement",value:c(o),hint:"en français et en anglais"}),v({icon:"clock",label:"Temps moyen par page",value:pe(l?u(t.current,"engaged_ms")/l:0),hint:"temps où la page est affichée"}),v({icon:"pulse",label:"Une seule page vue",value:G(u(t.current,"bounces"),u(t.current,"sessions")),hint:"part des visites"})])}
    <div class="grid">
      ${d("Pages",m.length?n`<div class="table-wrap"><table class="table">
        <thead><tr><th>Page</th><th class="num">Vues</th><th class="num">Temps moyen</th><th class="num">Entrées</th><th class="num">Sorties</th><th class="num">Taux de sortie</th></tr></thead>
        <tbody>${m.map(([b,D])=>n`<tr>
          <td>${b}</td><td class="num">${c(D)}</td><td class="num">${pe((s[b]??0)/D)}</td>
          <td class="num">${c(i[b]??0)}</td><td class="num">${c(r[b]??0)}</td><td class="num">${G(r[b]??0,D)}</td>
        </tr>`)}</tbody>
      </table></div>`:n`<p class="unavailable">Aucune page vue sur la période.</p>`,{wide:!0,icon:"file"})}
      ${d("Pages d'arrivée",x(M(w(t,"entry"),b=>b)),{icon:"link"})}
      ${d("Français et anglais",F(me(w(t,"page_lang"),q(Se)),{value:c(l),label:"pages vues"}),{icon:"website"})}
    </div>`}async function Wt(){const[e,t]=await Promise.all([K(),B()]),a=e.state==="live"?Ae(e.data):null,s=l=>l===void 0?n`<span class="muted">Indisponible</span>`:c(l),i="report"in t?t:null,r=i?(()=>{const l=i.report,o=u(l.current,"downloads");return n`
          ${at("Demandes de téléchargement sur aoze.fr","download",[["Toutes",N(i,"downloads","Demandes de téléchargement par jour")],["Depuis une visite",N(i,"requested","Visites qui ont demandé le téléchargement, par jour")]])}
          ${d("Sur la période",n`<div class="live-count"><strong>${c(o)}</strong><span class="muted">${o>1?"demandes":"demande"}, ${C(i,o,u(l.previous,"downloads"))}</span></div>
            ${x(M(w(l,"download_version"),m=>`Aoze ${m}`,5))}`,{icon:"tag"})}
          ${d("Par système",x(M(w(l,"download_os"),q({}))),{icon:"application"})}
          ${d("Par source de la visite",x(M(w(l,"download_source"),q({...se,"":"Lien direct, sans visite"}))),{icon:"link"})}
          ${d("Comptés par GitHub, par jour",l.github.since?n`${Ge({label:"Téléchargements de l'installeur comptés par GitHub, par jour",days:l.github.series.map(m=>m.day),values:l.github.series.map(m=>m.installer),dayLabel:$e(l.current.from,l.current.to)})}<p class="note">Relevé à chaque entretien horaire depuis le ${W(l.github.since)} : une hausse est datée du jour où elle est vue. L'auto-update n'est pas compté ici.</p>`:n`<p class="unavailable">Pas encore de relevé des compteurs de GitHub.</p>`,{wide:!0,icon:"analytics"})}`})():d("Demandes de téléchargement sur aoze.fr",t.missing,{wide:!0,icon:"download"});return n`
    ${i?U(i):""}
    ${I([v({icon:"download",label:"Installeur (site et GitHub)",value:s(a==null?void 0:a.installer),hint:"depuis la publication, compté par GitHub"}),v({icon:"update",label:"Installeur (auto-update)",value:s(a==null?void 0:a.updater),hint:"version actuelle seulement"}),v({icon:"pulse",label:"Vérifications de mise à jour",value:s(a==null?void 0:a.checks),hint:"lectures de latest.json"}),v({icon:"check",label:"Téléchargements terminés",value:n`<span class="muted">Non mesurable</span>`,hint:"ni GitHub ni le site ne le savent"})])}
    <div class="grid">
      ${r}
      ${h("Installeur téléchargé, par version",e,l=>{const o=[...O(l)].reverse();return o.length?Oe(o.map(m=>{var b;return{label:m.version,value:((b=m.installer)==null?void 0:b.downloads)??0}}),"Téléchargements de l'installeur par version"):n`<p class="unavailable">Aucune release publiée.</p>`},{wide:!0,icon:"analytics",action:n`<a class="card-link" href="#/application/distribution">Par fichier</a>`})}

      ${d("Ce que ces chiffres veulent dire",n`<ul class="facts">
        <li><strong>Une demande n'est pas un téléchargement terminé.</strong> Le site compte le clic qui part vers GitHub ; personne ne sait si le fichier est arrivé en entier.</li>
        <li><strong>Compté par GitHub.</strong> Chaque requête du fichier, y compris les relances, les gestionnaires de téléchargement et les robots.</li>
        <li><strong>Pas un nombre de personnes.</strong> La même personne peut télécharger plusieurs fois.</li>
      </ul>`,{wide:!0,icon:"info"})}
    </div>`}async function Kt(){const e=await B();if(!("report"in e))return Z(e);const t=e.report,a=t.current,s=u(a,"sessions"),i=r=>u(r,"sessions")?u(r,"requested")/u(r,"sessions"):0;return n`${U(e)}
    ${I([v({icon:"funnel",label:"Taux de conversion",value:G(u(a,"requested"),s),hint:C(e,i(a),i(t.previous))}),v({icon:"download",label:"Visites avec téléchargement",value:c(u(a,"requested")),hint:C(e,u(a,"requested"),u(t.previous,"requested"))}),v({icon:"check",label:"Clics sur Télécharger",value:c(u(a,"clicked")),hint:C(e,u(a,"clicked"),u(t.previous,"clicked"))}),v({icon:"pulse",label:"Visites",value:c(s),hint:ie()})])}
    <div class="grid">
      ${d("Du passage au téléchargement",n`${Pt([{label:"Visites",value:s},{label:"Bouton de téléchargement vu",value:u(a,"saw_download")},{label:"Clic sur Télécharger",value:u(a,"clicked")},{label:"Avertissement Windows accepté",value:u(a,"confirmed")},{label:"Téléchargement demandé",value:u(a,"requested")}])}<p class="note">Chaque étape compte des visites, une seule fois même si l'action est répétée. Le téléchargement terminé n'est pas mesurable.</p>`,{icon:"funnel"})}
      ${d("Téléchargements demandés par jour",N(e,"requested","Visites qui ont demandé le téléchargement, par jour"),{icon:"analytics"})}
      ${d("Par langue",ve(t,"lang",q(Se),"Langue"),{wide:!0,icon:"website"})}
      ${d("Par source",ve(t,"source_type",q(se),"Source"),{wide:!0,icon:"link"})}
    </div>`}const Zt=n`<a class="card-link" href="${et}" target="_blank" rel="noopener">GitHub ${$("external")}</a>`;async function Qt(){const e=await K();return n`<div class="grid">
    ${h("Historique des versions",e,t=>n`
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Version</th><th>Publiée le</th><th>Installeur</th><th class="num">Téléchargements</th><th></th></tr></thead>
        <tbody>${t.map(a=>n`<tr>
          <td><strong>${a.version}</strong>${a.tag===Xe?n` ${f("muted","Copie pour l'auto-update")}`:a.prerelease?n` ${f("muted","Pré-version")}`:""}</td>
          <td>${W(a.publishedAt)}</td>
          <td>${a.installer?we(a.installer.size):n`<span class="muted">Aucun</span>`}</td>
          <td class="num">${c(a.downloads)}</td>
          <td class="num"><a href="${a.url}" target="_blank" rel="noopener">Voir</a></td>
        </tr>`)}</tbody>
      </table></div>`,{wide:!0,icon:"tag",action:Zt})}

    ${h("Notes de la dernière version",e,t=>{const a=O(t)[0];return a!=null&&a.notesHtml?n`<h3 class="notes-title">${a.name}</h3><div class="notes">${z(a.notesHtml)}</div>`:n`<p class="unavailable">Pas de notes publiées.</p>`},{wide:!0,icon:"file"})}
  </div>`}async function Xt(){const[e,t]=await Promise.all([Ue(),K()]);return n`<div class="grid">
    ${h("Ce que reçoit l'auto-update (latest.json)",e,a=>n`
      <ul class="checks">
        ${a.checks.map(s=>n`<li class="${`check${s.ok?"":" check-bad"}`}">
          <span class="check-mark">${$(s.ok?"check":"alert")}</span><strong>${s.label}</strong><span>${s.detail}</span>
        </li>`)}
      </ul>
      <dl class="kvs">
        ${p("Version annoncée",a.version)}
        ${p("Taille",we(a.size))}
        ${p("SHA-256",n`<span class="mono wrap">${a.sha256}</span>`)}
        ${p("Fichier",n`<a class="mono wrap" href="${a.url}" target="_blank" rel="noopener">${a.url.replace(`${et}/download/`,"")}</a>`)}
      </dl>
      <p class="note">Lecture seule : publier une version ou modifier latest.json se fait avec <span class="mono">npm run release</span>, jamais depuis l'admin.</p>`,{wide:!0,icon:"lock"})}

    ${h("Empreintes des installeurs",t,a=>n`
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Version</th><th>Fichier</th><th>SHA-256 (publiée par GitHub)</th></tr></thead>
        <tbody>${a.filter(s=>s.installer).map(s=>n`<tr>
          <td><strong>${s.version}</strong></td>
          <td class="mono">${s.installer.name}</td>
          <td class="mono">${s.installer.sha256??n`<span class="muted">Non fournie</span>`}</td>
        </tr>`)}</tbody>
      </table></div>`,{wide:!0,icon:"security"})}
  </div>`}async function ea(){const e=await K();return n`<div class="grid">
    ${h("Qui télécharge l'installeur",e,t=>{const a=Ae(t);return n`${F([{label:"Depuis le site ou GitHub",value:a.installer,hint:"fichiers des versions publiques"},{label:"Par l'auto-update",value:a.updater,hint:"copie de la version actuelle seulement"}],{value:c(a.installer+a.updater),label:"installeurs servis"})}
      <p class="note">GitHub compte chaque requête du fichier, y compris les relances et les robots. Il ne dit pas si le téléchargement est allé au bout.</p>`},{icon:"download"})}

    ${h("Fichiers de la dernière version",e,t=>{const a=O(t)[0];return a?n`<p class="card-intro"><span class="muted">Aoze ${a.version}, par nombre de téléchargements.</span></p>
        ${x([...a.assets].sort((s,i)=>i.downloads-s.downloads).map(s=>({label:s.name,value:s.downloads})))}`:n`<p class="unavailable">Aucune release publiée.</p>`},{icon:"file"})}

    ${h("Par version",e,t=>n`
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Version</th><th class="num">Installeur</th><th class="num">Vérifications de mise à jour</th><th class="num">Autres fichiers</th></tr></thead>
        <tbody>${O(t).map(a=>{var s,i;return n`<tr>
          <td><strong>${a.version}</strong></td>
          <td class="num">${c(((s=a.installer)==null?void 0:s.downloads)??0)}</td>
          <td class="num">${c(de(a))}</td>
          <td class="num">${c(a.assets.reduce((r,l)=>r+l.downloads,0)-(((i=a.installer)==null?void 0:i.downloads)??0)-de(a))}</td>
        </tr>`})}</tbody>
      </table></div>
      <p class="note">Une vérification est comptée à chaque fois qu'une copie installée lit latest.json pendant que cette version était la dernière : c'est un signe d'activité, pas un nombre d'utilisateurs.</p>`,{wide:!0,icon:"update"})}
  </div>`}const st=21;function ta(e,t,a,s){var r;const i=[];if(e.state==="live")for(const l of e.data.checks.filter(o=>!o.ok))i.push({tone:"bad",text:`latest.json : ${l.label.toLowerCase()}, ${l.detail}`,href:"#/application/integrity"});if(t.state==="live"&&((r=t.data)==null?void 0:r.conclusion)==="failure"&&i.push({tone:"bad",text:"La dernière construction du site a échoué.",href:"#/infrastructure/deployment"}),a.state==="live"&&a.data.builtCommit!==a.data.liveCommit&&i.push({tone:"warn",text:"La version en ligne n'est pas encore la dernière construite.",href:"#/infrastructure/deployment"}),s.state==="live")for(const l of s.data.filter(o=>te(o.validTo)<st))i.push({tone:"warn",text:`Le certificat de ${l.host} expire dans ${te(l.validTo)} jours.`,href:"#/infrastructure/https"});return i}function nt(e){return e.status!=="completed"?["muted","En cours"]:e.conclusion==="success"?["ok","Réussie"]:e.conclusion==="failure"?["bad","Échec"]:["muted","Annulée"]}function aa(e,t,a,s,i){const r=s.state==="live"&&s.data.length?Math.min(...s.data.map(o=>te(o.validTo))):null,l=i.state==="live"?i.data.filter(o=>o.status===200).length:0;return[{label:"Auto-update",href:"#/application/integrity",state:e.state==="live"?e.data.checks.every(o=>o.ok)?["ok","Cohérent"]:["bad","Problème"]:null,detail:e.state==="live"?`latest.json annonce ${e.data.version}`:e.reason},{label:"Construction du site",href:"#/infrastructure/deployment",state:t.state==="live"&&t.data?nt(t.data):null,detail:t.state==="live"?t.data?`${Fe(t.data.commit)}, ${L(t.data.updatedAt)}`:"Aucune construction trouvée.":t.reason},{label:"Déploiement",href:"#/infrastructure/deployment",state:a.state==="live"?a.data.builtCommit===a.data.liveCommit?["ok","À jour"]:["warn","En retard"]:null,detail:a.state==="live"?`récupéré ${L(a.data.lastPullAt)}`:a.reason},{label:"HTTPS",href:"#/infrastructure/https",state:r===null?null:r<st?["warn",`${r} jours`]:["ok","Valide"],detail:r===null?s.state==="live"?"Aucun certificat lu.":s.reason:`prochaine expiration dans ${r} jours`},{label:"Pages principales",href:"#/infrastructure/availability",state:i.state==="live"?l===i.data.length?["ok","En ligne"]:["bad",`${i.data.length-l} en erreur`]:null,detail:i.state==="live"?`${l} sur ${i.data.length} répondent`:i.reason}]}function sa(e){if(e.state==="unavailable")return v({icon:"users",label:"Visiteurs du site",value:n`<span class="muted">Indisponible</span>`,hint:e.reason});const t=e.data;if(!t.measuredSince)return v({icon:"users",label:"Visiteurs du site",value:n`<span class="muted">Non mesuré</span>`,hint:n`<a href="#/settings">${t.enabled?"aucune visite comptée pour l'instant":"mesure d'audience pas encore active"}</a>`});const a=t.current.visitors??t.current.totals.visitors??0,s=t.previous.visitors;return v({icon:"users",label:"Visiteurs du site",value:c(a),hint:s!==null&&t.measuredSince<=t.previous.from?n`${Be(a,s)} sur 30 jours`:n`<a href="#/analytics/traffic">30 derniers jours</a>`})}async function na(){const e=Y(),[t,a,s,i,r,l,o,m]=await Promise.all([K(),Ye(),Ue(),Je(),We(),ke(),Ke(),Qe(_e(e,-29),e)]),b=ta(s,a,i,r),D=t.state==="live"?t.data:[],le=O(D),Q=le[0],qe=Ae(D),oe=n`<span class="muted">Indisponible</span>`,ce=t.state==="live";return n`
    ${I([v({icon:"tag",label:"Version publique",value:Q?Q.version:ce?"Aucune":oe,hint:Q?`publiée ${L(Q.publishedAt)}`:""}),v({icon:"download",label:"Téléchargements de l'installeur",value:ce?c(qe.installer):oe,hint:"GitHub, toutes versions publiques"}),v({icon:"update",label:"Vérifications de mise à jour",value:ce?c(qe.checks):oe,hint:"lectures de latest.json par l'application"}),sa(m)])}
    <div class="grid">
      ${d("À surveiller",b.length?n`<ul class="alerts">${b.map(g=>n`<li class="${`alert alert-${g.tone}`}"><a href="${g.href}">${$(g.tone==="bad"?"alert":"info")}<span>${g.text}</span></a></li>`)}</ul>`:n`<p class="all-clear">${$("check")}<span>Rien à signaler sur ce qui a pu être vérifié.</span></p>`,{wide:!0,icon:"alert"})}

      ${h("Téléchargements par version",t,()=>le.length?Oe([...le].reverse().slice(-10).map(g=>{var H,Me;return{label:g.version,value:((H=g.installer)==null?void 0:H.downloads)??0,tip:`Aoze ${g.version} : ${c(((Me=g.installer)==null?void 0:Me.downloads)??0)} téléchargements de l'installeur`}}),"Téléchargements de l'installeur par version"):n`<p class="unavailable">Aucune release publiée.</p>`,{wide:!0,icon:"analytics",action:n`<a class="card-link" href="#/analytics/downloads">Détails</a>`})}

      ${d("État des services",n`<ul class="services">
        ${aa(s,a,i,r,l).map(g=>n`<li><a href="${g.href}">
          <span class="service-name">${g.label}</span>
          ${g.state?f(...g.state):f("muted","Indisponible")}
          <span class="service-detail">${g.detail}</span>
        </a></li>`)}
      </ul>`,{icon:"pulse"})}

      ${h("Activité récente",o,g=>g.length?n`<ul class="timeline compact">
            ${g.slice(0,6).map(H=>n`<li><span class="when">${re(H.at)}</span><strong>${H.action}</strong><span>${H.detail}</span></li>`)}
          </ul>`:n`<p class="unavailable">Rien pour l'instant.</p>`,{icon:"file",action:n`<a class="card-link" href="#/security/audit">Tout le journal</a>`})}
    </div>`}const Ce=21;async function ia(){const e=await jt();return n`<div class="grid">
    ${h("Serveur",e,t=>n`<dl class="kvs">
      ${p("Hébergeur","o2switch, en France")}
      ${p("PHP",t.php)}
      ${p("Base de données",t.database)}
      ${p("Taille de la base",we(t.databaseSize))}
      ${p("Espace disque",n`<span class="muted">Non disponible : il faudrait un accès complet au compte cPanel</span>`)}
    </dl>`,{icon:"infrastructure"})}
    ${d("Organisation",n`<dl class="kvs">
      ${p("Site public",n`<span class="mono">~/public_html</span>`)}
      ${p("Données de l'admin",n`<span class="mono">~/aoze-admin</span> <span class="muted">hors du dossier public</span>`)}
      ${p("Mise en ligne","une tâche cron récupère la branche site toutes les 5 minutes")}
    </dl>`,{icon:"file"})}
  </div>`}async function ra(){const[e,t]=await Promise.all([Ye(),Je()]);return n`<div class="grid">
    ${h("Construction du site (GitHub Actions)",e,a=>a?n`<dl class="kvs">
          ${p("État",f(...nt(a)))}
          ${p("Déclenchée par",a.event==="push"?"un commit":a.event==="schedule"?"la mise à jour programmée":a.event)}
          ${p("Commit",n`<span class="mono">${Fe(a.commit)}</span>`)}
          ${p("Terminée",n`<a href="${a.url}" target="_blank" rel="noopener">${L(a.updatedAt)}</a>`)}
        </dl>`:n`<p class="unavailable">Aucune construction trouvée.</p>`,{icon:"refresh"})}

    ${h("Déploiement sur o2switch",t,a=>n`<dl class="kvs">
        ${p("Construit (branche site)",n`<span class="mono">${a.builtCommit}</span>`)}
        ${p("En ligne",n`<span class="mono">${a.liveCommit}</span> ${a.builtCommit===a.liveCommit?f("ok","À jour"):f("warn","En retard")}`)}
        ${p("Dernière récupération",L(a.lastPullAt))}
      </dl>`,{icon:"download"})}

    ${h("Journal de déploiement",t,a=>a.logTail.length?n`<pre class="log">${a.logTail.join(`
`)}</pre>`:n`<p class="all-clear">Aucune erreur dans le journal de déploiement.</p>`,{wide:!0,icon:"file"})}
  </div>`}async function la(){const e=await We();return n`<div class="grid">
    ${h("Certificats",e,t=>n`<ul class="list">
      ${t.map(a=>{const s=te(a.validTo);return n`<li><strong>${a.host}</strong>
          ${f(s<Ce?"warn":"ok",s<0?"Expiré":`${s} jours`)}
          <span class="muted">${a.issuer}, jusqu'au ${W(a.validTo)}</span></li>`})}
    </ul><p class="note">Let's Encrypt se renouvelle seul chez o2switch ; une alerte s'affiche à moins de ${Ce} jours.</p>`,{wide:!0,icon:"lock"})}
  </div>`}async function oa(){const e=await ke(),t=e.state==="live"?e.data:[],a=t.filter(i=>i.status===200).length,s=t.length?Math.round(t.reduce((i,r)=>i+r.ms,0)/t.length):null;return n`
    ${e.state==="live"?I([v({icon:"check",label:"Pages qui répondent",value:`${a} / ${t.length}`}),v({icon:"pulse",label:"Temps de réponse moyen",value:s===null?"–":`${s} ms`})]):""}
    <div class="grid">
      ${h("Pages principales",e,i=>n`<div class="table-wrap"><table class="table">
        <thead><tr><th>Page</th><th>Réponse</th><th class="num">Temps</th></tr></thead>
        <tbody>${i.map(r=>n`<tr>
          <td class="mono">${r.path}</td>
          <td>${f(r.status===200?"ok":"bad",String(r.status))}</td>
          <td class="num">${r.ms} ms</td>
        </tr>`)}</tbody>
      </table></div>`,{icon:"website"})}
      ${h("Temps de réponse",e,i=>x([...i].sort((r,l)=>l.ms-r.ms).map(r=>({label:r.path,value:r.ms}))," ms"),{icon:"pulse"})}
      ${d("Limite de cette vérification",n`<p class="muted">Le serveur s'interroge lui-même : une panne de tout l'hébergement ne peut pas s'afficher ici. Pour la détecter, il faudrait un service de surveillance extérieur.</p>`,{wide:!0,icon:"info"})}
    </div>`}const X=()=>window.dispatchEvent(new Event("admin:refresh")),ca=n`<form class="form inline-form" data-password hidden>
  <label class="field"><span>Mot de passe actuel</span><input name="current" type="password" autocomplete="current-password" required /></label>
  <label class="field"><span>Nouveau mot de passe (12 caractères minimum)</span><input name="next" type="password" autocomplete="new-password" minlength="12" required /></label>
  <label class="field"><span>Confirmer</span><input name="confirm" type="password" autocomplete="new-password" minlength="12" required /></label>
  <p class="note">Les autres sessions seront fermées.</p>
  <div class="form-actions"><button class="btn btn-ghost" type="button" data-cancel>Annuler</button><button class="btn btn-primary" type="submit">Changer le mot de passe</button></div>
</form>`,ua=n`<form class="form inline-form" data-2fa-disable hidden>
  <label class="field"><span>Mot de passe</span><input name="password" type="password" autocomplete="current-password" required /></label>
  <label class="field"><span>Code actuel de l'application</span><input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required /></label>
  <div class="form-actions"><button class="btn btn-ghost" type="button" data-cancel>Annuler</button><button class="btn btn-danger" type="submit">Désactiver</button></div>
</form>`,da=e=>e?n`<p class="card-intro">${f("warn",`${e} échec${e>1?"s":""}`)} <span class="muted">Après 5 échecs en 15 minutes, la connexion est bloquée 15 minutes pour l'adresse concernée.</span></p>`:"";async function pa(){const e=await It(),t=e.state==="live"?e.data:[],a=t.filter(s=>!s.success).length;return n`
    ${e.state==="live"?I([v({icon:"check",label:"Connexions réussies",value:c(t.length-a),hint:"dans l'historique affiché"}),v({icon:"alert",label:"Tentatives refusées",value:c(a),hint:"mot de passe ou code faux"})]):""}
    <div class="grid">
      ${h("Historique des connexions",e,s=>n`
        ${da(a)}
        ${s.length?n`<div class="table-wrap"><table class="table">
          <thead><tr><th>Date</th><th>Résultat</th><th>Adresse IP</th><th>Appareil</th></tr></thead>
          <tbody>${s.map(i=>n`<tr>
            <td>${re(i.at)}</td>
            <td>${i.success?f("ok","Réussie"):f("bad","Refusée")}</td>
            <td class="mono">${i.ip}</td>
            <td>${i.device}</td>
          </tr>`)}</tbody>
        </table></div>`:n`<p class="unavailable">Aucune connexion enregistrée.</p>`}`,{wide:!0,icon:"lock"})}
    </div>`}async function ma(){const e=await Vt();return n`<div class="grid">
    ${h("Sessions ouvertes",e,t=>n`<ul class="list">
      ${t.map(a=>n`<li><strong>${a.device}</strong>
        ${a.current?f("ok","Cette session"):""}
        <span class="muted">${a.ip}, ouverte ${L(a.createdAt)}, active ${L(a.lastSeenAt)}</span>
        ${a.current?"":n`<button class="btn btn-ghost btn-sm" type="button" data-revoke="${a.id}">Fermer</button>`}
      </li>`)}
    </ul>`,{wide:!0,icon:"users"})}
  </div>`}async function va(){const e=await Ze();return n`<div class="grid">
    ${h("Compte",e,t=>n`<dl class="kvs">
        ${p("Accès à /admin",t.hidden?f("ok","Masqué, clé d'accès requise"):f("warn","Visible par tous : ajoutez access_key à config.php"))}
        ${p("Double authentification",t.twoFactor?f("ok","Activée"):f("warn","Désactivée"))}
        ${p("Mot de passe modifié",L(t.passwordChangedAt))}
        ${p("Déconnexion automatique",`après ${t.idleMinutes} minutes d'inactivité`)}
      </dl>
      <div class="form-actions">
        <button class="btn btn-ghost" type="button" data-open="data-password">Changer le mot de passe</button>
        ${t.twoFactor?n`<button class="btn btn-ghost" type="button" data-open="data-2fa-disable">Désactiver la double authentification</button>`:n`<button class="btn btn-primary" type="button" data-2fa-start>Activer la double authentification</button>`}
      </div>
      ${ca}
      ${t.twoFactor?ua:n`<div data-2fa-setup></div>`}`,{wide:!0,icon:"security"})}
  </div>`}async function ha(){const e=await Ke();return n`<div class="grid">
    ${h("Journal d'activité",e,t=>t.length?n`<ul class="timeline">${t.map(a=>n`<li><span class="when">${re(a.at)}</span><strong>${a.action}</strong><span>${a.detail}</span></li>`)}</ul>`:n`<p class="unavailable">Rien pour l'instant.</p>`,{wide:!0,icon:"file"})}
  </div>`}function he(e,t){e==null||e.addEventListener("submit",async a=>{a.preventDefault();const s=e.querySelector("button[type=submit]");s.disabled=!0;try{await t(new FormData(e))}catch(i){S(i instanceof E?i.message:"Le serveur ne répond pas.","bad")}finally{s.disabled=!1}})}function fa(e){const t=e.querySelector("[data-2fa-setup]");t&&k("2fa/start",{}).then(({secret:a,uri:s})=>{var r;t.innerHTML=n`<form class="form inline-form" data-2fa-confirm>
      <p class="note">Dans votre application d'authentification (Google Authenticator, Aegis, 1Password…), ajoutez un compte avec cette clé, ou ouvrez le lien depuis votre téléphone :</p>
      <p class="secret mono">${a.match(/.{1,4}/g).join(" ")}</p>
      <p><a href="${s}">Ouvrir dans l'application</a></p>
      <label class="field"><span>Code affiché par l'application</span><input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required /></label>
      <div class="form-actions"><button class="btn btn-primary" type="submit">Confirmer et activer</button></div>
    </form>`.value;const i=t.querySelector("[data-2fa-confirm]");(r=i==null?void 0:i.querySelector("input"))==null||r.focus(),he(i,async l=>{await k("2fa/confirm",{code:l.get("code")}),S("Double authentification activée. Le code sera demandé à chaque connexion."),X()})},a=>S(a instanceof E?a.message:"Le serveur ne répond pas.","bad"))}function De(e){var t;e.querySelectorAll("[data-open]").forEach(a=>a.addEventListener("click",()=>{var i;const s=e.querySelector(`[${a.dataset.open}]`);s&&(s.hidden=!1,(i=s.querySelector("input"))==null||i.focus())})),e.querySelectorAll("[data-cancel]").forEach(a=>a.addEventListener("click",()=>{const s=a.closest("form");s.reset(),s.hidden=!0})),(t=e.querySelector("[data-2fa-start]"))==null||t.addEventListener("click",()=>fa(e)),he(e.querySelector("[data-password]"),async a=>{if(a.get("next")!==a.get("confirm"))throw new E(422,"Les deux nouveaux mots de passe ne sont pas identiques.");await k("password",{current:a.get("current"),next:a.get("next")}),S("Mot de passe changé. Les autres sessions ont été fermées."),X()}),he(e.querySelector("[data-2fa-disable]"),async a=>{await J({title:"Désactiver la double authentification ?",text:"Le mot de passe seul suffira pour se connecter. C'est nettement moins sûr.",confirm:"Désactiver",danger:!0})&&(await k("2fa/disable",{password:a.get("password"),code:a.get("code")}),S("Double authentification désactivée.","muted"),X())}),e.querySelectorAll("[data-revoke]").forEach(a=>a.addEventListener("click",async()=>{if(await J({title:"Fermer cette session ?",text:"L'appareil concerné devra se reconnecter.",confirm:"Fermer la session",danger:!0}))try{await k("sessions/revoke",{id:a.dataset.revoke}),S("Session fermée."),X()}catch(i){S(i instanceof E?i.message:"Le serveur ne répond pas.","bad")}}))}const it="aoze-admin-glass",rt={90:"3 mois",180:"6 mois",365:"12 mois",760:"25 mois (maximum de la CNIL)"};function lt(){try{return localStorage.getItem(it)!=="off"}catch{return!0}}function ba(){document.documentElement.toggleAttribute("data-solid",!lt())}const Pe=(e,t,a,s)=>n`<label class="switch">
  <input type="checkbox" ${e} ${t?"checked":""} />
  <span class="switch-track" aria-hidden="true"></span>
  <span><strong>${a}</strong><small>${s}</small></span>
</label>`;function ga(e){if(!e.sessions&&!e.downloads)return"Rien pour l'instant";const t=e.oldestAt?`, depuis le ${W(e.oldestAt)}`:"",a=(s,i,r)=>`${c(s)} ${s>1?r:i}`;return`${a(e.sessions,"visite","visites")} et ${a(e.downloads,"demande de téléchargement","demandes de téléchargement")}${t}`}async function $a(){const[e,t]=await Promise.all([Ze(),Ht()]);return n`<div class="grid">
    ${h("Mesure d'audience",t,a=>n`
      ${Pe("data-analytics-enabled",a.enabled,"Mesurer la fréquentation du site","Visites, pages, sources et demandes de téléchargement, sur aoze.fr uniquement, comme le décrit la politique de confidentialité.")}
      <dl class="kvs settings-rows">
        ${p("État",a.enabled?f("ok","Active"):f("muted","Désactivée"))}
        ${p("Conservation des visites",n`<select class="select" data-retention aria-label="Durée de conservation">
          ${a.retentionChoices.map(s=>n`<option value="${s}" ${s===a.retentionDays?"selected":""}>${rt[s]??`${s} jours`}</option>`)}
        </select>`)}
        ${p("Enregistré",ga(a))}
        ${p("Pays des visiteurs",a.geoMonth?`base DB-IP de ${a.geoMonth}`:n`<span class="muted">base pas encore téléchargée</span>`)}
        ${p("Dernier entretien",a.maintainedAt?L(a.maintainedAt):n`<span class="muted">pas encore</span>`)}
      </dl>
      <p class="note">Jamais d'adresse IP enregistrée : elle donne le pays, puis elle est oubliée. Un cookie propre au site (13 mois, jamais prolongé) reconnaît un visiteur qui revient. Après la durée choisie, il ne reste que des totaux par jour, sans identifiant, 25 mois au plus.</p>`,{wide:!0,icon:"analytics"})}

    ${h("Confidentialité de l'admin",e,a=>n`<dl class="kvs">
      ${p("Accès à /admin",a.hidden?f("ok","Masqué"):f("warn","Visible par tous"))}
      ${p("Connexions enregistrées","date, résultat, adresse IP et navigateur, pour repérer les tentatives d'intrusion")}
      ${p("Conservation","90 jours pour les connexions, 12 mois pour le journal, puis effacement automatique")}
    </dl>`,{icon:"lock"})}

    ${d("Préférences de ce navigateur",Pe("data-pref-glass",lt(),"Effets de transparence","Flou derrière le menu, la barre du haut et les fenêtres. À couper si l'affichage rame."),{icon:"settings"})}
  </div>`}async function je(e,t){try{await k("analytics/settings",e),S(t)}catch(a){S(a instanceof E?a.message:"Le serveur ne répond pas.","bad")}window.dispatchEvent(new Event("admin:refresh"))}function ya(e){var t,a,s;(t=e.querySelector("[data-pref-glass]"))==null||t.addEventListener("change",i=>{const r=i.target.checked;try{localStorage.setItem(it,r?"on":"off")}catch{S("Ce navigateur ne garde pas la préférence : elle s'applique jusqu'au rechargement.","muted")}document.documentElement.toggleAttribute("data-solid",!r)}),(a=e.querySelector("[data-analytics-enabled]"))==null||a.addEventListener("change",async i=>{const r=i.target,l=r.checked;if(!await J(l?{title:"Activer la mesure d'audience ?",text:"Le site commencera à compter les visites et à déposer son cookie de mesure. La politique de confidentialité doit déjà l'expliquer.",confirm:"Activer"}:{title:"Désactiver la mesure d'audience ?",text:"Le site arrêtera de compter les visites. Ce qui est déjà enregistré reste, jusqu'à la fin de sa durée de conservation.",confirm:"Désactiver",danger:!0})){r.checked=!l;return}await je({enabled:l},l?"Mesure d'audience activée.":"Mesure d'audience désactivée.")}),(s=e.querySelector("[data-retention]"))==null||s.addEventListener("change",async i=>{var m;const r=i.target,l=Number(r.value);if(!await J({title:"Changer la durée de conservation ?",text:"Si elle est plus courte, les visites plus anciennes seront effacées au prochain entretien, dans l'heure. Les totaux par jour restent. La politique de confidentialité annonce 6 mois : mettez-la à jour avec la nouvelle durée.",confirm:"Changer"})){r.value=String(((m=r.querySelector("option[selected]"))==null?void 0:m.getAttribute("value"))??l);return}await je({retentionDays:l},`Visites conservées ${rt[l]??`${l} jours`}.`)})}const wa=[["Téléchargement","Dernière release GitHub, choisie automatiquement"],["Code source","https://github.com/lololyeye/aoze"],["Soutien","https://ko-fi.com/aoze_support"],["Contact","contact@aoze.fr"]];function ze(e){if(!e)return"";const t=new Date(e),a=s=>String(s).padStart(2,"0");return`${t.getFullYear()}-${a(t.getMonth()+1)}-${a(t.getDate())}T${a(t.getHours())}:${a(t.getMinutes())}`}function ne(e,t){const a=t==="fr"?e.textFr:e.textEn;return a.trim()?n`<div class="${`banner-preview banner-${e.level}`}">
    <span>${a}</span>${e.link?n` <a href="${e.link}" tabindex="-1">${t==="fr"?"En savoir plus":"Learn more"}</a>`:""}
  </div>`:n`<p class="unavailable">Pas de texte en ${t==="fr"?"français":"anglais"}.</p>`}function ka(e){const t=e.status==="published"?n`${f("ok","En ligne")}${e.pendingChanges?n` ${f("warn","Modifications non publiées")}`:""}`:f("muted","Non publié");return n`<p class="card-intro" data-status>${t}
    <span class="muted">Modifié ${re(e.updatedAt)}. Il s'affiche en haut de toutes les pages, dans la langue du visiteur, entre les dates choisies.</span></p>`}function Aa(e){return n`<form class="form" data-announcement>
    <div class="field-row">
      <label class="field"><span>Texte en français</span><textarea name="textFr" maxlength="180" rows="2">${e.textFr}</textarea></label>
      <label class="field"><span>Texte en anglais</span><textarea name="textEn" maxlength="180" rows="2">${e.textEn}</textarea></label>
    </div>
    <div class="field-row">
      <label class="field"><span>Lien (facultatif)</span><input name="link" maxlength="300" placeholder="/download/ ou https://…" value="${e.link}" /></label>
      <label class="field"><span>Ton</span><select name="level">
        <option value="info" ${e.level==="info"?"selected":""}>Information</option>
        <option value="warning" ${e.level==="warning"?"selected":""}>Avertissement</option>
      </select></label>
    </div>
    <div class="field-row">
      <label class="field"><span>Début (facultatif, heure française)</span><input name="startsAt" type="datetime-local" value="${ze(e.startsAt)}" /></label>
      <label class="field"><span>Fin (facultatif, heure française)</span><input name="endsAt" type="datetime-local" value="${ze(e.endsAt)}" /></label>
    </div>
    <div class="form-actions">
      <button class="btn btn-ghost" type="submit" name="intent" value="draft">Enregistrer le brouillon</button>
      ${e.status==="published"?n`<button class="btn btn-ghost" type="submit" name="intent" value="unpublish">Retirer du site</button>`:""}
      <button class="btn btn-primary" type="submit" name="intent" value="publish">${e.status==="published"?"Publier les modifications":"Publier"}</button>
    </div>
  </form>`}async function Sa(){const e=await zt();return n`<div class="grid">
    ${h("Bandeau d'annonce",e,t=>n`
      ${ka(t)}
      ${Aa(t)}
      <h3 class="sub">Aperçu</h3>
      <div class="previews" data-previews>${ne(t,"fr")}${ne(t,"en")}</div>`,{wide:!0,icon:"info"})}
  </div>`}async function xa(){const e=await ke();return n`<div class="grid">
    ${d("Liens publics",n`<dl class="kvs">${wa.map(([t,a])=>p(t,n`<span class="wrap">${a}</span>`))}</dl>`,{icon:"link"})}
    ${h("Pages publiées",e,t=>n`<ul class="list">
      ${t.map(a=>n`<li><a class="mono" href="${`https://aoze.fr${a.path}`}" target="_blank" rel="noopener">${a.path}</a>${f(a.status===200?"ok":"bad",String(a.status))}</li>`)}
    </ul>`,{icon:"file"})}
    ${d("Modifier le site",n`<p class="muted">Les textes et les liens du site sont dans le dépôt GitHub : ils se modifient par un commit, relu avant publication. Le bandeau d'annonce est le seul contenu modifiable depuis l'admin.</p>`,{wide:!0,icon:"website"})}
  </div>`}const La={publish:{title:"Publier le bandeau ?",text:"Il apparaîtra en haut de toutes les pages du site public, en français et en anglais.",confirm:"Publier"},unpublish:{title:"Retirer le bandeau ?",text:"Il disparaîtra du site public. Le texte reste enregistré comme brouillon.",confirm:"Retirer",danger:!0}};function qa(e){const t=e.querySelector("[data-announcement]"),a=e.querySelector("[data-previews]");if(!t||!a)return;const s=r=>String(new FormData(t).get(r)??""),i=()=>({level:s("level")==="warning"?"warning":"info",textFr:s("textFr"),textEn:s("textEn"),link:s("link")});t.addEventListener("input",()=>{const r=i();a.innerHTML=n`${ne(r,"fr")}${ne(r,"en")}`.value}),t.addEventListener("submit",async r=>{var o;r.preventDefault();const l=((o=r.submitter)==null?void 0:o.value)??"draft";if(!((l==="publish"||l==="unpublish")&&!await J(La[l])))try{await k("announcement",{intent:l,...i(),startsAt:s("startsAt"),endsAt:s("endsAt")}),S(l==="publish"?"Bandeau publié sur le site.":l==="unpublish"?"Bandeau retiré du site.":"Brouillon enregistré."),window.dispatchEvent(new Event("admin:refresh"))}catch(m){S(m instanceof E?m.message:"Le serveur ne répond pas.","bad")}})}const fe=[{slug:"",label:"Vue d'ensemble",icon:"overview",pages:[{slug:"",label:"Vue d'ensemble",lead:"L'état d'Aoze, du site et de l'hébergement en un coup d'œil.",render:na}]},{slug:"analytics",label:"Analytics",icon:"analytics",ranged:!0,pages:[{slug:"traffic",label:"Trafic",lead:"Pages vues, visites et leur évolution.",render:Bt,bind:R},{slug:"visitors",label:"Visiteurs",lead:"D'où viennent les visiteurs et avec quel appareil.",render:Ut,bind:R},{slug:"acquisition",label:"Acquisition",lead:"Comment les visiteurs arrivent sur aoze.fr.",render:Yt,bind:R},{slug:"pages",label:"Pages",lead:"Les pages lues, par où on entre et par où on part.",render:Jt,bind:R},{slug:"downloads",label:"Téléchargements",lead:"Ce qui est réellement téléchargé, et ce qu'on ne peut pas mesurer.",render:Wt,bind:R},{slug:"conversions",label:"Conversions",lead:"Du premier passage sur le site jusqu'au téléchargement.",render:Kt,bind:R}]},{slug:"application",label:"Application",icon:"application",pages:[{slug:"releases",label:"Releases",lead:"Les versions publiées sur GitHub.",render:Qt},{slug:"integrity",label:"Intégrité",lead:"Ce que reçoit l'auto-update, vérifié comme le fait l'application.",render:Xt},{slug:"distribution",label:"Distribution",lead:"Quels fichiers GitHub distribue, et à qui.",render:ea}]},{slug:"website",label:"Site",icon:"website",pages:[{slug:"announcements",label:"Annonces",lead:"Le bandeau affiché en haut du site public.",render:Sa,bind:qa},{slug:"content",label:"Contenu public",lead:"Les liens et les pages que le site met en avant.",render:xa}]},{slug:"infrastructure",label:"Infrastructure",icon:"infrastructure",pages:[{slug:"hosting",label:"Hébergement",lead:"aoze.fr chez o2switch.",render:ia},{slug:"deployment",label:"Déploiement",lead:"De GitHub Actions jusqu'au serveur.",render:ra},{slug:"https",label:"HTTPS",lead:"Les certificats du domaine.",render:la},{slug:"availability",label:"Disponibilité",lead:"Les pages principales, vérifiées par le serveur lui-même.",render:oa}]},{slug:"security",label:"Sécurité",icon:"security",pages:[{slug:"logins",label:"Connexions",lead:"Chaque tentative de connexion à l'admin.",render:pa},{slug:"sessions",label:"Sessions",lead:"Les appareils connectés en ce moment.",render:ma,bind:De},{slug:"account",label:"Compte et 2FA",lead:"Mot de passe, double authentification et accès à /admin.",render:va,bind:De},{slug:"audit",label:"Journal",lead:"Tout ce qui a été fait depuis l'admin.",render:ha}]},{slug:"settings",label:"Réglages",icon:"settings",pages:[{slug:"",label:"Réglages",lead:"Mesure d'audience, confidentialité et préférences de l'admin.",render:$a,bind:ya}]}],xe='<svg viewBox="240 200 640 620" aria-hidden="true"><path d="M292 772 L512 248 L732 772" fill="none" stroke="#eef1f5" stroke-width="96" stroke-linecap="round" stroke-linejoin="round"/><path d="M392 616 L800 616" fill="none" stroke="#3dd6d0" stroke-width="76" stroke-linecap="round"/><circle cx="800" cy="616" r="62" fill="#5ff0d4"/></svg>',ot=(e,t)=>`#/${[e.slug,(t==null?void 0:t.slug)??""].filter(Boolean).join("/")}`,y=document.querySelector("#app");let A=null,Le=!1;function ee(e){var t;document.body.classList.toggle("nav-open",e),(t=y.querySelector("[data-open-nav]"))==null||t.setAttribute("aria-expanded",String(e))}function Ma(e){y.innerHTML=n`
    <div class="layout">
      <aside class="sidebar" id="sidebar">
        <a class="brand" href="#/">${z(xe)}<span>Aoze</span><span class="brand-tag">Admin</span></a>
        <nav class="nav" aria-label="Administration">
          ${fe.map(t=>n`<a href="${ot(t)}" data-section="${t.slug}">${$(t.icon)}<span>${t.label}</span></a>`)}
        </nav>
        <div class="account">
          <span class="avatar" aria-hidden="true">${e.slice(0,1).toUpperCase()}</span>
          <span class="account-mail" title="${e}">${e}</span>
          <button class="icon-btn" type="button" data-logout aria-label="Se déconnecter" data-tip="Se déconnecter">${$("logout")}</button>
        </div>
      </aside>
      <div class="scrim" data-close-nav></div>
      <div class="content">
        <header class="topbar">
          <button class="icon-btn menu-btn" type="button" data-open-nav aria-label="Ouvrir le menu" aria-controls="sidebar" aria-expanded="false">${$("menu")}</button>
          <ol class="crumbs" id="crumbs"></ol>
          <div class="topbar-actions">
            <button class="icon-btn" type="button" data-refresh aria-label="Actualiser" data-tip="Actualiser">${$("refresh")}</button>
            <a class="btn btn-ghost btn-sm" href="https://aoze.fr" target="_blank" rel="noopener">${$("external")}<span>Voir le site</span></a>
          </div>
        </header>
        <div class="page-intro" id="intro"></div>
        <main class="main" id="main" tabindex="-1"></main>
      </div>
    </div>`.value,y.querySelector("[data-open-nav]").addEventListener("click",()=>ee(!0)),y.querySelector("[data-close-nav]").addEventListener("click",()=>ee(!1)),y.querySelector(".nav").addEventListener("click",()=>ee(!1)),y.querySelector("[data-refresh]").addEventListener("click",()=>void j()),kt(y.querySelector("#intro")),y.querySelector("[data-logout]").addEventListener("click",async()=>{try{await k("logout",{})}finally{A=null,location.hash="#/",j()}})}function ct(e){var i;document.title=`${e.title} · Aoze Admin`,y.innerHTML=n`
    <main class="login">
      <form class="login-card" data-gate>
        <div class="login-logo">${z(xe)}</div>
        <h1>${e.title}</h1>
        <p class="muted">${e.lead}</p>
        ${e.fields}
        <p class="form-error" role="alert" hidden></p>
        <button class="btn btn-primary btn-block" type="submit">${e.submit}</button>
      </form>
    </main>`.value;const t=y.querySelector("[data-gate]"),a=t.querySelector(".form-error"),s=t.querySelector("button[type=submit]");(i=t.querySelector("input"))==null||i.focus(),t.addEventListener("submit",async r=>{r.preventDefault(),s.disabled=!0,a.hidden=!0;try{await e.onSubmit(new FormData(t)),A=await Ve(),Le=!1,location.hash="#/",j()}catch(l){a.textContent=l instanceof E?l.message:"Connexion au serveur impossible.",a.hidden=!1,s.disabled=!1}})}function ut(e,t){document.title=`${e} · Aoze Admin`,y.innerHTML=n`<main class="login"><div class="login-card">
    <div class="login-logo">${z(xe)}</div>
    <h1>${e}</h1>
    <p class="muted">${t}</p>
  </div></main>`.value}const _=(e,t,a,s,i=0)=>n`<label class="field"><span>${t}</span><input name="${e}" type="${a}" autocomplete="${s}" ${i?z(`minlength="${i}"`):""} required /></label>`;function Ea(){ct({title:"Administration",lead:Le?"Votre session a expiré : reconnectez-vous.":"Réservé à l'administrateur d'Aoze.",fields:n`
      ${_("email","Adresse e-mail","email","username")}
      ${_("password","Mot de passe","password","current-password")}
      <label class="field"><span>Code de double authentification</span><input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" placeholder="Seulement si elle est activée" /></label>`,submit:"Se connecter",onSubmit:e=>k("login",{email:e.get("email"),password:e.get("password"),code:e.get("code")??""})})}function Ta(e){if(!e)return ut("Mise en place","Aucun compte administrateur n'existe encore. Ajoutez un code de mise en place (au moins 24 caractères) dans ~/aoze-admin/config.php, puis rechargez cette page.");ct({title:"Mise en place",lead:"Créez le compte administrateur. Cette page ne fonctionne qu'une fois.",fields:n`
      ${_("token","Code de mise en place (dans config.php)","password","off")}
      ${_("email","Adresse e-mail","email","username")}
      ${_("password","Mot de passe (12 caractères minimum)","password","new-password",12)}
      ${_("confirm","Confirmer le mot de passe","password","new-password",12)}`,submit:"Créer le compte",onSubmit:async t=>{if(t.get("password")!==t.get("confirm"))throw new E(422,"Les deux mots de passe ne sont pas identiques.");await k("setup",{token:t.get("token"),email:t.get("email"),password:t.get("password")})}})}function Ca(){const[e="",t=""]=location.hash.replace(/^#\/?/,"").split("/"),a=fe.find(s=>s.slug===e)??fe[0];return[a,a.pages.find(s=>s.slug===t)??a.pages[0]]}function Da(e,t){const a=e.pages.length>1?n`<nav class="tabs" aria-label="${e.label}">${e.pages.map(s=>n`<a href="${ot(e,s)}" ${s===t?z('aria-current="page"'):""}>${s.label}</a>`)}</nav>`:"";return n`<div class="intro-text"><h1>${t.label}</h1><p>${t.lead}</p></div>
    ${e.ranged?wt():""}
    ${a}`}let ue=0;async function j(){var l;if(!A)try{A=await Ve()}catch{return ut("Serveur injoignable","Réessayez dans un instant.")}if(A.state==="setup")return Ta(A.setupReady===!0);if(A.state!=="signed-in")return Ea();y.querySelector(".layout")||Ma(A.email??"");const[e,t]=Ca();document.querySelector("#tip").hidden=!0,y.querySelectorAll(".nav a").forEach(o=>o.toggleAttribute("aria-current",o.dataset.section===e.slug)),y.querySelector("#crumbs").innerHTML=n`<li>Aoze</li>${e.pages.length>1?n`<li>${e.label}</li>`:""}<li aria-current="page">${t.label}</li>`.value,y.querySelector("#intro").innerHTML=Da(e,t).value;const a=y.querySelector("#main"),s=++ue;a.setAttribute("aria-busy","true");const i=setTimeout(()=>{s===ue&&(a.innerHTML=Et().value)},120);let r;try{r=await t.render()}catch(o){console.error(o),r=n`<section class="card"><h2>Cette page n'a pas pu s'afficher.</h2><p class="note">Rechargez la page. Si le problème revient, le détail est dans la console du navigateur.</p></section>`}clearTimeout(i),!(s!==ue||!y.contains(a))&&(a.innerHTML=r.value,a.removeAttribute("aria-busy"),Tt(a),(l=t.bind)==null||l.call(t,a),a.focus({preventScroll:!0}),document.title=`${t.label} · Aoze Admin`)}ba();Ct(document.querySelector("#tip"));addEventListener("keydown",e=>{e.key==="Escape"&&ee(!1)});addEventListener("hashchange",()=>void j());addEventListener("admin:refresh",()=>void j());addEventListener("admin:signed-out",()=>{(A==null?void 0:A.state)==="signed-in"&&(A=null,Le=!0,j())});j();
