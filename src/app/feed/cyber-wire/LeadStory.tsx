import styles from './cyberwire.module.css';

/**
 * LeadStory — magazine-style featured alert. Drop-cap first paragraph,
 * Instrument Serif italic headline, italic byline, Geist Mono body at
 * comfortable measure (~70ch via parent max-width).
 *
 * The drop cap is the "no one expects this on a cyber dashboard"
 * detail — editorial authority signal.
 */
export function LeadStory({
  kicker,
  headline,
  byline,
  body,
  entityKind,
  entityId,
}: {
  /** e.g. "CRITICAL · KEV · 14m ago" */
  kicker: string;
  headline: string;
  byline: string;
  /** Plain-text body — paragraphs separated by \n\n */
  body: string;
  /** Entity kind (cve / kev / incident) for the "read full brief" link */
  entityKind: string | null;
  /** Entity ID for the link target */
  entityId: string | null;
}) {
  const paragraphs = body.split(/\n\n+/).filter(Boolean);
  const readMoreHref = entityKind && entityId ? buildReadMoreUrl(entityKind, entityId) : null;

  return (
    <article className={styles.leadStory}>
      <div className={styles.leadKicker}>
        <span className={styles.leadKickerDot} aria-hidden />
        {kicker}
      </div>
      <h2 className={styles.leadHeadline}>{headline}</h2>
      <div className={styles.leadByline}>{byline}</div>
      <div className={styles.leadBody}>
        {paragraphs.map((p, i) => (
          <p key={`p-${i}`}>{p}</p>
        ))}
      </div>
      <div className={styles.leadFooter}>
        <span>AEGIS-triaged</span>
        {readMoreHref ? (
          <a className={styles.leadLink} href={readMoreHref}>
            Read full brief →
          </a>
        ) : null}
      </div>
    </article>
  );
}

function buildReadMoreUrl(entityKind: string, entityId: string): string {
  switch (entityKind) {
    case 'cve':
      return `/api/aegis/cves/view?id=${encodeURIComponent(entityId)}`;
    case 'kev':
      return `/api/aegis/kev/view?id=${encodeURIComponent(entityId)}`;
    case 'incident':
      return `/api/aegis/incidents/view?id=${encodeURIComponent(entityId)}`;
    default:
      return `/api/aegis/cves/view?id=${encodeURIComponent(entityId)}`;
  }
}
