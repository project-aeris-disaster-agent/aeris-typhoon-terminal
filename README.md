# AERIS — Typhoon Resilience Terminal

A region-locked (Philippines only) disaster response dashboard for LGU and
barangay emergency coordinators. Real-time typhoon tracking, flood and
landslide hazard maps, animated satellite and radar, and crowdsourced
incident reporting in one live terminal.

## Features

- **Region-locked interactive map** — MapLibre GL 2D with Three.js 3D terrain toggle, Philippines bbox enforced
- **Hazard overlays** — Project NOAH / MGB flood (5/25/100-year return period) and landslide susceptibility
- **Animated weather** — NASA GIBS Himawari-9 satellite loops and RainViewer radar precipitation
- **Typhoon tracking** — GDACS-sourced active storm tracks, forecast cones, wind radii rings, PAR boundary
- **Alerts feed** — GDACS active cyclones in PAR and current Philippines-relevant hazards
- **Forecast** — 7-day Open-Meteo per-region wind, rain, pressure
- **Live reports** — open crowdsourced incident submission with rate limiting, spam filtering, 72h TTL
- **News** — virtualized RSS aggregation from major Philippine outlets
- **Intel feeds** — JazBaz CCTV grid, PH news YouTube livestreams (cached, single API budget)
- **AGENT AERIS companion** — native in-panel AI chat proxy with compact dashboard context and optional VRM avatar
- **PWA offline** — service worker caches hazard tiles, last-known alerts, and queues reports when offline

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript 5 |
| 2D Map | MapLibre GL + CARTO vector basemap |
| 3D Terrain | Three.js + SRTM heightmap |
| Styling | Tailwind CSS (dark mode) |
| Edge Proxies | Vercel Edge Functions |
| Storage | Vercel KV (Redis) for incident reports |
| Offline | Service worker + IndexedDB queue |

## Data Sources (all free, no API keys required)

| Source | Purpose | Update Frequency |
|---|---|---|
| NASA GIBS WMTS | Himawari-9 satellite imagery | Near real-time |
| RainViewer | Animated radar (PAGASA included) | ~10 min |
| Open-Meteo | Wind/pressure/rainfall forecast | 1-6 hrs |
| GDACS | Typhoon tracks + disaster alerts | ~5 min |
| PAGASA | Daily weather / outside-PAR TC text (`/api/pagasa-daily`) | Daily |
| PAGASA TCB | Active in-PAR Tropical Cyclone Bulletin index + official PDF links (`/api/pagasa-bulletins`, via pagasa-parser) | 3–5 min during active TCs; 15 min otherwise |
| Project NOAH | Flood + landslide hazard rasters | Static |
| OpenStreetMap | Base tiles, roads, boundaries | Static |
| Philippine RSS | Google News (PH weather/disaster), Rappler, Inquirer, GMA, PhilStar | 10 min |

## Getting Started

### Prerequisites

- Node.js 18.17 or newer
- A Vercel account (free tier works) for edge functions and KV storage

### Install

```bash
npm install
cp .env.example .env.local
# (optional) populate KV_* vars for production reports; dev works with in-memory fallback
npm run dev
```

The app will be served at http://localhost:3000.

### Production build

```bash
npm run build
npm start
```

### Deploy to Vercel

1. Push to GitHub
2. Import the repo in Vercel
3. Provision Vercel KV from the Storage tab — environment variables auto-populate
4. Deploy — edge functions, PWA service worker, and Redis all wire up automatically

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the production checklist, health probe, rollback, and audit notes.

## Configuration

Environment variables are documented in `.env.example`. All are **optional** —
the app functions without any credentials; incident report storage falls back
to an in-memory map in development.

For AGENT AERIS chat, AI triage, and weather briefs, the dashboard proxies
every LLM call through the **AERIS CHAT** app. Set `AERIS_CHAT_API_BASE_URL`
to the deployed AERIS CHAT URL (e.g. `https://aeris-chat.vercel.app`) and
`AERIS_CHAT_API_KEY` to the same secret as `LLM_API_KEY` on the AERIS CHAT
project. The dashboard never calls NVIDIA directly.

See [`docs/AGENT_BACKEND.md`](docs/AGENT_BACKEND.md) for every call site and
the AERIS CHAT repo's `docs/AGENT_CONTRACT.md` for the frozen HTTP contract.
When changing `/api/llm/chat` on AERIS CHAT, both documents must be updated
and every call site listed in `AGENT_BACKEND.md` re-verified — there is no
shared package, the HTTP contract is the source of truth.

The VRM avatar loader looks for `public/models/aeris-companion.vrm`. If the
model is absent or fails to load, the companion keeps chat available and shows a
standby visual. Use only a free-license VRM model and document its source before
shipping a bundled asset.

## Project Structure

```
app/                      # Next.js App Router
  api/                    # Edge function proxies
    gibs/                 # NASA GIBS metadata
    rainviewer/           # RainViewer radar
    open-meteo/           # Forecast
    jtwc/                 # Typhoon tracks (via GDACS)
    alerts/               # GDACS cyclone + hazard feed
    pagasa-daily/         # PAGASA daily weather scrape
    pagasa-bulletins/     # PAGASA active TC bulletin index (via pagasa-parser)
    rss/                  # News aggregator
    reports/              # Incident reports CRUD
  layout.tsx              # Root layout + SW registration
  page.tsx                # Main terminal view
components/
  Map2D.tsx               # MapLibre GL (PH-locked)
  Map3D.tsx               # Three.js terrain
  MapContainer.tsx        # 2D/3D toggle
  LayerLegend.tsx         # Layer controls
  Sidebar.tsx             # Collapsible panel stack
  Header.tsx              # HUD with live clock
  panels/                 # Eight ops panels
services/
  hazard-layers.ts        # WMS overlay registration
  typhoon-tracks.ts       # Storm rendering
  satellite-frames.ts     # GIBS + RainViewer playback
  forecast.ts             # Open-Meteo client
  alerts.ts               # GDACS + PAGASA aggregator
  news.ts                 # RSS client
  reports-client.ts       # Incident reports client
  terrain-scene.ts        # Three.js scene + heightmap
  url-state.ts            # Shareable link encoder
  data-freshness.ts       # Per-source staleness tracking
  sw-register.ts          # Service worker bootstrap
lib/
  kv.ts                   # Vercel KV (with in-memory fallback)
  rate-limit.ts           # IP-based rate limiter
  sanitize.ts             # Text + URL sanitization
  circuit-breaker.ts      # API fault tolerance
  api-response.ts         # JSON response helpers
config/
  region.ts               # PH bbox + PAR polygon
  panels.ts               # Panel registry
  feeds.ts                # RSS source list
  lib/youtube-feed/       # YouTube poll, Supabase cache, channel constants
public/
  manifest.json           # PWA manifest
  sw.js                   # Service worker
  dem/                    # SRTM heightmap (add manually)
  hazards/                # Static hazard GeoJSON fallback
```

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `1`–`5` | Toggle sidebar panels (Typhoon, Satellite, Forecast, Alerts, News RSS) |
| `0`, `A`–`C` | Bottom Intel Feeds (collapse, Live Webcams, News Livestreams, Community Chat) |
| `\` | Collapse/expand sidebar |

## License Notes

Patterns adapted from [WorldMonitor](https://github.com/koala73/worldmonitor),
which is AGPL-3.0. If this project remains open source, AGPL is compatible.
If any portion needs to be closed-source, use WorldMonitor only as a
reference, not a direct code lift.

## Limitations and Caveats

- **PAGASA** has no public RSS/JSON API for severe-weather bulletins — the
  advertised Joomla `?format=feed` URLs return the full HTML homepage, and
  bulletins are published only as PDFs. Daily TC context comes from
  `/api/pagasa-daily` (HTML scrape); the active in-PAR Tropical Cyclone Bulletin
  index comes from `/api/pagasa-bulletins`, which reads the public-domain
  `pagasa-parser` JSON index (links point back to the official PAGASA PDFs).
  Both degrade gracefully to `null` (circuit-broken) if the upstream changes.
- **Project NOAH WMS** endpoints have had uptime issues historically. Drop
  static GeoJSON snapshots into `public/hazards/` as a fallback.
- **RainViewer** free tier has modest rate limits. Edge-cached for 5 minutes.
- **Open crowdsourced reports** attract spam. v1 uses IP rate limiting +
  text sanitization; add a moderation queue if abuse appears.
- **3D terrain** requires a pre-baked heightmap at `public/dem/ph-heightmap.png`
  (Mapbox Terrain-RGB format). See `public/dem/README.md` for bake instructions.

## Attribution

- **Project NOAH** / UP Resilience Institute — hazard layers
- **NASA GIBS** / Himawari-9 — satellite imagery
- **RainViewer** — radar
- **Open-Meteo** — forecast
- **GDACS** — alerts and typhoon tracks
- **PAGASA / DOST** — official advisories
- **OpenStreetMap** contributors — base map
- **three-vrm** — VRM loading/rendering for AGENT AERIS avatar
- Philippine news outlets — RSS feeds under fair use
