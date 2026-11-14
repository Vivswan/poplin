// A command line written as one string in a fixture, split the way a shell would split it.

/**
 * Split a fixture line into the words after `poplin`.
 *
 * @param line - a command line that starts with `poplin`; double quotes hold a word together, and nothing else is special
 */
export function words(line: string): string[] {
  return [...line.matchAll(/"([^"]*)"|(\S+)/g)].map(([, quoted, bare]) => quoted ?? bare ?? "").slice(1);
}
