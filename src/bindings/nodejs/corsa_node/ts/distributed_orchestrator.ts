import { binding } from "./binding";
import { fromJson, toJson } from "./json";

import type { NativeDistributedOrchestrator } from "./binding";
import type { VirtualChange, VirtualDocumentState } from "./types";

/** Experimental replicated orchestrator wrapper for multi-node document state. */
export class CorsaDistributedOrchestrator {
  readonly #inner: NativeDistributedOrchestrator;

  /** Creates an orchestrator with the supplied logical node identifiers. */
  constructor(nodeIds: string[]) {
    this.#inner = new binding.CorsaDistributedOrchestrator(nodeIds);
  }

  /** Starts or advances an election campaign for a node and returns the term. */
  campaign(nodeId: string): number {
    return this.#inner.campaign(nodeId);
  }

  /** Returns the current leader id, or `undefined` before election completes. */
  leaderId(): string | undefined {
    return this.#inner.leaderId() ?? undefined;
  }

  /** Returns the replicated cluster state as caller-selected JSON shape. */
  state<T>(): T | undefined {
    const value = this.#inner.stateJson();
    return value ? fromJson<T>(value) : undefined;
  }

  /** Returns one node's state as caller-selected JSON shape. */
  nodeState<T>(nodeId: string): T | undefined {
    const value = this.#inner.nodeStateJson(nodeId);
    return value ? fromJson<T>(value) : undefined;
  }

  /** Returns one virtual document from a node, if the document is open there. */
  document(nodeId: string, uri: string): VirtualDocumentState | undefined {
    const value = this.#inner.documentJson(nodeId, uri);
    return value ? fromJson<VirtualDocumentState>(value) : undefined;
  }

  /** Opens a virtual document through the elected leader. */
  openVirtualDocument(document: VirtualDocumentState): VirtualDocumentState {
    return fromJson(this.#inner.openVirtualDocumentJson(this.requireLeader(), toJson(document)));
  }

  /** Applies virtual-document changes through the elected leader. */
  changeVirtualDocument(uri: string, changes: VirtualChange[]): VirtualDocumentState {
    return fromJson(
      this.#inner.changeVirtualDocumentJson(this.requireLeader(), uri, toJson(changes)),
    );
  }

  /** Closes a virtual document through the elected leader. */
  closeVirtualDocument(uri: string): void {
    this.#inner.closeVirtualDocument(this.requireLeader(), uri);
  }

  private requireLeader(): string {
    const leaderId = this.leaderId();
    if (!leaderId) {
      throw new Error("raft leader has not been elected");
    }
    return leaderId;
  }
}
