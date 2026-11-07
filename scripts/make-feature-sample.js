// Writes test/fixtures/pump-test.docx: a short engineering note with a column chart, a line chart,
// display and inline equations and numbered figure captions (w:fldSimple). Used by the tests and
// for the README screenshot. Run: node scripts/make-feature-sample.js
const fs = require('fs');
const path = require('path');
const { makeDocx, p } = require('../test/helpers/make-docx');

const NS = 'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"';
const r = (t) => `<m:r><m:t>${t}</m:t></m:r>`;
const frac = (a, b) => `<m:f><m:num>${a}</m:num><m:den>${b}</m:den></m:f>`;
const sup = (e, s) => `<m:sSup><m:e>${e}</m:e><m:sup>${s}</m:sup></m:sSup>`;
const sub = (e, s) => `<m:sSub><m:e>${e}</m:e><m:sub>${s}</m:sub></m:sSub>`;
const darcy = `<w:p><m:oMathPara><m:oMath>${sub(r('h'), r('f'))}${r('=f')}${frac(r('L'), r('D'))}${frac(sup(r('v'), r('2')), r('2g'))}</m:oMath></m:oMathPara></w:p>`;
const power = `<w:p><m:oMathPara><m:oMath>${r('P=')}${frac(r('ρgQH'), sub(r('η'), r('p')))}</m:oMath></m:oMathPara></w:p>`;
const inline = `<w:p><w:r><w:t xml:space="preserve">With </w:t></w:r><m:oMath>${r('g=9.81')}</m:oMath><w:r><w:t xml:space="preserve"> m/s², pump B needs about </w:t></w:r><m:oMath>${r('P≈')}${frac(r('1000·9.81·0.042·38'), r('0.74'))}</m:oMath><w:r><w:t xml:space="preserve">, or 21 kW at the duty point.</w:t></w:r></w:p>`;
const caption = (n, text) => `<w:p><w:pPr><w:pStyle w:val="Caption"/></w:pPr><w:r><w:t xml:space="preserve">Figure </w:t></w:r><w:fldSimple w:instr=" SEQ Figure \\* ARABIC "><w:r><w:t>${n}</w:t></w:r></w:fldSimple><w:r><w:t xml:space="preserve">. ${text}</w:t></w:r></w:p>`;
const drawing = (rid, n) => `<w:p><w:r><w:drawing><wp:inline><wp:extent cx="5486400" cy="2743200"/><wp:docPr id="${n}" name="Chart ${n}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="${rid}"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;

function chart(kind, title, cats, series, extra) {
  const strCache = (vals) => `<c:strCache><c:ptCount val="${vals.length}"/>${vals.map((v, i) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join('')}</c:strCache>`;
  const numCache = (vals) => `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${vals.length}"/>${vals.map((v, i) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join('')}</c:numCache>`;
  const sers = series.map(([name, vals], i) => `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:strRef>${strCache([name])}</c:strRef></c:tx><c:cat><c:strRef>${strCache(cats)}</c:strRef></c:cat><c:val><c:numRef>${numCache(vals)}</c:numRef></c:val></c:ser>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:t>${title}</a:t></a:r></a:p></c:rich></c:tx></c:title><c:autoTitleDeleted val="0"/><c:plotArea><c:${kind}>${extra}${sers}<c:axId val="1"/><c:axId val="2"/></c:${kind}></c:plotArea><c:legend><c:legendPos val="b"/></c:legend></c:chart></c:chartSpace>`;
}

const body = [
  p('Pump Test Results, Line 3', 'Title'),
  p('Summary', 'Heading1'),
  p('We tested three replacement pumps on line 3 in October. Pump B gives the most flow per kilowatt and meets the 40 L/s target at 38 m of head. The head loss in the 120 m suction line follows the Darcy-Weisbach equation:'),
  darcy,
  p('Flow at the duty point', 'Heading1'),
  drawing('rIdC1', 1),
  caption(1, 'Measured flow at 38 m head, three runs per pump.'),
  p('Power', 'Heading1'),
  p('Shaft power comes from the flow, the head and the pump efficiency:'),
  power,
  inline,
  drawing('rIdC2', 2),
  caption(2, 'Efficiency against flow for pumps A and B.'),
  p('Next steps', 'Heading1'),
  p('Order two pump B units before the December shutdown and repeat the test after six months.')
].join('');

(async () => {
  const buf = await makeDocx({
    body,
    ns: NS,
    rels: [{ id: 'rIdC1', type: 'chart', target: 'charts/chart1.xml' }, { id: 'rIdC2', type: 'chart', target: 'charts/chart2.xml' }],
    extraParts: {
      'word/charts/chart1.xml': chart('barChart', 'Flow at 38 m head (L/s)', ['Pump A', 'Pump B', 'Pump C'], [['Run 1', [36.2, 42.1, 33.8]], ['Run 2', [35.9, 41.7, 34.4]], ['Run 3', [36.5, 42.4, 33.1]]], '<c:barDir val="col"/><c:grouping val="clustered"/>'),
      'word/charts/chart2.xml': chart('lineChart', 'Efficiency (%)', ['20 L/s', '30 L/s', '40 L/s', '50 L/s', '60 L/s'], [['Pump A', [58, 66, 71, 69, 61]], ['Pump B', [61, 70, 74, 73, 67]]], '<c:grouping val="standard"/>')
    },
    contentTypes: [
      '<Override PartName="/word/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>',
      '<Override PartName="/word/charts/chart2.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>'
    ]
  });
  const out = path.join(__dirname, '..', 'test', 'fixtures', 'pump-test.docx');
  fs.writeFileSync(out, buf);
  console.log('wrote', out, buf.length, 'bytes');
})();
