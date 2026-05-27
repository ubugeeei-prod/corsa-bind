import type { RunTasks } from "../task_types.ts";

/** Release automation tasks intentionally kept outside the default test graph. */
export const releaseTasks = {
  release_dry_run: {
    command: "node --strip-types ./scripts/release_dry_run.ts",
    dependsOn: ["build"],
  },
  release: {
    cache: false,
    command: "node --strip-types ./scripts/release.ts",
  },
} satisfies RunTasks;
