import {fetchAll} from "../public/feeds.js";

const TTL=120; // seconds the combined feed is cached at the edge

export default {
  async fetch(req,env,ctx){
    const url=new URL(req.url);
    if(url.pathname!=="/api/news")return env.ASSETS.fetch(req);

    const key=new Request(url.origin+"/api/news");
    const cache=caches.default;
    if(!url.searchParams.has("fresh")){
      const hit=await cache.match(key);
      if(hit)return hit;
    }
    const items=await fetchAll();
    const res=new Response(JSON.stringify({fetchedAt:new Date().toISOString(),items}),{
      headers:{"content-type":"application/json; charset=utf-8","cache-control":`public, max-age=${TTL}`},
    });
    ctx.waitUntil(cache.put(key,res.clone()));
    return res;
  },
};
