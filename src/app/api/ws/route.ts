import { withRoutePolicy } from '@/lib/security/route-policy';
// ═══════════════════════════════════════════════
// THREAT DECK - WebSocket API Route
// ═══════════════════════════════════════════════
//
// Next.js App Router does not natively support WebSocket upgrades in API routes.
// The actual WebSocket server is initialized as a standalone process that shares
// the same HTTP server in a custom server setup, or runs on a separate port.
//
// Approach: The ThreatDeckWSServer (src/lib/ws/server.ts) is attached to a Node.js
// HTTP server in the custom server entry point (e.g. server.ts at project root).
// When running `next dev` locally, a companion WS server can be started alongside.
//
// In production, deploy the WS server as a sidecar process or use a service like
// Fly.io / Railway that supports long-lived WebSocket connections.
//
// This route serves as a health/info endpoint for the WebSocket system.

import { NextResponse } from 'next/server';

function routeGETImplementation() {
  return NextResponse.json({
    status: 'ws_info',
    message:
      'WebSocket connections are handled by the standalone WS server. ' +
      'Connect to your configured wss:// endpoint for real-time data.',
    channels: [
      'markets',
      'news',
      'crypto',
      'whales',
      'congress',
      'fed',
      'polymarket',
      'alerts',
      'agent',
    ],
    protocol: {
      subscribe: '{ "action": "subscribe", "channels": ["markets", "news"] }',
      unsubscribe: '{ "action": "unsubscribe", "channels": ["markets"] }',
      messageFormat:
        '{ "channel": "markets", "type": "indices", "data": {...}, "timestamp": 1234567890 }',
    },
  });
}

export const GET = withRoutePolicy('/api/ws', routeGETImplementation);
