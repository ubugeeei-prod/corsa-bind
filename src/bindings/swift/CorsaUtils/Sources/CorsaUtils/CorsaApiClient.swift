import Foundation

public enum CorsaApiMode: String, Encodable {
    case jsonrpc
    case msgpack
}

public typealias CorsaApiMode = CorsaApiMode

public struct CorsaApiClientOptions: Encodable {
    public let executable: String
    public let cwd: String?
    public let mode: CorsaApiMode?
    public let requestTimeoutMs: UInt64?
    public let shutdownTimeoutMs: UInt64?
    public let outboundCapacity: Int?
    public let allowUnstableUpstreamCalls: Bool?

    public init(
        executable: String,
        cwd: String? = nil,
        mode: CorsaApiMode? = nil,
        requestTimeoutMs: UInt64? = nil,
        shutdownTimeoutMs: UInt64? = nil,
        outboundCapacity: Int? = nil,
        allowUnstableUpstreamCalls: Bool? = nil
    ) {
        self.executable = executable
        self.cwd = cwd
        self.mode = mode
        self.requestTimeoutMs = requestTimeoutMs
        self.shutdownTimeoutMs = shutdownTimeoutMs
        self.outboundCapacity = outboundCapacity
        self.allowUnstableUpstreamCalls = allowUnstableUpstreamCalls
    }
}

public typealias CorsaApiClientOptions = CorsaApiClientOptions

@_silgen_name("corsa_api_client_spawn")
private func spawnCorsaApiClientNative(_ optionsJSON: CorsaStrRef) -> UnsafeMutableRawPointer?

@_silgen_name("corsa_api_client_initialize_json")
private func initializeCorsaApiClientNative(_ value: UnsafeMutableRawPointer?) -> CorsaString

@_silgen_name("corsa_api_client_parse_config_file_json")
private func parseConfigFileCorsaApiClientNative(_ value: UnsafeMutableRawPointer?, _ file: CorsaStrRef) -> CorsaString

@_silgen_name("corsa_api_client_update_snapshot_json")
private func updateSnapshotCorsaApiClientNative(_ value: UnsafeMutableRawPointer?, _ paramsJSON: CorsaStrRef) -> CorsaString

@_silgen_name("corsa_api_client_get_source_file")
private func getSourceFileCorsaApiClientNative(
    _ value: UnsafeMutableRawPointer?,
    _ snapshot: CorsaStrRef,
    _ project: CorsaStrRef,
    _ file: CorsaStrRef
) -> CorsaBytes

@_silgen_name("corsa_api_client_get_string_type_json")
private func getStringTypeCorsaApiClientNative(
    _ value: UnsafeMutableRawPointer?,
    _ snapshot: CorsaStrRef,
    _ project: CorsaStrRef
) -> CorsaString

@_silgen_name("corsa_api_client_get_type_at_position_json")
private func getTypeAtPositionCorsaApiClientNative(
    _ value: UnsafeMutableRawPointer?,
    _ snapshot: CorsaStrRef,
    _ project: CorsaStrRef,
    _ file: CorsaStrRef,
    _ position: UInt32
) -> CorsaString

@_silgen_name("corsa_api_client_get_symbol_at_position_json")
private func getSymbolAtPositionCorsaApiClientNative(
    _ value: UnsafeMutableRawPointer?,
    _ snapshot: CorsaStrRef,
    _ project: CorsaStrRef,
    _ file: CorsaStrRef,
    _ position: UInt32
) -> CorsaString

@_silgen_name("corsa_api_client_get_type_arguments_json")
private func getTypeArgumentsCorsaApiClientNative(
    _ value: UnsafeMutableRawPointer?,
    _ snapshot: CorsaStrRef,
    _ project: CorsaStrRef,
    _ typeHandle: CorsaStrRef,
    _ objectFlags: UInt32
) -> CorsaString

@_silgen_name("corsa_api_client_get_type_of_symbol_json")
private func getTypeOfSymbolCorsaApiClientNative(
    _ value: UnsafeMutableRawPointer?,
    _ snapshot: CorsaStrRef,
    _ project: CorsaStrRef,
    _ symbol: CorsaStrRef
) -> CorsaString

@_silgen_name("corsa_api_client_get_declared_type_of_symbol_json")
private func getDeclaredTypeOfSymbolCorsaApiClientNative(
    _ value: UnsafeMutableRawPointer?,
    _ snapshot: CorsaStrRef,
    _ project: CorsaStrRef,
    _ symbol: CorsaStrRef
) -> CorsaString

@_silgen_name("corsa_api_client_type_to_string")
private func typeToStringCorsaApiClientNative(
    _ value: UnsafeMutableRawPointer?,
    _ snapshot: CorsaStrRef,
    _ project: CorsaStrRef,
    _ typeHandle: CorsaStrRef,
    _ location: CorsaStrRef,
    _ flags: Int32
) -> CorsaString

@_silgen_name("corsa_api_client_call_json")
private func callJsonCorsaApiClientNative(
    _ value: UnsafeMutableRawPointer?,
    _ method: CorsaStrRef,
    _ paramsJSON: CorsaStrRef
) -> CorsaString

@_silgen_name("corsa_api_client_call_binary")
private func callBinaryCorsaApiClientNative(
    _ value: UnsafeMutableRawPointer?,
    _ method: CorsaStrRef,
    _ paramsJSON: CorsaStrRef
) -> CorsaBytes

@_silgen_name("corsa_api_client_release_handle")
private func releaseHandleCorsaApiClientNative(_ value: UnsafeMutableRawPointer?, _ handle: CorsaStrRef) -> Bool

@_silgen_name("corsa_api_client_close")
private func closeCorsaApiClientNative(_ value: UnsafeMutableRawPointer?) -> Bool

@_silgen_name("corsa_api_client_free")
private func freeCorsaApiClientNative(_ value: UnsafeMutableRawPointer?)

public final class CorsaApiClient {
    private var handle: UnsafeMutableRawPointer?

    public init(options: CorsaApiClientOptions) throws {
        let data = try JSONEncoder().encode(options)
        guard let json = String(data: data, encoding: .utf8) else {
            throw CorsaFfiError.message("failed to encode corsa api client options")
        }
        self.handle = try CorsaApiClient.create(json: json)
    }

    private init(handle: UnsafeMutableRawPointer) {
        self.handle = handle
    }

    public static func spawn(json optionsJSON: String) throws -> CorsaApiClient {
        try CorsaApiClient(handle: create(json: optionsJSON))
    }

    deinit {
        if let handle {
            _ = closeCorsaApiClientNative(handle)
            freeCorsaApiClientNative(handle)
        }
    }

    public func close() throws {
        guard let handle else {
            return
        }
        self.handle = nil
        let ok = closeCorsaApiClientNative(handle)
        freeCorsaApiClientNative(handle)
        if !ok {
            throw ffiError()
        }
    }

    public func initializeJSON() throws -> String {
        try takeCheckedString(initializeCorsaApiClientNative(handle))
    }

    public func parseConfigFileJSON(file: String) throws -> String {
        try withStrRef(file) { try takeCheckedString(parseConfigFileCorsaApiClientNative(handle, $0)) }
    }

    public func updateSnapshotJSON(paramsJSON: String? = nil) throws -> String {
        try withOptionalStrRef(paramsJSON) { try takeCheckedString(updateSnapshotCorsaApiClientNative(handle, $0)) }
    }

    public func getSourceFile(snapshot: String, project: String, file: String) throws -> Data? {
        let refs = BorrowedRefs([snapshot, project, file])
        return try refs.refs.withUnsafeBufferPointer {
            try takeCheckedBytes(getSourceFileCorsaApiClientNative(handle, $0[0], $0[1], $0[2]))
        }
    }

    public func getStringTypeJSON(snapshot: String, project: String) throws -> String {
        let refs = BorrowedRefs([snapshot, project])
        return try refs.refs.withUnsafeBufferPointer {
            try takeCheckedString(getStringTypeCorsaApiClientNative(handle, $0[0], $0[1]))
        }
    }

    public func getTypeAtPositionJSON(
        snapshot: String,
        project: String,
        file: String,
        position: UInt32
    ) throws -> String {
        let refs = BorrowedRefs([snapshot, project, file])
        return try refs.refs.withUnsafeBufferPointer {
            try takeCheckedString(getTypeAtPositionCorsaApiClientNative(handle, $0[0], $0[1], $0[2], position))
        }
    }

    public func getSymbolAtPositionJSON(
        snapshot: String,
        project: String,
        file: String,
        position: UInt32
    ) throws -> String {
        let refs = BorrowedRefs([snapshot, project, file])
        return try refs.refs.withUnsafeBufferPointer {
            try takeCheckedString(getSymbolAtPositionCorsaApiClientNative(handle, $0[0], $0[1], $0[2], position))
        }
    }

    public func getTypeArgumentsJSON(
        snapshot: String,
        project: String,
        typeHandle: String,
        objectFlags: UInt32 = 0
    ) throws -> String {
        let refs = BorrowedRefs([snapshot, project, typeHandle])
        return try refs.refs.withUnsafeBufferPointer {
            try takeCheckedString(getTypeArgumentsCorsaApiClientNative(handle, $0[0], $0[1], $0[2], objectFlags))
        }
    }

    public func getTypeOfSymbolJSON(snapshot: String, project: String, symbol: String) throws -> String {
        let refs = BorrowedRefs([snapshot, project, symbol])
        return try refs.refs.withUnsafeBufferPointer {
            try takeCheckedString(getTypeOfSymbolCorsaApiClientNative(handle, $0[0], $0[1], $0[2]))
        }
    }

    public func getDeclaredTypeOfSymbolJSON(snapshot: String, project: String, symbol: String) throws -> String {
        let refs = BorrowedRefs([snapshot, project, symbol])
        return try refs.refs.withUnsafeBufferPointer {
            try takeCheckedString(getDeclaredTypeOfSymbolCorsaApiClientNative(handle, $0[0], $0[1], $0[2]))
        }
    }

    public func typeToString(
        snapshot: String,
        project: String,
        typeHandle: String,
        location: String? = nil,
        flags: Int32? = nil
    ) throws -> String {
        let refs = BorrowedRefs([snapshot, project, typeHandle])
        return try refs.refs.withUnsafeBufferPointer { refs in
            try withOptionalStrRef(location) {
                try takeCheckedString(typeToStringCorsaApiClientNative(
                    handle,
                    refs[0],
                    refs[1],
                    refs[2],
                    $0,
                    flags ?? -1
                ))
            }
        }
    }

    public func callJSON(method: String, paramsJSON: String? = nil) throws -> String {
        try withStrRef(method) { methodRef in
            try withOptionalStrRef(paramsJSON) {
                try takeCheckedString(callJsonCorsaApiClientNative(handle, methodRef, $0))
            }
        }
    }

    public func callBinary(method: String, paramsJSON: String? = nil) throws -> Data? {
        try withStrRef(method) { methodRef in
            try withOptionalStrRef(paramsJSON) {
                try takeCheckedBytes(callBinaryCorsaApiClientNative(handle, methodRef, $0))
            }
        }
    }

    public func releaseHandle(_ value: String) throws {
        let ok = withStrRef(value) { releaseHandleCorsaApiClientNative(handle, $0) }
        if !ok {
            throw ffiError()
        }
    }

    private static func create(json optionsJSON: String) throws -> UnsafeMutableRawPointer {
        try withStrRef(optionsJSON) {
            guard let handle = spawnCorsaApiClientNative($0) else {
                throw ffiError()
            }
            return handle
        }
    }
}

public typealias CorsaApiClient = CorsaApiClient

private func withOptionalStrRef<T>(_ value: String?, _ body: (CorsaStrRef) throws -> T) throws -> T {
    if let value {
        return try withStrRef(value, body)
    }
    return try body(CorsaStrRef(ptr: nil, len: 0))
}

private func takeCheckedString(_ value: CorsaString) throws -> String {
    let text = takeString(value)
    if !text.isEmpty {
        return text
    }
    let message = takeString(takeErrorMessageNative())
    if !message.isEmpty {
        throw CorsaFfiError.message(message)
    }
    return text
}

private func takeCheckedBytes(_ value: CorsaBytes) throws -> Data? {
    let status = value.status
    let data = takeBytes(value)
    if status == corsaResultError {
        let message = takeString(takeErrorMessageNative())
        if !message.isEmpty {
            throw CorsaFfiError.message(message)
        }
    }
    return data
}
