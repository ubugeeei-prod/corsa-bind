import type { RunTasks } from "../task_types.ts";

/** Documentation build and Void deployment tasks. */
export const docsTasks = {
  docs_build: {
    command: "cargo run -p corsa_docs -- dist/docs",
  },
  docs_deploy: {
    cache: false,
    command: "npx --yes void@0.8.11 deploy --dir dist/docs --skip-build",
    dependsOn: ["docs_build"],
  },
} satisfies RunTasks;
