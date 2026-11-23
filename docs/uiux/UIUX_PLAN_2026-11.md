# AERIS dashboard: UI/UX plan, aligned to FLOOD CONTROL (2026-11-23)

**Goal:** the dashboard and the FLOOD CONTROL game should look like one product from bagyo.app. The dashboard takes on the game's day theme, which is the same theme the game's landing page and HUD share:
- frosted white glass cards with large radii and a soft navy shadow;
- heavy navy Nunito type, with small uppercase letter-spaced labels;
- pale segmented tracks with a white raised segment;
- rounded chips (when selected: a blue rim and a pale blue fill);
- blue gradient primary buttons;
- a green-dot status pill;
- a dark navy bar for time and playback controls.

**References**
- `E:\NPC\06 AERIS GAME\bagyogame\src\ui\theme\tokens.ts`: the source of truth for the colours.
- `src/ui/theme/hudTheme.ts`, `src/ui/landing/landingStyles.ts`: how each element is built.
- `docs/playtest/hudtheme/README.md`: contrast notes.
- `screenshots/screen0-2.png`: the landing page, the HUD in a calm state and the HUD during a storm.

Before: `before-desktop-light.jpg`. Flat terminal look: Inter and monospace type, 4–6 px radii, a sidebar docked to the edge with hairline borders, and +/− text toggles.

---

## 1. Where the dashboard stands

| Aspect | Dashboard today | Game (target) |
|---|---|---|
| Type | Inter 400–600, plus 111 `font-mono` uses for labels and numbers | Nunito 600–900. Labels: 10 px / 900 / 0.14em / uppercase. Numbers: tabular figures. |
| Colour | `aeris-*` tokens in 1,004 places (good), cyan/teal accent | Navy ink `#0f2a47`, blue `#1f6fd1`/`#3aa2ff`, green `#149a63`, warm `#f08a1c`, red `#d93f45` |
| Surfaces | `panel-glass`: 1 px border, `shadow-sm`, radius 6–8 | Gradient white glass, white rim, `0 10px 28px` navy shadow, radius 18 (panels) / 28 (hero card) |
| Controls | Bordered rectangles, text "+/−", mono uppercase toggles | Segmented track, chips, round white buttons, gradient call-to-action, `sh-key` hotkey caps |
| Status | Red pulsing "live" dot, flat pills | Pale-blue pill with blue text and a blinking green dot |
| Dark mode | Near-black with neon cyan | The game has no night HUD. Use its **storm navy** (`#0b1f3a` / `#10294a` / `#163a63`) from the trailer's storm scenes. |
| Motion | Scanline, aurora, wipes | Card rise on entry (`lp-rise`), blinking live dot, gentle hover lift. Reduced motion is respected. |

**Leverage:** about 95% of colour already goes through `aeris-*` tokens, and most radii use a few Tailwind steps. So changing the token values, the radius scale and the fonts reskins most of the app, and only the shell components need structural work.

---

## 2. Plan

### Phase 1: foundation (tokens, type, primitives)
1. **Tokens** (`app/globals.css`, `tailwind.config.ts`)
   - Change the `aeris-*` values to the game palette (light = day theme, dark = storm navy).
   - New tokens: `ink2`, `accent2`, `track`, `navy`, `kicker`, `chip-on`, `gold`.
   - Surface tokens for the card fill, rim, panel/pill/pop shadows and the call-to-action gradients.
   - **Accessibility deviation from the game:** muted text is `#5d7189`, about 4.9:1 on white, where the game's `#6b7f96` is 4.1:1. Warn text is `#b45309`, not `#d0700c`. The dashboard is a public-safety tool, so it meets WCAG AA throughout.
2. **Type:**
   - Nunito (400/600/700/800/900) via `next/font` replaces Inter. Body weight is 600, as in the game.
   - `font-mono` maps to Nunito with tabular numbers, so the 111 terminal-style labels become the game's label style without editing each file.
3. **Radius scale:** `rounded` 8, `md` 10, `lg` 14, `xl` 18, `2xl` 24, `3xl` 28.
4. **Shared classes:** `.panel-glass` (game panel), `.aeris-label` (game label), `.aeris-kicker` + `.aeris-live-dot`, `.aeris-seg` / `.aeris-seg-btn`, `.aeris-chip`, `.aeris-btn-cta` / `-warm` / `-ghost` / `-soft`, `.aeris-round`, `.aeris-key`, `.aeris-navy-bar`.
5. **React primitives** (`components/ui/`): `Card`/`CardHeader`/`Pill` restyled (pill tones = the game's chip tones); new `Kicker`, `SectionLabel`, `Segmented`, `HotkeyCap`.

### Phase 2: shell and map chrome
1. **Header → floating pill clusters,** as in the game's status bar:
   - a brand pill (emblem + wordmark);
   - a LIVE status pill with a green dot;
   - a clock;
   - the ticker;
   - round white buttons for theme and profile, and a red-toned Reports button.
2. **Ops sidebar → floating card stack** on a pale sky background:
   - each panel is an 18 px glass card;
   - the header is an icon + uppercase heavy title + hotkey cap + chevron (no more "+/−");
   - the collapsed rail becomes the game's left rail (icon, label, hotkey caps).
3. **Map left column** (Live weather / View mode / Quick views / Layers):
   - glass cards;
   - view mode → segmented control;
   - quick views → chips;
   - section titles → game labels.
4. **Search** → a white pill input with the pill shadow. **Open Chat** → a round pill button.
5. **Bottom "Live Updates" bar** → the game's navy bar.
6. **MapLibre controls** (zoom, attribution) → round white pills. A navy vignette frames the map edges in light mode.
7. **Popups / facility card** → the game's map popover: a white card with a 14 px radius and the stronger popover shadow.
8. **Boot screen** → the game's loading screen: a sky gradient, Nunito, the brand mark, and the track/fill loading bar.
9. **Mobile tab bar** → a floating white pill dock (the game's `sh-dock`).

### Phase 3: UX fixes that come with the reskin (each is small)
- **Hotkeys ignore typing:** the 1–5/0 panel hotkeys currently swallow digits in the search box and forms (audit B6). The new `HotkeyCap` shows the keys, so they must stop eating input.
- **Alerts empty state:** "No active cyclones" no longer contradicts the Typhoon Tracker. When the tracker is monitoring a storm, the empty state says so (audit B16).
- **One focus ring for every control:** 2 px blue outline with a 2 px offset, keyboard only.
- **Reduced motion:** the ticker marquee, card rise and live-dot blink stop under `prefers-reduced-motion`.

### Phase 4: follow-ups (not in this pass)
- **One Sidebar / MapTopChrome tree** instead of CSS-hidden duplicates (audit P7). This changes layout behaviour, so it needs its own testing.
- **Panel content:**
  - LiveReportsPanel: a 1,595-line file;
  - LocationInfoPanel;
  - Typhoon cards with the game's warm "Storm of the Day" card for monitored storms;
  - incident-style left-border cards for reports.
- **Toasts** in the game's style for new SOS reports.
- **Brand assets:** the bagyo emblem as a CSS mask, as the game does, so it can take on either theme colour.

---

## 3. What's left alone
- **The map itself:** basemap styles, hazard colours, radar and satellite imagery are data, not chrome. That matches the game's rule that "WebGL markers are world art, not HUD".
- **Agent AERIS avatar, webcams and livestream content.**
- **Layout breakpoints and panel positions:** Phases 1–3 restyle only. Phase 4 is where layout changes.

## 4. Status (2026-11-23)

| Phase | Item | State |
|---|---|---|
| 1 | Tokens (light day / dark storm navy), Nunito, radius scale, kit classes, `components/ui/Kit.tsx`, Card/Pill tones | ✅ Done |
| 2 | Header pill clusters | ✅ Done |
| 2 | Ops sidebar cards, collapsed rail with hotkey caps | ✅ Done |
| 2 | Map column: segmented view mode, quick-view chips, layer toggles, live-weather header | ✅ Done |
| 2 | Search pill, ad banner, Open Chat, MapLibre controls, attribution, vignette | ✅ Done |
| 2 | Navy "Live updates" bar, mobile dock, boot screen, facility popup | ✅ Done |
| 3 | Hotkeys ignore typing (`lib/hotkeys.ts` + test; the audit session wired it into every handler) | ✅ Done |
| 3 | Focus ring, reduced motion (ticker, rise, live dot, wave) | ✅ Done |
| 3 | Phone ad banner no longer cropped; map attribution no longer leaks onto the Reports tab | ✅ Done (found during verification) |
| 3 | Alerts empty state that agrees with the tracker (B16) | ✅ Done (logic by the audit session; styled as a warm card here) |
| 4 | Panel kit: white rows, incident cards, warm cards, stat tiles, bars (`.aeris-row/-incident/-warm-card/-stat/-bar`). Global rule turns the old mono uppercase labels into the game's spaced caps. | ✅ Done |
| 4 | Typhoon Tracker: storms as warm cards, outside-PAR monitors as incident rows, bulletins as white rows | ✅ Done |
| 4 | Alerts Feed + AlertCard as incident cards (also fixed the card printing its title twice when there was no summary) | ✅ Done |
| 4 | Forecast (region list, stat tiles, day rows), News (white rows) | ✅ Done |
| 4 | Live Reports: segmented sort/range, stat tiles, report cards as incident cards, vote/review buttons, popover and full-screen sheet | ✅ Done |
| 4 | Location Info: kicker header, toned verdict card, sections as white rows, chip actions, bottom sheet on phones | ✅ Done |
| 4 | One Sidebar / MapTopChrome / BottomPanel tree via `useMediaQuery` (audit P7, B9) | ✅ Done: 1 sidebar and 1 search box at both 1440 and 375 px |
| 4 | Toasts for new urgent reports (`ReportToasts`, `lib/report-toasts.ts`): no backlog flood, an empty first poll is not a baseline, max 3 plus "+N more", Go to / dismiss / 15 s TTL | ✅ Done |
| 4 | bagyo.app lockup as a CSS mask so it shows on storm navy | ✅ Done |
| 5 | Agent AERIS: the game's guide dialogue (white speech bubbles with a blue speaker label, your own messages in chip blue, toned stripes for urgent/operator/weather), sky portrait tile, gradient Generate Report, pill input, round mute button | ✅ Done |
| 5 | Community chat: glass overlay with a live-dot kicker, compact log (own lines in chip blue), pill composer, nickname gate with the CTA | ✅ Done |
| 5 | Profile: avatar disc, XP stat with chunky bar, Minds card as a white row with the game toggle, kit inputs (`.aeris-input`), gradient Save | ✅ Done |
| 5 | Webcams: rounded tiles, white pill labels and round map-style buttons over video, LIVE badge top-left, segmented grid size, white picker rows | ✅ Done |
| 5 | Livestreams: channel chips, rounded player, the navy time-control bar for Prev / Latest / Next, white video rows | ✅ Done |
| 5 | Fixes found in verification: the map control column is capped to the map height and scrolls (it covered the Live Updates bar when the panel was open); Open Chat moved to bottom-centre (it sat on the Layers card) | ✅ Done |

**Contrast** (WCAG 2.x):
- **Light, on white:** ink 14.6, ink2 8.0, muted 5.0, accent 4.9, warn 5.0, danger 5.2, ok 5.4.
- **Light, on the sky background:** every token is ≥ 4.6.
- **Kicker:** 5.1.
- **Dark, on surface:** every token is ≥ 6.2.
- **Dark, on elevated surface:** every token is ≥ 4.9.

**Danger red:** darkened to `#c8363c` (dark mode `#ff858a`), because the game's `#d93f45` measures 4.4:1 on white.

**Screenshots** (in this folder):
- `before-desktop-light.jpg`
- `after-desktop-light.jpg`
- `after-desktop-dark.jpg`
- `after-mobile-dark.jpg`
- `phase4-toasts-light.jpg`
- `phase4-reports-dark.jpg`
- `phase5-panels-light.jpg`
- `phase5-panels-dark.jpg`

**Bundle:** the main page's first-load JavaScript is 620 kB, up from 617 kB before the reskin (+3 kB).

**Sign-in and edge screens:** these are done too.

| Screen | What it looks like now |
|---|---|
| `/login` | The game's landing: sky backdrop, brand pill, round Day/Storm theme button, a frosted hero card (live kicker, gradient "A.E.R.I.S." with the wave underline, "by bagyo.app" mark, gradient Google button, ghost wallet button), and AERIS with a speech bubble. Sign-in logic is unchanged. |
| `/refresh` | A loading card on the sky. |
| Phone "best on a desktop" gate | A hero card with the brand mark and the gradient CTA. |
| PDF bulletin viewer | A frosted sheet with a kicker header, soft buttons and a round close button. |

Screenshots: `login-light.jpg`, `login-dark.jpg`, `login-mobile-gate-dark.jpg`.

`/login` first-load JavaScript is 773 kB (was 772 kB).

Not checked in the browser:
- **The PDF viewer:** no PAGASA bulletin was active to open.
- **`/refresh`:** it needs a real Privy session.

## 5. How it was verified
- Before and after screenshots at 1440×900 in light and dark, and at 375 px phone width.
- Contrast checked for ink, muted, accent, warn, ok and danger on white and on storm navy.
- `tsc`, lint, the full Jest suite and `next build`.
