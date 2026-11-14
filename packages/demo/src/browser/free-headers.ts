// A browser refuses some header names on a `Request` or a `Response` that a script builds: `Origin`, `Cookie`, and `Content-Length` going in, `Set-Cookie` coming out.
// A server keeps them, and the product reads them. Inside the demo's worker the two classes keep every header a script sets, as a server's do.
//
// Nothing here reaches the network: an answer leaves the worker through `plainResponse`, as the browser's own class again.
// The worker imports this file first, so every `new Request` and `new Response` of its bundle is one of these.

/** The two classes of the runtime this file was loaded in, before anything stood in for them. */
const NATIVE: Classes = { Request: globalThis.Request, Response: globalThis.Response };

/** The classes a script builds a request and a response with. */
interface Classes {
  readonly Request: typeof Request;
  readonly Response: typeof Response;
}

/**
 * Make the two classes that keep every header a script sets.
 *
 * @param native - the runtime's own classes, which each of the two extends
 * @returns classes that build and read as the native ones do, but for the headers; an object of a native class is an instance of its free class too
 */
export function freeClasses(native: Classes): Classes {
  class FreeRequest extends native.Request {
    readonly #headers: Headers;

    // A request the browser itself made is one too.
    static override [Symbol.hasInstance](value: unknown): boolean {
      return Object.prototype.isPrototypeOf.call(native.Request.prototype, value as object);
    }

    constructor(input: RequestInfo | URL, init: RequestInit = {}) {
      super(input, init);
      // As the constructor itself does: the headers of `init` stand in place of the input's.
      this.#headers = new Headers(init.headers ?? (input instanceof native.Request ? input.headers : undefined));
    }

    override get headers(): Headers {
      return this.#headers;
    }

    override clone(): Request {
      return new FreeRequest(super.clone(), { headers: this.#headers });
    }
  }

  class FreeResponse extends native.Response {
    readonly #headers: Headers;

    // `Response.redirect` and `Response.json` answer with the browser's own class.
    static override [Symbol.hasInstance](value: unknown): boolean {
      return Object.prototype.isPrototypeOf.call(native.Response.prototype, value as object);
    }

    constructor(body?: BodyInit | null, init: ResponseInit = {}) {
      super(body, init);
      this.#headers = new Headers(init.headers);

      // The content type the constructor itself gave a text or a form body.
      super.headers.forEach((value, name) => {
        if (!this.#headers.has(name)) this.#headers.set(name, value);
      });
    }

    override get headers(): Headers {
      return this.#headers;
    }

    override clone(): Response {
      return new FreeResponse(super.clone().body, { status: this.status, statusText: this.statusText, headers: this.#headers });
    }
  }

  return { Request: FreeRequest, Response: FreeResponse };
}

/**
 * Make the response a browser takes from a worker: its own class, with every header it lets a worker send.
 *
 * @returns the same status and body; `Set-Cookie` is not on it, since no worker can set a cookie this way
 */
export function plainResponse(response: Response): Response {
  return new NATIVE.Response(response.body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

// Only a Service Worker hides these headers from the code it runs; under any other runtime the classes stay as they are.
if ("ServiceWorkerGlobalScope" in globalThis) Object.assign(globalThis, freeClasses(NATIVE));
