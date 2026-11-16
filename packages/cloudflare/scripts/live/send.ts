// What sends every request of a live run to the test install.
//
// The edge closes a connection it kept open, and a client that sends its next request on that connection gets no answer. A client sends a read again by itself; a request that changes something it does not,
// so a publish or a removal failed within milliseconds, with nothing wrong at the install. A request that is no read therefore opens a connection of its own; reads keep the open ones, and their pace.

/** The method of a read, which a client sends again by itself when its connection was closed. */
const READ = "GET";

/**
 * Send one request to the test install.
 *
 * @returns the answer, or the rejection of `fetch` as it is: nothing is sent twice here
 */
export function sendLive(input: string, init: RequestInit): Promise<Response> {
  return fetch(input, (init.method ?? READ) === READ ? init : { ...init, keepalive: false });
}
