import { reviewFixture } from "$lib/domain/testing/chart-review-fixture";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { UserChartBathymetryV1 } from "@topostack/data-contracts/chart-bathymetry";
import type { ChartBuildResult } from "$lib/domain/chart-build";
import { draft, resetDraft } from "$lib/studio/customdata/chart-draft.svelte";
import { canTrace, chooseChartFile, keepChart, resetSession, resultIsCurrent, session, traceChart, traceHint, traceInputsKey, reviewSourceKey, generateReviewedDepths, canKeepChart } from "$lib/studio/customdata/chart-tracing.svelte";

/** The PDF renderer; pdf.js itself needs a real browser, so it is exercised end to end instead. */
const pdf = vi.hoisted(() => ({ renderPdfPage: vi.fn() }));
vi.mock("$lib/domain/chart-pdf", () => pdf);

/** The trace worker, held open so a test decides when each trace finishes. */
const builds: { resolve: (result: ChartBuildResult) => void; reject: (error: unknown) => void; request: Record<string, unknown> }[] = [];
vi.mock("$lib/workers/chart-trace-client", () => ({
  ChartTraceClient: class {
    prepare(request: Record<string, unknown>) { return this.build(request); }
    build(request: Record<string, unknown>) {
      return new Promise<ChartBuildResult>((resolve, reject) => builds.push({ resolve, reject, request }));
    }
    dispose() {}
  },
}));

/** A 40x30 white page, as a decoded chart image. jsdom has no ImageData. */
const pixels = () => ({ width: 40, height: 30, data: new Uint8ClampedArray(40 * 30 * 4).fill(255), colorSpace: "srgb" }) as unknown as ImageData;
const traced = (record: Partial<UserChartBathymetryV1> = {}) => ({ record: { id: "chart-1", lake: { name: "Round Lake" }, ...record }, report: { deepestM: 4, coverage: 1, iou: 0.98, snapUncertain: false } }) as unknown as ChartBuildResult;

describe("tracing a depth chart", () => {
  beforeAll(() => {
    HTMLCanvasElement.prototype.getContext ??= () => null;
  });
  afterEach(() => {
    builds.length = 0;
    resetDraft();
    resetSession();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Reads a file the way the sidebar's upload control does. */
  async function upload(name = "chart.png"): Promise<void> {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 40, height: 30, close: vi.fn() })));
    // jsdom has no Web Crypto digest; the file's hash only lands in provenance.
    vi.stubGlobal("crypto", { subtle: { digest: vi.fn(async () => new Uint8Array(32).buffer) } });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(), getImageData: vi.fn(() => pixels()),
    } as unknown as ReturnType<HTMLCanvasElement["getContext"]>);
    await chooseChartFile(new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" }));
  }

  it("reads an upload into the draft and names the chart after its lake", async () => {
    draft.lake = { id: "lake-1", name: "Round Lake", hylakId: 9092, footprint: 1, spanKm: [1, 1], distanceKm: 0, clipped: false, outline: [[-80, 45], [-79.99, 45], [-79.99, 45.01]] };
    await upload();
    expect(draft.image).toMatchObject({ width: 40, height: 30 });
    expect(draft.imageName).toBe("chart.png");
    expect(draft.title).toBe("Round Lake depth chart");
    expect(session.error).toBe("");
  });

  it("reads a PDF page as the picture, and offers the other pages when one is blank", async () => {
    vi.stubGlobal("crypto", { subtle: { digest: vi.fn(async () => new Uint8Array(32).buffer) } });
    const file = new File([new Uint8Array([37, 80, 68, 70])], "chart.pdf", { type: "application/pdf" });
    pdf.renderPdfPage.mockResolvedValueOnce({ pixels: pixels(), pages: 3, page: 1, blank: false });
    await chooseChartFile(file);
    expect(pdf.renderPdfPage).toHaveBeenCalledWith(expect.any(Uint8Array), 1, 2400);
    expect(draft.image).toMatchObject({ width: 40, height: 30 });
    expect(draft.imageName).toBe("chart.pdf, page 1");
    expect(draft.pdf).toMatchObject({ pages: 3, page: 1 });

    pdf.renderPdfPage.mockResolvedValueOnce({ pixels: pixels(), pages: 3, page: 2, blank: true });
    await chooseChartFile(file, 2);
    expect(draft.image, "a blank page is not a picture to trace").toBeUndefined();
    expect(draft.pdf).toMatchObject({ pages: 3, page: 2 });
    expect(session.error).toContain("Page 2 of this PDF is blank");
  });

  it("reports a file it cannot read as an image", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => { throw new Error("Unsupported image"); }));
    await chooseChartFile(new File([new Uint8Array([1])], "chart.txt"));
    expect(session.error).toContain("Unsupported image");
    expect(draft.image).toBeUndefined();
  });

  it("prepares geometry without seed depths", async () => {
    await upload();
    expect(draft.depths).toHaveLength(0);
    expect(canTrace()).toBe(true);
  });

  it("marks a traced result out of date whenever what it was traced from changes", async () => {
    await upload();
    draft.depths = [...draft.depths, { x: 4, y: 4, value: 10, reach: 3 }];
    draft.result = traced();
    draft.resultKey = traceInputsKey();
    expect(resultIsCurrent()).toBe(true);
    draft.depths = [...draft.depths, { x: 8, y: 8, value: 20, reach: 3 }];
    expect(resultIsCurrent(), "a new depth").toBe(false);

    draft.resultKey = traceInputsKey();
    draft.depths = draft.depths.slice(1);
    expect(resultIsCurrent(), "a removed depth").toBe(false);

    draft.resultKey = traceInputsKey();
    draft.interval = "10";
    expect(resultIsCurrent(), "a new contour interval").toBe(false);

    draft.resultKey = traceInputsKey();
    draft.title = "Another name";
    expect(resultIsCurrent(), "a name is applied when kept, not traced").toBe(true);
  });

  it("validates the surface elevation before tracing and sends placed depths as marks", async () => {
    draft.lake = { id: "lake-1", name: "Round Lake", hylakId: 9092, footprint: 1, spanKm: [1, 1], distanceKm: 0, clipped: false, outline: [[-80, 45], [-79.99, 45], [-79.99, 45.01]] };
    await upload();
    draft.reads = "elevation";
    draft.depths = [{ x: 4, y: 4, value: 10, reach: 3 }, { x: 8, y: 8, value: 20, reach: 3 }, { x: 16, y: 16, value: 30, reach: 3 }];
    await traceChart();
    expect(builds).toHaveLength(0);
    expect(traceHint()).toContain("surface elevation");
    draft.surface = "100";
    void traceChart();
    expect(builds).toHaveLength(1);
    expect(builds[0]!.request.marks).toEqual([{ x: 4, y: 4, value: 10, reach: 3 }, { x: 8, y: 8, value: 20, reach: 3 }, { x: 16, y: 16, value: 30, reach: 3 }]);
    expect(builds[0]!.request.words).toBeUndefined();
    expect(builds[0]!.request.surface).toBe(100);
  });

  it("drops a trace that finishes after its depths changed, and stays quiet when one is cancelled", async () => {
    draft.lake = { id: "lake-1", name: "Round Lake", hylakId: 9092, footprint: 1, spanKm: [1, 1], distanceKm: 0, clipped: false, outline: [[-80, 45], [-79.99, 45], [-79.99, 45.01]] };
    await upload();
    draft.depths = [{ x: 4, y: 4, value: 10, reach: 3 }, { x: 8, y: 8, value: 20, reach: 3 }, { x: 16, y: 16, value: 30, reach: 3 }];
    const first = traceChart();
    draft.depths = [...draft.depths, { x: 12, y: 12, value: 30, reach: 3 }];
    builds[0]!.resolve(traced());
    await first;
    expect(draft.result, "a stale trace must not land on the new depths").toBeUndefined();

    const second = traceChart();
    builds[1]!.reject(new DOMException("Chart tracing cancelled", "AbortError"));
    await second;
    expect(session.error).toBe("");
    expect(session.busy).toBe(false);
  });


  it("keeps the latest upload when an older file finishes afterwards", async () => {
    vi.stubGlobal("crypto", { subtle: { digest: vi.fn(async () => new Uint8Array(32).buffer) } });
    let finishFirst!: (value: unknown) => void;
    pdf.renderPdfPage.mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }));
    const first = chooseChartFile(new File(["first"], "first.pdf", { type: "application/pdf" }));
    await vi.waitFor(() => expect(finishFirst).toBeDefined());
    pdf.renderPdfPage.mockResolvedValueOnce({ pixels: pixels(), pages: 1, page: 1, blank: false });
    await chooseChartFile(new File(["second"], "second.pdf", { type: "application/pdf" }));
    finishFirst({ pixels: pixels(), pages: 1, page: 1, blank: false });
    await first;
    expect(draft.imageName).toBe("second.pdf");
    expect(session.busy).toBe(false);
  });

  it("discards an upload after the maker starts a different lake", async () => {
    vi.stubGlobal("crypto", { subtle: { digest: vi.fn(async () => new Uint8Array(32).buffer) } });
    let finish!: (value: unknown) => void;
    pdf.renderPdfPage.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const upload = chooseChartFile(new File(["first"], "first.pdf", { type: "application/pdf" }));
    await vi.waitFor(() => expect(finish).toBeDefined());
    resetDraft();
    resetSession();
    finish({ pixels: pixels(), pages: 1, page: 1, blank: false });
    await upload;
    expect(draft.image).toBeUndefined();
    expect(session.error).toBe("");
  });

  it("does not let a cancelled trace clear the busy state of a newer upload", async () => {
    draft.lake = { id: "lake-1", name: "Round Lake", hylakId: 9092, footprint: 1, spanKm: [1, 1], distanceKm: 0, clipped: false, outline: [[-80, 45], [-79.99, 45], [-79.99, 45.01]] };
    await upload();
    draft.depths = [{ x: 4, y: 4, value: 10, reach: 3 }, { x: 8, y: 8, value: 20, reach: 3 }, { x: 16, y: 16, value: 30, reach: 3 }];
    const trace = traceChart();
    let finish!: (value: unknown) => void;
    pdf.renderPdfPage.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const next = chooseChartFile(new File(["new"], "new.pdf", { type: "application/pdf" }));
    await vi.waitFor(() => expect(finish).toBeDefined());
    builds[0]!.resolve(traced());
    await trace;
    expect(draft.result).toBeUndefined();
    expect(session.busy).toBe(true);
    finish({ pixels: pixels(), pages: 1, page: 1, blank: false });
    await next;
    expect(draft.imageName).toBe("new.pdf");
    expect(session.busy).toBe(false);
  });

  it("traces below-datum elevations once the surface elevation is known", async () => {
    await upload();
    draft.reads = "elevation";
    draft.depths = [{ x: 4, y: 4, value: -10, reach: 3 }, { x: 8, y: 8, value: -20, reach: 3 }, { x: 16, y: 16, value: -30, reach: 3 }];
    expect(canTrace()).toBe(false);
    draft.surface = "0";
    expect(canTrace()).toBe(true);
    draft.interval = "-5";
    expect(canTrace(), "legacy interval metadata does not gate contour review").toBe(true);
    draft.interval = "";
    expect(canTrace()).toBe(true);
  });

  it("keeps a traced chart through the studio, and reports a browser that will not store it", async () => {
    expect(await keepChart(vi.fn()), "nothing to keep before a trace").toBe(false);

    draft.result = traced({ provenance: { title: "Round Lake depth chart", fileSha256: "0", tool: "chart-trace" }, license: { attestation: "own-work" } });
    expect(await keepChart(vi.fn()), "nothing current to keep").toBe(false);
    const fixture = reviewFixture();
    draft.image = fixture.request.image;
    draft.lake = { id: "lake-1", name: "Round Lake", outline: fixture.request.lake.outline, footprint: 1, spanKm: [1,1], distanceKm: 0, clipped: false };
    draft.units = "m"; draft.interval = "5";
    draft.review = fixture.review; draft.reviewSourceKey = reviewSourceKey();
    draft.resultKey = traceInputsKey();
    expect(await keepChart(vi.fn()), "layer review is required").toBe(false);
    draft.layersReviewedKey = draft.resultKey;
    // The name and licence are chosen after the trace, and the kept record carries them.
    draft.title = "  Viking 2019  ";
    draft.attestation = "public-domain";
    const save = vi.fn(async () => ({ id: "chart-1", contentHash: "abc" }));
    expect(await keepChart(save)).toBe(true);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      id: "chart-1",
      provenance: expect.objectContaining({ title: "Viking 2019", tool: "chart-trace" }),
      license: { attestation: "public-domain" },
      review: expect.objectContaining({ version: 1, contours: true, alignment: true, layers: true }),
    }));

    const failing = vi.fn(async () => { throw new Error("Storage is full."); });
    expect(await keepChart(failing)).toBe(false);
    expect(session.error).toBe("Storage is full.");
    expect(session.keeping).toBe(false);
    draft.review!.contours[1]!.value = 15;
    expect(canKeepChart(), "an edit invalidates the preview and receipt").toBe(false);
  });

  it("does not generate before review and discards a generated result after an edit", async () => {
    await generateReviewedDepths();
    expect(builds).toHaveLength(0);
    const fixture = reviewFixture();
    draft.image = fixture.request.image;
    draft.lake = { id: "lake-1", name: "Round Lake", outline: fixture.request.lake.outline, footprint: 1, spanKm: [1,1], distanceKm: 0, clipped: false };
    draft.units = "m"; draft.interval = "5";
    draft.review = fixture.review; draft.reviewSourceKey = reviewSourceKey();
    const generation = generateReviewedDepths();
    expect(builds).toHaveLength(1);
    expect(builds[0]!.request.review).toEqual(fixture.review);
    draft.review!.contours[1]!.confirmed = false;
    builds[0]!.resolve(traced());
    await generation;
    expect(draft.result).toBeUndefined();
  });
});
