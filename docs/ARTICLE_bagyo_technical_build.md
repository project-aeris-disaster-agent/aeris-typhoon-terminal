# Building a Typhoon Terminal for the Philippines: Inside bagyo.app and dashboard.bagyo.app

*Subtitle: Two apps, one shared brain — how we turned a dozen scattered public data feeds into a live disaster-response stack.*

---

The Philippines gets around 20 tropical cyclones entering its area of responsibility every year. The data to understand them is public: satellite imagery, radar, forecast models, official bulletins, hazard maps. The problem was never data scarcity. It was that the data lives in a dozen places, in a dozen formats, and some of it is a PDF.

We built **bagyo.app** and **dashboard.bagyo.app** to fix that. Together they are one platform, A.E.R.I.S., with two faces:

- **bagyo.app** is the citizen side. It is phone-friendly, with live updates and community chat.
- **dashboard.bagyo.app** is the operator side. It is a desktop "typhoon terminal" for LGU and barangay coordinators.

Here is what's under the hood.

## The dashboard: a region-locked command terminal

The dashboard is a Next.js 15 (App Router) and TypeScript app. The map is MapLibre GL, locked to a Philippines bounding box so operators can't drift off-region. A Three.js 3D terrain mode sits on top for topography. The whole thing is client-rendered, and every data flow goes through a thin layer of API proxies.

That proxy layer is the interesting part. It has about 44 routes, and most of them exist to tame an upstream:

| Layer | Source |
|---|---|
| Satellite | NASA GIBS (Himawari-9) |
| Radar | RainViewer |
| Forecast | Open-Meteo |
| Storm tracks, cones, wind radii | GDACS and JMA |
| Official advisories | PAGASA bulletins and daily weather |
| Hazards | Project NOAH flood (5/25/100-year) and landslide layers |
| News | Philippine RSS and live-stream feeds |

Free public APIs go down, change shape, or return nothing. So every upstream sits behind caching and a **circuit breaker**. When a source fails, the panel degrades to "last known" and flags how stale the data is. It doesn't go blank. Per-source freshness tracking is a first-class feature, because in an emergency "this data is 40 minutes old" matters as much as the data.

PAGASA publishes its tropical cyclone bulletins only as PDFs, so we parse an index of them and proxy the official PDFs through the same origin. The terminal shows the authoritative document next to everything else.

## From a report to a record: the pipeline

Operators and citizens can file incident reports. Each report moves through a pipeline:

1. **Submit.** Reports are rate-limited and sanitized.
2. **AI triage.** An LLM classifies the report and flags urgent or SOS items. A deterministic floor stops a report author from steering the model into downgrading their own emergency.
3. **Operator review.** Verified or rejected by someone with the admin role.
4. **Community vote.** Votes feed an XP and reputation system.
5. **On-chain mint.** Verified reports become ERC-1155 tokens on SKALE, shaped like Hypercerts.

The on-chain step comes with a privacy rule. Immutable ledgers and the Philippine Data Privacy Act don't mix, so public metadata carries only coarse location (~111 m) plus **salted SHA-256 commitments** of the exact GPS, description, and photo. The salt stays server-side. Nothing sensitive is written anywhere you can't take it back. To be precise, this is a commitment scheme, not a zero-knowledge proof. A real ZK geofence circuit is on the roadmap, and we'd rather say so than oversell it.

## The shared brain

The two apps share a Supabase backend and a single AI service, **AERIS CHAT**. The dashboard never calls an LLM provider directly. Every AI feature (the in-panel AGENT AERIS companion with a VRM avatar and local TTS, triage, and auto-written weather briefs) goes through one HTTP contract. Swapping a model or provider is a one-place change, and the secret lives in exactly one repo.

For proactive alerts there's a "Watch Officer" agent built on Minds, which sends storm digests and urgent-triage alerts by email or Telegram.

## Engineering for the day it's actually needed

A few choices that matter more than they look:

- **Offline-first.** A service worker caches hazard tiles and last-known alerts, and an IndexedDB queue holds reports filed with no signal. Typhoons knock out connectivity, so the people who most need the app are the ones most likely to be offline.
- **Auth that survives.** Privy handles identity, Supabase Auth is the fallback, and four roles gate review and admin powers at the middleware layer.
- **Verification culture.** Strict TypeScript, around 80 test suites with 450+ tests, Playwright end-to-end, and an enforcing Content-Security-Policy that we tuned by running a production build in a browser. Two of the four CSP breakages we found only showed up that way. The policy looked fine on paper.
- **A self-audit.** We ran a full platform audit, found 15 issues including role impersonation and anon-key data exposure, and closed 14 of them the same day. We publish our own red flags internally. We recommend it.

## Real-world use cases

- **Barangay and LGU command rooms.** Replace five browser tabs with one screen: where the storm is, what its wind radii cover, which flood zone your barangay sits in, and what PAGASA just said.
- **Pre-emptive evacuation decisions.** Overlay a storm's forecast cone and wind field on 100-year flood and landslide susceptibility to see which communities need to move first.
- **Verified ground truth.** A flooded road photo from a resident becomes a triaged, operator-verified, community-validated record. It's far more useful than a viral post.
- **Citizen information on a phone.** Anyone can get live updates and community chat on bagyo.app without needing to read a PDF bulletin.
- **Volunteers and responders.** Role-based AI partners give volunteers, responders, and LGU staff persistent, context-aware assistance.
- **Post-event accountability.** Immutable, privacy-preserving records of what was reported and verified give auditors, NGOs, and funders something to trust.
- **Education and media.** The same live context helps teachers, journalists, and researchers explain a storm accurately.

## The optimistic scenario

Imagine the next five seasons go well.

**Year 1.** A few dozen LGUs adopt the dashboard as their situational-awareness layer. It's free to the public and sold as an SLA-backed operations tier to municipalities and provinces. The reliable email and SMS alert path replaces ad-hoc messaging.

**Year 2.** bagyo.app becomes the default "is it safe?" app for storm season. Neighbourhood-level alerts and verified reports make it sticky between storms too. Utilities, telcos, insurers, and logistics firms pay for an API and a data feed built on a verified, structured incident layer that doesn't exist elsewhere.

**Year 3.** Verified on-chain reports become **parametric-insurance triggers** and disaster-fund evidence. Funders release money against attestations that are tamper-evident but don't expose anyone's home location. Reporters earn reputation, and sometimes rewards, for being accurate.

**Years 4–5.** The architecture was built chain-agnostic and region-parametric (`config/region.ts`). It extends to Vietnam, Indonesia, and the Pacific islands. Each new region reuses the proxy layer, triage pipeline, and role model. Only the bounding box, official sources, and hazard packs change.

The business model is a mix of three revenue lines:

1. **B2G SaaS** for LGUs and national agencies.
2. **B2B data and API** for insurers, utilities, supply chains, and media.
3. **Impact finance**, where verified-report attestations unlock donor and parametric payouts.

The measurable impact is the real prize. Earlier evacuation lead times, fewer people crossing flooded roads, faster aid routing to the barangays that need it, and a durable record of what happened. If A.E.R.I.S. shaves hours off decision time for even a fraction of the typhoons that hit the country each year, the value is counted in lives and livelihoods, not page views.

## What's next

Shared, global rate limiting. Delivery guarantees for emergency alerts. Lazy-loading the heavier auth bundle so the first screen loads faster on weak connections. A true ZK geofence proof.

None of the data in this stack is secret. The product is making it legible, trustworthy, and usable at 2 a.m. when a storm is making landfall.

*If you work in disaster response, civic tech, or climate resilience in the Philippines and want to try the dashboard, get in touch.*

---

*Tags: Disaster Response, Civic Tech, Next.js, Climate Resilience, Philippines*
