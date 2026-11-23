# AERIS Dashboard Audit — code and functionality (2026-11-20)

Scope: the whole repo at `master` (2439af8) plus uncommitted WebGL work. It covers about 45k lines of TypeScript in 45 API routes, 63 components, 162 lib files and 43 services.

Method:
- Ran typecheck, lint, Jest, a production build and `npm audit`.
- Loaded the production build (`prod-authless`) in a browser at desktop and phone width.
- Four parallel code reviews: map/visualization, API/server, UI/panels, and reports/agent/on-chain.
- Re-checked every high-severity item against the code, and several in the running app.

It follows [PLATFORM_AUDIT_2026-08.md](PLATFORM_AUDIT_2026-08.md), which was security-focused. That audit's status is tracked in §7. This one is about **bugs, optimization, redundancy and over-engineering**.

Each finding is tagged with how it was confirmed:
- **[observed]**: reproduced in the running app.
- **[verified]**: checked by reading the code myself.
- **[reported]**: from a code reviewer, cited to file:line, not re-run by me.

---

## 1. Health snapshot

| Check | Result |
|---|---|
| `tsc --noEmit` | ✅ clean |
| `next lint` | ⚠️ 3 `exhaustive-deps` warnings (CommunityChatRoom:383, LocationInfoPanel:398, VirtualList:139). `next lint` is deprecated in Next 16. |
| Jest | ✅ 86 suites / 508 tests pass (28 s) |
| `next build` | ✅ passes. Warnings come from Privy's optional deps (`@stripe/crypto`, `@farcaster/mini-app-solana`), viem/ox, and `svix` in the Edge runtime. |
| `npm audit` | ❌ **72 vulnerabilities: 2 critical, 30 high.** The critical ones are in `next ≤15.5.28` (fix needs no major upgrade) and `maplibre-gl ≤6.4.0` (fix needs v6, a major). CI gates on this, so CI is red. |
| First Load JS, `/` | 617 kB (gzip). `/login` is 772 kB. Middleware is 168 kB. |
| **Bytes on first desktop load** | **~38 MB in 131 requests**, of which 32 MB is flood-hazard GeoJSON. JS heap is 125 MB right after load. |
| Phone first load | About 10–18 s on the boot screen with a fast local server, then the map. The ad banner is clipped at 375 px. |
| Console on load | 400 from `/api/youtube-feed` (self-inflicted, see B8), 502 from `/api/pagasa-water-levels` (upstream), and a Privy CSP frame-ancestors error (only on local port 3003). |

---

## 2. Bugs — fix first

| # | Sev | Finding | Evidence | Fix | Effort |
|---|---|---|---|---|---|
| B1 | 🔴 | **On-chain minting can loop forever.** The `minting` transition doesn't write metadata, so `attempts` never increments (it stays 0). Each failure goes back to `queued`, and the pg_net trigger fires on every update to `queued`. With the webhook configured, any lasting failure (RPC down, no MINTER_ROLE, no gas) becomes a pg_net → Vercel → RPC loop for each report. The tests mock `attemptCountFor`, so they miss it. | [verified] `lib/onchain/mint-queue.ts:292`, `services/onchain-mint-worker.ts:238,335-337`, `supabase/migrations/20260528030000_mint_webhook_trigger.sql:80` | Increment `attempts` on `minting`. Claim rows with a conditional PATCH (`queued→minting`). Add backoff with `next_attempt_at`, and a reaper for rows stuck in `minting`. | S |
| B2 | 🔴 | **A report can be lost after the user sees "saved".** If the Supabase insert throws, `catch {}` falls through to KV. KV isn't provisioned, so the report goes into one instance's memory and the client still gets **201**. GET reads only Supabase, so operators never see it. For SOS reports this is silent data loss. | [verified] `app/api/reports/route.ts:185-209`, `lib/kv.ts:19` | In production, return 503 when the insert fails. Have `sw.js` queue on 5xx, not only on a network error. | S |
| B3 | 🟠 | **Server reads try the anon key first.** `listSupabaseReports` tries `[anonKey, serviceKey]` and stops at the first `res.ok`. Under service-only RLS, PostgREST returns `200 []`, so the feed goes empty. Local reads return data today, which means either the RLS migration isn't live in that DB or anon still has a grant. Check prod. `listAgentMessages` has the same problem and **no per-user filter**, so moving it to the service key would show everyone's chats to everyone. | [verified] `lib/supabase-reports.ts:225-245`, `lib/supabase-agent.ts:91` | Reports: service key only. Agent messages: add `user_id`/session scoping first. | S / M |
| B4 | 🟠 | **Switching theme wipes the map overlays.** `setStyle(url)` diffs by default and never fires `style.load`, so the re-attach callback never runs. After switching to dark: the report pings, PAR, hillshade, flood and radar slot A are gone. Switching back keeps the dark sprite. | [observed] `components/Map2D.tsx:109-112` | Quick fix: `setStyle(url, {diff:false})`. Better: `setStyle(url, {transformStyle})`, which carries Aeris sources and layers across and lets you delete `map-style-reattach.ts` and five `reattach*` helpers. | S / M |
| B5 | 🟠 | **`whenStyleReady` drops work and leaks listeners.** `isStyleLoaded()` is false whenever tiles are loading, so it waits for a `style.load` that never comes. 83→109 pending listeners were measured. Radar/satellite layer switches can silently do nothing. | [reported] `config/map-layers.ts:55`, `satellite-frames.ts:875,1015` | Use an explicit "style swap in flight" flag. | S |
| B6 | 🟠 | **Number hotkeys swallow digits in every text field.** Typing "3" in the map search box toggled a panel and the digit never appeared. This affects search, chat, report forms and phone numbers. | [observed] `Sidebar.tsx:90-101`, `LiveWeatherMapPanel.tsx:33-41`, `BottomPanel.tsx:81-88`, `LiveWebcamsPanel.tsx:308` | A shared `useHotkey` with the input guard that `Header.tsx:103` already has. | XS |
| B7 | 🟠 | **Agent AERIS never gets nearby facilities.** `agent-context` fetches its own `/api/osm-context` with no cookies, middleware returns 401, and `if (!res.ok) return undefined` hides it. This affects the chat context and the Minds snapshot. | [verified] `lib/agent-context.ts:330-357`, `lib/middleware-paths.ts:18-22` | Move the Overpass logic into `lib/osm-context.ts` and call it directly. | S–M |
| B8 | 🟡 | **The boot preflight probes `/api/youtube-feed` without `?channels=`.** It always gets a 400, so "Live feeds" always shows a warning. The same preflight downloads and parses all of `ncr.json` (4 MB) just to check it's reachable. | [observed] `lib/preflight-checks.ts:160-178` | Pass the channel list, use HEAD for static probes. | XS |
| B9 | 🟡 | **The hidden mobile Sidebar can clear typhoon focus.** Its TyphoonTrackerPanel has `focusedId=null` and emits `TYPHOON_FOCUS_EVENT{storm:null}` on every poll. | [reported] `TyphoonTrackerPanel.tsx:186-195`, `app/page.tsx:233,239` | Fixed by mounting only one Sidebar (R3). | — |
| B10 | 🟡 | **Flood automation doesn't recompute when the location changes.** `useVisiblePolling` keeps the callback in a ref, so a new `refresh` isn't called until the next 5-minute tick. | [verified] `FloodAutomationProvider.tsx:77-121` | `useEffect(() => { void refresh() }, [refresh])` | XS |
| B11 | 🟡 | **Address search tilts the 2D map** to pitch 62 / bearing −18, and rotation controls are hidden in 2D. | [reported] `page.tsx:101` → `map-scene.ts:1267` | Only call `focusAddress3DContext` in 3D. | XS |
| B12 | 🟡 | **Offline can show the typhoon tracker as "clear".** The SW returns a fake `200 {offline:true}` and the typhoon/alerts clients treat it as an empty, fresh result. | [reported] `sw.js:221`, `typhoon-tracks.ts:196`, `alerts.ts:49` | Have the SW return 503. | XS |
| B13 | 🟡 | **Triage has no timeout and calls the LLM twice.** A hung upstream outlives `maxDuration=10`, and a whole classification runs just to compute a dedupe hash. | [reported] `services/ai-triage.ts:193`, `services/triage-runner.ts:122-127` | AbortSignal timeout; call `computeDedupeHash` directly. | XS |
| B14 | 🟡 | **Agent chat can be killed before its own timeout.** `maxDuration=60` and the upstream timeout is also 60 s, starting after context-building (8 s or more). | [reported] `app/api/agent-aeris/chat/route.ts:16,160` | Budget = `maxDuration − elapsed − 5 s`. | XS |
| B15 | 🟡 | **Storm-watch on login is fire-and-forget and bypasses the cache.** Vercel can freeze it after the response, and every login triggers an uncached PAGASA fetch. | [reported] `app/api/user/sync/route.ts:~42`, `storm-watch-runner.ts:45-57` | `after()` from `next/server`; check `last_polled_at` before fetching. | S |
| B16 | 🟡 | **The UI contradicts itself on typhoons.** The Typhoon Tracker shows NANGKA "approaching PAR" while the Alerts Feed in the same sidebar says "No active cyclones or GDACS hazards". They use different sources (JMA/JTWC vs GDACS). | [observed] | The Alerts empty state should defer to the tracker ("1 storm being monitored outside PAR"), or alerts should include the tracker's storms. | S |

---

## 3. Optimization — biggest wins

### 3.1 Payload and load time

| # | Finding | Evidence | Fix | Effort |
|---|---|---|---|---|
| P1 | **32 MB of flood GeoJSON loads at national zoom.** All 9 packs share the "5yr" period, so "lazy by period" means everything. They are parsed on the main thread (Camarines Sur alone is 9 MB), held in a JS cache, sent again to the MapLibre worker, and triangulated again in 3D on every 2D↔3D toggle. Flood turns on automatically when rain is forecast, and phones download it too. | [observed] network: 9 packs on first load. `services/hazard-layers.ts:187,537`, `three-scene.ts:1053`, `LayerLegend.tsx:165` | **Convert to PMTiles/MVT with tippecanoe** (one static file, the `pmtiles://` protocol, only visible tiles load). Interim: load packs whose manifest `bbox` overlaps the viewport, and skip the 3D rebuild when features haven't changed. | M–L |
| P2 | **Privy + WalletConnect + viem load on every route.** About 2.1 MB raw / 640 kB gzip, because `PrivyProviders` wraps the root layout, but only `/login`, `/refresh` and sign-out use Privy. The Privy SDK also starts a session and telemetry (Datadog, analytics) on every dashboard load. | [verified] `app/layout.tsx:6,58`; chunk `1573` (Privy) is in the `/` page manifest | Move the provider into an `(auth)` route-group layout. Sign out on the server and dynamic-import `logout` on click. | M |
| P3 | **Closed panels still mount and fetch.** `PanelWrapper` hides with CSS, so the closed Forecast panel fires **17 `/api/open-meteo` requests** on every load and the closed News panel polls RSS alongside the ticker. This also cancels the `dynamic()` splitting in Sidebar. | [observed] 17 open-meteo calls; `Sidebar.tsx:353-363`, `ForecastPanel.tsx:26-45` | Mount on first open, then keep mounted. Batch the forecast into **one** Open-Meteo call (it accepts comma-separated lat/lon lists). | S |
| P4 | **2D startup downloads 3D scene data.** The nearest preset to the default center is Naga, so `naga.json` (2.3 MB) is fetched in 2D. `moveend` runs a facility `setData` on every pan in 2D. | [observed] `naga.json` in the 2D waterfall; `map-scene.ts:930,951` | Load scene context on first 3D entry, and gate `moveend` on terrain being on. | S |
| P5 | **Agent avatar and voice are heavy.** The VRM is **16 MB** uncompressed. Piper TTS warms up as soon as Live Updates opens, even muted, pulling a Hugging Face voice model (medium voices are tens of MB) and ONNX WASM from jsdelivr. | [verified] `public/models/aeris-companion.vrm` 16.3 MB; [reported] `useAgentSpeech.ts:37-48` | Default to Web Speech and load Piper on the first unmuted speak. Show a poster image until the user clicks. Compress with `gltf-transform` (meshopt + KTX2) to about 3–5 MB. | S–M |
| P6 | **Static assets are served poorly.** `/hazards/` cache rules (SW + `vercel.json`) point at a folder that only holds a README, so the real `/flood-hazard/` packs get no long-lived caching. `AERIS_char.svg` is 690 KB (an embedded raster). The 750 KB ad GIF loads on every visit. | [verified] `public/sw.js:91`, `vercel.json:30`, `ls public/hazards` | Fix the paths. Convert the SVG to WebP/AVIF. Serve the ad as MP4/WebM or a static image. | XS–S |

### 3.2 Runtime and network chatter

| # | Finding | Evidence | Fix | Effort |
|---|---|---|---|---|
| P7 | **Sidebar and MapTopChrome are mounted twice** (mobile and desktop copies, hidden by CSS). On desktop the hidden copy polls reports, alerts and typhoons too. There are two search inputs in the DOM. | [observed] 2 `<aside>`, 2 search inputs; `app/page.tsx:154,212,233,239` | Render one, chosen by a `useMediaQuery` hook. | S |
| P8 | **No shared fetch layer.** On boot: `/api/jtwc` ×4, `/api/alerts` ×3, `/api/pagasa-bulletins` ×2, `/api/reports` ×2. About 10 components repeat the same useState/loading/error/polling code. | [observed] network log; UI review polling table | One `useSharedQuery(key, fetcher, {intervalMs, staleMs})` with in-flight dedupe, or adopt SWR (~4 kB). | M |
| P9 | **Map data is re-sent on every `styledata` event.** That includes every paint change from the ping pulse (12–30 fps) and radar crossfades, each time calling `setData` on ~1,075 report features plus webcams. | [reported] `ReportPingsSync.tsx:81`, `WebcamPingsSync.tsx:39` | Rehydrate only when `!map.getSource(id)`. Once B4 uses `transformStyle`, the listener can go. | S |
| P10 | **Every return to the tab fires about 13 requests**, even after a 2-second switch away. | [reported] `useVisiblePolling.ts:55-60`, `YouTubeFeedsProvider.tsx:99` | Refire only if the last run is older than the interval. | XS |
| P11 | **The radar ticker runs `requestAnimationFrame` at 60 Hz through multi-second holds.** It polls every 60 s, but the endpoint caches for 300 s. | [reported] `live-weather-overlay.ts:601-699` | `setTimeout` for holds, rAF only during crossfades, poll at 5 minutes. | S |
| P12 | **`MapContainer` memo has no effect**, because the inline `mapOverlay` JSX re-renders the map chrome on every page state change. `ReportCard` isn't memoized either, so up to 300 cards re-render on each 30-second poll. | [reported] `page.tsx:162`, `LiveReportsPanel.tsx:376-631` | `useMemo` the overlay; `React.memo(ReportCard)` with stable callbacks. | S |

### 3.3 Server

| # | Finding | Fix | Effort |
|---|---|---|---|
| P13 | `/api/rss` is `force-dynamic` + `no-store`, so every poll refetches all 6 upstream feeds, which risks Google News blocking the server. | `revalidate: 300` on the fetches, plus CDN cache headers. | XS |
| P14 | The middleware role lookup hits Supabase with `no-store` on **every request** (prior audit item 5.1, still open). | Cache the role in a signed cookie or a short-TTL memo. | S |
| P15 | The in-memory KV fallback has no size limit. Geocode writes a key per keystroke (24 h), open-meteo keys use 4 decimals, and osm-context stores large payloads twice. | LRU cap of about 1,000; round coordinates to 2 decimals in the cache key **and** the upstream URL. | S |
| P16 | `osm-context` has no limit on bbox area, keys its cache at 3 decimals (almost never hits), and tries 3 mirrors one after another at 20 s each with no `maxDuration`. | Cap area by zoom, snap to a tile grid, race the mirrors or use a 10 s budget. | M |
| P17 | YouTube `search.list` costs 100 units per call: 4 channels × 144 refreshes a day ≈ 57,600 units against a 10,000/day quota, so quota runs out by mid-morning and it falls back to scraping. `/api/youtube-feed` also accepts **any** channel list from the client. | Drop `search.list` (use the `/@handle/live` scrape plus `videos.list`, 1 unit). Accept only `MONITORED_YOUTUBE_HANDLES`. | M |
| P18 | N+1 queries in the email cycles: one dedupe query and one insert per recipient. | One `in.(…)` query plus one bulk insert with `on_conflict`. | S |
| P19 | The service worker caches **every** `/api` GET, including per-user ones (profile, role, votes, chat). These survive sign-out on shared devices. Geocode, open-meteo and osm-context keys grow without limit. Radar tiles hit the image rule first and pile up. Cross-origin assets (the HF voice model, YouTube thumbnails) also land in the shell cache. | Allow-list public feeds only, cap entries, clear on sign-out, keep the shell cache to same-origin `/_next/static/`. | S |
| P20 | `skipWaiting()` plus reload-on-`controllerchange` means every SW deploy **reloads every open dashboard mid-session**, losing half-typed reports. `aeris:update-available` is dispatched but nothing listens for it. | "Update available" toast; skipWaiting only when the user accepts. | S |

---

## 4. Redundancies

| Area | Duplication | Consolidate into |
|---|---|---|
| Client data fetching | ~10 components with their own fetch, loading, error and polling code, plus a private `useAsyncResource` in LocationInfoPanel | `useSharedQuery` or SWR (P8) |
| Layout | Sidebar ×2, MapTopChrome ×2 (P7) | One tree with a media query |
| LLM client | The AERIS CHAT `/api/llm/chat` call is written 3 times (agent chat, triage, weather reports), with different env fallbacks, response parsing (`content??message` vs `message\|\|content\|\|response`) and timeouts | `lib/aeris-chat-client.ts` |
| Upstream fetching | 4 approaches: `withBreaker` (races without aborting, so sockets leak), `fetchUpstream` (aborts), inline `AbortSignal.timeout`, and none at all (rainviewer tiles, pagasa PDF, gdacs-rss, pagasa-daily, most of youtube poll) | One `fetchUpstream(url, {timeoutMs, revalidate})` |
| Cache headers | Routes export `revalidate=300` but return `no-store` (alerts, pagasa-daily). `next.config.js:118-137` repeats rainviewer headers with different values from the route. | One rule set, in the routes |
| Runtimes | 4 routes on edge, the rest on nodejs, with no clear reason | nodejs everywhere unless a route needs edge |
| Cron | `cron/daily` re-implements triage and mint logic from `cron/triage` and `cron/onchain-mint`. `cron/weather-reports` skips the emails that daily sends. Only `/api/cron/daily` is scheduled. | `services/cron-jobs.ts`, called by daily; delete or thin the per-job routes |
| Supabase config | `supabase-reports.ts:208` and `supabase-agent.ts:59` still build their own configs, even though `lib/supabase-rest.ts` says it is the single source | `supabase-rest` |
| Recipients query | `lib/storm-watch/recipients.ts:18` ≈ `lib/aeris-report-email.ts:37` | One helper |
| Helpers | 4 "time ago" formatters, 3 haversines, XP values copied by hand between `ProfilePanel.tsx:24` and the profile route | `lib/format.ts`, `lib/geo.ts`, shared XP constants |
| Mobile gate | `MobileAccessGate` reimplements `shouldBlockMobileDashboardAccess` inline, so the tested helper never runs in the app | Call the helper |
| Schema | `reporter_user_id` index is defined twice. Chat nicknames and profile usernames are separate namespaces, so another user's username can be taken as a chat name. | Drop one index; derive the chat name from the profile |

---

## 5. Over-engineering — cut, simplify or freeze

For an LGU and barangay coordination tool, the core value is: map + hazards + typhoon tracking + alerts + reliable incident reports. Several subsystems cost more than they return.

| Subsystem | Wired? | Recommendation |
|---|---|---|
| **On-chain minting** (queue + pg_net webhook + worker + bulk button + cron, with viem/Privy/WalletConnect in the bundle) | Partial: inert unless contract and key are set; has bugs B1 and B5; mint rules contradict each other (phone-verification gate on one path only; every insert hardcodes `base-mainnet`/8453, which overrides the SKALE default) | **Freeze or cut.** If kept: one sweep path with a proper claim. Delete the webhook trigger. Load wallet code only on the routes that use it. |
| **Email through an LLM** (Minds is asked to "send one email per recipient") | Partial: off by default; `sent:true` only means the chat message was posted | **Replace** with a transactional provider (Resend/SES). Keep Minds for narrative text only. This is still open from the prior audit (R3). |
| Minds user partner | No: `lib/minds-user-partner.ts` (114 lines plus a test) has no imports | **Delete** (and its documented env vars) |
| ZK | Doc only | Keep as a roadmap doc |
| Circuit breaker | Per-instance on serverless, so it rarely trips. It also doesn't abort the fetch. | **Delete**; rely on timeouts plus stale cache |
| Style re-attach machinery | `map-style-reattach.ts`, 5 `reattach*AfterStyleChange` functions, and generation tracking in Map2D, all of which fail anyway (B4) | Replace with `setStyle(..., {transformStyle})` |
| Flood visuals | Halo and pattern layers are always hidden (18 invisible layers plus a noise texture). Pulse animation is always off. The debounce can never trigger. `setFloodHazardOpacity` has no callers. Terrain exaggeration is set to 1.35 then overridden to 0.9. | **Delete the dead paths** |
| Agent avatar | 16 MB VRM + three-vrm + in-browser Piper TTS | Keep, but make it opt-in (P5) |
| YouTube feed | 1,151-line `poll.ts` with a legacy cache table, a two-level cache and a duplicate `pollYoutubeChannels` | Simplify (P17); remove about 300 lines |
| Schema-fallback column sets | Up to 3 extra round-trips per read for an old schema (prior audit item 5.4) | Delete once the baseline migration is confirmed in prod |

### Dead code (grep-verified, no callers)

- **Routes:** `/api/gibs`, `/api/pagasa-daily` (the lib is called directly), `/api/agent-aeris/weather-reports`, `/api/agent-aeris/weather-report/generate` (also unreachable, because middleware 401s before its secret check runs).
- **Functions:** `getLatestNationalReport`, `listSupabaseReportsByAnonymousId`, `SCENE_LAYERS`, `DEFAULT_3D_PRESET`, `DEFAULT_HAZARD_OPACITY`, `formatReturnPeriodLabel`, `BASEMAP_*_ID`.
- **Other:** the `aeris_leaderboard` view (no code reads it), the duplicate `handle.dispose()` in `three-scene.ts:1515`, and unreachable auth branches in `agent/reply:59` and the `ai_agent`/`system` review path.
- **Not scheduled:** `/api/cron/{storm-watch,triage,weather-reports,youtube-feed,onchain-mint}`. They can only be run by hand.

---

## 6. Repo and build hygiene

- **The git pack is 332 MB.** `public/` holds source data that isn't used at runtime: `public/dem/heightmap` (4.6 MB), `ph-heightmap.png` (1.1 MB), and the `.py` generators in `public/dem/` and `public/make_icons.py`. Those are also served publicly. Move them to `scripts/` or object storage.
- **Untracked clutter in the root:** `ads_v1_2026.gif` (differs from `public/ads/`), the OCHA `.docx`, `generate_water_noise.py`, `coverage/`, `tsconfig.tsbuildinfo`. Either commit them deliberately or move them out.
- **README is out of date.** It says reports are stored in Vercel KV and "Node 18.17", but storage is Supabase and the engine is 22.x. It also doesn't mention Privy, Supabase or Minds.
- **Tests:** 17 of 45 routes have tests. The e2e suite is 2 smoke tests and never exercises the map, report submission or panels. The mint tests mock away the bug in B1.
- **Lint:** `next lint` is removed in Next 16. Migrate with `npx @next/codemod@canary next-lint-to-eslint-cli .`, and fix the 3 hook warnings. One of them, `LocationInfoPanel:398`, defeats a `useMemo`.
- **Error leakage:** raw upstream and Supabase error text is returned to clients (`review:131`, `alerts:13`, `rainviewer:28`, geocode, open-meteo). The public `/api/health` lists missing env var names.

---

## 7. Status of the August 2026 audit items

| Item | Status |
|---|---|
| R1 agent/reply authorization, R4 offline queue, R5 HTTP Overpass, R6 triage floor, R8 coverage, R10 timing-safe comparison, R12 geocode public, R14 auth-disabled in production, R15 actorId | ✅ Fixed |
| R2 anon reads | ✅ Migration written. Caused a regression (B3). Confirm it's applied in prod. |
| R13 suffix bypass | ✅ Fixed for `/api`. Page paths are still suffix-exempt. |
| R7 IP hashing | 🟡 Partial: hashing is fixed, but there is no retention/purge job |
| R11 CSP/HSTS | 🟡 Partial: CSP is still report-only. `webcam-pings.ts:273` puts `src` into HTML unescaped. |
| **R3 LLM as email transport** | ❌ Open |
| **R9 npm audit** | ❌ Open and **worse** (72 vulnerabilities, 2 critical) |
| 5.1 role lookup per request; 5.2 single daily cron; 5.3 route tests; 5.4 schema fallbacks; 5.6 retention | ❌ Open |

---

## 8. What's done well

- **Failure containment:** WebGL failures stay inside the map panel, and upstream failures fall back to stale caches.
- **Three.js is code-split:** type-only imports plus a dynamic import on first 3D entry, idle-time rebuilds, and hidden levels aren't built.
- **Imagery double buffer:** frames swap via `setTiles`, and the radar index fetch is shared.
- **Most polling already pauses on hidden tabs** (`useVisiblePolling`).
- **The security posture is much better than in August:** 11 of 15 red flags fixed, and the SW stale-HTML fix (2439af8) is correct.
- **Typecheck clean, 508 passing tests, lint in CI.**

---

## 9. Recommended plan

**Sprint 1: correctness (each fix is small; about 2–3 days in total)**
1. B1 mint loop. If you're not committed to on-chain minting, disable the webhook trigger now.
2. B2 lost reports, and B3 anon-key reads (check prod RLS/grants first).
3. B4 + B5 + P9 together: the map style lifecycle (`setStyle` with `transformStyle`).
4. B6 hotkeys, B8 preflight, B10 flood refresh, B11 tilt, B12 offline "clear", B16 contradictory typhoon messaging.
5. `npm i next@^15.5.29` (critical fix, no major upgrade). Plan the maplibre v6 upgrade separately.

**Sprint 2: load weight (biggest user-visible win, especially on phones and slow networks during a typhoon)**
1. P1 flood packs → PMTiles. This takes first load from 38 MB to probably under 3 MB.
2. P2 Privy out of the root layout (−640 kB gzip JS).
3. P3 + P7 mount-on-open and single Sidebar; batch the forecast into one call.
4. P4, P5, P6 asset and lazy-loading fixes.

**Sprint 3: consolidation**
1. P8 shared query layer, which also removes most per-panel boilerplate.
2. One upstream-fetch helper; delete the circuit breaker; consistent cache headers; one runtime.
3. One LLM client, one cron-jobs module, one Supabase config.
4. SW cleanup (P19, P20).
5. Delete the dead code in §5.

**Product decisions for you:** keep, freeze or cut on-chain minting and the Minds email path. Those two decisions settle most of the over-engineering in this audit.
