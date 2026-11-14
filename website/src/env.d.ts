declare module "virtual:poplin-samples" {
  /** The sample sites found at build time, sorted by folder name; the samples integration fills it. */
  export const samples: readonly { name: string; titleHtml: string; descriptionHtml: string }[];
}
