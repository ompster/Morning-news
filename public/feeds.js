/* Shared by the Worker (src/worker.js) and the page (app.js fallback).
   Order matches the old Google Assistant queue. Add or remove sources here.
   type "omny": Omny Studio program (org + prog IDs). type "rss": podcast RSS feed.
   match: only items whose title matches are bulletins (some feeds mix in single stories).
   cors:false means browsers cannot fetch the feed directly, so it only works via /api/news. */
const NC="2fb3740d-3436-44af-8cc0-a91900716aa5";   // News Corp Australia / NOVA on Omny
const TP="88b564ea-a9a6-4751-910a-a5d800019396";   // Tapt (Nine Radio) on Omny
const SC="566281f8-200e-4c9f-8378-a4870055423b";   // SCA / LiSTNR on Omny
export const SOURCES=[
  {id:"nova",   name:"NOVA News",             type:"omny", org:NC, prog:"d844a75b-4c7e-4638-b208-ac0d0185560e"},
  {id:"fox",    name:"Fox FM Melbourne News", type:"omny", org:SC, prog:"a7ee56bc-7e19-4bab-9026-ac0d00124f59"},
  {id:"abc",    name:"ABC News Briefing",     type:"rss",  url:"https://www.abc.net.au/feeds/101858056/podcast.xml",
                match:/\|\s*ABC News Top Stories\s*$/i, cors:false},
  {id:"news24", name:"News24",                type:"omny", org:NC, prog:"cfb18248-9dff-4d09-bd49-ac2a005249de"},
  {id:"sbs",    name:"SBS News",              type:"rss",  url:"https://sbs-ondemand.streamguys1.com/sbs-news-update/",
                match:/Bulletin/i},
  {id:"nine",   name:"Nine News Bulletin",    type:"omny", org:TP, prog:"d54017ee-1f2d-4e78-93e9-b2e300786105"},
];

/* ---------- Omny ---------- */
const toSec=t=>{const [h,m,s]=String(t).split(":").map(Number);return h*3600+m*60+s};
export function pickOmny(data){
  const c=(data.Clips||[]).filter(c=>c.AudioUrl)
    .sort((a,b)=>new Date(b.PublishedUtc)-new Date(a.PublishedUtc))[0];
  if(!c)throw new Error("No episodes");
  return {title:c.Title.trim(), published:new Date(c.PublishedUtc).toISOString(), audio:c.AudioUrl,
          guid:c.Id, image:c.ImageUrl||"", contentSeconds:c.DurationSeconds||0,
          adMarkers:(c.AdMarkers||[]).map(m=>({type:m.AdMarkerType,at:toSec(m.Offset)}))};
}

/* ---------- RSS (small regex parser so it runs in Workers and browsers alike) ---------- */
const ENT={amp:"&",lt:"<",gt:">",quot:'"',apos:"'"};
const decode=s=>s.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/,"$1")
  .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi,(m,e)=>e[0]==="#"
    ?String.fromCodePoint(e[1].toLowerCase()==="x"?parseInt(e.slice(2),16):+e.slice(1))
    :ENT[e]??m).trim();
const tag=(x,n)=>{const m=x.match(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`));return m?decode(m[1]):""};
const attr=(x,n,a)=>{const m=x.match(new RegExp(`<${n}\\b[^>]*?\\s${a}="([^"]*)"`));return m?decode(m[1]):""};

export function pickRss(xml,s){
  const items=[...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/g)].map(m=>{
    const x=m[1],title=tag(x,"title");
    return {raw:title, title:title.split(/\s*\|\s*/)[0]||title, published:new Date(tag(x,"pubDate")),
            audio:attr(x,"enclosure","url"), guid:tag(x,"guid"), image:attr(x,"itunes:image","href")};
  }).filter(i=>i.audio&&!isNaN(i.published)&&(!s.match||s.match.test(i.raw)))
    .sort((a,b)=>b.published-a.published);
  const it=items[0];
  if(!it)throw new Error("No bulletins");
  return {title:it.title, published:it.published.toISOString(), audio:it.audio,
          guid:it.guid||it.audio, image:it.image};
}

/* ---------- Fetch one source ---------- */
export async function fetchSource(s,ms=8000){
  const c=new AbortController(),t=setTimeout(()=>c.abort(),ms);
  try{
    const url=s.type==="omny"?`https://api.omny.fm/orgs/${s.org}/programs/${s.prog}/clips?pageSize=5`:s.url;
    const r=await fetch(url,{signal:c.signal});
    if(!r.ok)throw new Error("HTTP "+r.status);
    return s.type==="omny"?pickOmny(await r.json()):pickRss(await r.text(),s);
  }finally{clearTimeout(t)}
}

export async function fetchAll(sources=SOURCES){
  const res=await Promise.allSettled(sources.map(s=>fetchSource(s)));
  return SOURCES.map(s=>{
    const i=sources.indexOf(s);
    if(i<0)return {id:s.id,name:s.name,status:"error",error:"Needs the server"};
    return res[i].status==="fulfilled"
      ?{id:s.id,name:s.name,status:"ok",...res[i].value}
      :{id:s.id,name:s.name,status:"error",error:String(res[i].reason?.message||res[i].reason)};
  });
}
