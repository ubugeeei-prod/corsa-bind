import { benchTasks } from "./bench_tasks.ts";
import { buildTasks } from "./build_tasks.ts";
import { checkTasks } from "./check_tasks.ts";
import { docsTasks } from "./docs_tasks.ts";
import { exampleTasks } from "./example_tasks.ts";
import { releaseTasks } from "./release_tasks.ts";
import { testTasks } from "./test_tasks.ts";
import type { RunTasks } from "../task_types.ts";

/** Complete Vite+ task registry assembled from focused task groups. */
export const runTasks = {
  ...buildTasks,
  ...checkTasks,
  ...docsTasks,
  ...testTasks,
  ...benchTasks,
  ...releaseTasks,
  ...exampleTasks,
} satisfies RunTasks;
