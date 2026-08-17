import "server-only";
import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export interface PdfReportItem {
  number: number;
  heading: string;
  meta: string[];
  parties?: string;
  body?: string;
}

export interface PdfReportSection {
  title: string;
  items: PdfReportItem[];
}

const PAGE = { width: 612, height: 792, margin: 48 };
const burgundy = rgb(0.42, 0.15, 0.22);
const ink = rgb(0.11, 0.1, 0.09);
const stone = rgb(0.42, 0.4, 0.36);
const line = rgb(0.82, 0.79, 0.73);
const paper = rgb(0.97, 0.95, 0.91);

function safe(value: string) {
  return value.replace(/[–—]/g, "-").replace(/…/g, "...").replace(/[^\u0009\u000A\u000D\u0020-\u007E\u00A0-\u00FF]/g, "");
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const paragraphs = safe(text).split(/\n+/);
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) { lines.push(""); continue; }
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) current = candidate;
      else {
        if (current) lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

export async function createReportPdf(input: {
  title: string;
  subtitle: string;
  generatedLabel: string;
  notice?: string;
  sections: PdfReportSection[];
  watermark?: string;
}) {
  const document = await PDFDocument.create();
  document.setTitle(safe(input.title));
  document.setAuthor("Mi Boletín Judicial");
  document.setCreator("miboletin.lat");
  document.setProducer("Mi Boletín Judicial");
  document.setCreationDate(new Date());
  const sans = await document.embedFont(StandardFonts.Helvetica);
  const sansBold = await document.embedFont(StandardFonts.HelveticaBold);
  const serif = await document.embedFont(StandardFonts.TimesRoman);
  const serifBold = await document.embedFont(StandardFonts.TimesRomanBold);
  let page: PDFPage;
  let y = PAGE.height - 96;

  const addPage = () => {
    page = document.addPage([PAGE.width, PAGE.height]);
    page.drawRectangle({ x: 0, y: 0, width: PAGE.width, height: PAGE.height, color: paper });
    if (input.watermark) page.drawText(safe(input.watermark), { x: 96, y: 350, size: 38, font: serifBold, color: rgb(0.9, 0.86, 0.82), rotate: degrees(38) });
    page.drawRectangle({ x: PAGE.margin, y: PAGE.height - 61, width: 32, height: 32, color: burgundy });
    page.drawText("M", { x: PAGE.margin + 9, y: PAGE.height - 53, size: 18, font: serifBold, color: rgb(1, 0.99, 0.97) });
    page.drawText("MI BOLETÍN JUDICIAL", { x: PAGE.margin + 44, y: PAGE.height - 49, size: 10, font: sansBold, color: burgundy });
    page.drawText("miboletin.lat", { x: PAGE.width - PAGE.margin - 64, y: PAGE.height - 49, size: 8, font: sans, color: stone });
    page.drawLine({ start: { x: PAGE.margin, y: PAGE.height - 72 }, end: { x: PAGE.width - PAGE.margin, y: PAGE.height - 72 }, thickness: 1.4, color: burgundy });
    y = PAGE.height - 96;
  };

  const ensure = (height: number) => {
    if (y - height < 54) addPage();
  };

  addPage();
  for (const lineText of wrap(input.title, serif, 27, PAGE.width - PAGE.margin * 2)) {
    page!.drawText(lineText, { x: PAGE.margin, y, size: 27, font: serif, color: ink });
    y -= 31;
  }
  y -= 5;
  for (const lineText of wrap(input.subtitle, sans, 10, PAGE.width - PAGE.margin * 2)) {
    page!.drawText(lineText, { x: PAGE.margin, y, size: 10, font: sans, color: stone });
    y -= 14;
  }
  y -= 10;
  page!.drawText(safe(input.generatedLabel), { x: PAGE.margin, y, size: 9, font: sansBold, color: burgundy });
  y -= 24;
  if (input.notice) {
    const noticeLines = wrap(input.notice, sans, 8.5, PAGE.width - PAGE.margin * 2 - 20);
    const height = noticeLines.length * 12 + 18;
    ensure(height);
    page!.drawRectangle({ x: PAGE.margin, y: y - height + 7, width: PAGE.width - PAGE.margin * 2, height, color: rgb(0.93, 0.9, 0.85), borderColor: line, borderWidth: 0.6 });
    let noticeY = y - 7;
    for (const lineText of noticeLines) { page!.drawText(lineText, { x: PAGE.margin + 10, y: noticeY, size: 8.5, font: sans, color: ink }); noticeY -= 12; }
    y -= height + 9;
  }

  for (const section of input.sections.filter((item) => item.items.length)) {
    ensure(46);
    page!.drawLine({ start: { x: PAGE.margin, y }, end: { x: PAGE.width - PAGE.margin, y }, thickness: 0.8, color: burgundy });
    y -= 18;
    page!.drawText(safe(section.title.toUpperCase()), { x: PAGE.margin, y, size: 9, font: sansBold, color: burgundy });
    page!.drawText(String(section.items.length), { x: PAGE.width - PAGE.margin - 12, y, size: 9, font: sansBold, color: burgundy });
    y -= 20;
    for (const item of section.items) {
      const headingLines = wrap(`${item.number}. ${item.heading}`, serifBold, 13, PAGE.width - PAGE.margin * 2);
      const metaLines = item.meta.flatMap((meta) => wrap(meta, sans, 8.5, PAGE.width - PAGE.margin * 2 - 18));
      const partyLines = item.parties ? wrap(`Partes: ${item.parties}`, sans, 8.5, PAGE.width - PAGE.margin * 2 - 18) : [];
      const bodyLines = item.body ? wrap(item.body, serif, 10.5, PAGE.width - PAGE.margin * 2 - 18) : [];
      const height = headingLines.length * 16 + (metaLines.length + partyLines.length) * 11 + bodyLines.length * 14 + 23;
      ensure(Math.min(height, 280));
      for (const lineText of headingLines) { page!.drawText(lineText, { x: PAGE.margin, y, size: 13, font: serifBold, color: ink }); y -= 16; }
      for (const lineText of metaLines) { page!.drawText(lineText, { x: PAGE.margin + 18, y, size: 8.5, font: sans, color: stone }); y -= 11; }
      for (const lineText of partyLines) { page!.drawText(lineText, { x: PAGE.margin + 18, y, size: 8.5, font: sansBold, color: ink }); y -= 11; }
      if (bodyLines.length) y -= 4;
      for (const lineText of bodyLines) {
        ensure(18);
        page!.drawText(lineText, { x: PAGE.margin + 18, y, size: 10.5, font: serif, color: ink });
        y -= 14;
      }
      y -= 10;
      page!.drawLine({ start: { x: PAGE.margin + 18, y }, end: { x: PAGE.width - PAGE.margin, y }, thickness: 0.45, color: line });
      y -= 14;
    }
  }

  if (!input.sections.some((section) => section.items.length)) {
    ensure(80);
    page!.drawText("No se encontraron publicaciones para los criterios seleccionados.", { x: PAGE.margin, y, size: 13, font: serif, color: stone });
  }

  const pages = document.getPages();
  pages.forEach((current, index) => {
    current.drawLine({ start: { x: PAGE.margin, y: 38 }, end: { x: PAGE.width - PAGE.margin, y: 38 }, thickness: 0.5, color: line });
    current.drawText("Documento informativo. Verifica siempre la publicación oficial.", { x: PAGE.margin, y: 24, size: 7.5, font: sans, color: stone });
    current.drawText(`${index + 1} / ${pages.length}`, { x: PAGE.width - PAGE.margin - 22, y: 24, size: 7.5, font: sans, color: stone });
  });
  return document.save();
}
