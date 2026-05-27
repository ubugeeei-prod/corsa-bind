import type { RunTasks } from "../task_types.ts";

/** Documentation build and Void deployment tasks. */
export const docsTasks = {
  docs_build: {
    command: "vp exec vite build --config ./docs/vite.config.ts",
  },
  docs_deploy: {
    cache: false,
    command:
      "npx --yes --package void@0.8.11 --package @void/md@0.8.11 void deploy --dir dist/docs --skip-build",
    dependsOn: ["docs_build"],
  },
} satisfies RunTasks;
