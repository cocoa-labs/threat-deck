import { safeFetch } from '@/lib/security/safe-fetch';
import { checkRateLimit, getCached, setCache } from '../rate-limiter';

const USASPENDING_BASE = 'https://api.usaspending.gov/api/v2/search/spending_by_award/';

// ─── Fallback Demo Data ───

const DEMO_CONTRACTS: USASpendingResponse = {
  results: [
    {
      Award_ID: 'DEMO-001',
      Recipient_Name: 'Lockheed Martin Corporation',
      Award_Amount: 2_450_000_000,
      Awarding_Agency: 'Department of Defense',
      Award_Type: 'Contract',
      Start_Date: '2026-01-15',
      Description: 'Next Generation Fighter Aircraft Development',
      url: 'https://www.usaspending.gov/award/DEMO-001',
    },
    {
      Award_ID: 'DEMO-002',
      Recipient_Name: 'Raytheon Technologies',
      Award_Amount: 890_000_000,
      Awarding_Agency: 'Department of Defense',
      Award_Type: 'Contract',
      Start_Date: '2026-01-12',
      Description: 'Advanced Missile Defense System Upgrade',
      url: 'https://www.usaspending.gov/award/DEMO-002',
    },
    {
      Award_ID: 'DEMO-003',
      Recipient_Name: 'Palantir Technologies',
      Award_Amount: 480_000_000,
      Awarding_Agency: 'Department of Homeland Security',
      Award_Type: 'Contract',
      Start_Date: '2026-01-10',
      Description: 'Border Security Intelligence Analytics Platform',
      url: 'https://www.usaspending.gov/award/DEMO-003',
    },
    {
      Award_ID: 'DEMO-004',
      Recipient_Name: 'General Dynamics',
      Award_Amount: 1_200_000_000,
      Awarding_Agency: 'Department of the Navy',
      Award_Type: 'Contract',
      Start_Date: '2026-01-08',
      Description: 'Virginia-class Submarine Maintenance and Overhaul',
      url: 'https://www.usaspending.gov/award/DEMO-004',
    },
    {
      Award_ID: 'DEMO-005',
      Recipient_Name: 'Moderna Inc.',
      Award_Amount: 320_000_000,
      Awarding_Agency: 'Department of Health and Human Services',
      Award_Type: 'Contract',
      Start_Date: '2026-01-05',
      Description: 'Next Generation Vaccine Development Program',
      url: 'https://www.usaspending.gov/award/DEMO-005',
    },
  ],
  page_metadata: {
    page: 1,
    hasNext: false,
    total: 5,
  },
};

// ─── Public API ───

export interface GovernmentContractParams {
  limit?: number;
}

/**
 * Fetch government contracts from the USASpending API.
 * No API key required. Falls back to demo data on failure.
 * Returns raw USASpending response format.
 */
export async function fetchGovernmentContracts(
  params?: GovernmentContractParams,
): Promise<USASpendingResponse> {
  const cacheKey = 'government:contracts';
  const cached = await getCached<USASpendingResponse>(cacheKey);
  if (cached) return cached;

  if (!checkRateLimit('usaspending')) {
    return DEMO_CONTRACTS;
  }

  try {
    const limit = params?.limit ?? 20;

    // USASpending uses POST with a JSON body for searches
    const body: USASpendingRequestBody = {
      filters: {
        time_period: [
          {
            start_date: getDateMonthsAgo(3),
            end_date: new Date().toISOString().split('T')[0]!,
          },
        ],
        award_type_codes: ['A', 'B', 'C', 'D'], // Contracts
      },
      fields: [
        'Award ID',
        'Recipient Name',
        'Award Amount',
        'Awarding Agency',
        'Award Type',
        'Start Date',
        'Description',
      ],
      page: 1,
      limit,
      sort: 'Award Amount',
      order: 'desc',
    };

    const res = await safeFetch(USASPENDING_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      next: { revalidate: 1800 },
    });

    if (!res.ok) {
      console.warn(`[Government] USASpending API returned ${res.status}`);
      return DEMO_CONTRACTS;
    }

    const data: USASpendingApiResponse = await res.json();

    if (!data.results || data.results.length === 0) {
      return DEMO_CONTRACTS;
    }

    const result: USASpendingResponse = {
      results: data.results.map((r) => {
        const awardId = r['Award ID'] ?? r.Award_ID ?? 'N/A';
        return {
          Award_ID: awardId,
          Recipient_Name: r['Recipient Name'] ?? r.Recipient_Name ?? 'Unknown',
          Award_Amount: r['Award Amount'] ?? r.Award_Amount ?? 0,
          Awarding_Agency: r['Awarding Agency'] ?? r.Awarding_Agency ?? 'Unknown',
          Award_Type: r['Award Type'] ?? r.Award_Type ?? 'Contract',
          Start_Date: r['Start Date'] ?? r.Start_Date ?? '',
          Description: r.Description ?? r.description ?? '',
          url: awardId !== 'N/A' ? `https://www.usaspending.gov/award/${awardId}` : undefined,
        };
      }),
      page_metadata: data.page_metadata ?? {
        page: 1,
        hasNext: false,
        total: data.results.length,
      },
    };

    await setCache(cacheKey, result);
    return result;
  } catch (error) {
    console.warn(
      '[Government] Failed to fetch contracts:',
      error instanceof Error ? error.message : error,
    );
    return DEMO_CONTRACTS;
  }
}

// ─── Internal Helpers ───

function getDateMonthsAgo(months: number): string {
  const date = new Date();
  date.setMonth(date.getMonth() - months);
  return date.toISOString().split('T')[0]!;
}

// ─── USASpending Types ───

export interface USASpendingContract {
  Award_ID: string;
  Recipient_Name: string;
  Award_Amount: number;
  Awarding_Agency: string;
  Award_Type: string;
  Start_Date: string;
  Description: string;
  url?: string;
}

export interface USASpendingResponse {
  results: USASpendingContract[];
  page_metadata: {
    page: number;
    hasNext: boolean;
    total: number;
  };
}

interface USASpendingRequestBody {
  filters: {
    time_period: { start_date: string; end_date: string }[];
    award_type_codes: string[];
  };
  fields: string[];
  page: number;
  limit: number;
  sort: string;
  order: string;
}

interface USASpendingApiResult {
  'Award ID'?: string;
  Award_ID?: string;
  'Recipient Name'?: string;
  Recipient_Name?: string;
  'Award Amount'?: number;
  Award_Amount?: number;
  'Awarding Agency'?: string;
  Awarding_Agency?: string;
  'Award Type'?: string;
  Award_Type?: string;
  'Start Date'?: string;
  Start_Date?: string;
  Description?: string;
  description?: string;
}

interface USASpendingApiResponse {
  results?: USASpendingApiResult[];
  page_metadata?: {
    page: number;
    hasNext: boolean;
    total: number;
  };
}
