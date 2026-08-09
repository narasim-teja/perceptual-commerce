import { recentEvents, subscribe, type FeedEvent } from "@tessr/app";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Server-sent events for the live pipeline feed.
 *
 * Two details that matter for a demo:
 *
 *  - **Replay on connect.** We subscribe first and then push the last 40
 *    events, so a browser opened halfway through is not a blank panel and an
 *    event emitted during the replay is not lost in the gap. The client dedupes
 *    on id:at, so an event that arrives both ways renders once.
 *  - **Heartbeat.** A comment frame every 15s keeps proxies and the dev server
 *    from closing an idle stream. SSE comments start with `:` and clients ignore
 *    them, so this costs nothing on the receiving end.
 */
export async function GET(request: Request) {
  // Touch the service before opening the stream: a broken .env must answer as
  // JSON, not explode inside a ReadableStream where the client only sees a
  // dropped connection.
  try {
    recentEvents(0);
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (event: FeedEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };

      const unsubscribe = subscribe(send);
      for (const event of recentEvents(40)) send(event);
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          closed = true;
        }
      }, 15_000);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* already closed by the client going away */
        }
      };

      request.signal.addEventListener("abort", cleanup, { once: true });
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Nginx and friends buffer streamed responses by default, which turns a
      // live feed into a burst at the end.
      "x-accel-buffering": "no",
    },
  });
}
