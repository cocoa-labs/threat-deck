import styles from './cyberwire.module.css';

export type Brief = {
  id: number;
  kicker: string;
  headline: string;
  summary: string;
  readMoreHref: string | null;
};

/**
 * BriefGrid — three-column row of next-most-critical alerts as magazine
 * cards. Severity-color kicker, bold headline, 3-line summary clamp,
 * Matrix-green hover slide on left border.
 */
export function BriefGrid({ briefs }: { briefs: Brief[] }) {
  if (briefs.length === 0) return null;
  return (
    <section className={styles.briefSection} aria-label="Today's briefs">
      <h3 className={styles.sectionTitle}>Also in the wire</h3>
      <div className={styles.briefGrid}>
        {briefs.map((brief) => (
          <a key={brief.id} href={brief.readMoreHref ?? '#'} className={styles.briefCard}>
            <div className={styles.briefKicker}>{brief.kicker}</div>
            <div className={styles.briefHeadline}>{brief.headline}</div>
            <div className={styles.briefSummary}>{brief.summary}</div>
            <div className={styles.briefLink}>Read full brief →</div>
          </a>
        ))}
      </div>
    </section>
  );
}
