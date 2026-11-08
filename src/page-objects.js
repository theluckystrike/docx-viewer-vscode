'use strict';
// Page view: docx-preview draws VML pictures inside <w:pict> but skips <w:object>, which Word uses
// for OLE objects (old Equation Editor and MathType equations, embedded files). Their picture is the
// same VML, usually a WMF or EMF. The object parts are renamed to <w:pict> before layout, so those
// pictures show (drawn by media/pictures.js). Files without <w:object> pass through untouched.
const PARTS = /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/;

async function showObjects(JSZip, data) {
  let zip;
  try { zip = await JSZip.loadAsync(data); } catch (_) { return data; } // docx-preview reports it
  let changed = false;
  for (const name of Object.keys(zip.files)) {
    if (!PARTS.test(name) || zip.files[name].dir) continue;
    const xml = await zip.file(name).async('string');
    if (xml.indexOf('<w:object') === -1) continue;
    zip.file(name, xml.replace(/<w:object(?=[\s>/])/g, '<w:pict').replace(/<\/w:object>/g, '</w:pict>'));
    changed = true;
  }
  return changed ? zip.generateAsync({ type: 'uint8array', compression: 'STORE' }) : data;
}

module.exports = { showObjects };
