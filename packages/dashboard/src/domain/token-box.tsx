// The box a token is pasted into: a password box the browser does not fill, with the refusal of a run said under it.

import type { ReactNode } from "react";

import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

/**
 * Draw the token's box.
 *
 * @param refusal - the sentence said under the box in place of its note
 */
export function TokenBox({ refusal }: { readonly refusal: string | undefined }): ReactNode {
  return (
    <Field invalid={refusal !== undefined}>
      <FieldLabel>Account token</FieldLabel>
      <Input name="token" type="password" autoComplete="off" aria-required />
      {refusal === undefined ? (
        <FieldDescription>Used once. Not stored.</FieldDescription>
      ) : (
        <FieldError className="text-pretty">
          {refusal}
        </FieldError>
      )}
    </Field>
  );
}
