/**
 * Content Security Policy.
 *
 * Ships as **Report-Only** by default. The dashboard renders user-submitted
 * report text, OSM facility names (anyone can edit OSM), RSS titles, and LLM
 * output; escaping is applied consistently today, and a CSP is the layer that
 * makes a future slip non-exploitable rather than the primary defence.
 *
 * It starts in report-only because the surface is genuinely wide — MapLibre
 * (blob workers), Three.js + VRM, Piper TTS (WASM), the Privy wallet stack
 * (WalletConnect relays), YouTube embeds, the panahon.gov.ph frame, and news
 * thumbnails from arbitrary Philippine outlets. Enforcing a policy nobody has
 * measured would break the map during a storm.
 *
 * Set `CSP_ENFORCE=true` to switch the header to enforcing. Do that only after
 * reading a few days of violation reports and tightening the lists below —
 * `connect-src` and `img-src` in particular are wider than they should end up.
 */
const CSP_BASE_DIRECTIVES = [
  "default-src 'self'",
  // 'unsafe-inline': Next.js emits inline hydration scripts and app/layout.tsx
  // runs an inline theme-init script before paint to avoid a flash.
  // 'wasm-unsafe-eval': Piper TTS / onnxruntime compile WASM.
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob:",
  // MapLibre and Three.js run their parsers in blob-URL workers.
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  // MapLibre, Privy, and the popup cards all set inline styles.
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  // News thumbnails come from whatever host an RSS item points at, so this
  // cannot be enumerated. Restricting the scheme is the useful part.
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob:",
  [
    "connect-src 'self' data: blob:",
    "https://*.supabase.co wss://*.supabase.co",
    "https://auth.privy.io https://*.privy.io wss://*.privy.io",
    "https://*.walletconnect.com https://*.walletconnect.org wss://*.walletconnect.org",
    // Both the apex and the a/b/c/d shards: MapLibre fetches style.json from
    // the apex and tiles from the shards. A wildcard alone misses the apex —
    // report-only caught exactly that.
    "https://basemaps.cartocdn.com https://*.basemaps.cartocdn.com",
    "https://tile.openstreetmap.org https://*.tile.openstreetmap.org",
    "https://gibs.earthdata.nasa.gov https://*.rainviewer.com",
    // Piper TTS fetches its ONNX voice model from HuggingFace on first use;
    // the host is baked into the vendored piper-tts-web bundle, not
    // configurable. `resolve/` 302s to the LFS CDN, and browsers re-check
    // connect-src on the redirect target, so the CDN hosts are listed too.
    // Enforcing without these silently downgrades the agent to Web Speech —
    // found by running the policy enforced, not by reading it.
    "https://huggingface.co https://*.huggingface.co https://*.hf.co",
  ].join(" "),
  // youtube: webcam + livestream embeds. panahon.gov.ph: the external map
  // frame. privy.io: the auth iframe. 'self': the PAGASA PDF proxy.
  "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://www.panahon.gov.ph https://auth.privy.io https://*.privy.io",
  // 'self' rather than 'none' because /api/pagasa-bulletin-pdf is embedded in
  // a same-origin iframe; see the X-Frame-Options override for that route.
  "frame-ancestors 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
];

// Trimmed on purpose. A bare `=== "true"` silently no-matched a value stored
// as "true\n" (a trailing newline from the CLI), leaving the policy in
// report-only while the deploy looked successful. A security toggle that fails
// closed *and* silently on invisible whitespace is the wrong failure mode:
// whoever sets it gets no signal that it did nothing.
const CSP_ENFORCED = process.env.CSP_ENFORCE?.trim() === "true";

// Browsers ignore `upgrade-insecure-requests` in a report-only policy and log
// an error saying so on every page load. Only emit it when enforcing, so the
// report-only console stays readable — the whole point of this phase is that a
// violation in the log means something.
const CSP_DIRECTIVES = (
  CSP_ENFORCED ? [...CSP_BASE_DIRECTIVES, "upgrade-insecure-requests"] : CSP_BASE_DIRECTIVES
).join("; ");

const CSP_HEADER_KEY = CSP_ENFORCED
  ? "Content-Security-Policy"
  : "Content-Security-Policy-Report-Only";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["maplibre-gl"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin-allow-popups",
          },
          // One year, subdomains included. No `preload`: that is a submission
          // to a browser-vendor list which is slow and awkward to undo, and it
          // should be a deliberate decision rather than a side effect of a
          // hardening pass.
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
          // Deny the powerful features this app never uses. Geolocation stays
          // enabled for self — lib/user-geolocation.ts uses it to centre the
          // map on the reporter.
          {
            key: "Permissions-Policy",
            value:
              "geolocation=(self), camera=(), microphone=(), payment=(), usb=(), magnetometer=(), gyroscope=(), interest-cohort=()",
          },
          { key: CSP_HEADER_KEY, value: CSP_DIRECTIVES },
        ],
      },
      {
        source: "/api/rainviewer",
        headers: [
          {
            key: "Cache-Control",
            value: "public, s-maxage=300, stale-while-revalidate=600",
          },
        ],
      },
      {
        source: "/api/rainviewer/tiles/:path*",
        headers: [
          {
            key: "Cache-Control",
            value:
              "public, max-age=300, s-maxage=86400, stale-while-revalidate=86400",
          },
        ],
      },
      {
        // The global DENY above blocks this route from framing itself: the
        // PDF viewer embeds this same-origin proxy in an <iframe>, and DENY
        // rejects that regardless of origin. Scope framing back to same-origin
        // for this one route instead of disabling clickjacking protection app-wide.
        source: "/api/pagasa-bulletin-pdf",
        headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }],
      },
      {
        source: "/models/:path*.vrm",
        headers: [
          { key: "Content-Type", value: "model/gltf-binary" },
          {
            key: "Cache-Control",
            value:
              process.env.NODE_ENV === "development"
                ? "no-store"
                : "public, max-age=86400, stale-while-revalidate=604800",
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
