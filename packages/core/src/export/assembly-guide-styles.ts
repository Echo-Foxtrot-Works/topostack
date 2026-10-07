import { formatNumber as format } from "../primitives/format.js";
import type { GuideFont } from "./assembly-guide.js";

/**
 * The assembly guide's stylesheet: screen and print rules, the embedded
 * fonts, and the rules only some guides need.
 */
export function assemblyGuideStyles({ fonts, sheetMaps, acrylic, pieceIdSizePx }: {
  fonts: readonly GuideFont[];
  /** The guide shows per-sheet piece maps (nested sheets). */
  sheetMaps: boolean;
  /** The guide shows acrylic water inserts. */
  acrylic: boolean;
  /** Piece-id text size in the layer diagrams, in diagram units. */
  pieceIdSizePx: number;
}): string {
  return `${fonts.map((font) => `@font-face{font-family:"${font.family.replace(/["\\<>;{}]/g, "")}";src:url(data:font/woff2;base64,${font.woff2Base64.replace(/[^A-Za-z0-9+/=]/g, "")}) format("woff2");font-weight:${Math.round(font.weight)};font-style:normal;font-display:swap}`).join("\n")}
:root{color-scheme:light;--bg:#ebe7dc;--surface:#f5f2e9;--surface-alt:#efebe1;--text:#20231d;--muted:#5f5b50;--line:#c8c1b1;--line-soft:#ddd7c9;--line-strong:#847d6a;--accent:#c65224;--accent-text:#a9441d;--on-accent:#fff;--canvas:#d8d3c7;--display:"Jost","Avenir Next","Segoe UI",sans-serif;--utility:"Archivo","Helvetica Neue",Arial,sans-serif;--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
@media screen and (prefers-color-scheme:dark){:root{color-scheme:dark;--bg:#161814;--surface:#1e211c;--surface-alt:#24271f;--text:#ebe7dc;--muted:#a8a394;--line:#3a3d34;--line-soft:#2b2e26;--line-strong:#6a6e5f;--accent:#e0672f;--accent-text:#f0895c;--on-accent:#161814;--canvas:#d8d3c7}}
*,::before,::after{box-sizing:border-box}
html{background:var(--bg);color:var(--text);font:400 16px/1.6 var(--display);-webkit-font-smoothing:antialiased}
body{margin:0;padding:0 16px 80px}
main{max-width:8.5in;margin:0 auto}
h1,h2,h3{font-weight:500;line-height:1.15;margin:0}
h1{font-size:clamp(34px,6vw,52px);letter-spacing:-.035em;margin:10px 0 12px}
h2{font-size:26px;letter-spacing:-.02em;margin-bottom:14px}
h3{font-size:22px;letter-spacing:-.01em}
p{margin:0 0 12px}
strong{font-weight:700}
code{font:12.5px var(--mono);background:var(--surface-alt);border:1px solid var(--line-soft);padding:1px 5px;overflow-wrap:anywhere;white-space:normal}
.label{font:11px/1.4 var(--utility);letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin:0 0 6px}
.muted{color:var(--muted)}
.lede{font-size:18px;line-height:1.6;color:var(--muted);max-width:40em}
.masthead{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:16px 0;margin-bottom:24px;border-bottom:1px solid var(--line)}
.wordmark{font:500 20px var(--display);letter-spacing:-.01em;display:flex;align-items:center;gap:10px}
.wordmark svg{width:26px;height:26px}
.masthead .label{margin:0}
.page{background:var(--surface);border:1px solid var(--line);padding:32px;margin-bottom:24px}
.cover{padding:36px 32px}
.cover figure{margin:24px 0 28px}
.facts{display:grid;grid-template-columns:repeat(3,1fr);margin:0;border-top:1px solid var(--line)}
.facts>div{padding:12px 16px 12px 0;border-bottom:1px solid var(--line-soft)}
.facts dt{font:11px var(--utility);letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.facts dd{margin:4px 0 0;font-size:18px;font-weight:500}
figure{margin:0;background:var(--canvas);padding:14px;box-shadow:0 18px 23px rgb(32 35 29/.12)}
.diagram{display:block;width:100%;height:auto;max-height:118mm}${sheetMaps ? `
.sheet-maps{display:grid;grid-template-columns:repeat(auto-fill,minmax(3in,1fr));gap:14px;margin-top:10px}
.sheet-map figcaption{margin-top:6px}` : ""}
.diagram use{stroke:#847d6a;stroke-width:.6;vector-effect:non-scaling-stroke;fill-rule:evenodd}
.diagram use.current{fill:#c65224;stroke:#6e2a10;stroke-width:1.4}
${acrylic ? `.diagram use.acrylic{fill:#7fb2cc;fill-opacity:.6;stroke:#1f5f7d;stroke-width:1}
.diagram .insert-id{stroke:#1f5f7d}
.swatch-acrylic{background:rgb(127 178 204/.6);border:1px solid #1f5f7d}
` : ""}.diagram .callout{fill:none;stroke:#c65224;stroke-width:1.8;stroke-dasharray:4 3;vector-effect:non-scaling-stroke}
.diagram .piece-id{font:600 ${format(pieceIdSizePx)}px "Archivo","Helvetica Neue",sans-serif;fill:#fff;stroke:#6e2a10;stroke-width:.35em;paint-order:stroke;text-anchor:middle;dominant-baseline:central}
.two{display:grid;grid-template-columns:1fr 1fr;gap:32px}
ul,ol{margin:0;padding-left:1.3em}
li{margin-bottom:8px}
.numbered{counter-reset:n;list-style:none;padding:0}
.numbered>li{counter-increment:n;position:relative;padding-left:40px;min-height:28px;margin-bottom:12px}
.numbered>li::before{content:counter(n);position:absolute;left:0;top:0;width:26px;height:26px;display:grid;place-items:center;background:var(--text);color:var(--bg);font:600 12px var(--utility)}
table{width:100%;border-collapse:collapse;font-size:15px;margin-top:16px}
td{border-bottom:1px solid var(--line);padding:9px 12px 9px 0;vertical-align:top}
td:first-child{width:32px}
input[type=checkbox]{appearance:none;-webkit-appearance:none;width:18px;height:18px;margin:2px 0 0;border:1.5px solid var(--line-strong);background:var(--surface);display:inline-grid;place-content:center;cursor:pointer;vertical-align:-3px}
input[type=checkbox]:checked{background:var(--accent);border-color:var(--accent)}
input[type=checkbox]:checked::after{content:"";width:9px;height:5px;border:2px solid var(--on-accent);border-top:0;border-right:0;transform:translateY(-1px) rotate(-45deg)}
input[type=checkbox]:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.legend{list-style:none;padding:0}
.legend li{display:flex;align-items:center;gap:12px}
.swatch{flex:none;width:28px;height:18px;display:grid;place-items:center;font:600 10px var(--utility)}
.swatch-current{background:#c65224;border:1.5px solid #6e2a10}
.swatch-below{background:#d4ccbb;border:1px solid #847d6a}
.swatch-id{background:#c65224;color:#fff}
.swatch-ring{border:1.8px dashed #c65224;border-radius:50%;width:22px;height:22px;margin:0 3px}
.build-intro h3{margin:0 0 12px}
.step{background:var(--surface);border:1px solid var(--line);padding:24px;margin-bottom:20px;break-inside:avoid}
.step header{display:flex;gap:16px;align-items:center;margin-bottom:16px}
.step-title{flex:1}
.step-title .label{margin:0 0 2px}
.badge{flex:none;width:48px;height:48px;background:var(--accent);color:var(--on-accent);font:500 24px var(--display);display:grid;place-items:center}
.done{display:flex;gap:8px;align-items:center;font:11px var(--utility);letter-spacing:.1em;text-transform:uppercase;color:var(--muted);cursor:pointer}
.step-body{margin-top:16px}
.step-facts{display:grid;grid-template-columns:auto 1fr;gap:6px 16px;margin:0}
.step-facts>div{display:contents}
.step-facts dt{font:11px/2 var(--utility);letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.step-facts dd{margin:0}
.notes{list-style:none;padding:12px 0 0;margin:12px 0 0;border-top:1px solid var(--line-soft)}
.notes li{padding-left:14px;border-left:3px solid var(--accent);margin-bottom:10px}
.print{position:fixed;right:16px;bottom:16px;border:0;min-height:44px;background:var(--accent);color:var(--on-accent);padding:10px 18px;font:500 15px var(--display);cursor:pointer;box-shadow:0 12px 30px rgb(32 35 29/.18)}
.print:hover{background:var(--accent-text)}
footer{font:12px/1.8 var(--utility);color:var(--muted);margin-top:24px;padding-top:16px;border-top:1px solid var(--line)}
@media (max-width:640px){.two{grid-template-columns:1fr;gap:20px}.page,.step{padding:20px}.facts{grid-template-columns:1fr 1fr}.badge{width:40px;height:40px;font-size:20px}}
@page{size:letter;margin:.5in}
@media print{
html{background:#fff;font-size:10pt}
body{padding:0}
.print{display:none}
.page,.step{background:none;border:0;padding:0;margin:0 0 .3in}
.masthead{padding-top:0}
.cover{break-after:page}
.cover .diagram{max-height:5.2in}
h2,h3,.label{break-after:avoid}
tr{break-inside:avoid}
.build-intro{break-before:page}
figure{background:#efebe1;box-shadow:none;padding:.06in}
.step{display:grid;grid-template-columns:1.25fr 1fr;grid-template-areas:"fig head" "fig body";grid-template-rows:auto 1fr;gap:0 .25in;align-items:start;border-top:1.5px solid var(--text);padding-top:.12in;margin:0 0 .14in}
.step header{grid-area:head;margin-bottom:.1in}
.step figure{grid-area:fig}
.step-body{grid-area:body;margin-top:0}
.diagram{max-height:2.6in}
.badge{width:.45in;height:.45in;font-size:18pt}
code{font-size:8pt}
figure,code,.badge,.diagram,.swatch,.numbered>li::before,input{-webkit-print-color-adjust:exact;print-color-adjust:exact}
}`;
}
