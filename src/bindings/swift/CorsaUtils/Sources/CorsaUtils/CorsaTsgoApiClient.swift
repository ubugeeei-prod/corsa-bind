import Foundation

public enum CorsaTsgoApiMode: String, Encodable {
    case jsonrpc
    case msgpack
}

public typealias CorsaApiMode = CorsaTsgoApiMode

public struct CorsaTsgoApiClientOptions: Encodable {
    public let executable: String
    public let cwd: String?
    public let mode: CorsaTsgoApiMode?
    public let requestTimeoutMs: UInt64?
    public let shutdownTimeoutMs: UInt64?
    public let outboundCapacity: Int?
    public let allowUnstableUpstreamCalls: Bool?

    public init(
        executable: String,
        cwd: String? = nil,
        mode: CorsaTsgoApiMode? = nil,
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

public typealias CorsaApiClientOptions = CorsaTsgoApiClientOptions

@_silgen_name("corsa_tsgo_api_client_spawn")
private func spawnTsgoApiClientNative(_ optionsJSON: CorsaStrRef) -> UnsafeMutableRawPointer?

@_silgen_name("corsa_tsgo_api_client_initialize_json")
private func initializeTsgoApiClientNative(_ value: UnsafeMutableRawPointer?) -> CorsaString

@_silgen_name("corsa_tsgo_api_client_parse_config_file_json")
private func parseConfigFileTsgoApiClientNative(_ value: UnsafeMutableRawPointer?, _ file: CorsaStrRef) -> CorsaString

@_silgen_name("corsa_tsgo_api_client_update_snapshot_json")
private func updateSnapshotTsgoApiClientNative(_ value: UnsafeMutableRawPointer?, _ paramsJSON: CorsaStrRef) -> CorsaString

@_silgen_name("corsa_tsgo_api_client_get_source_file")
private func getSourceFileTsgoApiClientNative(
    _ value: UnsafeMutableRawPointer?,
    _ snapshot: CorsaStrRef,
    _ project: CorsaStrRef,
    _ file: CorsaStrRef
) -> CorsaBytes

@_silgen_name("corsa_tsgo_api_client_get_string_type_json")
private func getStringTypeTsgoApiClientNative(
    _ value: UnsafeMutableRawPointer?,
    _ snapshot: CorsaStrRef,
    _ project: CorsaStrRef
) -> CorsaString

@_silgen_name("corsa_tsgo_api_client_get_type_at_position_json")
private func getTypeAtPositionTsgoApiClientNative(
    _ value: UnsafeMutableRawPointer?,
    _ snapshot: CorsaStrRef,
    _ project: CorsaStrRef,
    _ file: CorsaStrRef,
    _ position: UInt32
) -> CorsaString

@_silgen_name("corsa_tsgo_api_client_get_symbol_at_position_json")
private func getSymbolAtPositionTsgoApiClientNative(
    _ value: UnsafeMutableRawPointer?,
    _ snapshot: CorsaStrRef,
    _ project: CorsaStrRef,
    _ file: CorsaStrRef,
    _ position: UInt32
) -> CorsaString

@_silgen_name("corsa_tsgo_api_client_get_type_arguments_json")
private func getTypeArgumentsTsgoApiClientNative(
    _ value: UnsafeMutableRawPointer?,
    _ snapshot: CorsaStrRef,
    _ project: CorsaStrRef,
    _ typeHandle: CorsaStrRef,
    _ objectFlags: UInt32
) -> CorsaString

@_silgen_name("corsa_tsgo_api_client_get_type_of_symbol_json")
private func getTypeOfSymbolTsgoApiClientNative(
    _ value: UnsafeMutableRawPointer?,
    _ snapshot: CorsaStrRef,
    _ project: CorsaStrRef,
    _ symbol: CorsaStrRef
) -> CorsaString

@_silgen_name("corsa_tsgo_api_client_get_declared_type_of_symbol_json")
private func getDeclaredTypeOfSymbolTsgoApiClientNative(
    _ value: UnsafeMutableRawPointer?,
    _ snapshot: CorsaStrRef,
    _ project: CorsaStrRef,
    _ symbol: CorsaStrRef
) -> CorsaString

@_silgen_name("corsa_tsgo_api_client_type_to_string")
private func typeToStringTsgoApiClientNative(
    _ value: UnsafeMutableRawPointer?,
    _ snapshot: CorsaStrRef,
    _ project: CorsaStrRef,
    _ typeHandle: CorsaStrRef,
    _ location: CorsaStrRef,
    _ flags: Int32
) -> CorsaString

@_silgen_name("corsa_tsgo_api_client_call_json")
private func callJsonTsgoApiClientNative(
    _ value: UnsafeMutableRawPointer?,
    _ method: CorsaStrRef,
    _ paramsJSON: CorsaStrRef
) -> CorsaString

@_silgen_name("corsa_tsgo_api_client_call_binary")
private func callBinaryTsgoApiClientNative(
    _ value: UnsafeMutableRawPointer?,
    _ method: CorsaStrRef,
    _ paramsJSON: CorsaStrRef
) -> CorsaBytes

@_silgen_name("corsa_tsgo_api_client_release_handle")
private func releaseHandleTsgoApiClientNative(_ value: UnsafeMutableRawPointer?, _ handle: CorsaStrRef) -> Bool

@_silgen_name("corsa_tsgo_api_client_close")
private func closeTsgoApiClientNative(_ value: UnsafeMutableRawPointer?) -> Bool

@_silgen_name("corsa_tsgo_api_client_free")
private func freeTsgoApiClientNative(_ value: UnsafeMutableRawPointer?)

public final class CorsaTsgoApiClient {
    private var handle: UnsafeMutableRawPointer?

    public init(options: CorsaTsgoApiClientOptions) throws {
        let data = try JSONEncoder().encode(options)
        guard let json = String(data: data, encoding: .utf8) else {
            throw CorsaFfiError.message("failed to encode corsa api client options")
        }
        self.handle = try CorsaTsgoApiClient.create(json: json)
    }

    private init(handle: UnsafeMutableRawPointer) {
        self.handle = handle
    }

    public static func spawn(json optionsJSON: String) throws -> CorsaTsgoApiClient {
        try CorsaTsgoApiClient(handle: create(json: optionsJSON))
    }

    deinit {
        if let handle {
            _ = closeTsgoApiClientNative(handle)
            freeTsgoApiClientNative(handle)
        }
    }

    public func close() throws {
        guard let handle else {
            return
        }
        self.handle = nil
        let ok = closeTsgoApiClientNative(handle)
        freeTsgoApiClientNative(handle)
        if !ok {
            throw ffiError()
        }
    }

    public func initializeJSON() throws -> String {
        try takeCheckedString(initializeTsgoApiClientNative(handle))
    }

    public func parseConfigFileJSON(file: String) throws -> String {
        try withStrRef(file) { try takeCheckedString(parseConfigFileTsgoApiClientNative(handle, $0)) }
    }

    public func updateSnapshotJSON(paramsJSON: String? = nil) throws -> String {
        try withOptionalStrRef(paramsJSON) { try takeCheckedString(updateSnapshotTsgoApiClientNative(handle, $0)) }
    }

    public func getSourceFile(snapshot: String, project: String, file: String) throws -> Data? {
        let refs = BorrowedRefs([snapshot, project, file])
        return try refs.refs.withUnsafeBufferPointer {
            try takeCheckedBytes(getSourceFileTsgoApiClientNative(handle, $0[0], $0[1], $0[2]))
        }
    }

    public func getStringTypeJSON(snapshot: String, project: String) throws -> String {
        let refs = BorrowedRefs([snapshot, project])
        return try refs.refs.withUnsafeBufferPointer {
            try takeCheckedString(getStringTypeTsgoApiClientNative(handle, $0[0], $0[1]))
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
            try takeCheckedString(getTypeAtPositionTsgoApiClientNative(handle, $0[0], $0[1], $0[2], position))
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
            try takeCheckedString(getSymbolAtPositionTsgoApiClientNative(handle, $0[0], $0[1], $0[2], position))
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
            try takeCheckedString(getTypeArgumentsTsgoApiClientNative(handle, $0[0], $0[1], $0[2], objectFlags))
        }
    }

    public func getTypeOfSymbolJSON(snapshot: String, project: String, symbol: String) throws -> String {
        let refs = BorrowedRefs([snapshot, project, symbol])
        return try refs.refs.withUnsafeBufferPointer {
            try takeCheckedString(getTypeOfSymbolTsgoApiClientNative(handle, $0[0], $0[1], $0[2]))
        }
    }

    public func getDeclaredTypeOfSymbolJSON(snapshot: String, project: String, symbol: String) throws -> String {
        let refs = BorrowedRefs([snapshot, project, symbol])
        return try refs.refs.withUnsafeBufferPointer {
            try takeCheckedString(getDeclaredTypeOfSymbolTsgoApiClientNative(handle, $0[0], $0[1], $0[2]))
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
                try takeCheckedString(typeToStringTsgoApiClientNative(
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
                try takeCheckedString(callJsonTsgoApiClientNative(handle, methodRef, $0))
            }
        }
    }

    public func callBinary(method: String, paramsJSON: String? = nil) throws -> Data? {
        try withStrRef(method) { methodRef in
            try withOptionalStrRef(paramsJSON) {
                try takeCheckedBytes(callBinaryTsgoApiClientNative(handle, methodRef, $0))
            }
        }
    }

    public func releaseHandle(_ value: String) throws {
        let ok = withStrRef(value) { releaseHandleTsgoApiClientNative(handle, $0) }
        if !ok {
            throw ffiError()
        }
    }

    private static func create(json optionsJSON: String) throws -> UnsafeMutableRawPointer {
        try withStrRef(optionsJSON) {
            guard let handle = spawnTsgoApiClientNative($0) else {
                throw ffiError()
            }
            return handle
        }
    }
}

public typealias CorsaApiClient = CorsaTsgoApiClient

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
