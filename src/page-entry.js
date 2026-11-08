// Entry for media/page-view.js, the browser bundle of docx-preview (Apache-2.0) and JSZip (MIT)
// that the Page view webview loads. Built by scripts/build.js; not part of the extension host.
// renderAsync is docx-preview's own, plus one hook: every picture passes through imageHook(blob,
// path, original) so media/page.js can draw EMF, WMF and TIFF pictures (media/pictures.js) first.
import { parseAsync, renderDocument } from 'docx-preview';
import JSZip from 'jszip';
import { showObjects } from './page-objects';

async function renderAsync(data, bodyContainer, styleContainer, options, imageHook) {
  const doc = await parseAsync(await showObjects(JSZip, data), options);
  if (typeof imageHook === 'function' && typeof doc.blobToURL === 'function') {
    const original = doc.blobToURL.bind(doc);
    doc.blobToURL = (blob, path) => imageHook(blob, path, original);
  }
  const nodes = await renderDocument(doc, options);
  const styles = styleContainer || bodyContainer;
  styles.innerHTML = '';
  bodyContainer.innerHTML = '';
  for (const n of nodes) (n.nodeName === 'STYLE' ? styles : bodyContainer).appendChild(n);
  return doc;
}

self.DocxPreview = { renderAsync };
