const std = @import("std");

pub const c = @cImport({
    @cInclude("corsa_utils.h");
});

pub fn toRef(text: []const u8) c.CorsaStrRef {
    return .{
        .ptr = if (text.len == 0) null else text.ptr,
        .len = text.len,
    };
}

fn withRefs(
    allocator: std.mem.Allocator,
    values: []const []const u8,
    body: fn ([]c.CorsaStrRef) bool,
) !bool {
    const refs = try allocator.alloc(c.CorsaStrRef, values.len);
    defer allocator.free(refs);
    for (values, 0..) |value, index| {
        refs[index] = toRef(value);
    }
    return body(refs);
}

fn withDualRefs(
    allocator: std.mem.Allocator,
    left: []const []const u8,
    right: []const []const u8,
    body: fn ([]c.CorsaStrRef, []c.CorsaStrRef) bool,
) !bool {
    const left_refs = try allocator.alloc(c.CorsaStrRef, left.len);
    defer allocator.free(left_refs);
    for (left, 0..) |value, index| left_refs[index] = toRef(value);
    const right_refs = try allocator.alloc(c.CorsaStrRef, right.len);
    defer allocator.free(right_refs);
    for (right, 0..) |value, index| right_refs[index] = toRef(value);
    return body(left_refs, right_refs);
}

pub fn takeString(allocator: std.mem.Allocator, value: c.CorsaString) ![]u8 {
    defer c.corsa_utils_string_free(value);
    if (value.ptr == null or value.len == 0) {
        return allocator.alloc(u8, 0);
    }
    const slice = @as([*]const u8, @ptrCast(value.ptr))[0..value.len];
    return allocator.dupe(u8, slice);
}

pub fn takeStringList(allocator: std.mem.Allocator, value: c.CorsaStringList) ![][]u8 {
    defer c.corsa_utils_string_list_free(value);
    const out = try allocator.alloc([]u8, value.len);
    for (0..value.len) |index| {
        const item = value.ptr[index];
        const slice = if (item.ptr == null or item.len == 0)
            &[_]u8{}
        else
            @as([*]const u8, @ptrCast(item.ptr))[0..item.len];
        out[index] = try allocator.dupe(u8, slice);
    }
    return out;
}

pub fn takeOptionalBytes(allocator: std.mem.Allocator, value: c.CorsaBytes) !?[]u8 {
    defer c.corsa_bytes_free(value);
    if (value.status == c.CORSA_RESULT_NONE) {
        return null;
    }
    if (value.status != c.CORSA_RESULT_SOME) return error.CorsaFfiError;
    if (value.ptr == null or value.len == 0) {
        return allocator.alloc(u8, 0);
    }
    const slice = @as([*]const u8, @ptrCast(value.ptr))[0..value.len];
    return allocator.dupe(u8, slice);
}

pub fn classifyTypeText(allocator: std.mem.Allocator, text: []const u8) ![]u8 {
    return takeString(allocator, c.corsa_utils_classify_type_text(toRef(text)));
}

pub fn splitTopLevelTypeText(
    allocator: std.mem.Allocator,
    text: []const u8,
    delimiter: u8,
) ![][]u8 {
    return takeStringList(
        allocator,
        c.corsa_utils_split_top_level_type_text(toRef(text), @as(c_uint, delimiter)),
    );
}

pub fn splitTypeText(allocator: std.mem.Allocator, text: []const u8) ![][]u8 {
    return takeStringList(allocator, c.corsa_utils_split_type_text(toRef(text)));
}

pub fn isStringLikeTypeTexts(allocator: std.mem.Allocator, type_texts: []const []const u8) !bool {
    return withRefs(allocator, type_texts, struct {
        fn call(refs: []c.CorsaStrRef) bool {
            return c.corsa_utils_is_string_like_type_texts(
                if (refs.len == 0) null else refs.ptr,
                refs.len,
            );
        }
    }.call);
}

pub fn isNumberLikeTypeTexts(allocator: std.mem.Allocator, type_texts: []const []const u8) !bool {
    return withRefs(allocator, type_texts, struct {
        fn call(refs: []c.CorsaStrRef) bool {
            return c.corsa_utils_is_number_like_type_texts(
                if (refs.len == 0) null else refs.ptr,
                refs.len,
            );
        }
    }.call);
}

pub fn isBigintLikeTypeTexts(allocator: std.mem.Allocator, type_texts: []const []const u8) !bool {
    return withRefs(allocator, type_texts, struct {
        fn call(refs: []c.CorsaStrRef) bool {
            return c.corsa_utils_is_bigint_like_type_texts(
                if (refs.len == 0) null else refs.ptr,
                refs.len,
            );
        }
    }.call);
}

pub fn isAnyLikeTypeTexts(allocator: std.mem.Allocator, type_texts: []const []const u8) !bool {
    return withRefs(allocator, type_texts, struct {
        fn call(refs: []c.CorsaStrRef) bool {
            return c.corsa_utils_is_any_like_type_texts(if (refs.len == 0) null else refs.ptr, refs.len);
        }
    }.call);
}

pub fn isUnknownLikeTypeTexts(allocator: std.mem.Allocator, type_texts: []const []const u8) !bool {
    return withRefs(allocator, type_texts, struct {
        fn call(refs: []c.CorsaStrRef) bool {
            return c.corsa_utils_is_unknown_like_type_texts(
                if (refs.len == 0) null else refs.ptr,
                refs.len,
            );
        }
    }.call);
}

pub fn isArrayLikeTypeTexts(allocator: std.mem.Allocator, type_texts: []const []const u8) !bool {
    return withRefs(allocator, type_texts, struct {
        fn call(refs: []c.CorsaStrRef) bool {
            return c.corsa_utils_is_array_like_type_texts(
                if (refs.len == 0) null else refs.ptr,
                refs.len,
            );
        }
    }.call);
}

pub fn isPromiseLikeTypeTexts(
    allocator: std.mem.Allocator,
    type_texts: []const []const u8,
    property_names: []const []const u8,
) !bool {
    return withDualRefs(allocator, type_texts, property_names, struct {
        fn call(type_refs: []c.CorsaStrRef, property_refs: []c.CorsaStrRef) bool {
            return c.corsa_utils_is_promise_like_type_texts(
                if (type_refs.len == 0) null else type_refs.ptr,
                type_refs.len,
                if (property_refs.len == 0) null else property_refs.ptr,
                property_refs.len,
            );
        }
    }.call);
}

pub fn isErrorLikeTypeTexts(
    allocator: std.mem.Allocator,
    type_texts: []const []const u8,
    property_names: []const []const u8,
) !bool {
    return withDualRefs(allocator, type_texts, property_names, struct {
        fn call(type_refs: []c.CorsaStrRef, property_refs: []c.CorsaStrRef) bool {
            return c.corsa_utils_is_error_like_type_texts(
                if (type_refs.len == 0) null else type_refs.ptr,
                type_refs.len,
                if (property_refs.len == 0) null else property_refs.ptr,
                property_refs.len,
            );
        }
    }.call);
}

pub fn hasUnsafeAnyFlow(
    allocator: std.mem.Allocator,
    source_texts: []const []const u8,
    target_texts: []const []const u8,
) !bool {
    return withDualRefs(allocator, source_texts, target_texts, struct {
        fn call(source_refs: []c.CorsaStrRef, target_refs: []c.CorsaStrRef) bool {
            return c.corsa_utils_has_unsafe_any_flow(
                if (source_refs.len == 0) null else source_refs.ptr,
                source_refs.len,
                if (target_refs.len == 0) null else target_refs.ptr,
                target_refs.len,
            );
        }
    }.call);
}

pub fn isUnsafeAssignment(
    allocator: std.mem.Allocator,
    source_texts: []const []const u8,
    target_texts: []const []const u8,
) !bool {
    return withDualRefs(allocator, source_texts, target_texts, struct {
        fn call(source_refs: []c.CorsaStrRef, target_refs: []c.CorsaStrRef) bool {
            return c.corsa_utils_is_unsafe_assignment(
                if (source_refs.len == 0) null else source_refs.ptr,
                source_refs.len,
                if (target_refs.len == 0) null else target_refs.ptr,
                target_refs.len,
            );
        }
    }.call);
}

pub fn isUnsafeReturn(
    allocator: std.mem.Allocator,
    source_texts: []const []const u8,
    target_texts: []const []const u8,
) !bool {
    return withDualRefs(allocator, source_texts, target_texts, struct {
        fn call(source_refs: []c.CorsaStrRef, target_refs: []c.CorsaStrRef) bool {
            return c.corsa_utils_is_unsafe_return(
                if (source_refs.len == 0) null else source_refs.ptr,
                source_refs.len,
                if (target_refs.len == 0) null else target_refs.ptr,
                target_refs.len,
            );
        }
    }.call);
}
