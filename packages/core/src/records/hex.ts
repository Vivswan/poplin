// Bytes as lowercase hex text: the one form a token's hash, the stored signing key, and a visitor key are written in.

/** The base of hex. */
const HEX = 16;

/** How many characters one byte takes. */
const BYTE_WIDTH = 2;

/**
 * Write bytes as hex.
 *
 * @returns lowercase text, two characters a byte, so a byte under 16 keeps its leading zero
 */
export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(HEX).padStart(BYTE_WIDTH, "0")).join("");
}
