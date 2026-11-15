// A file as text: Vite reads a file whole for an import that ends in `?raw`. And the built Worker bundle as the module Cloudflare runs.

declare module "*?raw" {
  const text: string;

  export default text;
}

declare module "*/dist/worker.js" {
  const worker: import("./install").Worker;

  export default worker;
}
