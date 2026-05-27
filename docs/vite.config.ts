import { defineConfig } from "vite";

import { corsaDocsPlugin } from "./build/plugin.ts";

export default defineConfig({
  plugins: [corsaDocsPlugin()],
});
