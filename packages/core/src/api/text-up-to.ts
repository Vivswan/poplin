// The text of a body read up to a cap, for the two ends that read an answer they do not control: the client reading the install, and the install reading the project's website.

/**
 * Read a body as UTF-8 text, and stop at one longer than the cap.
 *
 * @param most - the most bytes that are read
 * @returns the text, or `undefined` for a body above the cap; the stream is cancelled either way
 * @throws whatever the stream rejects with while it is read
 */
export async function textUpTo(body: ReadableStream<Uint8Array>, most: number): Promise<string | undefined> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;

  try {
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      bytes += chunk.value.byteLength;
      if (bytes > most) return undefined;

      text += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  return text + decoder.decode();
}
