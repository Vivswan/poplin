// The way to a token: a button that opens the provider's form with the rights chosen, and the help behind a quiet line.

import { ExternalLinkIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import type { Domain } from "@/domain/domain-queries";

/** Read an address a link may lead to: a whole one that starts with https. Anything else is no link, so no text that reaches the page is run by a press. */
function httpsLink(address: string): string | undefined {
  if (!URL.canParse(address)) return undefined;

  const parsed = new URL(address);

  return parsed.protocol === "https:" ? parsed.href : undefined;
}

/** The help behind the quiet line: what the form asks, every right to add by hand when it opens empty, and the rights an install works without. */
function FormHelp({ form }: { readonly form: Domain["form"] }): ReactNode {
  return (
    <Popover>
      <PopoverTrigger render={<Button type="button" variant="link" className="h-auto px-0 text-link" />}>Token help</PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="max-h-(--available-height) w-80 overflow-y-auto">
        <p>{form.tokenNote}</p>
        <PopoverHeader>
          <PopoverTitle>Form opened empty?</PopoverTitle>
          <PopoverDescription>Add these {form.tokenRights.length} rights by hand:</PopoverDescription>
        </PopoverHeader>
        <ul className="flex flex-col gap-1">
          {form.tokenRights.map((right) => (
            <li key={right} className="break-words">
              {right}
            </li>
          ))}
        </ul>
        {form.tokenOptional.length === 0 ? null : (
          <>
            <PopoverHeader>
              <PopoverTitle>Optional rights</PopoverTitle>
              <PopoverDescription>They block junk traffic and crawlers.</PopoverDescription>
            </PopoverHeader>
            <ul className="flex flex-col gap-2">
              {form.tokenOptional.map((entry) => (
                <li key={entry.right} className="flex flex-col break-words">
                  {entry.right}
                  <span className="text-muted-foreground">{entry.adds}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Draw the way to a token.
 *
 * @param form - what a token must hold and where one is made, in the provider's words
 */
export function TokenWay({ form }: { readonly form: Domain["form"] }): ReactNode {
  const link = httpsLink(form.tokenLink);

  return (
    <div className="flex min-w-0 flex-col items-start gap-2">
      {link === undefined ? null : (
        <>
          <Button variant="outline" nativeButton={false} render={<a href={link} target="_blank" rel="noreferrer" />}>
            Open the token form
            <ExternalLinkIcon data-icon="inline-end" />
          </Button>
          <p className="text-muted-foreground">The rights are already ticked. Create the token, then copy it.</p>
        </>
      )}
      <FormHelp form={form} />
    </div>
  );
}
