/// <reference types="vite/client" />

// SVG symbol sprites must be external assets: browsers do not support <use> on data URLs.
declare module "*.svg?url&no-inline" {
  const url: string
  export default url
}
