/** JSON in and out for the Worker's routes (worker/index.js, worker/accounts.js). */

export const MAX_BODY_BYTES = 4 * 1024;

export function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

/** The request's JSON body; throws a ready error Response when it is too long or not JSON. */
export async function readJsonBody(request, maxBytes = MAX_BODY_BYTES) {
  const declaredLength = Number(request.headers.get("Content-Length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw jsonResponse({ error: "请求内容过长。" }, 413);
  }
  const reader = request.body?.getReader();
  const chunks = [];
  let length = 0;
  if (reader) {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > maxBytes) {
          // Do not drain or decode a body after it exceeds the byte budget.
          void reader.cancel().catch(() => {});
          throw jsonResponse({ error: "请求内容过长。" }, 413);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw jsonResponse({ error: "请求不是有效的 JSON。" }, 400);
  }
}
