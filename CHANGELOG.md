# Changelog

## 0.4.4 (2026-11-10)

- A Compare button in the viewer toolbar (Reading view and Page view) and the command "DOCX Viewer: Compare...". It opens one list: "Compare with Git HEAD" and "Compare with another document" (free), then "Compare two folders" and "Export redline as Word with tracked changes" (Zovo Pro, with the free tries left on this computer). Nothing about Pro shows when a file opens: no badge, no popup.
- A free try of a Pro tool now counts only after its output is written: the folder report after a folder compare, the saved file after a redline export. Closing a folder picker or the save dialog with Escape keeps the try. Before, a folder compare used a try as soon as the first picker opened.
- "Export redline as Word" from the Compare list exports the open redline, or first asks for the document to compare this one with and exports when the compare is done.
- The Zovo Pro commands share one "Zovo Pro" group in the Command Palette, with the same names in every Zovo extension.
- The Zovo Pro window is shorter and has 4 buttons: "Get Zovo Pro, USD 19", "Pay with PayPal", "I already paid" (unlock with GitHub Sponsors or a license key) and Cancel. It names the other DOCX Pro tool and says that Pro covers all 22 Zovo extensions.
- One unlock for all Zovo extensions on this computer: after you unlock Zovo Pro here, the other Zovo extensions that have this license update find it without a second sign-in or key. The file `~/.zovo/pro.json` holds the key or the GitHub Sponsors result, never a sign-in token.
- "More free viewers" now starts with the Zovo extensions most related to this one. Picking one opens its Marketplace page, where you choose to install it.
- The walkthrough ends with a step that links free Zovo extensions for the files that often come with this one. A link opens the extension page; nothing installs on its own.
- The footer link "Zovo Pro, USD 19" and the Marketplace Sponsor button open the Zovo Pro tier (USD 19 once, for every Zovo extension) instead of the general GitHub Sponsors page.
- Everything else in 0.4.3 is unchanged: Reading view, Page view, the redline and its change list, the rating question and the USD 299 custom format line.

## 0.4.3 (2026-11-10)

- When a picture cannot be drawn (an EMF, WMF or TIFF that fails, or an image format the viewer does not read) or an old Word or RTF file opens as text only, one line can show next to that note: "Request support for this (free), or we build it for USD 299 once." The first link opens the format request form on GitHub with the kind of element filled in (never the file name or any text from the document). The second opens the GitHub Sponsors tier for custom format support.
- The line shows at most once per VS Code session, only after you click, scroll with the wheel or type in the document, and only next to a note that is on screen. Never when a file opens, no popup, no notification, and nothing is sent until you click a link. Images left out for a size limit get no line.
- The Pro window lists the ways to pay in one order: Get Zovo Pro (GitHub Sponsors), Unlock with GitHub Sponsors, Pay with PayPal, I have a license key (shared license module synced).
- Everything else in 0.4.2 is unchanged: Reading view, Page view, the redline and its Pro export with 3 free tries, the rating question and the support links.

## 0.4.2 (2026-11-10)

- Pay for Zovo Pro with PayPal from inside VS Code: a "Pay with PayPal" button in the Pro window and the command "Zovo: Pay for Pro with PayPal". It lists the 3 steps and opens PayPal with the amount filled in: USD 19 for one person, or USD 59 for a team of 5 with one shared key. The transaction ID goes to a short form on GitHub and the license key comes by email.
- The Pro window now says how to buy: "Get Zovo Pro" opens the "$19 one time" tier on GitHub Sponsors, then you come back and choose "Unlock with GitHub Sponsors". The buy buttons come first, the buttons for people who already paid come after them.
- Back from the browser: after "Get Zovo Pro" or a PayPal button, one message asks whether you paid and offers the next step (unlock with GitHub, or send the PayPal transaction ID). It shows once, within 2 hours, and never when Pro is already on.
- When the GitHub check says this account has not bought Zovo Pro, or VS Code has no GitHub sign-in, the message now also offers PayPal and the license key.
- Team license keys made for 5 people are accepted (shared license module synced).
- Everything in 0.4.1 is unchanged, the rating question included.

## 0.4.1 (2026-11-09)

- "Rate it" in the rating question and the Rate link in the viewer footer now open the review page of the store your editor installs from: the Visual Studio Marketplace in VS Code, Open VSX in Cursor, Windsurf, VSCodium and other editors that use Open VSX. Before, they always opened the Marketplace.
- A window that stays open for days now counts a file opened 4 hours or more after its first one as a new session for the rating question.
- Everything in 0.4.0 is unchanged.

## 0.4.0 (2026-11-09)

- Redline compare. "Compare with Git HEAD" and "Compare with Another Document" now offer a Redline view next to the Markdown diff (setting `docxViewer.compareView`), and "Compare Documents (Redline)..." opens it directly. One document shows word-level insertions (underlined) and deletions (struck through), moved paragraphs as moves, changed table cells one by one and, with "Formatting" on, bold, italic, underline, size and paragraph style changes.
- A change list with counts ("7 insertions, 6 deletions, 2 moves, 3 table cells, 1 formatting change"), filters by type, `F7` / `Shift+F7` for the next and previous change, a side-by-side mode that scrolls both versions together, and Swap to change which version is older.
- Works for `.docx`, `.docm`, `.dotx`, `.odt` and old `.doc` files (as text), in any mix. Tracked changes already in a file are accepted first.
- The compare runs in a worker thread with progress and Cancel: two 500-page documents with 200 tables compare in about half a second. Zip bombs and password-protected files get a message.
- Zovo Pro (3 free tries each, then USD 19 once for every Zovo viewer): export the redline as a new `.docx` with real tracked changes by "Compare" that Word and LibreOffice can accept or reject, or as one self-contained HTML file; and compare two folders of documents. Your documents are never changed. Unlock with GitHub Sponsors or a license key; the license key is checked on your computer. Set `docxViewer.showProFeatures` to `false` to hide the Pro buttons and commands.
- "More free viewers" starts with the Zovo extensions most related to this one, and the support links include PayPal.
- The description and keywords now say "compare Word documents", "DOCX compare", "redline" and "track changes".

## 0.3.3 (2026-11-08)

- The Marketplace name is now "DOCX Viewer & ODT Viewer, Word Document Preview (Dark Mode)" (was "DOCX Viewer, Word Viewer & DOCX Preview (Dark Mode)"), so more searches find it. The extension ID, settings and commands stay the same.
- The short description now starts with what the name does not say: free and offline, with Page view, search, an outline and a Git compare.
- The viewer footer now starts with Rate, then More free viewers, Sponsor and Hide. The rating question comes after 2 files that opened without an error in 2 sessions at least 4 hours apart; the sample file does not count.

## 0.3.2 (2026-11-08)

- EMF, WMF and TIFF pictures now show in Reading view and Page view, on the desktop and on the web. These are the pictures Word keeps for Visio drawings, Excel charts pasted as pictures, old Equation Editor and MathType equations, and scanned TIFF pages. Before, they showed a placeholder. The viewer draws them itself, offline: EMF and WMF as sharp vector pictures with their text, TIFF (LZW, PackBits, Deflate, CCITT fax and uncompressed) as an image of its first page.
- A picture that can't be drawn shows a short note that says why, such as "Picture could not be drawn (EMF): it has only EMF+ records". Damaged or oversized pictures are checked before they are drawn (record count, bitmap size, 40 megapixels per TIFF page, `docxViewer.maxImageSizeMB`), so one bad picture can't hang the viewer.
- Page view now shows the pictures of embedded objects, such as old equations, which it skipped before.
- Shift + mouse wheel scrolls sideways in Reading view too, for zoomed-in pages and wide content. Page view already had it.
- New third-party code: WMFJS from rtf.js (MIT) and UTIF.js (MIT), listed in THIRD-PARTY-NOTICES.md.

## 0.3.1 (2026-11-08)

- DOCX Viewer now works in VS Code for the Web (vscode.dev and github.dev). Open a .docx, .odt or .doc file from a GitHub repository or a local folder in the browser and it shows the same Reading view, Page view, outline, search, equations and charts. The converter runs in a separate browser worker with a 60 second limit, so a damaged file can't hang the editor.
- On the web, "Compare with Git HEAD" and "Open in Default App" are hidden, because the browser can't run git or another app. "Compare with Another Document" works.

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
