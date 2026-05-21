import Foundation

public struct CorsaStrRef {
    public let ptr: UnsafePointer<UInt8>?
    public let len: Int
}

public struct CorsaString {
    public let ptr: UnsafeMutablePointer<CChar>?
    public let len: Int
}

public struct CorsaBytes {
    public let ptr: UnsafeMutablePointer<UInt8>?
    public let len: Int
    public let present: Bool
    public let status: Int32
}

let corsaResultError: Int32 = 0
let corsaResultNone: Int32 = 1
let corsaResultSome: Int32 = 2

public struct CorsaStringList {
    public let ptr: UnsafeMutablePointer<CorsaString>?
    public let len: Int
}

@_silgen_name("corsa_utils_classify_type_text")
private func classifyTypeTextNative(_ text: CorsaStrRef) -> CorsaString

@_silgen_name("corsa_utils_split_top_level_type_text")
private func splitTopLevelTypeTextNative(_ text: CorsaStrRef, _ delimiter: UInt32) -> CorsaStringList

@_silgen_name("corsa_utils_split_type_text")
private func splitTypeTextNative(_ text: CorsaStrRef) -> CorsaStringList

@_silgen_name("corsa_utils_is_string_like_type_texts")
private func isStringLikeTypeTextsNative(_ typeTexts: UnsafePointer<CorsaStrRef>?, _ typeTextsLen: Int) -> Bool

@_silgen_name("corsa_utils_is_number_like_type_texts")
private func isNumberLikeTypeTextsNative(_ typeTexts: UnsafePointer<CorsaStrRef>?, _ typeTextsLen: Int) -> Bool

@_silgen_name("corsa_utils_is_bigint_like_type_texts")
private func isBigintLikeTypeTextsNative(_ typeTexts: UnsafePointer<CorsaStrRef>?, _ typeTextsLen: Int) -> Bool

@_silgen_name("corsa_utils_is_any_like_type_texts")
private func isAnyLikeTypeTextsNative(_ typeTexts: UnsafePointer<CorsaStrRef>?, _ typeTextsLen: Int) -> Bool

@_silgen_name("corsa_utils_is_unknown_like_type_texts")
private func isUnknownLikeTypeTextsNative(_ typeTexts: UnsafePointer<CorsaStrRef>?, _ typeTextsLen: Int) -> Bool

@_silgen_name("corsa_utils_is_array_like_type_texts")
private func isArrayLikeTypeTextsNative(_ typeTexts: UnsafePointer<CorsaStrRef>?, _ typeTextsLen: Int) -> Bool

@_silgen_name("corsa_utils_is_promise_like_type_texts")
private func isPromiseLikeTypeTextsNative(
    _ typeTexts: UnsafePointer<CorsaStrRef>?,
    _ typeTextsLen: Int,
    _ propertyNames: UnsafePointer<CorsaStrRef>?,
    _ propertyNamesLen: Int
) -> Bool

@_silgen_name("corsa_utils_is_error_like_type_texts")
private func isErrorLikeTypeTextsNative(
    _ typeTexts: UnsafePointer<CorsaStrRef>?,
    _ typeTextsLen: Int,
    _ propertyNames: UnsafePointer<CorsaStrRef>?,
    _ propertyNamesLen: Int
) -> Bool

@_silgen_name("corsa_utils_has_unsafe_any_flow")
private func hasUnsafeAnyFlowNative(
    _ sourceTexts: UnsafePointer<CorsaStrRef>?,
    _ sourceTextsLen: Int,
    _ targetTexts: UnsafePointer<CorsaStrRef>?,
    _ targetTextsLen: Int
) -> Bool

@_silgen_name("corsa_utils_is_unsafe_assignment")
private func isUnsafeAssignmentNative(
    _ sourceTexts: UnsafePointer<CorsaStrRef>?,
    _ sourceTextsLen: Int,
    _ targetTexts: UnsafePointer<CorsaStrRef>?,
    _ targetTextsLen: Int
) -> Bool

@_silgen_name("corsa_utils_is_unsafe_return")
private func isUnsafeReturnNative(
    _ sourceTexts: UnsafePointer<CorsaStrRef>?,
    _ sourceTextsLen: Int,
    _ targetTexts: UnsafePointer<CorsaStrRef>?,
    _ targetTextsLen: Int
) -> Bool

@_silgen_name("corsa_utils_string_free")
func freeStringNative(_ value: CorsaString)

@_silgen_name("corsa_bytes_free")
func freeBytesNative(_ value: CorsaBytes)

@_silgen_name("corsa_utils_string_list_free")
func freeStringListNative(_ value: CorsaStringList)

public enum CorsaUtils {
    public static func classifyTypeText(_ text: String) -> String {
        withStrRef(text) { takeString(classifyTypeTextNative($0)) }
    }

    public static func splitTopLevelTypeText(_ text: String, delimiter: UnicodeScalar) -> [String] {
        withStrRef(text) { takeStringList(splitTopLevelTypeTextNative($0, delimiter.value)) }
    }

    public static func splitTypeText(_ text: String) -> [String] {
        withStrRef(text) { takeStringList(splitTypeTextNative($0)) }
    }

    public static func isStringLikeTypeTexts(_ typeTexts: [String]) -> Bool { callSingle(typeTexts, isStringLikeTypeTextsNative) }
    public static func isNumberLikeTypeTexts(_ typeTexts: [String]) -> Bool { callSingle(typeTexts, isNumberLikeTypeTextsNative) }
    public static func isBigintLikeTypeTexts(_ typeTexts: [String]) -> Bool { callSingle(typeTexts, isBigintLikeTypeTextsNative) }
    public static func isAnyLikeTypeTexts(_ typeTexts: [String]) -> Bool { callSingle(typeTexts, isAnyLikeTypeTextsNative) }
    public static func isUnknownLikeTypeTexts(_ typeTexts: [String]) -> Bool { callSingle(typeTexts, isUnknownLikeTypeTextsNative) }
    public static func isArrayLikeTypeTexts(_ typeTexts: [String]) -> Bool { callSingle(typeTexts, isArrayLikeTypeTextsNative) }

    public static func isPromiseLikeTypeTexts(_ typeTexts: [String], propertyNames: [String] = []) -> Bool {
        callDual(typeTexts, propertyNames, isPromiseLikeTypeTextsNative)
    }

    public static func isErrorLikeTypeTexts(_ typeTexts: [String], propertyNames: [String] = []) -> Bool {
        callDual(typeTexts, propertyNames, isErrorLikeTypeTextsNative)
    }

    public static func hasUnsafeAnyFlow(_ sourceTexts: [String], targetTexts: [String]) -> Bool {
        callFlow(sourceTexts, targetTexts, hasUnsafeAnyFlowNative)
    }

    public static func isUnsafeAssignment(_ sourceTexts: [String], targetTexts: [String]) -> Bool {
        callFlow(sourceTexts, targetTexts, isUnsafeAssignmentNative)
    }

    public static func isUnsafeReturn(_ sourceTexts: [String], targetTexts: [String]) -> Bool {
        callFlow(sourceTexts, targetTexts, isUnsafeReturnNative)
    }
}

func callSingle(_ typeTexts: [String], _ body: (UnsafePointer<CorsaStrRef>?, Int) -> Bool) -> Bool {
    withRefs(typeTexts) { body($0.baseAddress, $0.count) }
}

func callDual(
    _ typeTexts: [String],
    _ propertyNames: [String],
    _ body: (UnsafePointer<CorsaStrRef>?, Int, UnsafePointer<CorsaStrRef>?, Int) -> Bool
) -> Bool {
    withRefs(typeTexts) { typeRefs in
        withRefs(propertyNames) { propertyRefs in
            body(typeRefs.baseAddress, typeRefs.count, propertyRefs.baseAddress, propertyRefs.count)
        }
    }
}

func callFlow(
    _ sourceTexts: [String],
    _ targetTexts: [String],
    _ body: (UnsafePointer<CorsaStrRef>?, Int, UnsafePointer<CorsaStrRef>?, Int) -> Bool
) -> Bool {
    withRefs(sourceTexts) { sourceRefs in
        withRefs(targetTexts) { targetRefs in
            body(sourceRefs.baseAddress, sourceRefs.count, targetRefs.baseAddress, targetRefs.count)
        }
    }
}

func withStrRef<T>(_ value: String, _ body: (CorsaStrRef) throws -> T) rethrows -> T {
    let refs = BorrowedRefs([value])
    return try refs.refs.withUnsafeBufferPointer { try body($0.first ?? CorsaStrRef(ptr: nil, len: 0)) }
}

func withRefs<T>(_ values: [String], _ body: (UnsafeBufferPointer<CorsaStrRef>) throws -> T) rethrows -> T {
    let refs = BorrowedRefs(values)
    return try refs.refs.withUnsafeBufferPointer(body)
}

func takeString(_ value: CorsaString) -> String {
    defer { freeStringNative(value) }
    guard let ptr = value.ptr, value.len > 0 else {
        return ""
    }
    return String(decoding: UnsafeBufferPointer(start: UnsafeRawPointer(ptr).assumingMemoryBound(to: UInt8.self), count: value.len), as: UTF8.self)
}

func takeStringList(_ value: CorsaStringList) -> [String] {
    defer { freeStringListNative(value) }
    guard let ptr = value.ptr, value.len > 0 else {
        return []
    }
    return UnsafeBufferPointer(start: ptr, count: value.len).map { item in
        guard let ptr = item.ptr, item.len > 0 else {
            return ""
        }
        return String(decoding: UnsafeBufferPointer(start: UnsafeRawPointer(ptr).assumingMemoryBound(to: UInt8.self), count: item.len), as: UTF8.self)
    }
}

func takeBytes(_ value: CorsaBytes) -> Data? {
    defer { freeBytesNative(value) }
    guard value.status == corsaResultSome else {
        return nil
    }
    guard let ptr = value.ptr, value.len > 0 else {
        return Data()
    }
    return Data(bytes: ptr, count: value.len)
}

final class BorrowedRefs {
    private let storage: [UnsafeMutableBufferPointer<UInt8>]
    let refs: [CorsaStrRef]

    init(_ values: [String]) {
        var storage = [UnsafeMutableBufferPointer<UInt8>]()
        var refs = [CorsaStrRef]()
        storage.reserveCapacity(values.count)
        refs.reserveCapacity(values.count)
        for value in values {
            let bytes = Array(value.utf8)
            guard !bytes.isEmpty else {
                refs.append(CorsaStrRef(ptr: nil, len: 0))
                continue
            }
            let buffer = UnsafeMutableBufferPointer<UInt8>.allocate(capacity: bytes.count)
            _ = buffer.initialize(from: bytes)
            storage.append(buffer)
            refs.append(CorsaStrRef(ptr: UnsafePointer(buffer.baseAddress!), len: bytes.count))
        }
        self.storage = storage
        self.refs = refs
    }

    deinit {
        for buffer in storage {
            buffer.deallocate()
        }
    }
}
