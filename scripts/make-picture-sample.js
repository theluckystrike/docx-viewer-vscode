// Writes Word files with EMF, WMF and TIFF pictures (and a Word-style table of contents) for the
// tests and the release check. Run: node scripts/make-picture-sample.js [outDir] [--hostile]
//   pictures.docx          EMF, EMF+ dual, WMF (VML, like old equations), TIFF LZW, PackBits, Deflate, 2-page TIFF
//   toc.docx               a table of contents field with links to the headings
//   hostile-pictures.docx  (--hostile) cut-off, oversized and broken pictures; each must become a small note
const fs = require('fs');
const path = require('path');
const { makeDocx, p } = require('../test/helpers/make-docx');
const F = require('../test/helpers/picture-files');

const NS = 'xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"';
const TYPES = ['<Default Extension="emf" ContentType="image/x-emf"/>', '<Default Extension="wmf" ContentType="image/x-wmf"/>', '<Default Extension="tif" ContentType="image/tiff"/>'];

function inline(rid, n, name, cx, cy) {
  return `<w:p><w:r><w:drawing><wp:inline><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${n}" name="Picture ${n}" descr="${name}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${n}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}
function vml(rid, wPt, hPt) {
  return `<w:p><w:r><w:t xml:space="preserve">Old equation object: </w:t></w:r><w:r><w:object><v:shape id="_x0000_i1025" type="#_x0000_t75" style="width:${wPt}pt;height:${hPt}pt" o:ole=""><v:imagedata r:id="${rid}" o:title=""/></v:shape></w:object></w:r></w:p>`;
}

async function picturesDocx(items) {
  const rels = [];
  const parts = {};
  const body = [p('Pictures Word draws from metafiles', 'Title')];
  items.forEach((it, i) => {
    const rid = 'rIdP' + (i + 1);
    const file = 'media/image' + (i + 1) + '.' + it.ext;
    rels.push({ id: rid, type: 'image', target: file });
    parts['word/' + file] = it.bytes;
    body.push(p(it.title, 'Heading1'));
    if (it.note) body.push(p(it.note));
    body.push(it.vml ? vml(rid, 144, 72) : inline(rid, i + 1, it.title, it.cx || 1828800, it.cy || 914400));
  });
  body.push(p('End of the picture test.'));
  return makeDocx({ body: body.join(''), ns: NS, rels, extraParts: parts, contentTypes: TYPES });
}

async function tocDocx() {
  const heads = [['Introduction', 1], ['Scope of the review', 2], ['Method', 1], ['Interviews', 2], ['Survey', 2], ['Findings', 1], ['Recommendations', 1]];
  const entry = (t, lvl, i, first, last) => `<w:p><w:pPr><w:pStyle w:val="TOC${lvl}"/><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9016"/></w:tabs></w:pPr>` +
    (first ? '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>' : '') +
    `<w:hyperlink w:anchor="_Toc${100 + i}" w:history="1"><w:r><w:t>${t}</w:t></w:r><w:r><w:tab/></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGEREF _Toc${100 + i} \\h </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>${i + 2}</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:hyperlink></w:p>` +
    (last ? '<w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>' : '');
  const toc = '<w:sdt><w:sdtPr><w:docPartObj><w:docPartGallery w:val="Table of Contents"/><w:docPartUnique/></w:docPartObj></w:sdtPr><w:sdtContent>' +
    '<w:p><w:pPr><w:pStyle w:val="TOCHeading"/></w:pPr><w:r><w:t>Contents</w:t></w:r></w:p>' +
    heads.map(([t, l], i) => entry(t, l, i, i === 0, i === heads.length - 1)).join('') + '</w:sdtContent></w:sdt>';
  const sections = heads.map(([t, l], i) => `<w:p><w:pPr><w:pStyle w:val="Heading${l}"/></w:pPr><w:bookmarkStart w:id="${i}" w:name="_Toc${100 + i}"/><w:r><w:t>${t}</w:t></w:r><w:bookmarkEnd w:id="${i}"/></w:p>` +
    p('Text of the section "' + t + '". '.repeat(1) + 'This paragraph is here so the headings sit on different screens.') + '<w:p><w:r><w:br w:type="page"/></w:r></w:p>').join('');
  return makeDocx({ body: p('Review of the Field Office', 'Title') + toc + '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' + sections });
}

async function main() {
  const out = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(__dirname, '..', 'test', 'fixtures'));
  fs.mkdirSync(out, { recursive: true });
  const good = [
    { title: 'EMF drawing', ext: 'emf', bytes: F.sampleEmf() },
    { title: 'EMF+ dual drawing', note: 'EMF+ records first, then the same picture as plain EMF records.', ext: 'emf', bytes: F.sampleEmf({ plus: true, text: 'EMF+ dual file' }) },
    { title: 'WMF picture', ext: 'wmf', bytes: F.sampleWmf(), vml: true },
    { title: 'TIFF, LZW', ext: 'tif', bytes: F.sampleTiff(5) },
    { title: 'TIFF, PackBits', ext: 'tif', bytes: F.sampleTiff(32773) },
    { title: 'TIFF, Deflate', ext: 'tif', bytes: F.sampleTiff(8) },
    { title: 'TIFF with two pages', note: 'Word shows the first page: red and blue halves.', ext: 'tif', bytes: F.sampleTiff(1, true) }
  ];
  fs.writeFileSync(path.join(out, 'pictures.docx'), await picturesDocx(good));
  fs.writeFileSync(path.join(out, 'toc.docx'), await tocDocx());
  if (process.argv.includes('--hostile')) {
    const H = F.hostile;
    const bad = [
      { title: 'Cut-off EMF (draws what is there)', ext: 'emf', bytes: H.emfTruncated() },
      { title: 'EMF with a huge declared size', ext: 'emf', bytes: H.emfHugeBounds() },
      { title: 'EMF with a zero-length record', ext: 'emf', bytes: H.emfZeroRecord() },
      { title: 'EMF with 250,000 records', ext: 'emf', bytes: H.emfRecordFlood() },
      { title: 'EMF with a 100000 x 100000 bitmap', ext: 'emf', bytes: H.emfBitmapBomb() },
      { title: 'EMF+ only', ext: 'emf', bytes: F.emfPlusOnly() },
      { title: 'WMF with a zero-length record', ext: 'wmf', bytes: H.wmfZeroRecord() },
      { title: 'Cut-off WMF', ext: 'wmf', bytes: H.wmfTruncated() },
      { title: 'TIFF that says 100000 x 100000 pixels', ext: 'tif', bytes: H.tiffHuge() },
      { title: 'TIFF whose page list loops', ext: 'tif', bytes: H.tiffIfdLoop() },
      { title: 'TIFF with a broken page table', ext: 'tif', bytes: H.tiffBadIfd() },
      { title: 'TIFF with broken LZW data', ext: 'tif', bytes: H.tiffLzwGarbage() },
      { title: 'TIFF with a Deflate bomb', ext: 'tif', bytes: H.tiffDeflateBomb() }
    ];
    fs.writeFileSync(path.join(out, 'hostile-pictures.docx'), await picturesDocx(bad));
  }
  console.log('Wrote', out);
}
main().catch((e) => { console.error(e); process.exit(1); });
