// Isolated parser: no network access is used; parent enforces time/output limits.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const chunks = [];
let size = 0;
for await (const chunk of process.stdin) {
  size += chunk.length;
  if (size > 32 * 1024 * 1024) throw new Error('file_too_large');
  chunks.push(chunk);
}
const buffer = Buffer.concat(chunks);
// DOCX/XLSX are ZIP archives. Reject ZIP64 and excessive expansion before parsing.
if (buffer.readUInt16LE(0) === 0x4b50) {
  let expanded = 0;
  let entries = 0;
  const end = buffer.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));
  if (end < 0 || end + 22 > buffer.length) throw new Error('invalid_zip');
  let offset = buffer.readUInt32LE(end + 16);
  const count = buffer.readUInt16LE(end + 10);
  if (count > 4096 || offset >= buffer.length) throw new Error('archive_limit');
  for (let i = 0; i < count; i++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('invalid_zip');
    const packed = buffer.readUInt32LE(offset + 20);
    const unpacked = buffer.readUInt32LE(offset + 24);
    const flags = buffer.readUInt16LE(offset + 8);
    expanded += unpacked;
    if ((flags & 1) || unpacked === 0xffffffff || expanded > 64 * 1024 * 1024 || unpacked > Math.max(1024 * 1024, packed * 200)) throw new Error('archive_limit');
    offset += 46 + buffer.readUInt16LE(offset + 28) + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
    entries++;
  }
  if (!entries) throw new Error('empty_archive');
}
let text = '';
let structured = {};
if (process.argv[2] === 'docx') {
  const result = await require('mammoth').extractRawText({buffer});
  text = result.value.slice(0,80_000);
  structured = {parser:'mammoth',bounded:true};
} else if (process.argv[2] === 'spreadsheet') {
  const XLSX = require('xlsx');
  const book = XLSX.read(buffer,{type:'buffer',sheetRows:1000,dense:true,cellDates:false,bookVBA:false});
  text = book.SheetNames.slice(0,12).map(name => `${name}\n${XLSX.utils.sheet_to_csv(book.Sheets[name]).slice(0,6000)}`).join('\n\n').slice(0,80_000);
  structured = {parser:'sheetjs',sheets:book.SheetNames.slice(0,12),maxRows:1000,bounded:true};
} else throw new Error('unsupported_parser');
process.stdout.write(JSON.stringify({parsedText:text,summary:text.slice(0,2400),structured}));
