/** Public liveness only. Never expose configuration, costs, or upstream errors. */
export async function GET(): Promise<Response> {
  return Response.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } });
}
