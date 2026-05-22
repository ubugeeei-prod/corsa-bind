import { createRustNativeRule } from "./native_bridge";

export const noUnsafeAssignmentRule = createRustNativeRule("no-unsafe-assignment");
