// The built Worker bundle as text: Vite reads a file whole for an import that ends in `?raw`.

declare module "*?raw" {
  const text: string;

  export default text;
}
