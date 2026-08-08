import { recentEvents, subscribe, type FeedEvent } from "@pc/app";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Server-sent events for the live pipeline feed.
 *
 * Two details that matter for a demo:
 *
 *  - **Replay on connect.** We push the last 40 events before subscribing, so a
 *    browser opened halfway through is not a blank panel.
 *  - **Heartbeat.** A comment frame every 15s keeps proxies and the dev server
 *    from closing an idle stream. SSE comments start with `:` and clients ignore
 *    them, so this costs nothing on the receiving end.
 */
export async function GET(request: Request) {
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

      for (const event of recentEvents(40)) send(event);

      const unsubscribe = subscribe(send);
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
