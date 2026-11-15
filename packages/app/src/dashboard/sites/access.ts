// Who can open a site: the three accesses, from the most private on, as the dashboard names and explains them.

/** The accesses, in the order shown. `means` says who opens a site under each. */
export const ACCESSES = [
  { access: "private", label: "Private", means: "Only people who can log in here." },
  { access: "unlisted", label: "Unlisted", means: "Anyone with the link. No login." },
  { access: "public", label: "Public", means: "Everyone, at a public link." },
] as const;
