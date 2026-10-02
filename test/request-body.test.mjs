import test from "node:test";
import assert from "node:assert/strict";
import { boundedBody } from "../dist/request-body.js";

function streamingRequest(headers = {}) {
  let reads = 0;
  let cancellations = 0;
  const stream = new ReadableStream({
    pull(controller) {
      reads++;
      controller.enqueue(new Uint8Array(8));
    },
    cancel() {
      cancellations++;
    },
  }, { highWaterMark: 0 });
  const request = new Request("https://example.test/v1/profiles", {
    method: "POST",
    headers,
    body: stream,
    duplex: "half",
  });
  return { request, stats: () => ({ reads, cancellations }) };
}

test("oversized request bodies stop reading and cancel the upload", async () => {
  const streamed = streamingRequest();
  await assert.rejects(boundedBody(streamed.request, 10), (error) => error.status === 413);
  assert.equal(streamed.stats().reads, 2);
  assert.equal(streamed.stats().cancellations, 1);

  const declared = streamingRequest({ "Content-Length": "100" });
  await assert.rejects(boundedBody(declared.request, 10), (error) => error.status === 413);
  assert.equal(declared.stats().reads, 0);
  assert.equal(declared.stats().cancellations, 1);
});

test("bounded request bodies are returned intact", async () => {
  const request = new Request("https://example.test/api/skill-requests", {
    method: "POST",
    body: "hello",
  });
  assert.equal((await boundedBody(request, 5)).toString("utf8"), "hello");
});
