// What the HTTP API and its clients agree on beyond the routes themselves: the form of every refusal, one response header, and the dashboard page a computer's login is decided on.

import * as v from "valibot";

/** The response header of a route that answers bytes, holding the media type the file is stored with, percent-encoded as `encodeURIComponent` does. */
export const STORED_TYPE_HEADER = "Poplin-Content-Type";

/** The dashboard page where an admin allows or denies a computer's login: the login's id follows it, and no part of its code. */
export const REVIEW_PAGE = "/tokens/review";

/** Every refusal, whatever the route: the code, a sentence for a person, and the argument, limit, or path the code is about. */
export const API_ERROR = v.object({ error: v.object({ code: v.string(), message: v.string(), about: v.exactOptional(v.string()) }) });

/** The body of a refusal. */
export type ApiError = v.InferOutput<typeof API_ERROR>;
