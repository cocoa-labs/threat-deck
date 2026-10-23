import styles from './cyberwire.module.css';

export type IndexEntry = {
  id: number;
  time: string;
  tag: 'CVE' | 'KEV' | 'BRH' | 'PCH';
  headline: string;
  href: string | null;
};

/**
 * IndexList — data-dense scrollable footer-of-the-day. All triaged alerts
 * in chronological order with timestamp, type chip, and headline.
 *
 * Used as the "everything else" catch-all after the lead + brief grid.
 * Matrix-green left border slides in on hover (subtle padding shift).
 */
export function IndexList({ entries }: { entries: IndexEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <section className={styles.indexSection} aria-label="Today's index">
      <h3 className={styles.sectionTitle}>Today&rsquo;s Index</h3>
      <div className={styles.indexList}>
        {entries.map((entry) => (
          <a key={entry.id} href={entry.href ?? '#'} className={styles.indexRow}>
            <span className={styles.indexTime}>{entry.time}</span>
            <span className={`${styles.indexTag} ${tagClass(entry.tag)}`}>{entry.tag}</span>
            <span className={styles.indexHeadline}>{entry.headline}</span>
          </a>
        ))}
      </div>
    </section>
  );
}

function tagClass(tag: IndexEntry['tag']): string {
  switch (tag) {
    case 'CVE':
      return styles.indexTagCve ?? '';
    case 'KEV':
      return styles.indexTagKev ?? '';
    case 'BRH':
      return styles.indexTagBreach ?? '';
    case 'PCH':
      return styles.indexTagPatch ?? '';
    default:
      return '';
  }
}
