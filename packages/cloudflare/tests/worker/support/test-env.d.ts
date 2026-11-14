// The variables vitest.config.ts sets beside the bindings of wrangler.jsonc, as the tests' `env` holds them.

declare namespace Cloudflare {
  interface Env {
    readonly ZONE: unknown;
    readonly FIRST_SETTINGS: unknown;
    readonly ACCESS: unknown;
    readonly ACCOUNT_ID: unknown;
  }
}
