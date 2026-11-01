// Minimal PDF 1.4 writer: one full-page JPEG per page. Rasterised pages keep the
// report self-contained (no font embedding or glyph coverage to worry about).

/** Page raster: A4 at 144 dpi. */
export const PAGE_WIDTH_PX = 1190;
export const PAGE_HEIGHT_PX = 1684;
/** A4 in PDF points. */
const PAGE_PT = [595, 842] as const;

const enc = new TextEncoder();

export function assemblePdf(jpegPages: Uint8Array[], comment = 'XYP3RN report'): Blob {
  const parts: Uint8Array[] = [enc.encode(`%PDF-1.4\n%${comment}\n`)];
  const offsets = [0];
  let offset = parts[0]!.length;
  const object = (id: number, ...chunks: Uint8Array[]) => {
    offsets[id] = offset;
    for (const chunk of [enc.encode(`${id} 0 obj\n`), ...chunks, enc.encode('\nendobj\n')]) {
      parts.push(chunk);
      offset += chunk.length;
    }
  };
  // Objects: 1 catalog, 2 page tree, then per page: page, image, content stream.
  const pageId = (i: number) => 3 + i * 3;
  object(1, enc.encode('<< /Type /Catalog /Pages 2 0 R >>'));
  object(2, enc.encode(`<< /Type /Pages /Count ${jpegPages.length} /Kids [${jpegPages.map((_, i) => `${pageId(i)} 0 R`).join(' ')}] >>`));
  const [w, h] = PAGE_PT;
  const draw = enc.encode(`q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`);
  jpegPages.forEach((jpeg, i) => {
    const id = pageId(i);
    object(id, enc.encode(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${id + 1} 0 R >> >> /Contents ${id + 2} 0 R >>`));
    object(id + 1,
      enc.encode(`<< /Type /XObject /Subtype /Image /Width ${PAGE_WIDTH_PX} /Height ${PAGE_HEIGHT_PX} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`),
      jpeg, enc.encode('\nendstream'));
    object(id + 2, enc.encode(`<< /Length ${draw.length} >>\nstream\n`), draw, enc.encode('\nendstream'));
  });
  const xref = offset;
  const entries = offsets.slice(1).map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  parts.push(enc.encode(`xref\n0 ${offsets.length}\n0000000000 65535 f \n${entries}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
  return new Blob(parts as BlobPart[], { type: 'application/pdf' });
}
