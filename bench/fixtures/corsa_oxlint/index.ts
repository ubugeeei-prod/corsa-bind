const lhs = "value";
const rhs = 1;
const values = [3, 2, 1];
const prefix = "pre";
const suffix = "fix";
const text = `${prefix}-${suffix}`;

declare const unsafeSet: Set<any>;
declare const promiseValue: Promise<any>;

export const result = lhs + rhs;
export const sorted = values.sort();
export const rejected = Promise.reject(new Error("boom"));
export const assigned: Set<string> = unsafeSet;
export async function unsafeReturnBench(): Promise<string> {
  return promiseValue;
}
export const baseToString = String({ value: 1 });
export const startsWithManual = text.slice(0, prefix.length) === prefix;
export const endsWithManual = text.slice(-suffix.length) === suffix;
