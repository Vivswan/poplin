// What the upgrade check's pieces share.

/** The address of this machine itself, which a command takes over plain HTTP. */
const LOOPBACK = "127.0.0.1";

/** An install answering on a port of this machine. */
export interface Listening {
  /** The origin a command is told as its server. */
  readonly origin: string;

  /** Stops answering and frees the port. */
  readonly stop: () => Promise<void>;
}

/**
 * Answer on a free port of this machine with one handler.
 *
 * Each answer goes out whole, so it states its length: a download is read by it.
 */
export function listen(answer: (request: Request) => Promise<Response>): Listening {
  const server = Bun.serve({
    hostname: LOOPBACK,
    port: 0,
    fetch: async (request) => {
      const answered = await answer(request);

      return new Response(await answered.arrayBuffer(), { status: answered.status, headers: answered.headers });
    },
  });

  return { origin: `http://${LOOPBACK}:${server.port}`, stop: () => server.stop(true) };
}
