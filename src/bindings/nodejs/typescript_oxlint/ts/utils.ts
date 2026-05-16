import {
  Utils as NodeUtils,
  classifyTypeText,
  isAnyLikeTypeTexts,
  isArrayLikeTypeTexts,
  isBigIntLikeTypeTexts,
  isErrorLikeTypeTexts,
  isNumberLikeTypeTexts,
  isPromiseLikeTypeTexts,
  isStringArrayLikeTypeTexts,
  isStringLikeTypeTexts,
  isUnknownLikeTypeTexts,
  splitTopLevelTypeText,
  splitTypeText,
} from "@corsa-bind/napi";

export type { TypeTextKind } from "@corsa-bind/napi";

export {
  classifyTypeText,
  isAnyLikeTypeTexts,
  isArrayLikeTypeTexts,
  isBigIntLikeTypeTexts,
  isErrorLikeTypeTexts,
  isNumberLikeTypeTexts,
  isPromiseLikeTypeTexts,
  isStringArrayLikeTypeTexts,
  isStringLikeTypeTexts,
  isUnknownLikeTypeTexts,
  splitTopLevelTypeText,
  splitTypeText,
};

export const Utils = NodeUtils;
