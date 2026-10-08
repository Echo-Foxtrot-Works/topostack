import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { readPdfPage, type PdfJs } from "./pdf.ts";

/**
 * A one-page PDF with the given content stream, written by hand so the test
 * needs no PDF writer. `form` is the content of a form XObject drawn as /X1,
 * scaled by two.
 */
function pdf(content: string, mediaBox = "0 0 300 400", form = ""): Uint8Array {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [${mediaBox}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> /XObject << /X1 6 0 R >> >> >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Type /XObject /Subtype /Form /BBox [0 0 100 100] /Matrix [2 0 0 2 0 0] /Length ${form.length} >>\nstream\n${form}\nendstream`,
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

const reader = pdfjs as unknown as PdfJs;

/** A stand-in for pdf.js serving one 100 x 100 page with these operators and text runs. */
function fakeReader(fnArray: number[], argsArray: unknown[], items: unknown[] = []): PdfJs & { destroyed: boolean } {
  const fake = {
    destroyed: false,
    OPS: reader.OPS,
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 1,
        getPage: async () => ({ view: [0, 0, 100, 100], getOperatorList: async () => ({ fnArray, argsArray }), getTextContent: async () => ({ items }) }),
      }),
      destroy: async () => { fake.destroyed = true; },
    }),
  };
  return fake;
}

const { OPS } = reader;

describe("readPdfPage", () => {
  it("reads strokes with their style in top-left page units, through the transformation matrix", async () => {
    const page = await readPdfPage(reader, pdf([
      "q 1 0 0 1 10 20 cm 0.2 0.4 0.6 RG 2 w 0 0 m 100 0 l S Q",
      "0 0 1 RG 1 w [3 2] 0 d 50 50 m 60 60 l 70 50 l h S [] 0 d",
      "0 0 0 RG 0.5 w 100 100 m 120 140 140 140 160 100 c S",
      "1 0 0 rg 10 10 20 20 re f",
    ].join("\n")));
    expect(page).toMatchObject({ width: 300, height: 400 });
    const [line, dashed, curve, square] = page.paths;
    expect(line).toMatchObject({ stroke: "#336699", lineWidth: 2, dashed: false, closed: false, points: [[10, 380], [110, 380]] });
    expect(dashed).toMatchObject({ stroke: "#0000ff", dashed: true, closed: true, points: [[50, 350], [60, 340], [70, 350]] });
    expect(curve!.points).toHaveLength(9);
    expect(curve!.points.at(-1)).toEqual([160, 300]);
    // The curve bulges up the page (y down), towards its control points.
    expect(Math.min(...curve!.points.map(([, y]) => y))).toBeLessThan(300);
    expect(square).toMatchObject({ fill: "#ff0000", closed: true });
    expect(square!.stroke).toBeUndefined();
  });

  it("reads text centred on its run and turned along its baseline", async () => {
    const page = await readPdfPage(reader, pdf("BT /F1 12 Tf 0 1 -1 0 200 100 Tm (15) Tj ET\nBT /F1 10 Tf 40 360 Td (Contours) Tj ET"));
    const label = page.texts.find((text) => text.text === "15")!;
    // Reading upward on the page: -90 degrees with y down.
    expect(label.angle).toBeCloseTo(-Math.PI / 2, 6);
    expect(label.size).toBeCloseTo(12, 6);
    expect(label.width).toBeGreaterThan(10);
    expect(label.x).toBeCloseTo(200 - 12 * 0.35, 3);
    expect(label.y).toBeCloseTo(400 - (100 + label.width / 2), 3);
    expect(page.texts.find((text) => text.text === "Contours")).toMatchObject({ angle: 0, y: expect.closeTo(400 - 360 - 3.5, 3) });
  });

  it("offsets a page whose media box does not start at the origin, and rejects a missing page", async () => {
    const page = await readPdfPage(reader, pdf("0 0 0 RG 110 120 m 150 120 l S", "100 100 400 500"));
    expect(page.paths[0]!.points).toEqual([[10, 380], [50, 380]]);
    await expect(readPdfPage(reader, pdf(""), 2)).rejects.toThrow(/no page 2/);
  });
  it("draws a form XObject through its matrix and restores the state after it", async () => {
    const page = await readPdfPage(reader, pdf("0 0 1 RG 3 w /X1 Do 0 0 m 10 0 l S", "0 0 300 400", "10 10 m 20 10 l S"));
    expect(page.paths.map(({ points, lineWidth }) => ({ points, lineWidth }))).toEqual([
      { points: [[20, 380], [40, 380]], lineWidth: 6 },
      { points: [[0, 400], [10, 400]], lineWidth: 3 },
    ]);
  });

  it("skips clipping paths and continues a closed subpath from its start", async () => {
    const page = await readPdfPage(reader, pdf("0 0 50 50 re W n\n0 0 0 RG 10 10 m 20 10 l h 30 30 l S\n40 40 m 50 40 l h 60 40 70 50 80 40 c S"));
    expect(page.paths).toHaveLength(4);
    expect(page.paths[0]).toMatchObject({ closed: true, points: [[10, 390], [20, 390]] });
    expect(page.paths[1]).toMatchObject({ closed: false, points: [[10, 390], [30, 370]] });
    expect(page.paths[3]!.points[0]).toEqual([40, 360]);
    expect(page.paths[3]!.points.at(-1)).toEqual([80, 360]);
  });

  it("reads quadratic segments and RGB colour arrays from the operator list", async () => {
    const quadratic = fakeReader([OPS.setStrokeRGBColor!, OPS.constructPath!], [[[255, 128, 0]], [OPS.stroke, [[0, 0, 0, 3, 50, 100, 100, 0]]]]);
    const page = await readPdfPage(quadratic, new Uint8Array());
    expect(page.paths[0]!.stroke).toBe("#ff8000");
    expect(page.paths[0]!.points).toHaveLength(9);
    expect(page.paths[0]!.points.at(-1)).toEqual([100, 100]);
    // A quadratic with its control point at (50, 100) peaks halfway, at y = 50 (page y down).
    expect(page.paths[0]!.points[4]![1]).toBeCloseTo(50, 9);
    expect(quadratic.destroyed).toBe(true);
  });

  it("refuses path data from pdf.js before 6, and unknown path operators, still closing the document", async () => {
    const old = fakeReader([OPS.constructPath!], [[OPS.stroke, [0, 0, 0, 1, 10, 10]]]);
    await expect(readPdfPage(old, new Uint8Array())).rejects.toThrow(/pdf\.js 6 or later/);
    expect(old.destroyed).toBe(true);
    await expect(readPdfPage(fakeReader([OPS.constructPath!], [[OPS.stroke, [[0, 0, 0, 9]]]]), new Uint8Array())).rejects.toThrow(/Unknown PDF path operator 9/);
  });

  it("skips text runs with no transform or no size", async () => {
    const page = await readPdfPage(fakeReader([], [], [{ str: "5", transform: [0, 0, 0, 0, 10, 10] }, { str: "10" }, { str: " " }, { str: "15", transform: [8, 0, 0, 8, 10, 10] }]), new Uint8Array());
    expect(page.texts.map(({ text, width }) => [text, width])).toEqual([["15", 0]]);
  });
});
