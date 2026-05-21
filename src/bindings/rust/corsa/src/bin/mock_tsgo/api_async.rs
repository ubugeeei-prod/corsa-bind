use crate::{Result, common, jsonrpc};
use base64::Engine as _;
use corsa::jsonrpc::{RawMessage, RequestId};
use serde_json::{Value, json};
use std::{
    fs::{OpenOptions, create_dir_all},
    io::{BufReader, BufWriter, Write as _},
    path::Path,
    time::Duration,
};

pub fn run(cwd: String, callbacks: Vec<String>) -> Result<()> {
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut reader = BufReader::new(stdin.lock());
    let mut writer = BufWriter::new(stdout.lock());
    loop {
        let Some(message) = jsonrpc::read_message(&mut reader)? else {
            return Ok(());
        };
        let method = message.method.unwrap_or_default();
        record_method(method.as_str());
        let id = message.id.clone();
        let params = message.params.unwrap_or(Value::Null);
        record_params(method.as_str(), &params);
        let response = match method.as_str() {
            "initialize" => Some(json!({
                "useCaseSensitiveFileNames": true,
                "currentDirectory": cwd,
            })),
            "describeCapabilities" => Some(common::capabilities()),
            "parseConfigFile" => Some(parse_config(&mut reader, &mut writer, &callbacks, params)?),
            "updateSnapshot" => Some(common::snapshot_from_update_params(
                "/workspace/tsconfig.json",
                &params,
            )),
            "getDefaultProjectForFile" => Some(common::project("/workspace/tsconfig.json")),
            "getSourceFile" => Some(common::encoded(b"source-file")),
            "getDiagnosticsForSnapshot" => Some(common::snapshot_diagnostics(json!(
                "/workspace/src/index.ts"
            ))),
            "getDiagnosticsForProject" => Some(common::project_diagnostics(json!(
                "/workspace/src/index.ts"
            ))),
            "getDiagnosticsForFile" => Some(common::file_diagnostics(
                params
                    .get("file")
                    .cloned()
                    .unwrap_or_else(|| json!("/workspace/src/index.ts")),
            )),
            "getHoverAtPosition" => Some(common::hover()),
            "getDefinitionAtPosition" => Some(common::definition()),
            "getReferencesAtPosition" => Some(common::references()),
            "getRenameAtPosition" => Some(common::rename(
                params
                    .get("newName")
                    .and_then(Value::as_str)
                    .unwrap_or("renamedValue"),
            )),
            "getCompletionAtPosition" => Some(common::completion()),
            "getSymbolAtPosition" | "getSymbolAtLocation" | "resolveName" => {
                Some(common::symbol("value"))
            }
            "getSymbolsAtPositions" | "getSymbolsAtLocations" => {
                Some(json!([common::symbol("value"), Value::Null]))
            }
            "getTypeOfSymbol"
            | "getDeclaredTypeOfSymbol"
            | "getTypeAtLocation"
            | "getTypeAtPosition"
            | "getContextualType"
            | "getBaseTypeOfLiteralType"
            | "getTypeOfSymbolAtLocation"
            | "getTargetOfType"
            | "getObjectTypeOfType"
            | "getIndexTypeOfType"
            | "getCheckTypeOfType"
            | "getExtendsTypeOfType"
            | "getBaseTypeOfType"
            | "getConstraintOfType"
            | "getReturnTypeOfSignature"
            | "getRestTypeOfSignature"
            | "getConstraintOfTypeParameter" => Some(common::type_response("t0000000000000001")),
            "getTypesOfSymbols" | "getTypeAtLocations" | "getTypesAtPositions" => {
                let count = params
                    .as_object()
                    .and_then(|value| {
                        value
                            .get("symbols")
                            .or_else(|| value.get("locations"))
                            .or_else(|| value.get("positions"))
                            .and_then(Value::as_array)
                    })
                    .map(Vec::len)
                    .unwrap_or(1);
                Some(Value::Array(
                    (0..count)
                        .map(|_| common::type_response("t0000000000000001"))
                        .collect(),
                ))
            }
            "getBaseTypes"
            | "getTypeArguments"
            | "getTypesOfType"
            | "getTypeParametersOfType"
            | "getOuterTypeParametersOfType"
            | "getLocalTypeParametersOfType" => {
                Some(json!([common::type_response("t0000000000000001")]))
            }
            "getSignaturesOfType" => Some(json!([common::signature()])),
            "getShorthandAssignmentValueSymbol" | "getParentOfSymbol" | "getSymbolOfType" => {
                Some(common::symbol("value"))
            }
            "getMembersOfSymbol" | "getExportsOfSymbol" | "getPropertiesOfType" => {
                Some(json!([common::symbol("value")]))
            }
            "getExportSymbolOfSymbol" => Some(common::symbol("exported")),
            "getTypePredicateOfSignature" => Some(common::type_predicate()),
            "getIndexInfosOfType" => Some(json!([common::index_info()])),
            "getAnyType" | "getStringType" | "getNumberType" | "getBooleanType" | "getVoidType"
            | "getUndefinedType" | "getNullType" | "getNeverType" | "getUnknownType"
            | "getBigIntType" | "getESSymbolType" => {
                Some(common::type_response("t0000000000000010"))
            }
            "typeToTypeNode" => Some(common::encoded(b"type-node")),
            "typeToString" => Some(json!("type:string")),
            "isContextSensitive" => Some(json!(true)),
            "printNode" => Some(print_node(params)?),
            "release" => Some(Value::Null),
            "ping" => Some(json!("pong")),
            "echo" => Some(params),
            _ => None,
        };
        if let Some(id) = id {
            let response = response.unwrap_or(Value::Null);
            jsonrpc::write_message(&mut writer, &RawMessage::response(id, response))?;
        }
    }
}

fn record_params(method: &str, params: &Value) {
    let Ok(dir) = std::env::var("CORSA_MOCK_TSGO_PARAMS_DIR") else {
        return;
    };
    if create_dir_all(&dir).is_err() {
        return;
    }
    let path = Path::new(&dir).join(format!("{method}.jsonl"));
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{}", params);
    }
}

fn record_method(method: &str) {
    maybe_delay(method);
    let Ok(dir) = std::env::var("CORSA_MOCK_TSGO_COUNT_DIR") else {
        return;
    };
    if create_dir_all(&dir).is_err() {
        return;
    }
    let path = Path::new(&dir).join(format!("{method}.count"));
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "1");
    }
}

fn maybe_delay(method: &str) {
    let Ok(delay_ms) = std::env::var("CORSA_MOCK_TSGO_DELAY_MS") else {
        return;
    };
    if method != "initialize" && method != "describeCapabilities" {
        return;
    }
    if let Ok(delay_ms) = delay_ms.parse::<u64>() {
        std::thread::sleep(Duration::from_millis(delay_ms));
    }
}

fn parse_config<R: std::io::BufRead, W: std::io::Write>(
    reader: &mut R,
    writer: &mut W,
    callbacks: &[String],
    params: Value,
) -> Result<Value> {
    let file = params
        .get("file")
        .and_then(Value::as_str)
        .unwrap_or("/workspace/tsconfig.json");
    let mut options = json!({ "strict": true });
    if file.starts_with("/virtual/") && callbacks.iter().any(|name| name == "readFile") {
        let response = jsonrpc::send_request(
            reader,
            writer,
            RequestId::string("cb-readFile"),
            "readFile",
            Value::String(file.to_owned()),
        )?;
        options["virtual"] = json!(response.get("content").is_some());
    }
    Ok(json!({
        "options": options,
        "fileNames": ["/workspace/src/index.ts"],
    }))
}

fn print_node(params: Value) -> Result<Value> {
    let data = params
        .get("data")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let decoded = base64::engine::general_purpose::STANDARD.decode(data)?;
    Ok(json!(format!(
        "print:{}",
        String::from_utf8_lossy(&decoded)
    )))
}
