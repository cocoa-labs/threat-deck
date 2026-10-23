import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const result = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const baseline = JSON.parse(readFileSync('.github/security-baseline.json', 'utf8'));
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const rule = id => id.slice(id.search(/(?:javascript|typescript)\./));
let failed = false;
for (const finding of result.results ?? []) {
  if (finding.extra.metadata?.category !== 'security') continue;
  const reviewed = baseline.findings.find(item => item.path === finding.path && item.rule === rule(finding.check_id) && item.line === finding.start.line && item.sha256 === hash(finding.path) && item.disposition);
  if (!reviewed) {
    console.error(`Unreviewed security finding: ${finding.path}:${finding.start.line} ${rule(finding.check_id)}`);
    failed = true;
  }
}
for (const error of result.errors ?? []) {
  const reviewed = baseline.parserLimitations.find(item => item.path === error.path && item.message === error.message && item.sha256 === hash(error.path));
  if (!reviewed) {
    console.error(`Unreviewed scanner error: ${error.message}`);
    failed = true;
  }
}
if (!(result.paths?.scanned?.length > 700)) throw new Error('Static analysis did not cover the expected source tree');
if (failed) process.exit(1);
console.log('Security findings match individually reviewed, file-hash-bound dispositions. See .github/security-baseline.json for scanner coverage limitations.');
