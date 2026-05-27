import type { ContextWithParserOptions } from "./types";
import { resolveProjectConfig } from "./context";
import { CorsaProjectSession } from "./session";

const sessions = new Map<string, CorsaProjectSession>();
let installedExitHook = false;

export function sessionForContext(context: ContextWithParserOptions): {
  project: ReturnType<typeof resolveProjectConfig>;
  session: CorsaProjectSession;
} {
  const project = resolveProjectConfig(context);
  const key = [
    project.configPath,
    project.runtime.executable,
    project.runtime.cwd,
    project.runtime.mode,
  ].join("::");
  let session = sessions.get(key);
  if (!session) {
    session = new CorsaProjectSession(project, project.runtime);
    sessions.set(key, session);
  }
  installExitHook();
  return { project, session };
}

function installExitHook(): void {
  if (installedExitHook) {
    return;
  }
  installedExitHook = true;
  process.on("exit", () => {
    for (const session of sessions.values()) {
      session.close();
    }
  });
}
