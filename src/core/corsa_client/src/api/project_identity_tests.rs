use super::ProjectMemo;
use serde_json::{Value, json};

fn project(id: &str, handle: u64) -> Value {
    json!({
        "id": id,
        "handle": handle,
        "currentDirectory": "/w",
        "dirty": false,
        "parsedCommandLine": { "options": {}, "fileNames": [] },
    })
}

#[test]
fn runtimes_without_handles_are_addressed_by_id() {
    let mut memo = ProjectMemo::default();
    memo.learn(
        &json!({ "snapshot": 1, "projects": [{ "id": "/w/tsconfig.json", "parsedCommandLine": {} }] }),
        None,
    );
    assert_eq!(memo.resolve(&json!("/w/tsconfig.json"), Some(1)), Ok(None));
    assert_eq!(memo.resolve(&json!("/never/seen"), Some(1)), Ok(None));
}

#[test]
fn snapshot_responses_bind_handles_to_the_snapshot_they_report() {
    let mut memo = ProjectMemo::default();
    // `updateSnapshot` is asked about its base and answers with the new snapshot.
    memo.learn(
        &json!({ "snapshot": 2, "projects": [project("/w/tsconfig.json", 7)] }),
        Some(1),
    );
    assert_eq!(
        memo.resolve(&json!("/w/tsconfig.json"), Some(2)),
        Ok(Some(7))
    );
}

#[test]
fn a_recreated_project_keeps_its_old_handle_in_older_snapshots() {
    let mut memo = ProjectMemo::default();
    memo.learn(
        &json!({ "snapshot": 1, "projects": [project("/w/p", 3)] }),
        None,
    );
    memo.learn(
        &json!({ "snapshot": 2, "projects": [project("/w/p", 9)] }),
        None,
    );
    assert_eq!(memo.resolve(&json!("/w/p"), Some(1)), Ok(Some(3)));
    assert_eq!(memo.resolve(&json!("/w/p"), Some(2)), Ok(Some(9)));
    // A snapshot the client never saw projects for gets the newest handle.
    assert_eq!(memo.resolve(&json!("/w/p"), Some(5)), Ok(Some(9)));
}

#[test]
fn a_single_project_response_belongs_to_the_request_snapshot() {
    let mut memo = ProjectMemo::default();
    memo.learn(&project("/dev/null/inferred", 4), Some(6));
    assert_eq!(
        memo.resolve(&json!("/dev/null/inferred"), Some(6)),
        Ok(Some(4))
    );
}

#[test]
fn numeric_projects_pass_through_and_unknown_ids_are_reported() {
    let mut memo = ProjectMemo::default();
    memo.learn(
        &json!({ "snapshot": 1, "projects": [project("/w/p", 3)] }),
        None,
    );
    assert_eq!(memo.resolve(&json!(3), Some(1)), Ok(None));
    assert_eq!(
        memo.resolve(&json!("/w/other"), Some(1)),
        Err("/w/other".into())
    );
}
