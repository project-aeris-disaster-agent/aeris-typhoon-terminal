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
- **Alerts feed** — GDACS tropical cyclone alerts and PAGASA advisory scraping
- **Forecast** — 7-day Open-Meteo per-region wind, rain, pressure
- **Live reports** — open crowdsourced incident submission with rate limiting, spam filtering, 72h TTL
- **News** — virtualized RSS aggregation from major Philippine outlets
- **Live cams** — embedded PAGASA, NDRRMC, MMDA, and news livestreams
- **PWA offline** — service worker caches hazard tiles, last-known alerts, and queues reports when offline

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript 5 |
| 2D Map | MapLibre GL + deck.gl |
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
| GDACS | Typhoon tracks + disaster alerts | Hourly |
| PAGASA | Official advisory text scrape | Per advisory |
| Project NOAH | Flood + landslide hazard rasters | Static |
| OpenStreetMap | Base tiles, roads, boundaries | Static |
| Philippine RSS | Rappler, Inquirer, ABS-CBN, GMA, PhilStar | 10 min |

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

## Configuration

Environment variables are documented in `.env.example`. All are **optional** —
the app functions without any credentials; incident report storage falls back
to an in-memory map in development.

## Project Structure

```
app/                      # Next.js App Router
  api/                    # Edge function proxies
    gibs/                 # NASA GIBS metadata
    rainviewer/           # RainViewer radar
    open-meteo/           # Forecast
    jtwc/                 # Typhoon tracks (via GDACS)
    gdacs/                # Disaster alerts
    pagasa/               # PAGASA scraper
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
  livecams.ts             # Livestream registry
public/
  manifest.json           # PWA manifest
  sw.js                   # Service worker
  dem/                    # SRTM heightmap (add manually)
  hazards/                # Static hazard GeoJSON fallback
```

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `1`–`8` | Toggle panels (Typhoon, Hazard, Satellite, Forecast, Alerts, Reports, News, LiveCam) |
| `\` | Collapse/expand sidebar |

## License Notes

Patterns adapted from [WorldMonitor](https://github.com/koala73/worldmonitor),
which is AGPL-3.0. If this project remains open source, AGPL is compatible.
If any portion needs to be closed-source, use WorldMonitor only as a
reference, not a direct code lift.

## Limitations and Caveats

- **PAGASA** has no public JSON API. The scraper is brittle against HTML
  changes — monitor the `/api/pagasa` endpoint after each visible PAGASA site
  redesign.
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
- Philippine news outlets — RSS feeds under fair use
