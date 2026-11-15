// The repository's lint rules, asked about files planted in a throwaway tree. A rule that lives in the lint settings alone is never seen to fire, so a pattern that matches nothing reads as a tree with nothing wrong in it.

import { cpSync } from "node:fs";
import { join } from "node:path";

import { plantedRepository, repositoryFiles } from "./repository-files";

/** The repository this file sits in. */
const ROOT = join(import.meta.dir, "..", "..");

/** The linter's own command, run by this runtime on every system. */
const BIOME = join(ROOT, "node_modules", "@biomejs", "biome", "bin", "biome");

/** The lint settings a planted tree is read under: the managed floor, the repository's own layer, and a package's own file, which counts the paths of the entries it takes over from its own folder. */
const SETTINGS = new Bun.Glob("{,**/}biome{.json,.jsonc,.local.jsonc}");

/** The ignore file of a planted tree: the settings read one, and the linter stops where there is none. */
const IGNORED: readonly string[] = ["node_modules/"];

/** The rules that keep a place's imports and names apart, which a guard of the tree plants a leak for. */
const GUARD_RULES: readonly string[] = ["noRestrictedImports", "noRestrictedTypes", "noRestrictedGlobals", "noNodejsModules", "noCommonJs"];

/** One finding as the linter's `rdjson` report writes it. */
interface Reported {
  readonly code: { readonly value: string };
  readonly location: { readonly path: string; readonly range: { readonly start: { readonly line: number } } };
  readonly severity: string;
}

/** What the repository's lint settings refuse in the given files, as sorted `<rule>: <path>:<line>`. Only an error of a guard rule is told: a rule the settings leave off, or leave as a warning, refuses nothing. Throws when the linter writes no report. */
export function plantedLint(files: Readonly<Record<string, string>>): string[] {
  using tree = plantedRepository(files, { ignored: IGNORED });
  for (const file of repositoryFiles(ROOT).filter((path) => SETTINGS.match(path))) cpSync(join(ROOT, file), join(tree.path, file));

  const ran = Bun.spawnSync([process.execPath, BIOME, "lint", "--reporter=rdjson", "--max-diagnostics=none", "."], {
    cwd: tree.path,
    stdout: "pipe",
    stderr: "pipe",
  });
  const written = ran.stdout.toString();
  if (!written.startsWith("{")) throw new Error(`The linter wrote no report for the planted files: ${ran.stderr.toString().trim() || written}`);

  const report: { readonly diagnostics: readonly Reported[] } = JSON.parse(written);
  const refused = report.diagnostics.filter(({ code, severity }) => severity === "ERROR" && GUARD_RULES.includes(code.value.split("/").at(-1) ?? ""));

  return refused.map(({ code, location }) => `${code.value.split("/").at(-1)}: ${location.path.replaceAll("\\", "/")}:${location.range.start.line}`).sort();
}
