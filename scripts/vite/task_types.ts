/**
 * Minimal shape accepted by Vite+ run tasks in this repository.
 *
 * Keeping the local type small avoids importing Vite+ internals from every task
 * module while still making task composition explicit and reviewable.
 */
export type RunTask = {
  readonly cache?: boolean;
  readonly command: string;
  readonly cwd?: string;
  readonly dependsOn?: readonly string[];
};

/** Named task map consumed by `defineConfig({ run: { tasks } })`. */
export type RunTasks = Record<string, RunTask>;
