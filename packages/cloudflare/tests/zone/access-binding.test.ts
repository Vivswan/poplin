import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readAccessBinding } from "../../src/zone/access-binding";
import { AUDIENCE, TEAM } from "../login/support/access";

const PACKAGE = join(import.meta.dir, "..", "..");
const BOUND = { team_domain: "team.cloudflareaccess.com", audience: AUDIENCE };

describe("readAccessBinding", () => {
  // Drift: the keys fetch and the issuer check take the team as an origin; a binding read into any other form would refuse every login.
  test("the team's hostname and the audience tag are the issuer and the audience a login's token is checked against", () => {
    expect(readAccessBinding(BOUND)).toEqual({ ok: true, value: { teamDomain: TEAM, audience: AUDIENCE } });
  });

  const refused: readonly { readonly name: string; readonly binding: unknown; readonly refusal: string }[] = [
    { name: "no binding at all", binding: undefined, refusal: "absent" },
    { name: "the binding still as JSON text", binding: JSON.stringify(BOUND), refusal: "bad-shape" },
    { name: "the team as an origin", binding: { ...BOUND, team_domain: TEAM }, refusal: "bad-team-domain" },
    { name: "the team as a name alone", binding: { ...BOUND, team_domain: "team" }, refusal: "bad-team-domain" },
    { name: "an audience that is no tag", binding: { ...BOUND, audience: "poplin" }, refusal: "bad-audience" },
    { name: "an audience tag in capitals", binding: { ...BOUND, audience: AUDIENCE.toUpperCase() }, refusal: "bad-audience" },
  ];

  test.each(refused)("$name is refused as $refusal and nothing throws: the Worker names the binding instead of failing on every request", ({ binding, refusal }) => {
    expect<unknown>(readAccessBinding(binding)).toEqual({ ok: false, refusal });
  });
});

describe("the ACCESS binding the module gives the Worker", () => {
  // Drift: the module writes the binding and the Worker reads it; a key renamed on one side would stop every instance at its start.
  test("the module binds exactly the two keys the reader takes: the team domain from its input, the audience from its own Access application", () => {
    const [team, audience] = Object.keys(BOUND);
    const bound = `jsonencode({ ${team} = var.access_team_domain, ${audience} = cloudflare_zero_trust_access_application.login.aud })`;

    expect(readFileSync(join(PACKAGE, "tofu", "worker.tf"), "utf8")).toContain(bound);
  });
});
