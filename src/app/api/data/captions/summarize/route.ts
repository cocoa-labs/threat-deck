import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';
import { DEFAULT_CHANNELS } from '@/lib/data/livestream-channels';
import { checkRateLimit, getCached, setCache } from '@/lib/data/rate-limiter';
import { budgetedAIFetch } from '@/lib/security/budget';
import { withRoutePolicy } from '@/lib/security/route-policy';

interface SummarizeRequest {
  channelId: string;
  channelLabel: string;
  category: string;
  captionText: string;
  windowStart: string;
  windowEnd: string;
  captionCount: number;
}

interface CachedSummary {
  summary: string;
  channelId: string;
  windowStart: string;
  windowEnd: string;
  captionCount: number;
  cachedAt: string;
}

async function routePOSTImplementation(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 503 });
  }

  try {
    const body = (await request.json()) as SummarizeRequest;
    const { channelId, channelLabel, category, captionText, windowStart, windowEnd, captionCount } =
      body;

    // Validate channelId exists in DEFAULT_CHANNELS
    if (!DEFAULT_CHANNELS.some((c) => c.id === channelId)) {
      return NextResponse.json({ error: 'Invalid channelId' }, { status: 400 });
    }

    // Validate captionText
    if (!captionText || captionText.length === 0) {
      return NextResponse.json({ error: 'captionText is required' }, { status: 400 });
    }
    if (captionText.length > 10_000) {
      return NextResponse.json(
        { error: 'captionText exceeds 10K character limit' },
        { status: 400 },
      );
    }

    // Validate window timestamps
    if (
      !windowStart ||
      !windowEnd ||
      Number.isNaN(Date.parse(windowStart)) ||
      Number.isNaN(Date.parse(windowEnd))
    ) {
      return NextResponse.json(
        { error: 'windowStart and windowEnd must be valid ISO strings' },
        { status: 400 },
      );
    }

    // Check cache
    const cacheKey = `cc-summary:${channelId}`;
    const cached = await getCached<CachedSummary>(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }

    // Rate limit
    if (!checkRateLimit('haiku_summarize')) {
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
    }

    const client = new Anthropic({ fetch: budgetedAIFetch, maxRetries: 0, timeout: 120_000 });
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system:
        'Summarize closed caption text from a live broadcast into a <200 word digest. Focus on: topics discussed, named entities (people, companies, countries), market-relevant information, breaking developments. Use present tense. Be factual and concise. If the text is garbled or nonsensical, summarize what you can discern.',
      messages: [
        {
          role: 'user',
          content: `Channel: ${channelLabel} (${category})\nCaption window: ${windowStart} to ${windowEnd}\nCaption count: ${captionCount}\n\n${captionText}`,
        },
      ],
    });

    const textBlock = response.content.find((block) => block.type === 'text');
    const summary = textBlock?.text ?? '';

    const result: CachedSummary = {
      summary,
      channelId,
      windowStart,
      windowEnd,
      captionCount,
      cachedAt: new Date().toISOString(),
    };

    await setCache(cacheKey, result, 90);

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to summarize captions' },
      { status: 500 },
    );
  }
}

export const POST = withRoutePolicy('/api/data/captions/summarize', routePOSTImplementation);
