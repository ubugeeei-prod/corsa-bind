import type { CheckerBatchRequest, CheckerBatchResponse } from "./types";

export interface CheckerBatchCapableClient {
  callJson<T>(method: string, params?: unknown): T;
}

export interface AsyncCheckerBatchCapableClient {
  callJsonAsync<T>(method: string, params?: unknown): Promise<T>;
}

/**
 * Sends multiple raw checker endpoint calls through upstream `batchRequests`.
 *
 * This keeps the original typed primitives available while giving hot paths a
 * single transport round trip for relation-heavy workflows.
 */
export function batchCheckerRequests(
  client: CheckerBatchCapableClient,
  requests: readonly CheckerBatchRequest[],
): CheckerBatchResponse[] {
  if (requests.length === 0) {
    return [];
  }
  const response = client.callJson<{ responses: unknown }>("batchRequests", {
    requests: requests.map(normalizeCheckerBatchRequest),
  });
  return normalizeCheckerBatchResponses(response, requests.length);
}

/**
 * Async counterpart of {@link batchCheckerRequests}.
 */
export async function batchCheckerRequestsAsync(
  client: AsyncCheckerBatchCapableClient,
  requests: readonly CheckerBatchRequest[],
): Promise<CheckerBatchResponse[]> {
  if (requests.length === 0) {
    return [];
  }
  const response = await client.callJsonAsync<{ responses: unknown }>("batchRequests", {
    requests: requests.map(normalizeCheckerBatchRequest),
  });
  return normalizeCheckerBatchResponses(response, requests.length);
}

function normalizeCheckerBatchRequest(request: CheckerBatchRequest): CheckerBatchRequest {
  if (request.params === undefined) {
    return { method: request.method };
  }
  return { method: request.method, params: request.params };
}

function normalizeCheckerBatchResponses(
  response: { responses?: unknown },
  expectedLength: number,
): CheckerBatchResponse[] {
  if (typeof response !== "object" || response === null) {
    throw new Error("batchRequests returned a malformed response");
  }
  const responses = response.responses;
  if (!Array.isArray(responses)) {
    throw new Error("batchRequests returned a malformed response list");
  }
  if (responses.length !== expectedLength) {
    throw new Error(
      `batchRequests returned ${responses.length} responses for ${expectedLength} requests`,
    );
  }
  return responses.map((item, index) => {
    if (typeof item !== "object" || item === null) {
      throw new Error(`batchRequests response ${index} is not an object`);
    }
    const record = item as Record<string, unknown>;
    const method = typeof record.method === "string" ? record.method : "";
    const normalized: CheckerBatchResponse = { method };
    if (typeof record.error === "string" && record.error.length > 0) {
      normalized.error = record.error;
    }
    if ("result" in record) {
      normalized.result = record.result;
    }
    return normalized;
  });
}
