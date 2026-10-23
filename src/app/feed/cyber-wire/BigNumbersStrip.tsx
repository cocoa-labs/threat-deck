import styles from './cyberwire.module.css';

export type BigNumber = {
  label: string;
  value: string;
  unit?: string;
};

/**
 * BigNumbersStrip — NORAD-scoreboard 4-column metric strip.
 *
 * VT323 oversized numbers, mono caps labels. Values pre-formatted by the
 * page (so we can do K/M/B abbreviations close to the data layer).
 */
export function BigNumbersStrip({ items }: { items: BigNumber[] }) {
  return (
    <section className={styles.bigNumbers} aria-label="Daily cyber metrics">
      {items.map((item) => (
        <div key={item.label} className={styles.bigCell}>
          <div className={styles.bigCellLabel}>{item.label}</div>
          <div className={styles.bigCellValue}>{item.value}</div>
          {item.unit ? <div className={styles.bigCellUnit}>{item.unit}</div> : null}
        </div>
      ))}
    </section>
  );
}
