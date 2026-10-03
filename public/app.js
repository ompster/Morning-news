import {SOURCES,fetchAll} from "./feeds.js";

/* ---------- Helpers ---------- */
const $=s=>document.querySelector(s);
const audio=$("#audio");
const store={get:(k,d)=>{try{return JSON.parse(localStorage.getItem(k))??d}catch{return d}},
             set:(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch{}}};
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const fmt=s=>{s=Math.max(0,Math.round(s||0));return Math.floor(s/60)+":"+String(s%60).padStart(2,"0")};
function ago(d){
  const m=Math.max(0,Math.round((Date.now()-d)/60000));
  if(m<1)return "just now"; if(m<60)return m+" min ago";
  const h=Math.round(m/60); if(h<48)return h+(h===1?" hour ago":" hours ago");
  return Math.round(h/24)+" days ago";
}

/* ---------- Stored state (this phone only) ---------- */
let enabled=store.get("news.enabled",{});
let trim=store.get("news.trim",{});          // {sourceId:{intro,outro}} seconds
let played=store.get("news.played",{});      // {"guid|published": ISO time played}
let includePlayed=store.get("news.includePlayed",false);
const WEEK=7*864e5;
for(const k in played)if(Date.now()-new Date(played[k])>WEEK)delete played[k];
store.set("news.played",played);
try{localStorage.removeItem("news.proxy")}catch{}   // v1 setting, no longer used

const isOn=id=>enabled[id]!==false;
const keyOf=it=>it.guid+"|"+it.published;
const isPlayed=it=>!!played[keyOf(it)];
function markPlayed(it,on=true){
  if(!it)return;
  if(on)played[keyOf(it)]=new Date().toISOString();else delete played[keyOf(it)];
  store.set("news.played",played);render();
}

/* ---------- Loading ---------- */
let items=SOURCES.map(s=>({id:s.id,name:s.name,status:"loading"}));
let q=[],cur=-1,loadedAt=0;

async function load(fresh=false){
  if(!loadedAt){items=SOURCES.map(s=>({id:s.id,name:s.name,status:"loading"}));render()}
  let next;
  try{
    const c=new AbortController(),t=setTimeout(()=>c.abort(),12000);
    const r=await fetch("api/news"+(fresh?"?fresh=1":""),{signal:c.signal}).finally(()=>clearTimeout(t));
    if(!r.ok)throw new Error("HTTP "+r.status);
    next=(await r.json()).items;
  }catch{
    // Server unavailable: fetch the feeds that allow browser access directly.
    next=await fetchAll(SOURCES.filter(s=>s.cors!==false));
  }
  items=next.map(i=>i.published?{...i,published:new Date(i.published)}:i);
  loadedAt=Date.now();render();
}

/* ---------- Rendering ---------- */
function render(){
  $("#date").textContent=new Date().toLocaleDateString("en-AU",{weekday:"long",day:"numeric",month:"long"});
  const playing=cur>=0?q[cur]:null;
  $("#list").innerHTML=items.map(it=>{
    let body,meta="";
    const src=`<span class="src">${esc(it.name)}</span>`;
    if(it.status==="ok"){
      body=src+`<span class="hl">${esc(it.title)}</span>`;
      const stale=Date.now()-it.published>24*3600e3;
      meta=`<span class="age${stale?" stale":""}">${ago(it.published)}</span>`;
      if(isPlayed(it))meta+=`<button class="tag" data-act="unplay" title="Mark as not played">Played</button>`;
    }else if(it.status==="loading"){
      body=src+`<span class="hl msg">Loading</span>`;
    }else{
      body=src+`<span class="hl msg err">Could not load. Try Refresh.</span>`;
    }
    const cls=["row",isOn(it.id)?"":"off",it.status==="ok"&&isPlayed(it)?"played":"",playing&&playing.id===it.id?"now":""].join(" ");
    return `<li class="${cls}" data-id="${it.id}">
      <input type="checkbox" aria-label="Include ${esc(it.name)}" ${isOn(it.id)?"checked":""}>
      <button class="pick">${body}</button><div class="meta">${meta}</div></li>`;
  }).join("");
  const avail=items.filter(i=>i.audio&&isOn(i.id));
  const fresh=avail.filter(i=>!isPlayed(i));
  $("#play").disabled=avail.length===0;
  $("#playLabel").textContent=fresh.length||includePlayed||!avail.length?"Play the news":"Play again";
  $("#count").textContent=!avail.length?"":includePlayed||fresh.length===avail.length
    ?`${avail.length} bulletin${avail.length===1?"":"s"}`
    :`${fresh.length} new of ${avail.length}`;
  $("#updated").textContent=loadedAt?"Updated "+new Date(loadedAt).toLocaleTimeString("en-AU",{hour:"numeric",minute:"2-digit"}):"";
  paintProgress();
}
function paintProgress(){
  const r=cur>=0&&document.querySelector(`.row[data-id="${q[cur].id}"]`);
  if(r&&audio.duration)r.style.setProperty("--p",(audio.currentTime/audio.duration*100)+"%");
}

/* ---------- Toast ---------- */
let toastT;
function toast(msg,actLabel,act){
  $("#toastMsg").textContent=msg;
  const b=$("#toastAct");b.hidden=!actLabel;b.textContent=actLabel||"";
  b.onclick=()=>{$("#toast").hidden=true;act&&act()};
  $("#toast").hidden=false;clearTimeout(toastT);toastT=setTimeout(()=>$("#toast").hidden=true,6000);
}

/* ---------- Ad trimming ----------
   Ads are stitched into the audio per request, so there is no exact ad map. We keep a
   per-source "skip first N / last N seconds" learned from the user's own skips, and cap it
   so it can never eat a short bulletin. For Omny we know the real content length, so the
   cap is the measured ad time. */
function trimLimit(it){
  const d=audio.duration;
  if(!isFinite(d)||!d)return 0;
  if(it.contentSeconds){const ads=d-it.contentSeconds;return ads>3?ads+3:0}
  return d*0.3;
}
function effTrim(it){
  const t=trim[it.id]||{},max=trimLimit(it);
  const intro=clamp(t.intro||0,0,max);
  return {intro,outro:clamp(t.outro||0,0,max-intro)};
}
function learn(id,field,val){
  const t=trim[id]||(trim[id]={});
  t[field]=Math.round(t[field]?(t[field]+val)/2:val);
  store.set("news.trim",trim);
}

/* ---------- Playback ---------- */
let retried=false,pendingIntro=null,introAt=0,outroFired=false;

function start(fromId){
  const avail=items.filter(i=>i.audio&&isOn(i.id));
  if(!avail.length)return;
  const want=i=>includePlayed||!isPlayed(i);
  if(fromId){
    const n=avail.findIndex(i=>i.id===fromId);
    q=[avail[n],...avail.slice(n+1).filter(want)];
  }else{
    q=avail.filter(want);
    if(!q.length)q=avail;              // all caught up: play everything again
  }
  playAt(0);
}

/* Must stay synchronous (no await) so Chrome keeps the media session alive with the screen locked. */
function playAt(n){
  if(n<0)n=0;
  if(n>=q.length){finish();return}
  cur=n;retried=false;pendingIntro=null;introAt=0;outroFired=false;
  const it=q[n];
  audio.src=it.audio;
  tryPlay();
  $("#mini").hidden=false;
  $("#mSrc").textContent=it.name;$("#mHl").textContent=it.title;
  $("#bar").value=0;$("#tCur").textContent="0:00";$("#tLeft").textContent="";
  if("mediaSession"in navigator){
    navigator.mediaSession.metadata=new MediaMetadata({title:it.title,artist:it.name,album:"Morning news",
      artwork:it.image?[{src:it.image,sizes:"512x512"}]:[{src:"icon-512.png",sizes:"512x512",type:"image/png"}]});
  }
  render();
}
function tryPlay(){
  const p=audio.play();
  // A rejected play() (screen locked, autoplay policy, src swapped) is NOT a broken bulletin.
  // Stay put and wait for the user or the lock-screen play button instead of skipping ahead.
  p?.catch(e=>{if(e.name!=="AbortError")setIcon(false)});
}
function finish(){
  cur=-1;audio.removeAttribute("src");audio.load();
  $("#mSrc").textContent="Morning news";$("#mHl").textContent="That is all the news.";
  $("#skipIntro").hidden=true;
  setIcon(false);render();
  if("mediaSession"in navigator)navigator.mediaSession.playbackState="none";
}
function next(user=false){
  if(cur<0)return;
  const it=q[cur],d=audio.duration,left=d-audio.currentTime;
  if(user&&isFinite(d)&&left<=60&&left<=d*0.25&&audio.currentTime>d*0.5){
    learn(it.id,"outro",left);markPlayed(it);
  }
  playAt(cur+1);
}
function prev(){
  if(cur<0)return;
  if(audio.currentTime>effTrim(q[cur]).intro+4)seek(0,false);else playAt(cur-1);
}
function seek(t,user=true){
  if(cur<0||!isFinite(audio.duration))return;
  const d=audio.duration;t=clamp(t,0,d-0.5);
  const from=audio.currentTime;
  audio.currentTime=t;
  if(user&&from<90){
    // A forward skip near the start is the user jumping the pre-roll; remember where they landed.
    pendingIntro=t>from&&t>5&&t<=Math.min(120,d*0.25)?t:null;
    if(t<5)pendingIntro=null;
  }
  updatePos();
}
function setIcon(playing){
  $("#ppIcon").innerHTML=playing?'<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>':'<path d="M7 4v16l13-8z"/>';
}
function updatePos(){
  const d=audio.duration,t=audio.currentTime;
  if(!isFinite(d)||!d)return;
  if(!dragging)$("#bar").value=Math.round(t/d*1000);
  $("#tCur").textContent=fmt(t);$("#tLeft").textContent="-"+fmt(d-t);
  $("#skipIntro").hidden=!(cur>=0&&t<90&&d>120);
  if("mediaSession"in navigator&&navigator.mediaSession.setPositionState){
    try{navigator.mediaSession.setPositionState({duration:d,position:clamp(t,0,d),playbackRate:audio.playbackRate})}catch{}
  }
}

audio.addEventListener("play",()=>{setIcon(true);if("mediaSession"in navigator)navigator.mediaSession.playbackState="playing"});
audio.addEventListener("pause",()=>{setIcon(false);if("mediaSession"in navigator)navigator.mediaSession.playbackState="paused"});
audio.addEventListener("ended",()=>{if(cur>=0){markPlayed(q[cur]);playAt(cur+1)}});
audio.addEventListener("loadedmetadata",()=>{
  if(cur<0)return;
  const it=q[cur],{intro}=effTrim(it);
  const ads=it.contentSeconds?Math.round(audio.duration-it.contentSeconds):0;
  $("#mSrc").textContent=it.name+(ads>3?` · about ${ads}s of ads`:"");
  if(intro>0&&audio.currentTime<intro){
    audio.currentTime=intro;introAt=intro;
    toast(`Skipped ${Math.round(intro)}s at the start`,"Undo",()=>{
      seek(0,false);delete (trim[it.id]||{}).intro;store.set("news.trim",trim);
      toast(`Start skip turned off for ${it.name}`);
    });
  }
  updatePos();
});
audio.addEventListener("ratechange",updatePos);
audio.addEventListener("seeked",updatePos);
audio.addEventListener("timeupdate",()=>{
  if(cur<0)return;
  const it=q[cur],d=audio.duration,t=audio.currentTime;
  updatePos();paintProgress();
  if(!isFinite(d)||!d)return;
  if(pendingIntro!=null&&t-pendingIntro>8){learn(it.id,"intro",pendingIntro);pendingIntro=null}
  if(t/d>=0.85&&!isPlayed(it))markPlayed(it);
  const {outro}=effTrim(it);
  if(!outroFired&&outro>0&&d-t<=outro&&t>introAt+10){outroFired=true;markPlayed(it);playAt(cur+1)}
});
audio.addEventListener("error",()=>{
  if(cur<0||!audio.getAttribute("src"))return;
  const code=audio.error?.code;
  if(code===1)return;                         // aborted by us
  if(!retried){retried=true;audio.load();tryPlay();return}
  toast(`Could not play ${q[cur].name}, skipping`);
  playAt(cur+1);
});

if("mediaSession"in navigator){
  const ms=navigator.mediaSession,h=(a,f)=>{try{ms.setActionHandler(a,f)}catch{}};
  h("play",()=>cur<0?start():tryPlay());
  h("pause",()=>audio.pause());
  h("stop",()=>{audio.pause();finish()});
  h("nexttrack",()=>next(true));
  h("previoustrack",prev);
  h("seekbackward",d=>seek(audio.currentTime-(d.seekOffset||15)));
  h("seekforward",d=>seek(audio.currentTime+(d.seekOffset||30)));
  h("seekto",d=>seek(d.seekTime));
}

/* ---------- Events ---------- */
let dragging=false;
const bar=$("#bar");
bar.addEventListener("input",()=>{dragging=true;if(isFinite(audio.duration))$("#tCur").textContent=fmt(bar.value/1000*audio.duration)});
bar.addEventListener("change",()=>{dragging=false;if(isFinite(audio.duration))seek(bar.value/1000*audio.duration)});

$("#play").onclick=async()=>{
  if(Date.now()-loadedAt>3*60e3)await load(true);   // always play the freshest bulletins
  start();
};
$("#refresh").onclick=()=>load(true);
$("#pp").onclick=()=>{if(cur<0)start();else if(audio.paused)tryPlay();else audio.pause()};
$("#next").onclick=()=>next(true);
$("#prev").onclick=prev;
$("#back").onclick=()=>seek(audio.currentTime-15);
$("#fwd").onclick=()=>seek(audio.currentTime+30);
$("#skipIntro").onclick=()=>{
  if(cur<0)return;
  const t=trim[q[cur].id]?.intro;
  seek(t&&t>audio.currentTime+3?t:audio.currentTime+30);
};
$("#list").addEventListener("change",e=>{
  if(e.target.type!=="checkbox")return;
  enabled[e.target.closest(".row").dataset.id]=e.target.checked;
  store.set("news.enabled",enabled);render();
});
$("#list").addEventListener("click",e=>{
  const row=e.target.closest(".row");if(!row)return;
  const it=items.find(i=>i.id===row.dataset.id);
  if(e.target.closest('[data-act="unplay"]'))return markPlayed(it,false);
  if(e.target.closest(".pick")&&it.status==="ok")start(it.id);
});

/* ---------- Settings ---------- */
const dlg=$("#settings");
$("#settingsBtn").onclick=()=>{
  $("#incPlayed").checked=includePlayed;
  $("#trimRows").innerHTML=SOURCES.map(s=>{
    const t=trim[s.id]||{};
    return `<tr data-id="${s.id}"><td>${esc(s.name)}</td>
      <td><input type="number" min="0" max="180" inputmode="numeric" data-f="intro" value="${t.intro||0}"></td>
      <td><input type="number" min="0" max="180" inputmode="numeric" data-f="outro" value="${t.outro||0}"></td>
      <td><button type="button" class="linkbtn" data-reset>Reset</button></td></tr>`;
  }).join("");
  dlg.showModal();
};
$("#trimRows").addEventListener("input",e=>{
  const f=e.target.dataset.f;if(!f)return;
  const id=e.target.closest("tr").dataset.id;
  (trim[id]||(trim[id]={}))[f]=clamp(+e.target.value||0,0,180);
  store.set("news.trim",trim);
});
$("#trimRows").addEventListener("click",e=>{
  if(!e.target.hasAttribute("data-reset"))return;
  const tr=e.target.closest("tr");delete trim[tr.dataset.id];store.set("news.trim",trim);
  tr.querySelectorAll("input").forEach(i=>i.value=0);
});
$("#incPlayed").onchange=e=>{includePlayed=e.target.checked;store.set("news.includePlayed",includePlayed);render()};
$("#clearPlayed").onclick=()=>{played={};store.set("news.played",played);render();toast("Played history cleared")};

document.addEventListener("visibilitychange",()=>{
  if(document.hidden)return;
  if(Date.now()-loadedAt>10*60e3&&cur<0)load();else render();
});
if("serviceWorker"in navigator)navigator.serviceWorker.register("sw.js").catch(()=>{});

load();
