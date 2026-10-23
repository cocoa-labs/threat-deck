-- RSS advisory ids were truncated to 80 characters before being used as the
-- UNIQUE upsert key. Chrome release URLs often differ only after that prefix,
-- so distinct releases overwrote one another. Move surviving legacy Chrome
-- rows to the complete canonical URL identity used by the fixed collector.

-- If fixed-code ingestion ran before this migration, preserve any signals by
-- repointing them to the already-canonical row, then remove the stale duplicate.
UPDATE aegis_advisory_signals AS signal
SET advisory_id = canonical.id
FROM aegis_advisories AS legacy
JOIN aegis_advisories AS canonical
  ON canonical.advisory_id = 'chrome-' || legacy.advisory_url
  AND canonical.id <> legacy.id
WHERE signal.advisory_id = legacy.id
  AND legacy.advisory_id LIKE 'chrome-http%'
  AND legacy.advisory_url IS NOT NULL
  AND legacy.advisory_id <> 'chrome-' || legacy.advisory_url;

DELETE FROM aegis_advisories AS legacy
WHERE legacy.advisory_id LIKE 'chrome-http%'
  AND legacy.advisory_url IS NOT NULL
  AND legacy.advisory_id <> 'chrome-' || legacy.advisory_url
  AND EXISTS (
    SELECT 1
    FROM aegis_advisories AS canonical
    WHERE canonical.advisory_id = 'chrome-' || legacy.advisory_url
      AND canonical.id <> legacy.id
  );

UPDATE aegis_advisories
SET advisory_id = 'chrome-' || advisory_url
WHERE advisory_id LIKE 'chrome-http%'
  AND advisory_url IS NOT NULL
  AND advisory_id <> 'chrome-' || advisory_url;
