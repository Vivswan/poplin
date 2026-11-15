import { describe, expect, test } from "bun:test";
import { rebuildAddress } from "@poplin/core/src/records/update";
import { isDeployHook } from "../../src/zone/deploy-hook";

const HOOK = "https://api.cloudflare.com/client/v4/workers/builds/deploy_hooks/a1b2c3d4-e5f6-7890-abcd-ef1234567890";

describe("isDeployHook", () => {
  // Drift: Cloudflare's page on Deploy Hooks writes one address form. Each row is an address an admin could paste; any one taken beyond that form is a host or a path the install would send a request to.
  test.each([
    { name: "the form Cloudflare's page writes", typed: HOOK, taken: true },
    { name: "an id of letters and digits alone", typed: HOOK.replace(/[^/]+$/, "3F9c2a7e5b"), taken: true },
    { name: "http", typed: HOOK.replace("https:", "http:"), taken: false },
    { name: "another host", typed: HOOK.replace("api.cloudflare.com", "example.com"), taken: false },
    { name: "a host that only starts as Cloudflare's", typed: HOOK.replace("api.cloudflare.com", "api.cloudflare.com.example.com"), taken: false },
    { name: "a host that only ends as Cloudflare's", typed: HOOK.replace("api.cloudflare.com", "evil-api.cloudflare.com"), taken: false },
    { name: "Cloudflare's host with a dot after it", typed: HOOK.replace("api.cloudflare.com", "api.cloudflare.com."), taken: false },
    { name: "Cloudflare's host as the user of another", typed: HOOK.replace("api.cloudflare.com", "api.cloudflare.com@example.com"), taken: false },
    { name: "a user and a password", typed: HOOK.replace("https://", "https://user:secret@"), taken: false },
    { name: "a port", typed: HOOK.replace("api.cloudflare.com", "api.cloudflare.com:8443"), taken: false },
    { name: "the default port written out", typed: HOOK.replace("api.cloudflare.com", "api.cloudflare.com:443"), taken: true },
    { name: "a query", typed: `${HOOK}?branch=main`, taken: false },
    { name: "a fragment", typed: `${HOOK}#main`, taken: false },
    { name: "no id", typed: HOOK.replace(/[^/]+$/, ""), taken: false },
    { name: "a path below the id", typed: `${HOOK}/delete`, taken: false },
    { name: "another path of Cloudflare's API", typed: "https://api.cloudflare.com/client/v4/accounts", taken: false },
    { name: "a path that climbs out of the hooks", typed: HOOK.replace(/[^/]+$/, "..%2F..%2Faccounts"), taken: false },
    { name: "a path with dots that a URL folds away", typed: HOOK.replace(/[^/]+$/, "x/../../../accounts"), taken: false },
    { name: "the path in capitals", typed: HOOK.replace("deploy_hooks", "DEPLOY_HOOKS"), taken: false },
  ])("$name", ({ typed, taken }) => {
    const address = rebuildAddress(typed, isDeployHook);

    expect(address).toBe(taken ? typed.replace(":443", "") : undefined);
  });
});
