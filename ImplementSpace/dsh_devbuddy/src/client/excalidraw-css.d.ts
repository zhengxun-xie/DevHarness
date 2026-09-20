/**
 * Type of the virtual module produced by the `excalidraw-css-inline`
 * bundle plugin (tsdown.config.ts): the production Excalidraw stylesheet as
 * a default-exported string, injected at runtime by ExcalidrawModal.
 */
declare module '@excalidraw/excalidraw/index.css' {
  const cssText: string
  export default cssText
}
