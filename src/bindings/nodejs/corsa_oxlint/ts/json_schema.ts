export type JSONSchema4 = Record<string, unknown>;

export function tupleSchema(...items: readonly JSONSchema4[]): JSONSchema4 {
  return {
    items,
    type: "array",
  };
}

export const JSONSchema = Object.freeze({
  tupleSchema,
});
