import { zip, type AsyncZippable } from "fflate";

export async function zipBlob(entries: AsyncZippable, type = "application/zip"): Promise<Blob> {
  const bytes = await new Promise<Uint8Array>((resolve, reject) => {
    zip(entries, { level: 6 }, (error, data) => error ? reject(error) : resolve(data));
  });
  const archive = new Uint8Array(bytes.byteLength);
  archive.set(bytes);
  return new Blob([archive.buffer], { type });
}
