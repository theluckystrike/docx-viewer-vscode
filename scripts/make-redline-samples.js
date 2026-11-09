// Writes the redline gate files to a folder (default ~/docx-viewer-vscode-work/redline-samples):
//   contract-v1/v2.docx      hand-edited contract: insertions, deletions, a moved clause, table and formatting edits
//   covenant-2.0/2.1.docx    Contributor Covenant 2.0 and 2.1 (CC BY 4.0), converted with pandoc from the real text
//   covenant-2.0.odt         the same 2.0 text as OpenDocument (for the .odt vs .docx pair)
//   mpl-1.1/2.0.docx         Mozilla Public License 1.1 and 2.0, two editions of a real licence (heavily rewritten)
//   tracked-v1/v2.docx       a file with tracked changes and comments on one side
//   simple.doc/simple-v2.doc Word 97-2003 text fallback (copied from test/fixtures)
//   large-500p-v1/v2.docx    500 pages, 200 tables, scattered edits (the speed gate)
//   hostile-*                unrelated pair, zip bomb, 10,000 footnotes, deeply nested tables, fields and content
//                            controls, password-protected container
// Usage: node scripts/make-redline-samples.js [outDir] [downloadDir]   (pandoc on PATH; texts in downloadDir)
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');
const JSZip = require('jszip');
const { makeDocx, p } = require('../test/helpers/make-docx');
const F = require('../test/helpers/redline-fixtures');

const out = process.argv[2] || path.join(os.homedir(), 'docx-viewer-vscode-work', 'redline-samples');
const dl = process.argv[3] || path.join(os.homedir(), 'docx-viewer-vscode-work', 'dl');
fs.mkdirSync(out, { recursive: true });
const put = (name, buf) => { fs.writeFileSync(path.join(out, name), buf); console.log(name, buf.length); };

const { largePair } = require('../test/helpers/redline-large');

function pandoc(input, from, to, file) {
  execFileSync('pandoc', ['-f', from, '-t', to, '-o', path.join(out, file), input], { stdio: 'inherit' });
  console.log(file, fs.statSync(path.join(out, file)).size);
}

// Licence text: join hard-wrapped lines into paragraphs for pandoc.
function textToMd(src, dst) {
  const t = fs.readFileSync(src, 'utf8').replace(/\r/g, '').replace(/\f/g, '\n');
  const paras = t.split(/\n\s*\n/).map((x) => x.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
  fs.writeFileSync(dst, paras.map((x) => x.replace(/^(\d+)\./, '$1\\.').replace(/^([*#+-])/, '\\$1')).join('\n\n') + '\n');
}

async function trackedPair() {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const comments = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:comments ' + W + '><w:comment w:id="0" w:author="Dana Reviewer" w:date="2026-10-01T10:00:00Z"><w:p><w:r><w:t>Check this date.</w:t></w:r></w:p></w:comment></w:comments>';
  const rels = [{ id: 'rIdC', type: 'comments', target: 'comments.xml' }];
  const ct = ['<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>'];
  const body1 = p('Lease summary', 'Heading1') +
    '<w:p><w:r><w:t xml:space="preserve">The lease starts on </w:t></w:r><w:del w:id="1" w:author="Sam Lawyer" w:date="2026-10-01T09:00:00Z"><w:r><w:delText>1 March</w:delText></w:r></w:del><w:ins w:id="2" w:author="Sam Lawyer" w:date="2026-10-01T09:00:00Z"><w:r><w:t>1 April</w:t></w:r></w:ins><w:r><w:t xml:space="preserve"> 2027.</w:t></w:r><w:commentRangeStart w:id="0"/><w:r><w:t xml:space="preserve"> Rent is due monthly.</w:t></w:r><w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p>' +
    p('The tenant pays for electricity and water.') + p('Pets are not allowed.') + F.SECT;
  const body2 = p('Lease summary', 'Heading1') +
    '<w:p><w:r><w:t xml:space="preserve">The lease starts on 1 April 2027.</w:t></w:r><w:commentRangeStart w:id="0"/><w:r><w:t xml:space="preserve"> Rent is due on the first day of each month.</w:t></w:r><w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p>' +
    p('The tenant pays for electricity, water and internet.') + p('One small pet is allowed with written consent.') + p('The deposit is two months of rent.') + F.SECT;
  put('tracked-v1.docx', await makeDocx({ body: body1, rels, extraParts: { 'word/comments.xml': comments }, contentTypes: ct }));
  put('tracked-v2.docx', await makeDocx({ body: body2, rels, extraParts: { 'word/comments.xml': comments }, contentTypes: ct }));
}

async function hostile() {
  // 10,000 footnotes.
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const notes = ['<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>'];
  const body = [];
  for (let i = 1; i <= 10000; i++) {
    notes.push('<w:footnote w:id="' + i + '"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> Source note ' + i + '.</w:t></w:r></w:p></w:footnote>');
    body.push('<w:p><w:r><w:t xml:space="preserve">Claim ' + i + ' is supported</w:t></w:r><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteReference w:id="' + i + '"/></w:r><w:r><w:t xml:space="preserve"> by the record' + (i % 997 === 0 ? ' (checked)' : '') + '.</w:t></w:r></w:p>');
  }
  put('hostile-10000-footnotes.docx', await makeDocx({ body: body.join('') + F.SECT, rels: [{ id: 'rIdF', type: 'footnotes', target: 'footnotes.xml' }], extraParts: { 'word/footnotes.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:footnotes ' + W + '>' + notes.join('') + '</w:footnotes>' }, contentTypes: ['<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>'] }));
  // Tables nested 120 deep.
  let inner = p('Deepest cell text');
  for (let d = 0; d < 120; d++) inner = '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>' + inner + p('level ' + d) + '</w:tc></w:tr></w:tbl>';
  put('hostile-nested-tables.docx', await makeDocx({ body: p('Nested tables, 120 levels.') + inner + p('After the tables.') + F.SECT }));
  // Field codes and content controls.
  const fields = p('Fields and content controls', 'Heading1') +
    '<w:p><w:r><w:t xml:space="preserve">Page </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:t xml:space="preserve"> of the contract dated </w:t></w:r><w:fldSimple w:instr=" DATE "><w:r><w:t>9 November 2026</w:t></w:r></w:fldSimple><w:r><w:t>.</w:t></w:r></w:p>' +
    '<w:sdt><w:sdtPr><w:alias w:val="Client name"/><w:tag w:val="client"/><w:id w:val="1234"/></w:sdtPr><w:sdtContent>' + p('Client: Northwind Traders Ltd') + p('Address: 1 Harbour Road') + '</w:sdtContent></w:sdt>' +
    '<w:p><w:r><w:t xml:space="preserve">Signed for </w:t></w:r><w:sdt><w:sdtPr><w:tag w:val="signer"/></w:sdtPr><w:sdtContent><w:r><w:t>the Supplier</w:t></w:r></w:sdtContent></w:sdt><w:r><w:t xml:space="preserve"> by its director.</w:t></w:r></w:p>' + F.SECT;
  put('hostile-fields-controls-v1.docx', await makeDocx({ body: fields }));
  put('hostile-fields-controls-v2.docx', await makeDocx({ body: fields.replace('Northwind Traders Ltd', 'Northwind Traders Limited').replace('the Supplier', 'the Service Provider').replace(' PAGE ', ' PAGE \\* Arabic ').replace('by its director', 'by two directors') }));
  // Password-protected container: an OLE file with an EncryptedPackage stream, as Word writes it.
  const enc = Buffer.alloc(4096);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(enc);
  Buffer.from('EncryptionInfo', 'utf16le').copy(enc, 1024);
  Buffer.from('EncryptedPackage', 'utf16le').copy(enc, 1152);
  put('hostile-password.docx', enc);
  // Zip bomb: word/document.xml unpacks to 1 GB of spaces inside a valid package (about 1 MB on disk).
  const ok = await makeDocx({ body: p('placeholder') });
  const zip = await JSZip.loadAsync(ok);
  const files = {};
  for (const n of Object.keys(zip.files)) if (!zip.files[n].dir) files[n] = await zip.file(n).async('nodebuffer');
  const head = Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>');
  const tail = Buffer.from('</w:t></w:r></w:p></w:body></w:document>');
  const total = 1024 * 1024 * 1024;
  const def = zlib.createDeflateRaw({ level: 9 });
  const parts = [];
  def.on('data', (d) => parts.push(d));
  const spaces = Buffer.alloc(1024 * 1024, 0x20);
  let c = crc32(head, 0);
  def.write(head);
  for (let i = 0; i < (total - head.length - tail.length) / spaces.length; i++) { def.write(spaces); c = crc32(spaces, c); }
  def.write(tail);
  c = crc32(tail, c);
  await new Promise((res) => def.end(res));
  const data = Buffer.concat(parts);
  const size = head.length + tail.length + Math.floor((total - head.length - tail.length) / spaces.length) * spaces.length;
  files['word/document.xml'] = { raw: data, crc: c >>> 0, size };
  put('hostile-zip-bomb.docx', buildZip(files));
}

// CRC-32 (IEEE), table driven.
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf, prev) { let c = (prev ^ 0xffffffff) >>> 0; for (let i = 0; i < buf.length; i++) c = CRC_T[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

// Minimal ZIP writer: plain entries are deflated here, { raw, crc, size } entries are already deflated.
function buildZip(files) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, v] of Object.entries(files)) {
    const nb = Buffer.from(name);
    const plain = Buffer.isBuffer(v) ? v : null;
    const raw = plain ? zlib.deflateRawSync(plain) : v.raw;
    const crc = plain ? crc32(plain, 0) : v.crc;
    const size = plain ? plain.length : v.size;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(0, 10);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(raw.length, 18); lh.writeUInt32LE(size, 22); lh.writeUInt16LE(nb.length, 26); lh.writeUInt16LE(0, 28);
    locals.push(lh, nb, raw);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0, 8); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(0, 12);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(raw.length, 20); ch.writeUInt32LE(size, 24); ch.writeUInt16LE(nb.length, 28);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, nb);
    offset += 30 + nb.length + raw.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

(async () => {
  put('contract-v1.docx', await F.contractV1());
  put('contract-v2.docx', await F.contractV2());
  const [l1, l2] = largePair();
  put('large-500p-v1.docx', await makeDocx({ body: l1 }));
  put('large-500p-v2.docx', await makeDocx({ body: l2 }));
  await trackedPair();
  await hostile();
  for (const f of ['simple.doc', 'simple-v2.doc']) fs.copyFileSync(path.join(__dirname, '..', 'test', 'fixtures', f), path.join(out, f));
  // Real texts (downloaded by the gate script): pandoc makes the Word and OpenDocument files.
  const strip = (src, dst) => fs.writeFileSync(dst, fs.readFileSync(src, 'utf8').replace(/^\+\+\+[\s\S]*?\+\+\+\s*/, ''));
  if (fs.existsSync(path.join(dl, 'cc-20.md'))) {
    strip(path.join(dl, 'cc-20.md'), path.join(dl, 'cc-20.clean.md'));
    strip(path.join(dl, 'cc-21.md'), path.join(dl, 'cc-21.clean.md'));
    pandoc(path.join(dl, 'cc-20.clean.md'), 'markdown', 'docx', 'covenant-2.0.docx');
    pandoc(path.join(dl, 'cc-21.clean.md'), 'markdown', 'docx', 'covenant-2.1.docx');
    pandoc(path.join(dl, 'cc-20.clean.md'), 'markdown', 'odt', 'covenant-2.0.odt');
  }
  if (fs.existsSync(path.join(dl, 'mpl-1.1.txt'))) {
    textToMd(path.join(dl, 'mpl-1.1.txt'), path.join(dl, 'mpl-1.1.md'));
    textToMd(path.join(dl, 'mpl-2.0.txt'), path.join(dl, 'mpl-2.0.md'));
    pandoc(path.join(dl, 'mpl-1.1.md'), 'markdown', 'docx', 'mpl-1.1.docx');
    pandoc(path.join(dl, 'mpl-2.0.md'), 'markdown', 'docx', 'mpl-2.0.docx');
  }
  if (fs.existsSync(path.join(dl, 'gpl-3.0.txt'))) {
    textToMd(path.join(dl, 'gpl-3.0.txt'), path.join(dl, 'gpl-3.0.md'));
    pandoc(path.join(dl, 'gpl-3.0.md'), 'markdown', 'docx', 'hostile-unrelated-gpl-3.0.docx');
  }
})().catch((e) => { console.error(e); process.exit(1); });
