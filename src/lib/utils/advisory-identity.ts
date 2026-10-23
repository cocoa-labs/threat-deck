import type { Advisory } from '@/lib/types';

type AdvisoryIdentityFields = Pick<
  Advisory,
  'id' | 'issuer' | 'publishedAt' | 'advisoryId' | 'advisoryUrl'
>;

interface RssAdvisoryIdentityInput {
  guid?: string | null;
  link?: string | null;
  title?: string | null;
}

/**
 * Build the persisted source id for an RSS advisory.
 *
 * The source value must stay complete. Truncating it before hashing collapses
 * distinct feed entries whose URLs share a long prefix (Chrome release posts
 * are a real example).
 */
export function createRssAdvisoryId(source: string, item: RssAdvisoryIdentityInput): string {
  const sourceIdentity = item.guid?.trim() || item.link?.trim() || item.title?.trim() || 'untitled';
  return `${source}-${sourceIdentity}`;
}

/** Canonical identity shared by React rows, feed dedup, and activation dedup. */
export function advisoryIdentityKey(advisory: AdvisoryIdentityFields): string {
  const advisoryId = advisory.advisoryId?.trim();
  if (advisoryId) return `advisory:${advisoryId}`;

  const url = advisory.advisoryUrl?.trim();
  if (url) return `url:${url}`;

  return `legacy:${advisory.issuer}:${advisory.id}:${advisory.publishedAt}`;
}

/** Keep the first occurrence of each canonical identity without reordering. */
export function dedupeAdvisoriesByIdentity<T extends AdvisoryIdentityFields>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = advisoryIdentityKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
