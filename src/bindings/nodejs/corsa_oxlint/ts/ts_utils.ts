export function isArray(arg: unknown): arg is unknown[] {
  return Array.isArray(arg);
}

export const TSUtils = Object.freeze({
  isArray,
});
