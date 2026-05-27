import * as nativeModule from "../index.js";

/**
 * Resolved native module shape.
 *
 * `napi-rs` output can be loaded either as the namespace object itself or under
 * a default export depending on the runtime bridge. This value normalizes both
 * shapes so wrapper modules can call native methods without repeating the check.
 */
export const binding = (
  "default" in nativeModule ? nativeModule.default : nativeModule
) as typeof import("../index.js");

/** Native synchronous/asynchronous Corsa API client instance. */
export type NativeApiClient = InstanceType<typeof binding.CorsaApiClient>;

/** Native replicated orchestration wrapper instance. */
export type NativeDistributedOrchestrator = InstanceType<
  typeof binding.CorsaDistributedOrchestrator
>;

/** Native virtual document wrapper instance. */
export type NativeVirtualDocument = InstanceType<typeof binding.CorsaVirtualDocument>;
