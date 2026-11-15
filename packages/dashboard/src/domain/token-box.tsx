// The box a token is pasted into: a password box the browser does not fill, with the refusal of a run said under it.

import { type ReactNode, useId } from "react";

import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

/**
 * Draw the token's box.
 *
 * @param refusal - the sentence said under the box in place of its note
 */
export function TokenBox({ refusal }: { readonly refusal: string | undefined }): ReactNode {
  const id = useId();
  const saysId = `${id}-says`;

  return (
    <Field data-invalid={refusal !== undefined}>
      <FieldLabel htmlFor={id}>Account token</FieldLabel>
      <Input id={id} name="token" type="password" autoComplete="off" required aria-invalid={refusal !== undefined} aria-describedby={saysId} />
      {refusal === undefined ? (
        <FieldDescription id={saysId}>Used once. Not stored.</FieldDescription>
      ) : (
        <FieldError id={saysId} className="text-pretty">
          {refusal}
        </FieldError>
      )}
    </Field>
  );
}
