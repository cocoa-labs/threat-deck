import { NextResponse } from 'next/server';
import { fetchGovernmentContracts } from '@/lib/data/collectors/government';
import type { GovernmentContract } from '@/lib/types';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = searchParams.get('limit') ? Number(searchParams.get('limit')) : undefined;

  try {
    const data = await fetchGovernmentContracts({ limit });

    // Normalize USASpending format → GovernmentContract format
    const results: GovernmentContract[] = data.results.map((r) => ({
      id: r.Award_ID || `contract-${Math.random().toString(36).slice(2, 10)}`,
      contractor: r.Recipient_Name || 'Unknown',
      agency: r.Awarding_Agency || 'Unknown',
      amount: r.Award_Amount ?? 0,
      description: r.Description || '',
      awardDate: r.Start_Date || '',
      url: r.url,
    }));

    const response = NextResponse.json({ results, timestamp: new Date().toISOString() });
    response.headers.set(
      'Cache-Control',
      'public, max-age=900, s-maxage=1800, stale-while-revalidate=900',
    );
    return response;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch government contracts' },
      { status: 500 },
    );
  }
}
