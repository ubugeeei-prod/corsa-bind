import { createRustNativeRule } from "./native_bridge";

export const awaitThenableRule = createRustNativeRule("await-thenable");
