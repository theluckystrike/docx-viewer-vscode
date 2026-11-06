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

// Returns 'zip' | 'ole' | 'rtf' | 'empty' | 'unknown'.
function detectFormat(buf) {
  if (!buf || buf.length === 0) return 'empty';
  if (startsWith(buf, ZIP_MAGIC)) return 'zip';
  if (startsWith(buf, OLE_MAGIC)) return 'ole';
  if (startsWith(buf, RTF_MAGIC)) return 'rtf';
  return 'unknown';
}

// A user-facing notice for files we will not render. ext is like ".doc".
function noticeFor(format, ext) {
  if (format === 'ole') {
    if (ext === '.doc' || ext === '.dot') {
      return { kind: 'legacyDoc', title: 'This is an old Word file (.doc)', detail: 'DOCX Viewer reads .docx, .dotx and .docm files. A .doc file uses the binary format from Word 97 to 2003. Open it in Word, LibreOffice or Pages and save it as .docx, then open it here.' };
    }
    return { kind: 'encrypted', title: 'This file is password protected or is an old .doc file', detail: 'Word saves password-protected documents in an encrypted container that DOCX Viewer cannot read. A .doc file renamed to ' + (ext || '.docx') + ' looks the same. Open it in Word, remove the password or save as .docx, then open it here.' };
  }
  if (format === 'rtf') return { kind: 'notDocx', title: 'This is an RTF file', detail: 'The file contains Rich Text Format, not a Word .docx package. Open it in Word or a text editor.' };
  if (format === 'empty') return { kind: 'empty', title: 'This file is empty', detail: 'The file has 0 bytes.' };
  if (format === 'unknown' && (ext === '.odt' || ext === '.ott')) return { kind: 'notDocx', title: 'This is not an OpenDocument text file', detail: 'An .odt file is a ZIP package. This file does not start with a ZIP header, so it may be damaged or have the wrong extension.' };
  if (format === 'unknown') return { kind: 'notDocx', title: 'This is not a Word .docx file', detail: 'A .docx file is a ZIP package. This file does not start with a ZIP header, so it may be damaged or have the wrong extension.' };
  return null;
}

module.exports = { detectFormat, noticeFor };
