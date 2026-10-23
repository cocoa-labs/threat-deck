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
 *   - Content-Security-Policy is generated per request in src/proxy.ts.
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

// Per-request CSP is issued in src/proxy.ts (Next SSR nonce propagation).

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
    // Then the feed rule fires alone for /feed/* (with common headers and
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
        ],
      },
      // (2) Exact /feed (no trailing segment) — same treatment.
      {
        source: "/feed",
        headers: [
          ...COMMON_HEADERS,
          ...hstsHeaders,
        ],
      },
      // (3) Everything else: common headers + clickjacking block.
      //     The negative lookahead excludes /feed and /feed/* so the
      //     overrides above are the only headers that apply to those paths.
      {
        source: "/((?!feed(?:/|$)).*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          ...COMMON_HEADERS,
          ...hstsHeaders,
        ],
      },
    ];
  },
};

export default nextConfig;
