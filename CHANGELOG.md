# Changelog

## 0.3.0 (2026-11-08)

Fixes found by opening 140 real-world files (Apache POI bug reports, a 47 MB JNCC survey report, gov.uk statistics):

- Equations show as real math in Reading view (fractions, roots, scripts, sums and integrals, brackets, matrices). Copy as Markdown and Open as Text write each one as a line of text.
- Charts show in Reading view. Column, bar, line, area, pie, doughnut and scatter charts are drawn from the values saved in the file, with a "Chart data" table under each one. Copy as Markdown copies the table.
- Figure, table and page numbers in simple fields were left out ("Figure ." instead of "Figure 29."). They show now.
- Big reports open about twice as fast. Pictures go to the viewer as bytes instead of base64 text. The 47 MB test report opens in about 1.5 s instead of 4.1 s, and shows all 41 photos instead of 35.
- Page view now opens files up to 100 MB (it was 20 MB). The 47 MB report lays out in 0.4 s. Files up to 100 MB open without asking (it was 50 MB). The image limits are now 20 MB per picture and 300 MB per document.
- An old Word 97-2003 file renamed to `.docx` or `.docm` opens as text. A password-protected `.docx` gets a clear "password protected" message.
- RTF files saved with a `.doc` name open as text, with their tables. Before, they got a "this is RTF" message.
- Files whose XML has a DOCTYPE or custom entities open. Tables nested hundreds deep no longer stop the converter.
- The "conversion notes" list no longer shows Word style names that have no special HTML. Real files had 5 to 10 of these each.
- New: hide the toolbar for more reading room with the button at its right end or `Ctrl+Shift+H` (`Cmd+Shift+H`), and bring it back the same way. The choice is kept per workspace.
- New setting `docxViewer.fontFamily` for Reading view: empty (Word-like default), `editor` or a font list.
- The rating question now comes after 3 files that opened without an error on 2 different days, and never after an error. "Later" asks one more time after 7 days, "No thanks" ends it, and it never asks more than 2 times. `docxViewer.askForRating: false` turns it off.

## 0.2.5 (2026-11-07)

- The Marketplace name is now "DOCX Viewer, Word Viewer & DOCX Preview (Dark Mode)" (it was "DOCX Viewer & Word Viewer with Dark Mode"). The extension id, commands and settings stay the same.

## 0.2.4 (2026-11-07)

- "More free viewers" now starts with the Zovo extensions most related to this one. Picking one opens its Marketplace page, where you choose to install it.
- The README has a "Support Zovo" section with GitHub Sponsors and the developer's GitHub profile, and "More tools by Zovo" lists related extensions.

## 0.2.3 (2026-11-07)

- Page view. A "Page view" button shows the document the way Word lays it out, with page size, margins, portrait and landscape pages, headers, footers, fonts and colors. "Reading view" switches back, and the choice is kept per workspace. New setting `docxViewer.defaultView`.
- Zoom from 50% to 300% in both views, with buttons and `Ctrl+=`, `Ctrl+-` and `Ctrl+0` (`Cmd` on macOS), plus "Fit width" in Page view. New setting `docxViewer.zoom`.
- In a dark theme the pages turn dark and photos and charts keep their colors. Files over 20 MB open in Reading view first (`docxViewer.pageViewMaxMB`). If a file can't be laid out, it opens in Reading view with a note.
- Tracked changes and comments in Reading view, read-only. A bar counts changes, people and comments and switches between Markup, Final and Original. Each author gets a color, and hovering a change shows who made it and when. Comments show as numbered markers and a Comments section. Copy as Markdown, Open as Text and Compare stay on Final.
- Old Word 97-2003 `.doc` and `.dot` files open as text, with tables, search, Copy as Markdown, Open as Text and both compare commands. Password-protected ones, and RTF or HTML files with a `.doc` name, get a short message with "Open in default app".
- The build checks the license of every bundled package. New third-party code: docx-preview (Apache-2.0) and word-extractor (MIT), listed in THIRD-PARTY-NOTICES.md.

## 0.2.2 (2026-11-07)

- The footer under the viewer has a "Rate" link next to Sponsor and More free viewers. It opens the review page of this extension on the Marketplace. Nothing pops up and nothing asks you for a rating. "Hide" still hides the whole line.

## 0.2.1 (2026-11-07)

- The "More free viewers" list and the README list now show the 15 Zovo extensions on the Marketplace under their current names, and 12 that are coming soon.
- Extensions for related files now come first, starting with PPTX Viewer & PowerPoint Viewer and PDF Viewer & PDF Reader with Dark Mode.

## 0.2.0 (2026-11-06)

- OpenDocument text files (`.odt`, and `.ott` templates) open in the viewer, with the same outline, search, dark mode, tables, images, footnotes, Copy as Markdown and Open as Text as a `.docx`. An `.odt` saved with a `.docx` name opens too. OpenDocument spreadsheets and presentations get a short message instead.
- New command "Compare with Git HEAD". It shows what changed in a `.docx` or `.odt` since the last commit, as Markdown in the VS Code diff view. It's in the Explorer and Source Control right-click menus and in the viewer's `...` menu. Git runs locally with hooks and fsmonitor off, and only in a trusted workspace.
- New command "Compare with Another Document...". Select two documents in the Explorer, or pick the second one, to see their differences the same way. A `.docx` can be compared with an `.odt`.
- Both features are free, like the rest of the extension.

## 0.1.4 (2026-11-06)

- The Marketplace page now starts with a screenshot of a real VS Code window with a .docx in dark mode and a search, and a short GIF of searching, the outline and the paper theme. Both were made from generated sample files. The images load from the GitHub repo and are not packed into the extension, so the download size stays the same.

## 0.1.3 (2026-11-06)

- A small line at the bottom right of the viewer has two links, "Sponsor" (GitHub Sponsors) and "More free viewers". The new setting `docxViewer.showSupportLinks` (default `true`) hides it, and so does the "Hide" link next to them. There is no popup, and nothing is sent anywhere.
- The webview allows command links only for these two commands and the settings page. Links inside a document still go through the same checks as before.
- New commands "DOCX Viewer: Support the developer" and "DOCX Viewer: More free viewers". The second one lists the other Zovo extensions and installs only the one you pick. Ones that are not on the Marketplace yet open their GitHub page.
- The listing gets a Sponsor button. The README has a short Support section and lists all Zovo extensions.

## 0.1.2 (2026-11-06)

- DOCX Viewer asks one time for a Marketplace rating. It counts each success (an opened document). After 5 of them, and no sooner than 2 days after the first, it shows a small message with "Rate it", "Later" and "Don't ask again". "Later" waits for 20 more, at most two more times. It never shows in your first session, more than once per session, when the window is not focused, or in a remote or untrusted workspace.
- New setting `docxViewer.askForRating` (default `true`) turns it off. Nothing is sent anywhere; "Rate it" only opens the review page in your browser.

## 0.1.1 (2026-11-06)

- Listing only, no change to the extension. The display name is now "DOCX Viewer & Word Viewer with Dark Mode" and the description is one sentence, so the listing uses the words people search for (docx (41), docx viewer (32), word viewer (35)).
- The 30 keywords start with the most searched terms.
- The README ends with links to the other Zovo extensions.

## 0.1.0 (2026-11-06)

First release.

- Read-only preview for `.docx`, `.dotx` and `.docm` files, converted with mammoth in a worker thread.
- Page theme follows VS Code, or switch to light paper or a dark page.
- Heading outline panel, search with match count, `Enter` and `Shift+Enter` to move between matches.
- Inline images with a per-image and per-document size cap, tables with merged cells, footnotes and endnotes.
- Copy as Markdown, Open as Markdown and Open as Text, also from the Explorer context menu.
- Clear messages for old `.doc` files, password-protected files, files that are not Word documents, and files over the size limit.
