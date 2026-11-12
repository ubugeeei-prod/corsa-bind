use super::super::{LintNode, RuleContext, RuleMessage, RustLintRule};
use crate::lint::checker_types::{
    FunctionReturns, TypeDetail, flags, is_unsafe_assignment, quoted_type,
};
use crate::utils::is_unsafe_return;

/// Type-aware rule that rejects returning any-typed values from functions.
#[derive(Clone, Copy, Debug, Default)]
pub struct NoUnsafeReturnRule;

const MESSAGES: &[RuleMessage] = &[
    RuleMessage {
        id: "unsafe",
        description: "Unsafe return of a value of type {{type}}.",
    },
    RuleMessage {
        id: "unsafeReturnAssignment",
        description: "Unsafe return of type {{sender}} from function with return type {{receiver}}.",
    },
];
const LISTENERS: &[&str] = &["ArrowFunctionExpression", "ReturnStatement"];

impl RustLintRule for NoUnsafeReturnRule {
    fn name(&self) -> &'static str {
        "no-unsafe-return"
    }

    fn docs_description(&self) -> &'static str {
        "Disallow returning any-typed values from functions."
    }

    fn messages(&self) -> &'static [RuleMessage] {
        MESSAGES
    }

    fn listeners(&self) -> &'static [&'static str] {
        LISTENERS
    }

    fn check(&self, ctx: &mut RuleContext<'_>, node: &LintNode) {
        match node.kind.as_str() {
            "ArrowFunctionExpression" => {
                let Some(body) = node.child("body") else {
                    return;
                };
                if body.kind == "BlockStatement" {
                    return;
                }
                check_return(ctx, node, body);
            }
            "ReturnStatement" => {
                let Some(argument) = node.child("argument") else {
                    return;
                };
                check_return(ctx, node, argument);
            }
            _ => {}
        }
    }
}

/// typescript-eslint `discriminateAnyType`.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum AnyKind {
    Any,
    AnyArray,
    PromiseAny,
    Safe,
}

fn check_return(ctx: &mut RuleContext<'_>, owner: &LintNode, returned: &LintNode) {
    let (Some(returns), Some(detail)) = (FunctionReturns::of(owner), TypeDetail::of(returned))
    else {
        report_if_unsafe_text(ctx, owner, returned);
        return;
    };
    let signatures = returns
        .signatures
        .iter()
        .filter_map(|signature| signature.detail())
        .collect::<Vec<_>>();
    // An explicit return type that matches the returned type (or is itself
    // `any`/`unknown`) makes the `any` intentional.
    if returns.has_return_type
        && signatures.iter().any(|signature| {
            same_type(detail, *signature)
                || is_any_or_unknown(*signature)
                || (returns.is_async && {
                    let awaited_signature = signature.awaited();
                    same_type(detail.awaited(), awaited_signature)
                        || is_any_or_unknown(awaited_signature)
                })
        })
    {
        return;
    }
    let kind = discriminate(detail);
    if kind != AnyKind::Safe {
        let allowed = signatures.iter().any(|signature| match kind {
            AnyKind::Any => signature.is_unknown(),
            AnyKind::AnyArray => signature.is_unknown_array(),
            AnyKind::PromiseAny => signature.awaited().is_unknown(),
            AnyKind::Safe => false,
        });
        if allowed || (kind == AnyKind::PromiseAny && !returns.is_async) {
            return;
        }
        let name = match kind {
            AnyKind::AnyArray => "`any[]`",
            AnyKind::PromiseAny => "`Promise<any>`",
            AnyKind::Any | AnyKind::Safe => "`any`",
        };
        ctx.report_with_data("unsafe", returned.range, &[("type", name)]);
        return;
    }
    let Some(signature) = returns.signatures.first() else {
        return;
    };
    if let Some(receiver) = signature.detail() {
        if is_unsafe_assignment(detail, receiver, Some(returned)) {
            let sender = quoted_type(&returned.type_texts);
            let receiver = quoted_type(&signature.texts());
            ctx.report_with_data(
                "unsafeReturnAssignment",
                returned.range,
                &[("sender", sender.as_str()), ("receiver", receiver.as_str())],
            );
        }
    }
}

fn discriminate(detail: TypeDetail<'_>) -> AnyKind {
    if detail.is_any() {
        return AnyKind::Any;
    }
    if detail.is_any_array() {
        return AnyKind::AnyArray;
    }
    // A thenable whose awaited type is `any` (`Promise<Promise<any>>` too).
    // Constituents of unions and intersections are not described, so only a
    // top-level `Promise` reference is recognised.
    if detail.is_promise() && detail.awaited().is_any() {
        return AnyKind::PromiseAny;
    }
    AnyKind::Safe
}

/// The checker's identity for both types, when both are known.
fn same_type(left: TypeDetail<'_>, right: TypeDetail<'_>) -> bool {
    left.id()
        .is_some_and(|id| !id.is_empty() && Some(id) == right.id())
}

fn is_any_or_unknown(detail: TypeDetail<'_>) -> bool {
    detail.union_flags() & (flags::ANY | flags::UNKNOWN) != 0
}

fn report_if_unsafe_text(ctx: &mut RuleContext<'_>, owner: &LintNode, source: &LintNode) {
    let target_type_texts = return_type_texts(owner);
    if is_unsafe_return(&source.type_texts, &target_type_texts) {
        ctx.report_with_data("unsafe", source.range, &[("type", "`any`")]);
    }
}

fn return_type_texts(node: &LintNode) -> Vec<String> {
    node.fields
        .get("__returnTypeTexts")
        .and_then(serde_json::Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(serde_json::Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}
