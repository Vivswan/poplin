/** The repository every page links to. */
export const REPOSITORY_URL = "https://github.com/Vivswan/poplin";

/** Prefixes a site-relative path such as `demo/` with the configured base, so one setting moves every link. */
export function sitePath(path = ""): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  return `${base}/${path.replace(/^\//, "")}`;
}
