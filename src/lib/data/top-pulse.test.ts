import { describe, expect, it } from 'vitest';
import { buildTopPulseItems } from '@/lib/data/top-pulse';
import type { NewsItem, Tweet } from '@/lib/types';

const now = new Date('2026-05-31T23:30:00.000Z');

function news(partial: Partial<NewsItem> & Pick<NewsItem, 'id' | 'title' | 'source'>): NewsItem {
  return {
    category: 'cyber',
    publishedAt: '2026-05-31T22:30:00.000Z',
    url: `https://example.com/${partial.id}`,
    ...partial,
  };
}

function tweet(partial: Partial<Tweet> & Pick<Tweet, 'id' | 'text' | 'authorUsername'>): Tweet {
  return {
    authorId: `author-${partial.id}`,
    authorName: partial.authorUsername,
    createdAt: '2026-05-31T23:00:00.000Z',
    domain: 'ai',
    likeCount: 100,
    quoteCount: 0,
    relevant: true,
    replyCount: 5,
    retweetCount: 10,
    url: `https://x.com/${partial.authorUsername}/status/${partial.id}`,
    ...partial,
  };
}

describe('buildTopPulseItems', () => {
  it('lets fresh AI and X signals outrank old RSS when cyber publishers are quiet', () => {
    const result = buildTopPulseItems({
      now,
      cyberItems: [
        news({
          id: 'seven-hour-cyber',
          title: 'Trusted ransomware story from earlier today',
          source: 'BleepingComputer',
          publishedAt: '2026-05-31T16:30:00.000Z',
        }),
        news({
          id: 'old-cyber',
          title: 'Old trusted vulnerability writeup',
          source: 'The Hacker News',
          publishedAt: '2026-05-31T09:00:00.000Z',
        }),
      ],
      aiItems: [
        news({
          id: 'fresh-ai',
          title: 'OpenAI announces new agent safety eval for frontier models',
          source: 'OpenAI News',
          category: 'ai',
          publishedAt: '2026-05-31T22:45:00.000Z',
        }),
      ],
      tweets: [
        tweet({
          id: 'fresh-x',
          text: 'Claude Mythos model release benchmark looks like a major jump in agentic coding.',
          authorUsername: 'AnthropicAI',
          createdAt: '2026-05-31T23:10:00.000Z',
        }),
      ],
    });

    expect(result.items.map((item) => item.source)).toEqual([
      'OpenAI News',
      '@AnthropicAI',
      'BleepingComputer',
      'The Hacker News',
    ]);
  });

  it('filters unrelated broad AI-adjacent posts while keeping trusted cyber publishers', () => {
    const result = buildTopPulseItems({
      now,
      cyberItems: [
        news({
          id: 'datasette',
          title: 'datasette 1.0a32',
          source: 'Simon Willison',
          summary: 'A minor bugfix release for Datasette.',
        }),
        news({
          id: 'trusted',
          title: 'Ransomware crew targets edge devices',
          source: 'The Hacker News',
        }),
        news({
          id: 'job',
          title: 'I was starting my first job in September — then they gave it to AI',
          source: 'AI Incident Database',
        }),
        news({
          id: 'deepfake',
          title: 'Executive caught in deepfake loan scam',
          source: 'AI Incident Database',
        }),
      ],
      aiItems: [
        news({
          id: 'quiz',
          title: 'Take our I/O 2026 quiz, vibe coded in Google AI Studio',
          source: 'Google AI Blog',
          category: 'ai',
        }),
      ],
    });

    expect(result.items.map((item) => item.id)).toEqual(['trusted', 'deepfake']);
  });

  it('caps social posts and dedupes tweets that link to an included article', () => {
    const result = buildTopPulseItems({
      now,
      socialCap: 1,
      cyberItems: [
        news({
          id: 'article',
          title: 'Critical prompt injection flaw hits agent gateways',
          source: 'CyberScoop',
          url: 'https://cyberscoop.com/prompt-injection-agent-gateways',
        }),
      ],
      tweets: [
        tweet({
          id: 'dupe',
          text: 'Critical prompt injection flaw hits agent gateways https://t.co/a',
          authorUsername: 'researcher',
          domain: 'infosec',
          entities: {
            urls: [
              {
                display_url: 'cyberscoop.com/prompt...',
                expanded_url: 'https://cyberscoop.com/prompt-injection-agent-gateways',
              },
            ],
          },
        }),
        tweet({
          id: 'unique-1',
          text: 'New Claude model release benchmark has fresh agentic safety implications.',
          authorUsername: 'AnthropicAI',
        }),
        tweet({
          id: 'unique-2',
          text: 'OpenAI rolls out a new red-team eval for autonomous agents.',
          authorUsername: 'OpenAI',
        }),
      ],
    });

    expect(result.items.filter((item) => item.category === 'social')).toHaveLength(1);
    expect(result.items.some((item) => item.id === 'x-dupe')).toBe(false);
    expect(result.sourceStats.socialIncluded).toBe(1);
  });
});
