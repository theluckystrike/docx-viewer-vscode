# Changelog

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
