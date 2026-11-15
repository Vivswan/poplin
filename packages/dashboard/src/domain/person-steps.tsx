// What only a person can do after a run, each step with the address to open.

import type { ReactNode } from "react";

import type { Ran } from "@/domain/domain-queries";

/** Draw the steps, one line each; nothing where there is none. An address opens in a new tab and is not told where the press came from. */
export function PersonSteps({ steps }: { readonly steps: Ran["steps"] }): ReactNode {
  if (steps.length === 0) return null;

  return (
    <ol className="flex flex-col gap-1">
      {steps.map((step) => (
        <li key={step.address} className="break-words">
          {step.text}{" "}
          <a href={step.address} target="_blank" rel="noreferrer" className="text-link underline-offset-2 hover:underline">
            {step.address}
          </a>
        </li>
      ))}
    </ol>
  );
}
