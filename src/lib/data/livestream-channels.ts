/**
 * Livestream channel configuration and types.
 * Defines the expanded channel list across finance, crypto, and world news.
 */

/* ─── Types ─── */

export type StreamType =
  | 'youtube-channel'
  | 'youtube-video'
  | 'hls'
  | 'iframe'
  /**
   * Pseudo-stream type for the hero LIVE tab's user-driven YouTube search
   * affordance. The channel-strip entry of this type renders a search input
   * + results list (instead of a player) until the user picks a video; then
   * an iframe player plays the picked video. Also the surface that receives
   * agent-driven YouTube plays when the hero is the active lens.
   */
  | 'youtube-search';

export interface LivestreamChannelConfig {
  id: string;
  label: string;
  type: StreamType;
  /** YouTube channel ID, video ID, or stream URL depending on type */
  source: string;
  category: 'finance' | 'crypto' | 'geopolitical';
  /** Fallback YouTube video ID when API resolution fails */
  fallbackVideoId?: string;
  enabled?: boolean;
  /** RSS_FEEDS category keys from rss.ts for headline context */
  rssCategories?: string[];
  /** Static one-line description for agent context */
  description?: string;
  /** Network's own RSS feed URL */
  rssFeedUrl?: string;
  /** Live blog or "latest" page to scrape via Firecrawl */
  livePageUrl?: string;
  /** YouTube channel ID for metadata polling (explicit, decoupled from stream type) */
  youtubeChannelId?: string;
}

export interface ResolvedChannel {
  id: string;
  videoId: string | null;
  isLive: boolean;
  title?: string;
  thumbnailUrl?: string;
}

/* ─── Default Channel List ─── */

export const DEFAULT_CHANNELS: LivestreamChannelConfig[] = [
  // ── HLS: 24/7 always-on (guaranteed live) ──
  {
    id: 'cheddar',
    label: 'CHEDDAR',
    type: 'hls',
    source:
      'https://livestream.chdrstatic.com/b93e5b0d43ea306310a379971e384964acbe4990ce193c0bd50078275a9a657d/cheddar-42620/cheddarweblive/cheddar/index.m3u8',
    category: 'finance',
    rssCategories: ['finance'],
    description: 'Business and tech news network covering markets, startups, and media',
    rssFeedUrl: 'https://cheddar.com/feed',
  },
  {
    id: 'aljazeera',
    label: 'AL JAZEERA',
    type: 'hls',
    source: 'https://live-hls-apps-aje-v3-fa.getaj.net/AJE/index.m3u8',
    category: 'geopolitical',
    rssCategories: ['politics'],
    description: 'Qatar-based international news covering Middle East, Africa, and global affairs',
    rssFeedUrl: 'https://www.aljazeera.com/xml/rss/all.xml',
    livePageUrl: 'https://www.aljazeera.com/live-blog/',
  },
  {
    id: 'france24',
    label: 'FRANCE 24',
    type: 'hls',
    source: 'https://live.france24.com/hls/live/2037218/F24_EN_HI_HLS/master_5000.m3u8',
    category: 'geopolitical',
    rssCategories: ['politics'],
    description: 'French international news with European and African focus',
    rssFeedUrl: 'https://www.france24.com/en/rss',
    livePageUrl: 'https://www.france24.com/en/latest-news',
  },
  {
    id: 'dw',
    label: 'DW NEWS',
    type: 'hls',
    source: 'https://dwamdstream102.akamaized.net/hls/live/2015525/dwstream102/index.m3u8',
    category: 'geopolitical',
    rssCategories: ['politics'],
    description: 'German international broadcaster covering European politics and world affairs',
    rssFeedUrl: 'https://rss.dw.com/xml/rss-en-all',
    livePageUrl: 'https://www.dw.com/en/latest-news/s-62379',
  },
  {
    id: 'ndtv',
    label: 'NDTV 24x7',
    type: 'hls',
    source:
      'https://ndtv24x7elemarchana.akamaized.net/hls/live/2003678/ndtv24x7/ndtv24x7master.m3u8',
    category: 'geopolitical',
    rssCategories: ['politics'],
    description: 'Indian news network covering South Asian politics, economy, and world events',
    rssFeedUrl: 'https://feeds.feedburner.com/ndtvnews-top-stories',
    livePageUrl: 'https://www.ndtv.com/latest',
  },
  {
    id: 'nhk',
    label: 'NHK WORLD',
    type: 'hls',
    source: 'https://media-tyo.hls.nhkworld.jp/hls/w/live/master.m3u8',
    category: 'geopolitical',
    rssCategories: ['politics'],
    description: 'Japanese public broadcaster covering Asia-Pacific affairs and global news',
    rssFeedUrl: 'https://www3.nhk.or.jp/rss/news/cat0.xml',
  },
  {
    id: 'nasa',
    label: 'NASA TV',
    type: 'hls',
    source: 'https://ntv1.akamaized.net/hls/live/2014075/NASA-NTV1-HLS/master.m3u8',
    category: 'geopolitical',
    rssCategories: ['tech'],
    description: 'NASA live coverage of space missions, ISS operations, and science briefings',
    rssFeedUrl: 'https://www.nasa.gov/news-release/feed/',
  },

  // ── YouTube: frequently live during business hours ──
  {
    id: 'bloomberg',
    label: 'BLOOMBERG',
    type: 'youtube-channel',
    source: 'UCIALMKvObZNtJ6AmdCLP7Lg',
    category: 'finance',
    fallbackVideoId: 'msdhTLcB7Pg',
    rssCategories: ['finance'],
    description: 'Global financial news covering markets, economics, and business analysis',
    rssFeedUrl: 'https://feeds.bloomberg.com/markets/news.rss',
    livePageUrl: 'https://www.bloomberg.com/latest',
    youtubeChannelId: 'UCIALMKvObZNtJ6AmdCLP7Lg',
  },
  {
    id: 'cnbc',
    label: 'CNBC',
    type: 'youtube-channel',
    source: 'UCvJJ_dzjViJCoLf5uKUTwoA',
    category: 'finance',
    fallbackVideoId: 'EQL7RGd2Id0',
    rssCategories: ['finance'],
    description: 'US business news covering Wall Street, economic policy, and corporate earnings',
    rssFeedUrl:
      'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114',
    livePageUrl: 'https://www.cnbc.com/world/?region=world',
    youtubeChannelId: 'UCvJJ_dzjViJCoLf5uKUTwoA',
  },
  {
    id: 'sky',
    label: 'SKY NEWS',
    type: 'youtube-channel',
    source: 'UCoMdktPbSTixAyNGwb-UYkQ',
    category: 'geopolitical',
    fallbackVideoId: 'bfQx3ouH8ik',
    rssCategories: ['politics'],
    description:
      'UK-based global news network covering breaking events, politics, and world affairs',
    rssFeedUrl: 'https://feeds.skynews.com/feeds/rss/home.xml',
    livePageUrl: 'https://news.sky.com/',
    youtubeChannelId: 'UCoMdktPbSTixAyNGwb-UYkQ',
  },

  // ── YouTube: sometimes live / event-driven ──
  {
    id: 'yahoo',
    label: 'YAHOO FIN',
    type: 'youtube-channel',
    source: 'UCEAZeUIeJs92IQdiegpzIdg',
    category: 'finance',
    fallbackVideoId: 'YQHsXMglC9A',
    rssCategories: ['finance'],
    description: 'Market coverage with analyst interviews, stock picks, and economic trends',
    livePageUrl: 'https://finance.yahoo.com/',
    youtubeChannelId: 'UCEAZeUIeJs92IQdiegpzIdg',
  },
  {
    id: 'fox-biz',
    label: 'FOX BIZ',
    type: 'youtube-channel',
    source: 'UCceiyyOA0vEOSf0im2UDLKw',
    category: 'finance',
    rssCategories: ['finance'],
    description:
      'US business and financial news with market analysis and political economy coverage',
    livePageUrl: 'https://www.foxbusiness.com/',
    youtubeChannelId: 'UCceiyyOA0vEOSf0im2UDLKw',
  },
  {
    id: 'cbs-news',
    label: 'CBS NEWS',
    type: 'youtube-channel',
    source: 'UC8p1vwvWtl6T73JiExfWs1g',
    category: 'geopolitical',
    rssCategories: ['politics'],
    description: 'US national and international news with investigative reporting',
    rssFeedUrl: 'https://www.cbsnews.com/latest/rss/main',
    livePageUrl: 'https://www.cbsnews.com/',
    youtubeChannelId: 'UC8p1vwvWtl6T73JiExfWs1g',
  },
  {
    id: 'reuters',
    label: 'REUTERS',
    type: 'youtube-channel',
    source: 'UChqUTb7kYRX8-EiaN3XFrSQ',
    category: 'geopolitical',
    fallbackVideoId: 'JNfVqxBJkCE',
    rssCategories: ['politics', 'finance'],
    description: 'Global wire service covering breaking news, markets, and geopolitics',
    rssFeedUrl: 'https://www.reutersagency.com/feed/',
    livePageUrl: 'https://www.reuters.com/',
    youtubeChannelId: 'UChqUTb7kYRX8-EiaN3XFrSQ',
  },
  {
    id: 'euronews',
    label: 'EURONEWS',
    type: 'youtube-channel',
    source: 'UCW2QcKZiU8aUGg4yxCIditg',
    category: 'geopolitical',
    rssCategories: ['politics'],
    description: 'Pan-European news covering EU politics, climate, and continental affairs',
    rssFeedUrl: 'https://www.euronews.com/rss',
    livePageUrl: 'https://www.euronews.com/just-in',
    youtubeChannelId: 'UCW2QcKZiU8aUGg4yxCIditg',
  },
  {
    id: 'wion',
    label: 'WION',
    type: 'youtube-channel',
    source: 'UC_gUM8rL-Lrg6O3adPW9K1g',
    category: 'geopolitical',
    rssCategories: ['politics'],
    description: 'Indian global news network covering international relations and diplomacy',
    livePageUrl: 'https://www.wionews.com/',
    youtubeChannelId: 'UC_gUM8rL-Lrg6O3adPW9K1g',
  },
  {
    id: 'cna',
    label: 'CNA',
    type: 'youtube-channel',
    source: 'UCo8bcnLyZH8tBIH9V1mLgqQ',
    category: 'geopolitical',
    rssCategories: ['politics'],
    description: 'Singapore-based Asian news covering ASEAN, China, and Asia-Pacific geopolitics',
    livePageUrl: 'https://www.channelnewsasia.com/latest-news',
    youtubeChannelId: 'UCo8bcnLyZH8tBIH9V1mLgqQ',
  },
  {
    id: 'coindesk',
    label: 'COINDESK',
    type: 'youtube-channel',
    source: 'UCGkp_hw4bAMXUJvbMiNG0tw',
    category: 'crypto',
    rssCategories: ['finance'],
    description: 'Cryptocurrency and blockchain news covering Bitcoin, DeFi, and digital assets',
    livePageUrl: 'https://www.coindesk.com/',
    youtubeChannelId: 'UCGkp_hw4bAMXUJvbMiNG0tw',
  },

  // ── YT SEARCH — user-driven YouTube search (and agent landing pad on the hero) ──
  {
    id: 'youtube-search',
    label: 'YT SEARCH',
    type: 'youtube-search',
    source: '', // no source; this channel renders a search UI until a video is picked
    category: 'finance',
    description:
      'YouTube search: type a query to find videos, or let Max push a video into the hero',
  },
];

/* ─── Channel Resolution ─── */

/**
 * Resolves the final channel list, merging defaults with env var overrides.
 * Supports backward compatibility with NEXT_PUBLIC_LIVESTREAM_URL and
 * NEXT_PUBLIC_LIVESTREAM_CHANNELS.
 */
export function resolveChannelConfig(): LivestreamChannelConfig[] {
  const channels: LivestreamChannelConfig[] = [];

  // Legacy single-URL channel
  const legacyUrl = process.env.NEXT_PUBLIC_LIVESTREAM_URL;
  if (legacyUrl) {
    const videoId = extractYouTubeVideoId(legacyUrl);
    if (videoId) {
      channels.push({
        id: 'custom',
        label: 'CUSTOM',
        type: 'youtube-video',
        source: videoId,
        category: 'finance',
      });
    }
  }

  // JSON channel override
  const channelsEnv = process.env.NEXT_PUBLIC_LIVESTREAM_CHANNELS;
  if (channelsEnv) {
    try {
      const parsed = JSON.parse(channelsEnv) as LivestreamChannelConfig[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        channels.push(...parsed);
        return channels;
      }
    } catch {
      // Invalid JSON — fall through to defaults
    }
  }

  channels.push(...DEFAULT_CHANNELS.filter((c) => c.enabled !== false));
  return channels;
}

/* ─── Helpers ─── */

function extractYouTubeVideoId(url: string): string | null {
  const patterns = [
    /youtube\.com\/watch\?v=([^&]+)/,
    /youtu\.be\/([^?]+)/,
    /youtube\.com\/embed\/([^?]+)/,
    /youtube\.com\/live\/([^?]+)/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}
