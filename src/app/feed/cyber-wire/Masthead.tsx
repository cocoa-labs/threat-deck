import styles from './cyberwire.module.css';

/**
 * Masthead — the broadsheet header. Cocoa AI italic + // AI CYBER WIRE VT323
 * + dateline + subscribe row, all closing on the first 2px brand seam
 * stripe (the page has two — opening here, closing in the footer).
 *
 * Phase 9.6: wire mark narrowed to "AI Cyber Wire" so the public surface
 * commits to the AI-cyber niche. Twitter handle updated to the configured X account
 * (locked Phase 9.x decision).
 */
export function Masthead({
  volume,
  issue,
  dateline,
}: {
  /** Edition volume number (publication year). */
  volume: number;
  /** Issue number within the volume. */
  issue: number;
  /** Pre-formatted dateline string: "Tuesday May 23, 2026 · 12:00 ET". */
  dateline: string;
}) {
  return (
    <header className={styles.masthead}>
      <div className={styles.brandRow}>
        <span className={styles.brandName}>Cocoa AI</span>
        <span className={styles.brandSeparator} aria-hidden />
        <span className={styles.wireMark}>AI Cyber Wire</span>
      </div>
      <div className={styles.dateline}>
        <span>Vol. {volume}</span>
        <span className={styles.dateSep}>·</span>
        <span>No. {issue}</span>
        <span className={styles.dateSep}>·</span>
        <span>{dateline}</span>
      </div>
      <div className={styles.subscribeRow}>
        <span>Subscribe</span>
        <span className={styles.dateSep}>·</span>
        <a className={styles.subscribeLink} href="/feed/cyber-wire.rss">
          RSS
        </a>
        <span className={styles.dateSep}>·</span>
        <a
          className={styles.subscribeLink}
          href="mailto:?subject=Subscribe%20to%20AI%20Cyber%20Wire"
        >
          Email
        </a>
      </div>
    </header>
  );
}
