import { binding } from "./binding";
import { fromJson, toJson } from "./json";

import type { NativeVirtualDocument } from "./binding";
import type { VirtualChange, VirtualDocumentState } from "./types";

/** Mutable in-memory document used to drive LSP overlays without touching disk. */
export class CorsaVirtualDocument {
  readonly #inner: NativeVirtualDocument;

  private constructor(inner: NativeVirtualDocument) {
    this.#inner = inner;
  }

  /** Creates an untitled virtual document with an editor-like URI. */
  static untitled(path: string, languageId: string, text: string): CorsaVirtualDocument {
    return new CorsaVirtualDocument(binding.CorsaVirtualDocument.untitled(path, languageId, text));
  }

  /** Creates an in-memory virtual document under the supplied URI authority. */
  static inMemory(
    authority: string,
    path: string,
    languageId: string,
    text: string,
  ): CorsaVirtualDocument {
    return new CorsaVirtualDocument(
      binding.CorsaVirtualDocument.inMemory(authority, path, languageId, text),
    );
  }

  /** Canonical document URI consumed by LSP overlay APIs. */
  get uri(): string {
    return this.#inner.uri;
  }

  /** LSP language id associated with the virtual document. */
  get languageId(): string {
    return this.#inner.languageId;
  }

  /** Monotonic version incremented whenever text changes. */
  get version(): number {
    return this.#inner.version;
  }

  /** Current full document text. */
  get text(): string {
    return this.#inner.text;
  }

  /** Returns the serializable document state for orchestrator or LSP APIs. */
  state(): VirtualDocumentState {
    return fromJson(this.#inner.stateJson());
  }

  /** Replaces the entire virtual document text. */
  replace(text: string): void {
    this.#inner.replace(text);
  }

  /** Applies LSP-style incremental changes and returns generated change events. */
  applyChanges(changes: VirtualChange[]): unknown[] {
    return fromJson(this.#inner.applyChangesJson(toJson(changes)));
  }
}
