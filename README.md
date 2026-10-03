# Morning news

Google Assistant used to answer "play the news" with a queue of short radio bulletins. That feature is gone, so this is a replacement: a small web app that pulls the latest bulletin from each Australian news source you choose and plays them back to back with one tap.

It runs free on Cloudflare Workers. The page and its tiny API come from one Worker, and there is no database, no account system and no tracking.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/ompster/Morning-news)

## Features
- **One tap Play all.** Plays the newest bulletin from every enabled source in order. Untick a source to leave it out, or tap a row to start from that one.
- **Always the bulletin, not a random story.** Some feeds (ABC, SBS) mix full bulletins with single stories. Each source has a title rule so only the real bulletin is picked.
- **Skip past ads.**
  - Seek bar, back 15 seconds, forward 30 seconds, and a Skip intro button.
  - All of these also work from the lock screen and notification controls.
- **Learned ad trimming per source.**
  - Skip past the ads yourself once, and the app remembers where you landed. Next time it jumps there automatically, with an Undo.
  - Pressing Next near the end teaches it to leave early on that source.
  - The values are capped so they can never cut into the news itself, and you can edit them in Settings.
- **Measured ad time.** For Omny sources, the player shows how much ad time was inserted into the bulletin you are hearing.
- **Played tracking.**
  - Play all skips bulletins you have already heard, so the button shows something like "3 new of 6".
  - Tap the Played tag on a row to unmark it.
  - Settings can include played bulletins again or clear the history.
- **Keeps playing with the screen locked.** It uses one audio element and the Media Session API. Being installable as an app (PWA) also helps Android keep it running in the background.
- **Keeps working if the Worker is down.** The page falls back to fetching the feeds that allow direct browser access, which is every source except ABC.

Played history, ad trim values and source choices are stored in your browser only (localStorage). Nothing is sent anywhere.

## Sources
| Source | Feed | Notes |
|---|---|---|
| NOVA News | Omny Studio | Ads inserted per play |
| Fox FM Melbourne News | Omny Studio | Ads inserted per play |
| ABC News Briefing | ABC podcast RSS | Feed blocks browsers, so it is fetched by the Worker. Only items ending in "\| ABC News Top Stories" are bulletins |
| News24 | Omny Studio | Ads inserted per play |
| SBS News | SBS `sbs-news-update` RSS | Bulletins only ("Morning/Midday/Evening News Bulletin") |
| Nine News Bulletin | Omny Studio | Melbourne bulletin, ads inserted per play |

## Deploy your own (free)
You need a free [Cloudflare account](https://dash.cloudflare.com/sign-up). The free Workers plan is far more than enough for this.

### Option A: Deploy button (easiest)
1. Click **Deploy to Cloudflare** above.
2. Sign in, and let it copy the repo to your GitHub account.
3. It builds and deploys, then gives you a `https://morning-news.<your-subdomain>.workers.dev` URL. Every later push to your copy deploys automatically.

### Option B: From your computer
Requires [Node.js](https://nodejs.org/) 20 or newer.
```sh
git clone https://github.com/ompster/Morning-news.git
cd Morning-news
npm install
npx wrangler login     # opens a browser to authorise Cloudflare, once
npm run deploy         # prints your workers.dev URL
```
If this is your first Worker, Cloudflare may ask you to choose a `workers.dev` subdomain.

To auto-deploy on every push, open the Cloudflare dashboard and go to **Workers & Pages**. Select **morning-news**, then **Settings**, then **Builds**, and connect your GitHub repo. The build needs no settings, because the default deploy command `npx wrangler deploy` is correct.

### Put it on your phone
- **Android (Chrome):** open your URL, then use the menu (three dots) and choose **Add to Home screen**, then **Install**. Open it from the home screen icon.
- **iPhone (Safari):** open your URL, tap Share, then **Add to Home Screen**. Background playback on iOS is less forgiving than on Android, so results may vary.

## Run locally
```sh
npm install
npm run dev            # http://localhost:8787
```
`/api/news` returns the combined JSON. Add `?fresh=1` to skip the 2 minute cache.

## Customising sources
Everything about sources lives in [`public/feeds.js`](public/feeds.js), in the `SOURCES` array. The order there is the play order.

```js
{id:"nova", name:"NOVA News", type:"omny", org:"<org id>", prog:"<program id>"},
{id:"sbs",  name:"SBS News",  type:"rss",  url:"https://...", match:/Bulletin/i},
```

- **`type:"rss"`:** any podcast RSS feed.
  - `match` (optional) is a regex tested against each item title. The newest matching item wins.
  - Set `cors:false` if the feed does not send `Access-Control-Allow-Origin`. It will then only load through the Worker, not in the offline fallback.
- **`type:"omny"`:** an Omny Studio program, which gives ad-time info that RSS doesn't. To find the IDs, open any episode's audio URL. It contains `/d/clips/<org id>/<program id>/<clip id>/`. You can also list an org's programs at `https://api.omny.fm/orgs/<org id>/programs`.
- Give each source a unique, stable `id`. Played history and ad trims are keyed on it.

After editing, run `npm run deploy`, or just push if builds are connected.

## How it works
```
Phone (PWA)                     Cloudflare Worker                 Feeds
public/app.js  -- /api/news --> src/worker.js --fetchAll()-->  Omny API, ABC RSS, SBS RSS
               <-- JSON ------  (cached 2 min at the edge)
               -- audio -------------------------------------->  publisher CDNs (direct)
```
- **`src/worker.js`** answers `/api/news`. Every other path is served from `public/` as static assets.
- **`public/feeds.js`** is shared by the Worker and the page. It holds the source list, a small RSS parser that works in both environments, and the Omny parser.
- **`public/app.js`** is the player: queue, Media Session (lock screen), seek and skip, learned trims, and played tracking.
- **`public/sw.js`** caches only the app shell, so the page opens quickly. It never caches audio or `/api/news`.
- Audio streams straight from each publisher. The Worker never proxies or stores audio.

## Limitations
- **Ads cannot be removed exactly.** Commercial publishers (via Omny and Triton) stitch ads into the MP3 on each request. Lengths change from play to play, and there is no ad-free URL. The learned trimming is a best guess that gets you most of the way. The skip buttons cover the rest.
- **Feeds change.** If a publisher renames a show or changes its title format, that source may show "Could not load" or pick the wrong item. Adjust its `url` or `match` in `public/feeds.js`.
- **Some sources update rarely.** The age shows in red when a bulletin is over 24 hours old.

## Contributing
Issues and pull requests are welcome, especially new sources for other cities, or feeds that have broken.

## License
[MIT](LICENSE). Audio and feed content belong to their respective publishers; this app only links to their public podcast feeds.
