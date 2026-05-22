import { createRustNativeRule } from "./native_bridge";

export const noFloatingPromisesRule = createRustNativeRule("no-floating-promises");
