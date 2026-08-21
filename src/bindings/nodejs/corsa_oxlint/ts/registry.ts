import type { ContextWithParserOptions } from "./types";
import { resolveProjectConfig } from "./context";
import { CorsaProjectSession } from "./session";

const sessions = new Map<string, CorsaProjectSession>();
type SessionContext = {
  project: ReturnType<typeof resolveProjectConfig>;
  session: CorsaProjectSession;
};

const contextSessions = new WeakMap<ContextWithParserOptions, SessionContext>();
let installedExitHook = false;

export function sessionForContext(context: ContextWithParserOptions): SessionContext {
  const cached = contextSessions.get(context);
  if (cached) {
    return cached;
  }
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
  const resolved = { project, session };
  contextSessions.set(context, resolved);
  return resolved;
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
