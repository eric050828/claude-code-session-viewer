import fs from "node:fs";
import { sessionFilePath } from "@/lib/session-loader";

export const dynamic = "force-dynamic";

// SSE stream that polls session jsonl for new lines and pushes them.
// Uses simple poll + size compare to avoid fs.watch quirks across platforms.
export async function GET(
  _req: Request,
  { params }: { params: { projectId: string; sessionId: string } },
) {
  const filePath = sessionFilePath(params.projectId, params.sessionId);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let lastSize = 0;
      try {
        const stat = await fs.promises.stat(filePath);
        lastSize = stat.size;
      } catch {
        // file may not exist yet
      }

      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      send("ready", { size: lastSize });

      let cancelled = false;
      const interval = setInterval(async () => {
        if (cancelled) return;
        try {
          const stat = await fs.promises.stat(filePath);
          if (stat.size > lastSize) {
            const fh = await fs.promises.open(filePath, "r");
            const length = stat.size - lastSize;
            const buf = Buffer.alloc(length);
            await fh.read(buf, 0, length, lastSize);
            await fh.close();
            lastSize = stat.size;
            const text = buf.toString("utf-8");
            const newEvents: unknown[] = [];
            for (const line of text.split("\n")) {
              if (!line.trim()) continue;
              try {
                newEvents.push(JSON.parse(line));
              } catch {}
            }
            if (newEvents.length) send("append", { events: newEvents });
          } else if (stat.size < lastSize) {
            // file truncated/replaced — signal full reload
            lastSize = stat.size;
            send("reset", {});
          }
        } catch {
          // stat failed transiently — ignore
        }
      }, 1500);

      // heartbeat to keep connection alive
      const hb = setInterval(() => {
        if (cancelled) return;
        try {
          controller.enqueue(encoder.encode(`: keepalive\n\n`));
        } catch {}
      }, 25000);

      const close = () => {
        cancelled = true;
        clearInterval(interval);
        clearInterval(hb);
        try {
          controller.close();
        } catch {}
      };

      // close handler when client disconnects
      const signal = (_req as Request & { signal?: AbortSignal }).signal;
      signal?.addEventListener("abort", close);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
