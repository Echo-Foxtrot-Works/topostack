// Lays the studio's renders and screenshots out as listing cards. The model
// pixels are never painted over: a cutout only recovers the alpha the studio's
// renderer produced over white and over black. Backdrops are the place's own
// flat-engraving artwork, restyled as faint lines.
export const CARD = { width: 1600, height: 1200, scale: 2 };
const INK = "#e9dcc6";
const FONT = "'Helvetica Neue', Arial, sans-serif";

const dataUrl = (buffer, type = "image/png") => `data:${type};base64,${buffer.toString("base64")}`;
export const escapeHtml = text => String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");

/** Recover the model's alpha from its white and black renders and trim to its bounds. */
export async function cutout(page, { white, black }) {
  await page.setContent("<body style='margin:0'></body>");
  return page.evaluate(async ([w, k]) => {
    const load = src => new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = src; });
    const [a, b] = await Promise.all([load(w), load(k)]);
    const canvas = document.createElement("canvas"); canvas.width = a.width; canvas.height = a.height;
    const g = canvas.getContext("2d", { willReadFrequently: true });
    g.drawImage(a, 0, 0); const W = g.getImageData(0, 0, canvas.width, canvas.height);
    g.drawImage(b, 0, 0); const B = g.getImageData(0, 0, canvas.width, canvas.height);
    const out = g.createImageData(canvas.width, canvas.height);
    let minX = canvas.width, minY = canvas.height, maxX = 0, maxY = 0;
    for (let i = 0; i < out.data.length; i += 4) {
      const diff = (W.data[i] - B.data[i] + W.data[i + 1] - B.data[i + 1] + W.data[i + 2] - B.data[i + 2]) / 3;
      const alpha = Math.max(0, Math.min(255, 255 - diff));
      if (alpha > 8) { const p = i / 4, x = p % canvas.width, y = (p / canvas.width) | 0; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
      const s = alpha ? 255 / alpha : 0;
      out.data[i] = Math.min(255, B.data[i] * s); out.data[i + 1] = Math.min(255, B.data[i + 1] * s); out.data[i + 2] = Math.min(255, B.data[i + 2] * s); out.data[i + 3] = alpha;
    }
    if (maxX < minX) throw new Error("The render held no model pixels");
    g.putImageData(out, 0, 0);
    const trimmed = document.createElement("canvas"); trimmed.width = maxX - minX + 1; trimmed.height = maxY - minY + 1;
    trimmed.getContext("2d").drawImage(canvas, minX, minY, trimmed.width, trimmed.height, 0, 0, trimmed.width, trimmed.height);
    return trimmed.toDataURL("image/png");
  }, [dataUrl(white), dataUrl(black)]);
}

/** The place's engraving as faint backdrop lines. */
export function contourLines(svg, color = "#9cc0cf", widthPx = 1.6) {
  const styled = svg.replace(/<svg\b[^>]*>/, open => `${open}<style>*{stroke:${color}!important;fill:none!important;stroke-width:${widthPx}px!important;vector-effect:non-scaling-stroke}</style>`);
  return dataUrl(Buffer.from(styled), "image/svg+xml");
}

/** The engraving as artwork on a birch-coloured panel: what the flat output looks like. */
export function engravingArtwork(svg) {
  const styled = svg.replace(/<svg\b[^>]*>/, open => `${open}<style>*{stroke:#4a2e17!important;stroke-width:1.1px!important;vector-effect:non-scaling-stroke}[fill]:not([fill=none]){fill:#4a2e17!important}</style>`);
  return dataUrl(Buffer.from(styled), "image/svg+xml");
}

export const backdrop = (lines, opacity = 0.5) => `<div style="position:absolute;inset:0;background:radial-gradient(120% 95% at 50% 42%,#33505f 0%,#1a2a34 72%)"></div>${lines ? `<img src="${lines}" style="position:absolute;left:50%;top:50%;width:230%;transform:translate(-50%,-50%) rotate(-8deg);opacity:${opacity}">` : ""}`;

export const model = (src, { left = 50, top = 54, width = 90, height, z = 1 } = {}) => `<img src="${src}" style="position:absolute;left:${left}%;top:${top}%;${height ? `height:${height}%` : `width:${width}%`};transform:translate(-50%,-50%);z-index:${z};filter:drop-shadow(0 26px 30px rgba(0,0,0,.5)) drop-shadow(0 6px 8px rgba(0,0,0,.25))">`;

/** A gallery card: headline and subtitle over the backdrop, a caption at the foot. */
export function card({ lines, headline, subtitle, body, caption }) {
  return `${backdrop(lines, 0.32)}
    <header style="position:absolute;left:72px;top:56px;right:72px;z-index:10;color:${INK};font-family:${FONT}">
      <div style="display:flex;justify-content:space-between;font-size:22px;font-weight:700;letter-spacing:.5px;opacity:.85"><span>TopoStack</span><span style="font-weight:400;letter-spacing:3px;font-size:16px">MAP · LAYER · MAKE</span></div>
      <h1 style="margin:34px 0 14px;font-size:76px;line-height:1.04;letter-spacing:-2.5px;font-weight:800">${escapeHtml(headline)}</h1>
      <p style="margin:0;font-size:30px;line-height:1.3;opacity:.78;max-width:1250px">${escapeHtml(subtitle)}</p>
    </header>
    ${body}
    <footer style="position:absolute;left:72px;right:72px;bottom:40px;z-index:10;display:flex;justify-content:space-between;color:${INK};opacity:.62;font:400 17px ${FONT}"><span>${escapeHtml(caption)}</span><span>topostack.app</span></footer>`;
}

/** A UI screenshot in a rounded frame. */
export const screenshot = (buffer, { left = 50, top = 63, width = 88, z = 2, anchor = "center" } = {}) => `<img src="${dataUrl(buffer)}" style="position:absolute;left:${left}%;top:${top}%;width:${width}%;max-height:${anchor === "top" ? 100 - top - 9 : 100}%;object-fit:cover;object-position:top;transform:translate(-50%,${anchor === "top" ? "0" : "-50%"});z-index:${z};border-radius:18px;box-shadow:0 24px 60px rgba(0,0,0,.45),0 0 0 1px rgba(255,255,255,.08)">`;

export async function renderCard(page, html, path) {
  await page.setViewportSize({ width: CARD.width, height: CARD.height });
  await page.setContent(`<body style="margin:0;width:${CARD.width}px;height:${CARD.height}px;position:relative;overflow:hidden;background:#1a2a34">${html}</body>`);
  await page.evaluate(() => Promise.all([...document.images].map(image => image.decode().catch(() => {}))));
  return page.screenshot({ path });
}
