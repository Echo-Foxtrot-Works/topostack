import { PbfWriter } from "pbf";

/** An invented lake and chart: deterministic data, no external survey required. */
export const chartRings = [[140, 90], [95, 61], [50, 32]] as const;
export const lakeCentre = { lat: 45, lon: -80 };
export const lakeOutline = Array.from({ length: 180 }, (_, i) => {
  const angle = 2 * Math.PI * i / 180;
  return [-80 + 0.014 * Math.cos(angle), 45 + 0.009 * Math.sin(angle)] as [number, number];
});

/** One z0 MVT in a PMTiles archive, with enough coordinate precision for a small lake. */
export function lakeArchive(centre = lakeCentre, source?: "coarse-lake" | "map-water"): Buffer {
  const extent = 2 ** 24;
  const shore = source === "coarse-lake" ? lakeOutline.filter((_, index) => index % 6 === 0) : lakeOutline;
  const ring = shore.map(([lon, lat]) => [lon - lakeCentre.lon + centre.lon, lat - lakeCentre.lat + centre.lat] as [number, number]).map(([lon, lat]) => [Math.round((lon + 180) / 360 * extent), Math.round((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * extent)] as [number, number]).reverse();
  const geometry: number[] = [];
  let x = 0, y = 0;
  for (const [i, point] of ring.entries()) {
    if (i === 0) geometry.push(9);
    if (i === 1) geometry.push((ring.length - 1) * 8 + 2);
    const dx = point[0] - x, dy = point[1] - y;
    geometry.push(dx < 0 ? -dx * 2 - 1 : dx * 2, dy < 0 ? -dy * 2 - 1 : dy * 2);
    [x, y] = point;
  }
  geometry.push(15);
  const pbf = new PbfWriter();
  pbf.writeMessage(3, (_, layer) => {
    layer.writeVarintField(15, 2);
    layer.writeStringField(1, source === "map-water" ? "water" : "lakes");
    layer.writeVarintField(5, extent);
    for (const key of ["hylak_id", "name", "area_km2"]) layer.writeStringField(3, key);
    layer.writeMessage(4, (_, value) => value.writeVarintField(4, 900001), null);
    layer.writeMessage(4, (_, value) => value.writeStringField(1, "Round Lake"), null);
    layer.writeMessage(4, (_, value) => value.writeDoubleField(3, 3), null);
    layer.writeMessage(2, (_, feature) => {
      feature.writeVarintField(1, 1);
      feature.writePackedVarint(2, [0, 0, 1, 1, 2, 2]);
      feature.writeVarintField(3, 3);
      feature.writePackedVarint(4, geometry);
    }, null);
  }, null);
  const tile = pbf.finish();
  const dir = new PbfWriter();
  for (const value of [1, 0, 1, tile.length, 1]) dir.writeVarint(value);
  const directory = dir.finish();
  const bytes = Buffer.alloc(127 + directory.length + tile.length);
  bytes.write("PMTiles"); bytes[7] = 3;
  bytes.writeBigUInt64LE(127n, 8);
  bytes.writeBigUInt64LE(BigInt(directory.length), 16);
  bytes.writeBigUInt64LE(BigInt(127 + directory.length), 56);
  bytes.writeBigUInt64LE(BigInt(tile.length), 64);
  bytes[97] = 1; bytes[98] = 1; bytes[99] = 1;
  bytes.set(directory, 127); bytes.set(tile, 127 + directory.length);
  return bytes;
}

/** A small two-page PDF: blank cover, then the same three contour rings. */
export function chartPdf(): Buffer {
  const paths = chartRings.map(([rx, ry]) => Array.from({ length: 181 }, (_, i) => {
    const a = i * 2 * Math.PI / 180;
    return `${(180 + rx * Math.cos(a)).toFixed(2)} ${(140 + ry * Math.sin(a)).toFixed(2)} ${i ? "l" : "m"}`;
  }).join("\n") + "\nh S").join("\n");
  const stream = `1 w\n0 G\n${paths}\n`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 360 280] /Resources << >> /Contents 5 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 360 280] /Resources << >> /Contents 6 0 R >>",
    "<< /Length 0 >>\nstream\n\nendstream",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [i, object] of objects.entries()) { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}
