export async function readResponseBytes(
  response: Response,
  signal?: AbortSignal,
  report?: (loaded: number, total: number | null) => void,
): Promise<ArrayBuffer> {
  const total = contentLength(response);
  if (!response.body || !report) {
    const bytes = await response.arrayBuffer();
    report?.(bytes.byteLength, bytes.byteLength);
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    if (signal?.aborted) {
      await reader.cancel();
      throw new DOMException("The operation was aborted.", "AbortError");
    }
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    report(loaded, total);
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

function contentLength(response: Response): number | null {
  const raw = response.headers.get("content-length");
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const total = Number(raw);
  return total > 0 ? total : null;
}
