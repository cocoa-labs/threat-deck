// @vitest-environment node
import { expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseOffice } from './office-parser';

it('parses a synthetic spreadsheet in the bounded subprocess', async () => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([
      ['System', 'Severity'],
      ['Example server', 'high'],
    ]),
    'Example',
  );
  const result = await parseOffice(
    'spreadsheet',
    XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }),
  );
  expect(result.parsedText).toContain('Example server');
});
it('rejects malformed and expansion-bomb archives before parsing', async () => {
  await expect(parseOffice('docx', Buffer.from('PK invalid archive'))).rejects.toThrow(
    'invalid_or_oversized',
  );
  const data = Buffer.alloc(100);
  data.writeUInt32LE(0x04034b50, 0);
  data.writeUInt32LE(0x02014b50, 20);
  data.writeUInt32LE(0x7fffffff, 44);
  data.writeUInt32LE(0x06054b50, 78);
  data.writeUInt16LE(1, 88);
  data.writeUInt32LE(20, 94);
  await expect(parseOffice('spreadsheet', data)).rejects.toThrow('invalid_or_oversized');
});
