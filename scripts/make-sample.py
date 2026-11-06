"""Build the real sample documents used by the tests, the walkthrough and the README screenshot.
Run: python3 scripts/make-sample.py   (needs python-docx)"""
import io, os, re, shutil, sys, zipfile
from docx import Document
from docx.shared import Inches

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
FIX = os.path.join(ROOT, "test", "fixtures")
os.makedirs(FIX, exist_ok=True)

d = Document()
d.core_properties.author = "Northwind Solar"
d.add_heading("Q3 2026 Field Report", 0)
p = d.add_paragraph("Northwind Solar installed ")
p.add_run("18.2 MW").bold = True
p.add_run(" in the third quarter, up 28% on Q2. Revenue reached ")
p.add_run("$41.6 million").bold = True
p.add_run(", and the field team closed 412 service tickets.[[FN1]]")
d.add_heading("Summary", 1)
d.add_paragraph("Revenue grew in every region. The North region grew fastest because two school districts signed in July. "
                "Margins held at 31% even though panel prices rose in August.")
p = d.add_paragraph("The full data set is at [[LINK]].")
d.add_heading("Revenue by region", 1)
rows = [("Region", "Q2 revenue", "Q3 revenue", "Change"),
        ("North", "$9.8M", "$13.1M", "+34%"),
        ("South", "$11.2M", "$12.4M", "+11%"),
        ("East", "$8.1M", "$9.0M", "+11%"),
        ("West", "$6.4M", "$7.1M", "+11%")]
t = d.add_table(rows=len(rows), cols=4)
t.style = "Table Grid"
for i, r in enumerate(rows):
    for j, v in enumerate(r):
        c = t.cell(i, j); c.text = v
        if i == 0:
            c.paragraphs[0].runs[0].bold = True
d.add_heading("Installations", 1)
d.add_paragraph("Installed capacity grew for the fourth quarter in a row.")
d.add_picture(os.path.join(HERE, "chart.png"), width=Inches(5.5))
d.add_heading("Highlights", 2)
for s in ["Two school districts in the North region (6.4 MW)", "A cold-storage warehouse in the South region (2.1 MW)", "First battery retrofit for an existing customer"]:
    d.add_paragraph(s, style="List Bullet")
d.add_heading("Risks", 2)
for s in ["Panel prices rose 6% in August and may rise again.", "Two inspectors leave in October.", "Grid connection waits in the East region are now 11 weeks."]:
    d.add_paragraph(s, style="List Number")
d.add_heading("Next steps", 1)
p = d.add_paragraph("Hire two inspectors before November. ")
p.add_run("Lock Q4 panel prices this month.").italic = True
d.add_paragraph("Review revenue by region again in January.")
buf = io.BytesIO(); d.save(buf)

FOOTNOTES = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
 '<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
 '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>'
 '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>'
 '<w:footnote w:id="1"><w:p><w:r><w:t xml:space="preserve">Ticket counts come from the service desk export of 3 October 2026.</w:t></w:r></w:p></w:footnote>'
 '</w:footnotes>')
FN_REF = '<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteReference w:id="1"/></w:r>'
LINK = ('<w:hyperlink r:id="rIdLink1"><w:r><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr>'
        '<w:t>example.com/q3-report</w:t></w:r></w:hyperlink>')

def rewrite(src_bytes, main_type):
    zin = zipfile.ZipFile(io.BytesIO(src_bytes))
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "word/document.xml":
                s = data.decode("utf-8")
                s = s.replace("[[FN1]]</w:t></w:r>", "</w:t></w:r>" + FN_REF)
                s = re.sub(r'(<w:t[^>]*>The full data set is at )\[\[LINK\]\]\.</w:t></w:r>', r'\1</w:t></w:r>' + LINK + '<w:r><w:t>.</w:t></w:r>', s)
                assert "[[" not in s, "marker left in document.xml"
                data = s.encode("utf-8")
            elif item.filename == "word/_rels/document.xml.rels":
                s = data.decode("utf-8").replace("</Relationships>",
                    '<Relationship Id="rIdFn1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>'
                    '<Relationship Id="rIdLink1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/q3-report" TargetMode="External"/>'
                    '</Relationships>')
                data = s.encode("utf-8")
            elif item.filename == "[Content_Types].xml":
                s = data.decode("utf-8").replace("</Types>",
                    '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/></Types>')
                s = s.replace("application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml", main_type)
                data = s.encode("utf-8")
            zout.writestr(item, data)
        zout.writestr("word/footnotes.xml", FOOTNOTES)
    return out.getvalue()

docx = rewrite(buf.getvalue(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml")
dotx = rewrite(buf.getvalue(), "application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml")
open(os.path.join(FIX, "sample.docx"), "wb").write(docx)
open(os.path.join(FIX, "sample.dotx"), "wb").write(dotx)
# Old binary Word header (OLE compound file signature) followed by filler. Enough for format detection.
open(os.path.join(FIX, "legacy.doc"), "wb").write(bytes.fromhex("D0CF11E0A1B11AE1") + b"\0" * 504)
open(os.path.join(FIX, "not-a-zip.docx"), "wb").write(b"This is plain text with a .docx name.\n")
os.makedirs(os.path.join(ROOT, "media", "sample"), exist_ok=True)
shutil.copyfile(os.path.join(FIX, "sample.docx"), os.path.join(ROOT, "media", "sample", "Q3 Field Report.docx"))
print("wrote", len(docx), "bytes sample.docx")
