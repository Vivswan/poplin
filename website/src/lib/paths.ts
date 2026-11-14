/** The repository every page links to. */
export const REPOSITORY_URL = "https://github.com/Vivswan/poplin";

/** The one sentence a person pastes into any agent to set poplin up. */
export const SETUP_PROMPT = `Look at ${REPOSITORY_URL}, read its skill, and help me set up poplin.`;

/** Prefixes a site-relative path such as `docs/` with the configured base, so one setting moves every link. */
export function sitePath(path = ""): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  return `${base}/${path.replace(/^\//, "")}`;
}
