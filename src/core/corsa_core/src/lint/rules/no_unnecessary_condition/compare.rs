//! JavaScript comparison semantics for `booleanComparison` over static values.

use std::cmp::Ordering;

use super::super::super::type_shape::StaticValue;

/// Evaluates `left <operator> right` the way JavaScript would, for the
/// primitive values `toStaticValue` produces. `None` for unknown operators.
pub(super) fn evaluate(left: &StaticValue, operator: &str, right: &StaticValue) -> Option<bool> {
    Some(match operator {
        "===" => strict_equals(left, right),
        "!==" => !strict_equals(left, right),
        "==" => loose_equals(left, right),
        "!=" => !loose_equals(left, right),
        "<" => relational(left, right) == Some(Ordering::Less),
        ">" => relational(left, right) == Some(Ordering::Greater),
        "<=" => matches!(
            relational(left, right),
            Some(Ordering::Less | Ordering::Equal)
        ),
        ">=" => matches!(
            relational(left, right),
            Some(Ordering::Greater | Ordering::Equal)
        ),
        _ => return None,
    })
}

fn strict_equals(left: &StaticValue, right: &StaticValue) -> bool {
    match (left, right) {
        (StaticValue::Number(a), StaticValue::Number(b)) => a == b,
        (StaticValue::BigInt(a), StaticValue::BigInt(b)) => bigint_eq(a, b),
        _ => left == right,
    }
}

fn loose_equals(left: &StaticValue, right: &StaticValue) -> bool {
    use StaticValue::{BigInt, Boolean, Null, Number, String, Undefined};
    match (left, right) {
        (Null | Undefined, Null | Undefined) => true,
        (Null | Undefined, _) | (_, Null | Undefined) => false,
        (Boolean(a), other) | (other, Boolean(a)) => {
            loose_equals(&Number(if *a { 1.0 } else { 0.0 }), other)
        }
        (Number(a), String(b)) | (String(b), Number(a)) => *a == to_number(b),
        (BigInt(a), String(b)) | (String(b), BigInt(a)) => {
            parse_bigint(b).is_some_and(|b| Some(b) == parse_bigint(a))
        }
        (BigInt(a), Number(b)) | (Number(b), BigInt(a)) => {
            parse_bigint(a).is_some_and(|a| (a as f64) == *b)
        }
        _ => strict_equals(left, right),
    }
}

/// Abstract relational comparison; `None` when either side is `NaN`.
fn relational(left: &StaticValue, right: &StaticValue) -> Option<Ordering> {
    if let (StaticValue::String(a), StaticValue::String(b)) = (left, right) {
        return Some(a.encode_utf16().cmp(b.encode_utf16()));
    }
    match (left, right) {
        (StaticValue::BigInt(a), StaticValue::BigInt(b)) => {
            Some(parse_bigint(a)?.cmp(&parse_bigint(b)?))
        }
        (StaticValue::BigInt(a), other) => (parse_bigint(a)? as f64).partial_cmp(&numeric(other)?),
        (other, StaticValue::BigInt(b)) => numeric(other)?.partial_cmp(&(parse_bigint(b)? as f64)),
        _ => numeric(left)?.partial_cmp(&numeric(right)?),
    }
}

fn numeric(value: &StaticValue) -> Option<f64> {
    let number = match value {
        StaticValue::Undefined => f64::NAN,
        StaticValue::Null => 0.0,
        StaticValue::Boolean(value) => f64::from(u8::from(*value)),
        StaticValue::Number(value) => *value,
        StaticValue::String(text) => to_number(text),
        StaticValue::BigInt(text) => parse_bigint(text)? as f64,
    };
    (!number.is_nan()).then_some(number)
}

/// `Number(text)` for the common decimal, hex, octal and binary forms.
fn to_number(text: &str) -> f64 {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return 0.0;
    }
    let radix = |prefix: &[&str], radix: u32| {
        prefix.iter().find_map(|prefix| {
            trimmed
                .strip_prefix(prefix)
                .map(|digits| i64::from_str_radix(digits, radix).map_or(f64::NAN, |v| v as f64))
        })
    };
    if let Some(value) = radix(&["0x", "0X"], 16)
        .or_else(|| radix(&["0o", "0O"], 8))
        .or_else(|| radix(&["0b", "0B"], 2))
    {
        return value;
    }
    match trimmed {
        "Infinity" | "+Infinity" => f64::INFINITY,
        "-Infinity" => f64::NEG_INFINITY,
        _ => trimmed.parse::<f64>().unwrap_or(f64::NAN),
    }
}

fn parse_bigint(text: &str) -> Option<i128> {
    text.trim().trim_end_matches('n').parse::<i128>().ok()
}

fn bigint_eq(a: &str, b: &str) -> bool {
    match (parse_bigint(a), parse_bigint(b)) {
        (Some(a), Some(b)) => a == b,
        _ => a == b,
    }
}

/// `checker.typeToString` of a static value, for the report message.
pub(super) fn render(value: &StaticValue) -> String {
    match value {
        StaticValue::Undefined => "undefined".to_owned(),
        StaticValue::Null => "null".to_owned(),
        StaticValue::Boolean(value) => value.to_string(),
        StaticValue::Number(value) => {
            if value.fract() == 0.0 && value.abs() < 1e21 {
                (*value as i64).to_string()
            } else {
                value.to_string()
            }
        }
        StaticValue::String(text) => serde_json::Value::String(text.clone()).to_string(),
        StaticValue::BigInt(text) => [text.as_str(), "n"].concat(),
    }
}

#[cfg(test)]
mod tests {
    use super::{StaticValue, evaluate};

    #[test]
    fn follows_javascript_equality() {
        let null = StaticValue::Null;
        let undefined = StaticValue::Undefined;
        assert_eq!(evaluate(&null, "==", &undefined), Some(true));
        assert_eq!(evaluate(&null, "===", &undefined), Some(false));
        assert_eq!(evaluate(&null, "!==", &null), Some(false));
        let one = StaticValue::Number(1.0);
        let text = StaticValue::String("1".to_owned());
        assert_eq!(evaluate(&one, "==", &text), Some(true));
        assert_eq!(evaluate(&one, "===", &text), Some(false));
        assert_eq!(
            evaluate(&StaticValue::Boolean(true), "==", &one),
            Some(true)
        );
    }

    #[test]
    fn follows_javascript_relations() {
        let a = StaticValue::String("a".to_owned());
        let b = StaticValue::String("b".to_owned());
        assert_eq!(evaluate(&a, "<", &b), Some(true));
        assert_eq!(evaluate(&StaticValue::Undefined, "<=", &a), Some(false));
        assert_eq!(
            evaluate(
                &StaticValue::BigInt("2".to_owned()),
                ">",
                &StaticValue::Number(1.5)
            ),
            Some(true)
        );
        assert_eq!(
            evaluate(&StaticValue::Null, ">=", &StaticValue::Number(0.0)),
            Some(true)
        );
    }
}
