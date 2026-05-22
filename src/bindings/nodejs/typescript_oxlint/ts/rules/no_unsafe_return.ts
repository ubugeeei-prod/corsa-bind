import { createRustNativeRule } from "./native_bridge";

export const noUnsafeReturnRule = createRustNativeRule("no-unsafe-return");
