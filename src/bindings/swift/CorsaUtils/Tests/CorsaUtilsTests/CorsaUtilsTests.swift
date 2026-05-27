import Foundation
import Testing
@testable import CorsaUtils

@Test func smoke() async throws {
    #expect(CorsaUtils.classifyTypeText("Promise<string> | null") == "nullish")
    #expect(CorsaUtils.splitTypeText("string | Promise<any>") == ["string", "Promise<any>"])
    #expect(CorsaUtils.isErrorLikeTypeTexts(["TypeError"]))
    #expect(CorsaUtils.hasUnsafeAnyFlow(["Promise<any>"], targetTexts: ["Promise<string>"]))
    let document = try CorsaVirtualDocument.untitled(path: "/demo.ts", languageID: "typescript", text: "const value = 1;")
    try document.splice(startLine: 0, startCharacter: 14, endLine: 0, endCharacter: 15, text: "2")
    #expect(document.text == "const value = 2;")
    #expect(document.version == 2)
}

@Test func apiClientCheckerPositionBindings() async throws {
    let root = URL(fileURLWithPath: "../../../..", relativeTo: URL(fileURLWithPath: FileManager.default.currentDirectoryPath)).standardizedFileURL
    let binary = root.appending(path: "target/debug/mock_corsa").path
    guard FileManager.default.fileExists(atPath: binary) else {
        return
    }
    let client = try CorsaApiClient(options: CorsaApiClientOptions(
        executable: binary,
        cwd: root.path,
        mode: .jsonrpc
    ))
    defer {
        try? client.close()
    }

    let snapshotJSON = try client.updateSnapshotJSON(paramsJSON: #"{"openProject":"/workspace/tsconfig.json"}"#)
    let snapshot = try JSONSerialization.jsonObject(with: Data(snapshotJSON.utf8)) as! [String: Any]
    let snapshotID = snapshot["snapshot"] as! String
    let projects = snapshot["projects"] as! [[String: Any]]
    let projectID = projects[0]["id"] as! String

    let typeJSON = try client.getTypeAtPositionJSON(
        snapshot: snapshotID,
        project: projectID,
        file: "/workspace/src/index.ts",
        position: 1
    )
    let type = try JSONSerialization.jsonObject(with: Data(typeJSON.utf8)) as! [String: Any]
    #expect(type["id"] as? String == "t0000000000000001")

    let symbolJSON = try client.getSymbolAtPositionJSON(
        snapshot: snapshotID,
        project: projectID,
        file: "/workspace/src/index.ts",
        position: 1
    )
    let symbol = try JSONSerialization.jsonObject(with: Data(symbolJSON.utf8)) as! [String: Any]
    #expect(symbol["name"] as? String == "value")
}

@Test func apiClientTypeArgumentsBinding() async throws {
    let root = URL(fileURLWithPath: "../../../..", relativeTo: URL(fileURLWithPath: FileManager.default.currentDirectoryPath)).standardizedFileURL
    let binary = root.appending(path: "target/debug/mock_corsa").path
    guard FileManager.default.fileExists(atPath: binary) else {
        return
    }
    let client = try CorsaApiClient(options: CorsaApiClientOptions(
        executable: binary,
        cwd: root.path,
        mode: .jsonrpc
    ))
    defer {
        try? client.close()
    }

    let snapshotJSON = try client.updateSnapshotJSON(paramsJSON: #"{"openProject":"/workspace/tsconfig.json"}"#)
    let snapshot = try JSONSerialization.jsonObject(with: Data(snapshotJSON.utf8)) as! [String: Any]
    let snapshotID = snapshot["snapshot"] as! String
    let projects = snapshot["projects"] as! [[String: Any]]
    let projectID = projects[0]["id"] as! String

    let stringTypeJSON = try client.getStringTypeJSON(snapshot: snapshotID, project: projectID)
    let stringType = try JSONSerialization.jsonObject(with: Data(stringTypeJSON.utf8)) as! [String: Any]
    let typeID = stringType["id"] as! String
    let objectFlags = (stringType["objectFlags"] as! NSNumber).uint32Value

    let nonReferenceJSON = try client.getTypeArgumentsJSON(
        snapshot: snapshotID,
        project: projectID,
        typeHandle: typeID,
        objectFlags: objectFlags
    )
    let nonReference = try JSONSerialization.jsonObject(with: Data(nonReferenceJSON.utf8)) as! [Any]
    #expect(nonReference.isEmpty)

    let referenceJSON = try client.getTypeArgumentsJSON(
        snapshot: snapshotID,
        project: projectID,
        typeHandle: typeID,
        objectFlags: 1 << 2
    )
    let reference = try JSONSerialization.jsonObject(with: Data(referenceJSON.utf8)) as! [[String: Any]]
    #expect(reference[0]["id"] as? String == "t0000000000000001")
}

@Test func apiClientSymbolTypeBindings() async throws {
    let root = URL(fileURLWithPath: "../../../..", relativeTo: URL(fileURLWithPath: FileManager.default.currentDirectoryPath)).standardizedFileURL
    let binary = root.appending(path: "target/debug/mock_corsa").path
    guard FileManager.default.fileExists(atPath: binary) else {
        return
    }
    let client = try CorsaApiClient(options: CorsaApiClientOptions(
        executable: binary,
        cwd: root.path,
        mode: .jsonrpc
    ))
    defer {
        try? client.close()
    }

    let snapshotJSON = try client.updateSnapshotJSON(paramsJSON: #"{"openProject":"/workspace/tsconfig.json"}"#)
    let snapshot = try JSONSerialization.jsonObject(with: Data(snapshotJSON.utf8)) as! [String: Any]
    let snapshotID = snapshot["snapshot"] as! String
    let projects = snapshot["projects"] as! [[String: Any]]
    let projectID = projects[0]["id"] as! String

    let symbolJSON = try client.getSymbolAtPositionJSON(
        snapshot: snapshotID,
        project: projectID,
        file: "/workspace/src/index.ts",
        position: 1
    )
    let symbol = try JSONSerialization.jsonObject(with: Data(symbolJSON.utf8)) as! [String: Any]
    #expect(symbol["name"] as? String == "value")
    let symbolID = symbol["id"] as! String

    let symbolTypeJSON = try client.getTypeOfSymbolJSON(snapshot: snapshotID, project: projectID, symbol: symbolID)
    let symbolType = try JSONSerialization.jsonObject(with: Data(symbolTypeJSON.utf8)) as! [String: Any]
    #expect(symbolType["id"] as? String == "t0000000000000001")

    let declaredTypeJSON = try client.getDeclaredTypeOfSymbolJSON(snapshot: snapshotID, project: projectID, symbol: symbolID)
    let declaredType = try JSONSerialization.jsonObject(with: Data(declaredTypeJSON.utf8)) as! [String: Any]
    #expect(declaredType["id"] as? String == "t0000000000000001")
}
