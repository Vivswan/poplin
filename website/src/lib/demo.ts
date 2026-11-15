/** The running demo's address, from the build's `DEMO_URL`; nothing unless that is an https address. */
export function demoAddress(): string | undefined {
  const given = URL.parse(process.env.DEMO_URL ?? "");

  return given?.protocol === "https:" ? given.href : undefined;
}
