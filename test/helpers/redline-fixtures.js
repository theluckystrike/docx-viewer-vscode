'use strict';
// Contract pairs for the redline tests: insertions, deletions, a moved clause, table edits and
// formatting edits, written by hand as WordprocessingML.
const { makeDocx, p, W } = require('./make-docx');

const r = (text, rPr) => `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const para = (runs, style) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}${runs}</w:p>`;
const cell = (text) => `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr>${p(text)}</w:tc>`;
const row = (cells) => `<w:tr>${cells.map(cell).join('')}</w:tr>`;
const table = (rows) => `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>${rows.map(row).join('')}</w:tbl>`;
const SECT = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>';

function contractV1() {
  return makeDocx({ body: [
    p('Services Agreement', 'Title'),
    p('1. Scope', 'Heading1'),
    para(r('The Supplier will deliver the services described in Schedule A within ') + r('thirty days', '<w:b/>') + r(' of the start date.')),
    p('2. Payment', 'Heading1'),
    para(r('The Client pays each invoice within 30 days. Late payments carry interest at 2 percent per month.')),
    p('3. Confidentiality', 'Heading1'),
    para(r('Each party keeps the other party\'s confidential information secret and uses it only for this agreement.')),
    p('4. Termination', 'Heading1'),
    para(r('Either party may end this agreement with 60 days written notice.')),
    table([['Item', 'Price'], ['Setup', '1,000 USD'], ['Support', '200 USD per month'], ['Training', '500 USD']]),
    para(r('Signed by both parties on the date below.')),
    SECT
  ].join('') });
}

function contractV2() {
  return makeDocx({ body: [
    p('Services Agreement', 'Title'),
    p('1. Scope', 'Heading1'),
    para(r('The Supplier will deliver the services described in Schedule A and Schedule B within ') + r('forty-five days', '<w:b/>') + r(' of the start date.')),
    p('2. Payment', 'Heading1'),
    para(r('The Client pays each invoice within 45 days.')),
    p('4. Termination', 'Heading1'),
    para(r('Either party may end this agreement with 60 days written notice.')),
    p('3. Confidentiality', 'Heading1'),
    para(r('Each party keeps the other party\'s confidential information secret and uses it only for this agreement.')),
    para(r('This clause survives the end of the agreement.')),
    table([['Item', 'Price'], ['Setup', '1,200 USD'], ['Support', '200 USD per month'], ['Hosting', '90 USD per month']]),
    para(r('Signed by ') + r('both parties', '<w:i/>') + r(' on the date below.')),
    SECT
  ].join('') });
}

module.exports = { contractV1, contractV2, r, para, table, cell, row, SECT, W };
