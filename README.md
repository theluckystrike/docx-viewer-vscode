# DOCX Viewer & ODT Viewer, Word Document Preview (Dark Mode)

For developers who get specs, contracts and reports as Word files, DOCX Viewer opens .docx, .odt and old .doc files in VS Code as a dark-mode preview with an outline, search, tables, charts and equations.

![A Word report open in VS Code in dark mode, with the heading outline on the left and a search for revenue on match 1 of 6](https://raw.githubusercontent.com/theluckystrike/docx-viewer-vscode/main/images/vscode-docx-dark.png)

*A real VS Code 1.142 window running this extension on [`test/fixtures/sample.docx`](test/fixtures/sample.docx), a generated 2 page field report with a table and a chart.*

- Read Word and OpenDocument (.odt) specs, contracts and reports next to your code. The page follows your VS Code theme, or switch to white paper with one click.
- Find things fast. Search shows a match count, and the outline jumps to any heading.
- See what changed. Compare a document with its last Git commit, or with another version, in the VS Code diff view. Or copy the whole document as Markdown with tables and footnotes.
- Open big real-world files. A 47 MB government report with 41 photos opens in about 1.5 seconds, and Page view lays it out in under half a second. The preview reloads when the file changes on disk. The whole extension is a 0.8 MB download and needs no Office or LibreOffice.
- Works in the browser too. In vscode.dev and github.dev, click a .docx in a GitHub repository and read it without cloning.

## New in 0.3.2

- EMF, WMF and TIFF pictures show in both views. Visio drawings, Excel charts pasted as pictures, old Equation Editor and MathType equations and scanned TIFF pages used to be a grey placeholder. The viewer now draws them itself, offline, and a picture it can't draw gets a short note that says why.
- Shift + mouse wheel scrolls sideways in Reading view, as it already did in Page view.

## Quick start

1. Install DOCX Viewer.
2. Click any `.docx` or `.dotx` file in the Explorer. It opens as a read-only preview. Press `Ctrl+F` (`Cmd+F` on macOS) to search.

![A click on the .docx file opens it. Typing revenue marks 6 matches and Enter steps through them, a click on Installations in the outline jumps to that heading, and the theme button switches to white paper](https://raw.githubusercontent.com/theluckystrike/docx-viewer-vscode/main/images/demo-docx.gif)

*Recorded in the same window. The white arrow is drawn in to show where each click lands.*

No .docx at hand? Run "DOCX Viewer: Open Sample Document" from the Command Palette.

## What it shows

Headings, paragraphs, bold, italic, underline and strikethrough. Bulleted and numbered lists, including nested ones. Tables with merged cells. Images inline: PNG, JPEG, GIF, BMP and WebP, plus EMF, WMF and TIFF, which the viewer draws itself (see Limits). Equations and charts (see below). Figure and table numbers. Footnotes and endnotes, with links between the reference and the note. Hyperlinks, which open in your browser.

It reads `.docx`, `.dotx` (templates) and `.docm` files, and OpenDocument text files (`.odt` and `.ott` templates) from LibreOffice, Google Docs downloads and pandoc. Macros in `.docm` files never run. The viewer only reads the text and images.

Old Word 97-2003 `.doc` and `.dot` files open as text. You get the paragraphs, simple tables, and the headers, footers, footnotes, comments and text boxes in their own sections. A grey bar says that formatting, images and layout are not shown, with a button to open the file in your default app. Search, Copy as Markdown, Open as Text and both compare commands work on them. An old `.doc` file renamed to `.docx` or `.docm` opens the same way. Many websites publish RTF files with a `.doc` name; those open as text too, with their tables. A password-protected file gets a short message that says so, and so does an HTML file saved with a `.doc` name.

![The same report on white paper while VS Code stays dark, showing the revenue table and the installed capacity chart](images/screenshot-paper.png)

![The report in a light VS Code theme with a search for "region", on match 4 of 8](images/screenshot-light.png)

![An old Word 97-2003 .doc file shown as text, with the grey text-only bar and its table](images/vscode-doc-text.png)

## Equations and charts

Word equations show as real math in Reading view: fractions, roots, sub- and superscripts, sums and integrals with limits, brackets, matrices and equation arrays. Copy as Markdown and Open as Text write them as one line of text, such as `x=(-b±√(b^2-4ac))/(2a)`.

Charts are drawn again from the numbers Word saves inside the file, so you see them without Excel: column, bar, line, area, pie, doughnut and scatter charts, with the title, the legend and a value on hover. "Chart data" under each chart opens its table, and Copy as Markdown copies that table.

![An engineering note in Reading view with the Darcy-Weisbach equation and a column chart of pump flow, drawn from the values in the .docx](images/vscode-charts-equations.png)

## Page view

Click "Page view" in the toolbar to see the document the way Word lays it out. You get the page size and margins, portrait and landscape pages, headers and footers, fonts, colors, highlights, table borders and shading, and footnotes. "Reading view" switches back. VS Code keeps your choice for the workspace, and `docxViewer.defaultView` sets it for new ones.

![A supply contract in Page view in dark mode, with the header, a table and a chart on the first page](images/vscode-page-dark.png)

![The same contract in Page view on white paper](images/vscode-page-light.png)

- Zoom goes from 50% to 300% with the minus and plus buttons, or `Ctrl+=` and `Ctrl+-` (`Cmd` on macOS). `Ctrl+0` goes back to 100%, and "Fit width" fits the widest page to the window. Reading view zooms the same way.
- In a dark theme the pages turn dark too, and photos and charts keep their colors. The theme button switches to white paper.
- The outline and search work on the pages, and search also finds text in headers and footers.
- Page view opens `.docx`, `.dotx` and `.docm` files. Files over 100 MB (`docxViewer.pageViewMaxMB`) open in Reading view, with a button to try Page view anyway. If a file can't be laid out, it opens in Reading view with a one-line note.

## Tracked changes and comments

When a `.docx` has tracked changes or comments, a bar at the top of Reading view counts them, for example "12 changes by 2 people · 4 comments". Markup underlines insertions and strikes through deletions in one color per author, and when you hover a change you see who made it and when. Comments get small numbered markers and a Comments section at the end with the author and date.

"Final" shows the document as if every change were accepted, and "Original" as if every change were rejected. Copy as Markdown, Open as Text and the compare commands always use Final. The viewer only reads the file, so nothing gets accepted or rejected in it.

![A contract with one deletion and one insertion by two people, the bar with Markup, Final and Original, and a comment at the end](images/vscode-tracked-dark.png)

## Compare versions

Word files are binary, so `git diff` shows nothing useful for them. Right-click a `.docx` or `.odt` file in the Explorer or in Source Control and pick "Compare with Git HEAD". Both versions are turned into Markdown and open in the VS Code diff view, with changed words, table rows and headings marked. It's also in the `...` menu of the viewer.

To compare two files, select both in the Explorer and pick "Compare with Another Document...", or run it on one file and pick the second. A `.docx` can be compared with an `.odt`.

Git runs on your machine with hooks and fsmonitor turned off, and only in a trusted workspace. The compare shows text and structure. Changes to fonts, colors or images alone don't show.

## Commands

| Command | What it does |
| --- | --- |
| "DOCX Viewer: Find in Document" | Puts the cursor in the search box (`Ctrl+F` / `Cmd+F`) |
| "DOCX Viewer: Copy as Markdown" | Copies the whole document as Markdown |
| "DOCX Viewer: Open as Text" | Opens the plain text in a new untitled editor |
| "DOCX Viewer: Open as Markdown" | Opens the Markdown in a new untitled editor |
| "DOCX Viewer: Open in Default App" | Opens the file in Word, Pages or LibreOffice |
| "DOCX Viewer: Compare with Git HEAD" | Shows what changed since the last commit, as a Markdown diff |
| "DOCX Viewer: Compare with Another Document..." | Shows the differences between two documents, as a Markdown diff |
| "DOCX Viewer: Show or Hide the Toolbar" | Hides the toolbar for more reading room, and shows it again (`Ctrl+Shift+H` / `Cmd+Shift+H` in the viewer). The small button at the top right also brings it back. |
| "DOCX Viewer: Open Sample Document" | Opens a short sample report |
| "DOCX Viewer: Support the developer" | Opens the GitHub Sponsors page |
| "DOCX Viewer: More free viewers" | Lists the other Zovo extensions and installs the one you pick |

"Copy as Markdown", "Open as Text" and the two compare commands are also in the Explorer right-click menu for `.docx`, `.odt` and `.doc` files, so you can grab the text without opening the preview.

In the search box, `Enter` goes to the next match and `Shift+Enter` to the previous one. `Esc` clears it.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `docxViewer.theme` | `auto` | `auto` follows VS Code, `light` shows white paper, `dark` a dark page |
| `docxViewer.defaultView` | `reading` | `page` opens Word files in Page view in new workspaces. The toolbar switch is kept per workspace. |
| `docxViewer.zoom` | `1` | Zoom for both views, from `0.5` to `3` |
| `docxViewer.fontFamily` | empty | Font for Reading view. Empty keeps the Word-like default, `editor` uses your editor font, or give a font list such as `Georgia, serif` |
| `docxViewer.pageViewMaxMB` | `100` | Bigger files open in Reading view, with a button to try Page view anyway |
| `docxViewer.maxFileSizeMB` | `100` | Bigger files ask before they open |
| `docxViewer.maxImageSizeMB` | `20` | Bigger images show a placeholder instead |
| `docxViewer.maxTotalImagesMB` | `300` | After this many MB of images, the rest show placeholders |
| `docxViewer.askForRating` | `true` | Ask for a Marketplace rating after 3 files opened without an error on 2 different days. "Later" asks one more time after 7 days, "No thanks" never again. It never asks after an error. Turn it off with `false`. |
| `docxViewer.showSupportLinks` | `true` | Show the small Sponsor and More free viewers line at the bottom right of the viewer. Turn it off with `false`. |

## Big files

The converter runs in a worker thread with a memory cap and a 60 second limit, so a huge or broken file can't freeze VS Code. Pictures go to the viewer as raw bytes instead of text, which keeps big reports fast. The page fills in from the top in chunks of about 200 KB of HTML, and you can read the first screen while the rest arrives.

Measured in a real VS Code 1.142 window on an Apple M3 Pro, from the click in the Explorer to the finished page:

| File | 0.2.5 | 0.3.0 |
| --- | --- | --- |
| 47 MB government report, 41 photos, 31 headings | 4.1 s, 6 photos left out | 1.4 to 1.6 s, all 41 photos |
| Same report in Page view | Reading view only (over 20 MB) | 0.4 s, 41 photos |
| 475 KB report with 39,000 words | 1.9 s | 1.8 to 1.9 s |

We test each release on 17 real-world files from public sources (Apache POI bug reports, a JNCC survey report, a gov.uk statistics file), including broken, password-protected and renamed files.

## Privacy

DOCX Viewer works offline. It makes no network calls and sends no telemetry. The webview runs under a strict Content Security Policy with no remote scripts and no network access, and the document HTML is rebuilt from an allowlist with all text escaped before it reaches the page. Remote images, scripts and `javascript:` links in a document are dropped. Page view allows inline styles, which the page layout needs, and blocks the rest the same way.

## Limits

- It's a viewer. It can't edit or save a document.
- Reading view simplifies the layout. It leaves out page size, margins, headers, footers, columns, text boxes, fonts and colors, so the text reads like a clean web page. Page view shows them.
- Page view doesn't show tracked changes or comments. It says so and offers Reading view.
- SmartArt doesn't show. Excel 2016 chart types (waterfall, treemap and others) show the picture Word saved with them, if there is one. Page view draws equations its own way and shows charts only as their saved picture. Tracked changes to paragraph marks, formatting and table rows show as in Final.
- EMF and WMF pictures are drawn from their plain records. An EMF that has only EMF+ records (rare, some newer Office add-ins write them) shows a note instead. TIFF pictures show their first page; JPEG 2000 TIFFs show a note. A picture over `docxViewer.maxImageSizeMB`, an EMF or WMF with more than 200,000 records and a TIFF page over 40 megapixels show a note too.
- `.doc` files show text only. Some `.doc` files that macOS TextEdit or `textutil` saved at more than about 2.4 MB can't be read and get the could-not-read message.
- Search finds text inside one formatting run. A word whose letters have mixed formatting may not match.
- In VS Code for the Web (vscode.dev, github.dev), "Compare with Git HEAD" and "Open in Default App" are not available. To use them, open the folder in desktop VS Code.
- In Markdown, images become placeholder links such as `![](#image-1)` to keep the text small.
- In `.odt` files, styles set by name in the document (Title, Quotations, Preformatted Text) and direct bold, italic, underline, strikethrough and superscript show. Other paragraph styles, frames and drawings are simplified. SVG and linked images show a placeholder. OpenDocument spreadsheets and presentations don't open. Tracked changes and comments in `.odt` files are not shown.

## Credits

The .docx conversion uses [mammoth](https://github.com/mwilliamson/mammoth.js) (BSD-2-Clause). Page view uses [docx-preview](https://github.com/VolodymyrBaydalka/docxjs) (Apache-2.0), and `.doc` files are read with [word-extractor](https://github.com/morungos/node-word-extractor) (MIT). WMF pictures are drawn with WMFJS from [rtf.js](https://github.com/tbluemel/rtf.js) (MIT) and TIFF pictures are read with [UTIF.js](https://github.com/photopea/UTIF.js) (MIT). The EMF drawing code is part of this extension. The .odt reader is part of this extension and uses JSZip (MIT) and @xmldom/xmldom (MIT), which mammoth already bundles. See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) for every bundled package and its license.

## License

MIT

## Support Zovo

Zovo extensions are free, with no ads and no tracking. They are made by [theluckystrike](https://github.com/theluckystrike) on GitHub. If this one saves you time, you can support the work:

- [Sponsor on GitHub](https://github.com/sponsors/theluckystrike)
- [Follow theluckystrike on GitHub](https://github.com/theluckystrike)

## More tools by Zovo

- [PPTX Viewer & PowerPoint Viewer, PPT Slide Viewer](https://marketplace.visualstudio.com/items?itemName=zovo.pptx-slide-viewer) shows PowerPoint slides, thumbnails and speaker notes.
- [PDF Viewer & PDF Reader](https://marketplace.visualstudio.com/items?itemName=zovo.pdf-viewer-dark) reads PDFs with a real dark mode, search, an outline and thumbnails.
- [XLSX Viewer, Excel Viewer, CSV Viewer & Parquet Viewer](https://marketplace.visualstudio.com/items?itemName=zovo.table-viewer-vscode) opens CSV, TSV, Excel and Parquet files as a sortable, filterable table.
- [EML Viewer, Email Headers & MBOX Viewer](https://marketplace.visualstudio.com/items?itemName=zovo.eml-viewer) reads EML, EMLX and MBOX email files with remote images blocked.
- [EPUB Viewer, EPUB Reader & Ebook Reader](https://marketplace.visualstudio.com/items?itemName=zovo.zovo-epub-reader) reads EPUB books with a table of contents, search and light, sepia or dark themes.

See [all Zovo extensions on the Marketplace](https://marketplace.visualstudio.com/publishers/zovo).
