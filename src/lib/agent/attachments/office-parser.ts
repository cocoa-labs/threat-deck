import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { requireAttachmentIngestion } from './office-policy';

export function parseOffice(
  kind: 'docx' | 'spreadsheet',
  bytes: Buffer,
): Promise<{
  parsedText: string;
  summary: string;
  structured: Record<string, unknown>;
}> {
  if (process.env.ENABLE_OFFICE_INGESTION !== 'true')
    return Promise.reject(new Error('office_ingestion_disabled'));
  requireAttachmentIngestion({ kind, filename: kind === 'docx' ? 'input.docx' : 'input.xlsx' });
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--max-old-space-size=256', join(process.cwd(), 'scripts/parse-office.mjs'), kind],
      {
        stdio: ['pipe', 'pipe', 'ignore'],
        // Parser subprocesses receive no API keys, database URLs or auth secrets.
        env: { NODE_ENV: 'production', PATH: process.env.PATH },
      },
    );
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('parser_timeout'));
    }, 10_000);
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
      if (output.length > 1024 * 1024) {
        child.kill('SIGKILL');
        reject(new Error('parser_output_limit'));
      }
    });
    child.on('error', () => {
      clearTimeout(timeout);
      reject(new Error('parser_failed'));
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error('invalid_or_oversized_office_file'));
        return;
      }
      try {
        resolve(JSON.parse(output));
      } catch {
        reject(new Error('parser_invalid_output'));
      }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(bytes);
  });
}
