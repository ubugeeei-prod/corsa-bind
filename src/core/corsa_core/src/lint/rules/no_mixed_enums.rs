use super::super::{LintNode, RuleContext, RuleMessage, RustLintRule};
use crate::lint::checker_types::{TypeDetail, flags};
use crate::lint::helpers::{EnumMemberKind, enum_member_kind, enum_members_of};

/// Rule that rejects TypeScript enums mixing string and numeric members.
#[derive(Clone, Copy, Debug, Default)]
pub struct NoMixedEnumsRule;

const MESSAGES: &[RuleMessage] = &[RuleMessage {
    id: "mixed",
    description: "Mixing number and string enums can be confusing.",
}];
const LISTENERS: &[&str] = &["TSEnumDeclaration"];

impl RustLintRule for NoMixedEnumsRule {
    fn name(&self) -> &'static str {
        "no-mixed-enums"
    }

    fn docs_description(&self) -> &'static str {
        "Disallow mixing string and numeric enum members."
    }

    fn messages(&self) -> &'static [RuleMessage] {
        MESSAGES
    }

    fn listeners(&self) -> &'static [&'static str] {
        LISTENERS
    }

    fn check(&self, ctx: &mut RuleContext<'_>, node: &LintNode) {
        if node.kind != "TSEnumDeclaration" {
            return;
        }
        let members = enum_members_of(node);
        let Some(first_member) = members.first() else {
            return;
        };
        // A declaration merging with an earlier one follows that one's first
        // member (the host attaches it).
        let desired_kind = member_kind(
            node.child("__previousEnumFirstMember")
                .unwrap_or(first_member),
        );
        if desired_kind == EnumMemberKind::Unknown {
            return;
        }
        for member in members {
            let current_kind = member_kind(member);
            if current_kind == EnumMemberKind::Unknown {
                return;
            }
            if current_kind != desired_kind {
                ctx.report(
                    "mixed",
                    member
                        .child("initializer")
                        .map(|initializer| initializer.range)
                        .unwrap_or(member.range),
                );
                return;
            }
        }
    }
}

/// typescript-eslint `getMemberType`: literals and template literals by their
/// syntax, any other initializer by whether its checker type is string-like
/// (everything else counts as a number).
fn member_kind(member: &LintNode) -> EnumMemberKind {
    let Some(initializer) = member.child("initializer") else {
        return EnumMemberKind::Number;
    };
    match initializer.kind.as_str() {
        "Literal" => enum_member_kind(member),
        "TemplateLiteral" => EnumMemberKind::String,
        _ => match TypeDetail::of(initializer) {
            Some(detail) if detail.flags() & flags::STRING_LIKE != 0 => EnumMemberKind::String,
            Some(_) => EnumMemberKind::Number,
            None => enum_member_kind(member),
        },
    }
}
