'use strict';
// File format sniffing and user-facing notices. No dependencies, so the
// extension host can load it without pulling in mammoth.

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const RTF_MAGIC = [0x7b, 0x5c, 0x72, 0x74, 0x66]; // {\rtf

function startsWith(buf, magic) {
  if (!buf || buf.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) if (buf[i] !== magic[i]) return false;
  return true;
}

// Word's "Save as Web Page" and many export tools write HTML or MHTML files with a .doc name.
const HTML_HEAD = /^(?:\ufeff)?\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!doctype\s+html|<html|mime-version\s*:)/i;

// Returns 'zip' | 'ole' | 'rtf' | 'html' | 'empty' | 'unknown'.
function detectFormat(buf) {
  if (!buf || buf.length === 0) return 'empty';
  if (startsWith(buf, ZIP_MAGIC)) return 'zip';
  if (startsWith(buf, OLE_MAGIC)) return 'ole';
  if (startsWith(buf, RTF_MAGIC)) return 'rtf';
  const head = Buffer.from(buf.buffer || buf, buf.byteOffset || 0, Math.min(buf.length, 1024)).toString('utf8');
  if (HTML_HEAD.test(head)) return 'html';
  return 'unknown';
}

function isLegacyExt(ext) {
  return ext === '.doc' || ext === '.dot';
}

// True when the converter (worker) can open these bytes: any ZIP package, or an OLE file named .doc/.dot.
function canConvert(format, ext) {
  return format === 'zip' || (format === 'ole' && isLegacyExt(ext));
}

// A user-facing notice for files we will not render. ext is like ".doc".
function noticeFor(format, ext) {
  if (format === 'ole') {
    if (isLegacyExt(ext)) {
      return { kind: 'legacyDoc', title: 'This is an old Word file (' + ext + ')', detail: 'DOCX Viewer shows the text of Word 97-2003 files. Open it in Word, LibreOffice or Pages and save it as .docx to see the formatting too.' };
    }
    return { kind: 'encrypted', title: 'This file is password protected or is an old .doc file', detail: 'Word saves password-protected documents in an encrypted container that DOCX Viewer cannot read. A .doc file renamed to ' + (ext || '.docx') + ' looks the same. Open it in Word, remove the password or save as .docx, then open it here.' };
  }
  if (format === 'rtf' && isLegacyExt(ext)) return { kind: 'notDocx', title: 'This ' + ext + ' file is really an RTF file', detail: 'The file contains Rich Text Format under a Word name. DOCX Viewer does not read RTF. Open it in Word, Pages, LibreOffice or a text editor.' };
  if (format === 'html' && isLegacyExt(ext)) return { kind: 'notDocx', title: 'This ' + ext + ' file is really an HTML file', detail: 'The file is a web page saved under a Word name. DOCX Viewer does not open HTML. Open it in Word or a browser, or rename it to .html.' };
  if (format === 'rtf') return { kind: 'notDocx', title: 'This is an RTF file', detail: 'The file contains Rich Text Format, not a Word .docx package. Open it in Word or a text editor.' };
  if (format === 'empty') return { kind: 'empty', title: 'This file is empty', detail: 'The file has 0 bytes.' };
  if (format === 'html') format = 'unknown';
  if (format === 'unknown' && (ext === '.odt' || ext === '.ott')) return { kind: 'notDocx', title: 'This is not an OpenDocument text file', detail: 'An .odt file is a ZIP package. This file does not start with a ZIP header, so it may be damaged or have the wrong extension.' };
  if (format === 'unknown') return { kind: 'notDocx', title: 'This is not a Word .docx file', detail: 'A .docx file is a ZIP package. This file does not start with a ZIP header, so it may be damaged or have the wrong extension.' };
  return null;
}

// Notice for a password-protected .doc file (the FIB says the streams are encrypted).
const ENCRYPTED_DOC = { kind: 'encrypted', title: 'This .doc file is password protected', detail: 'Word encrypted the text of this file. DOCX Viewer cannot read it. Open it in Word, remove the password and save it again, then open it here.' };

module.exports = { detectFormat, noticeFor, canConvert, isLegacyExt, ENCRYPTED_DOC };
