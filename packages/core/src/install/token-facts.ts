// What a provider's form for a new token is and asks for, as every place that asks a person for one shows it.

/** The token an install is made, checked, and repaired with: its rights, the form's address, and what the form still asks of the person. */
export interface TokenFacts {
  /** Every right a token needs for an install to work, each in the provider's own name for it. */
  readonly tokenRights: readonly string[];

  /** The address of the provider's form for a new token, with each of those rights chosen that a link can choose; `tokenNote` names any other. */
  readonly tokenLink: string;

  /** The rights an install works without: the provider's name for each, and in one line what a token that has it adds. */
  readonly tokenOptional: readonly { readonly right: string; readonly adds: string }[];

  /** What else the provider's form asks of the person, in one sentence, such as which account the token is for. */
  readonly tokenNote: string;

  /** What a token must be made for, as a refusal of one says it, such as `this account and this domain`. */
  readonly tokenFor: string;
}
