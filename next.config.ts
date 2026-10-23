import type { NextConfig } from "next";

/**
 * Security headers applied to every response.
 *
 * Header purpose summary:
 *   - X-Frame-Options: DENY
 *       Blocks iframe embedding of the dashboard. Prevents clickjacking
 *       (an attacker overlays our UI inside a transparent iframe and tricks
 *       the user into clicking it). Omitted on /feed/cyber-wire which must
 *       remain embeddable as a public newsfeed surface.
 *   - X-Content-Type-Options: nosniff
 *       Stops browsers from MIME-sniffing a response and treating, e.g., a
 *       text/plain payload as executable JS. Removes a class of XSS where an
 *       uploaded "image" actually contains a script.
 *   - Referrer-Policy: strict-origin-when-cross-origin
 *       On cross-origin navigation, send only the origin (not the full URL +
 *       querystring). Protects against leaking magic-link tokens or session
 *       IDs to third-party analytics/widgets that load through the dashboard.
 *   - Permissions-Policy: camera=(), microphone=(), geolocation=()
 *       Explicitly disable powerful browser APIs we do not use. Even if an
 *       attacker injects script, they cannot turn on the user's webcam/mic
 *       or grab their location.
 *   - Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
 *       Force the browser to use HTTPS for the next 2 years for this domain
 *       and any subdomain. `preload` makes the entry eligible for the Chrome
 *       HSTS preload list. PRODUCTION ONLY — applying this in dev would
 *       break localhost (HTTP) sessions for 2 years on the user's machine.
 *   - Content-Security-Policy (dashboard routes)
 *       Defense-in-depth against XSS. Whitelists exactly the origins we load
 *       script/style/img/font/connect resources from. `frame-ancestors 'none'`
 *       complements X-Frame-Options in modern browsers.
 *       NOTE: 'unsafe-inline' on script-src is REQUIRED for Next.js streaming
 *       SSR (the runtime injects bootstrap scripts inline) and for the Mapbox
 *       worker shim. 'unsafe-eval' is required by Mapbox GL JS for its
 *       expression compiler. We accept these as a known limitation — future
 *       work could move to per-request nonces if a tighter posture is needed.
 *   - Content-Security-Policy (/feed/cyber-wire)
 *       Looser CSP allowing the public newsfeed to be embedded in third-party
 *       sites. frame-ancestors is set to '*' and X-Frame-Options is omitted.
 *
 * Header sets are split by `source` so Next can apply the right policy per
 * path. Order matters: most-specific path first.
 */

const PROD_ONLY_HEADERS = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const COMMON_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];

/** CSP for authenticated dashboard surface — strict on script, pragmatic on media. */
const DASHBOARD_CSP = [
  "default-src 'self'",
  // Mapbox GL needs unsafe-eval for its expression compiler; Next streaming
  // SSR injects inline bootstrap scripts so unsafe-inline is required too.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://api.mapbox.com",
  // Mapbox GL v3 runs its tile-decode/render worker from a `blob:` URL. Without
  // an explicit `worker-src`, the browser falls back to `script-src` — which
  // does NOT allow `blob:` — and BLOCKS the worker, so tiles never decode and
  // the globe renders as a bare grey sphere. `child-src blob:` is the fallback
  // older Safari consults. This omission silently broke the map since the CSP
  // was introduced; `map-init.test.ts` guards it.
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  // Dashboard aggregates images from many third-party feeds: YouTube
  // thumbnails (i.ytimg.com), Twitter avatars (pbs.twimg.com), news article
  // hero images (CDNs that change weekly), market data favicons, etc. An
  // enumerated allowlist breaks every time a new feed is added; allow any
  // HTTPS origin instead. Script-src stays strictly enumerated, which is
  // where the actual XSS risk lives — img-src has near-zero XSS surface.
  "img-src 'self' data: blob: https:",
  "font-src 'self' https://fonts.gstatic.com",
  "connect-src 'self' https://api.mapbox.com https://events.mapbox.com https://api.anthropic.com wss: https:",
  // YouTube livestream embeds (LIVESTREAM + LIVESTREAM 2 panels). The
  // -nocookie variant is what YouTube uses when 'enablejsapi' is set.
  "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com",
  // hls.js plays HLS streams via MediaSource Extensions which creates blob:
  // URLs. The .m3u8 + .ts segment fetches go through connect-src (already
  // covered by `https:` above). media-src is needed for the actual <video>
  // src once the blob is created.
  "media-src 'self' blob: https:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

/** Looser CSP for the public, embeddable cyber-wire feed. */
const PUBLIC_FEED_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: https:",
  "font-src 'self' https://fonts.gstatic.com",
  "connect-src 'self' https:",
  "frame-ancestors *",
].join("; ");

const nextConfig: NextConfig = {
  allowedDevOrigins:
    process.env.NEXT_DEV_ORIGINS?.split(",")
      .map((s) => s.trim())
      .filter(Boolean) ?? [],
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
  images: {
    unoptimized: true,
    remotePatterns: [],
    localPatterns: [{ pathname: "/icons/**" }, { pathname: "/images/**" }],
  },
  turbopack: {
    rules: {
      "*.glsl": { loaders: ["raw-loader"], as: "*.js" },
      "*.frag": { loaders: ["raw-loader"], as: "*.js" },
      "*.vert": { loaders: ["raw-loader"], as: "*.js" },
    },
  },
  async headers() {
    const isProd = process.env.NODE_ENV === "production";
    const hstsHeaders = isProd ? PROD_ONLY_HEADERS : [];

    // Next.js applies header rules in order; when two rules match the same
    // path, the LATER rule wins on per-key collision (later set() overrides).
    // BUT Next has no way to *unset* a header from a previous rule. To get
    // the public feed truly embeddable we must ensure the dashboard rule
    // does NOT match the /feed path tree in the first place. We do that with
    // a regex negative lookahead in the catch-all `source` field.
    //
    // Then the feed rule fires alone for /feed/* (with PUBLIC_FEED_CSP and
    // NO X-Frame-Options at all — matching the spec). All other paths get
    // the strict dashboard rule.
    return [
      // (1) Public cyber-wire feed (any path under /feed) — embeddable.
      //     CSP `frame-ancestors *` is the modern, preferred mechanism.
      //     X-Frame-Options is deliberately OMITTED so the page can be
      //     iframed by external sites.
      {
        source: "/feed/:path*",
        headers: [
          ...COMMON_HEADERS,
          ...hstsHeaders,
          { key: "Content-Security-Policy", value: PUBLIC_FEED_CSP },
        ],
      },
      // (2) Exact /feed (no trailing segment) — same treatment.
      {
        source: "/feed",
        headers: [
          ...COMMON_HEADERS,
          ...hstsHeaders,
          { key: "Content-Security-Policy", value: PUBLIC_FEED_CSP },
        ],
      },
      // (3) Everything else: strict dashboard CSP + clickjacking block.
      //     The negative lookahead excludes /feed and /feed/* so the
      //     overrides above are the only headers that apply to those paths.
      {
        source: "/((?!feed(?:/|$)).*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          ...COMMON_HEADERS,
          ...hstsHeaders,
          { key: "Content-Security-Policy", value: DASHBOARD_CSP },
        ],
      },
    ];
  },
};

export default nextConfig;
