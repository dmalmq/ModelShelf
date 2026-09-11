import { test } from "node:test";
import assert from "node:assert/strict";
import { readResponseBytes } from "../apps/web/src/lib/read-response-bytes.ts";

test("readResponseBytes reports incremental download totals", async () => {
  const chunkA = new Uint8Array([1, 2, 3]);
  const chunkB = new Uint8Array([4, 5]);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(chunkA);
      controller.enqueue(chunkB);
      controller.close();
    },
  });
  const response = new Response(body, { headers: { "content-length": "5" } });
  const reports: Array<[number, number | null]> = [];
  const bytes = await readResponseBytes(response, undefined, (loaded, total) => {
    reports.push([loaded, total]);
  });
  assert.deepEqual(reports, [
    [3, 5],
    [5, 5],
  ]);
  assert.equal(bytes.byteLength, 5);
  assert.deepEqual([...new Uint8Array(bytes)], [1, 2, 3, 4, 5]);
});
