const std = @import("std");
const utils = @import("corsa_utils.zig");

pub const c = utils.c;

pub const ApiMode = enum {
    jsonrpc,
    msgpack,
};

pub const SpawnOptions = struct {
    executable: []const u8,
    cwd: ?[]const u8 = null,
    mode: ?ApiMode = null,
    request_timeout_ms: ?u64 = null,
    shutdown_timeout_ms: ?u64 = null,
    outbound_capacity: ?usize = null,
    allow_unstable_upstream_calls: ?bool = null,
};

pub const ApiClient = struct {
    handle: ?*c.CorsaApiClient,

    pub fn spawnJson(options_json: []const u8) !ApiClient {
        return .{
            .handle = c.corsa_api_client_spawn(utils.toRef(options_json)) orelse return error.CorsaFfiError,
        };
    }

    pub fn spawn(allocator: std.mem.Allocator, options: SpawnOptions) !ApiClient {
        const payload = .{
            .executable = options.executable,
            .cwd = options.cwd,
            .mode = if (options.mode) |mode| @tagName(mode) else null,
            .requestTimeoutMs = options.request_timeout_ms,
            .shutdownTimeoutMs = options.shutdown_timeout_ms,
            .outboundCapacity = options.outbound_capacity,
            .allowUnstableUpstreamCalls = options.allow_unstable_upstream_calls,
        };
        const options_json = try std.json.stringifyAlloc(allocator, payload, .{});
        defer allocator.free(options_json);
        return try spawnJson(options_json);
    }

    pub fn deinit(self: *ApiClient) void {
        if (self.handle) |handle| c.corsa_api_client_free(handle);
        self.handle = null;
    }

    pub fn close(self: *ApiClient) !void {
        if (self.handle) |handle| {
            if (!c.corsa_api_client_close(handle)) return error.CorsaFfiError;
            c.corsa_api_client_free(handle);
            self.handle = null;
        }
    }

    pub fn initializeJson(self: ApiClient, allocator: std.mem.Allocator) ![]u8 {
        const value = try utils.takeString(allocator, c.corsa_api_client_initialize_json(self.handle));
        if (value.len == 0) return error.CorsaFfiError;
        return value;
    }

    pub fn parseConfigFileJson(self: ApiClient, allocator: std.mem.Allocator, file: []const u8) ![]u8 {
        const value = try utils.takeString(
            allocator,
            c.corsa_api_client_parse_config_file_json(self.handle, utils.toRef(file)),
        );
        if (value.len == 0) return error.CorsaFfiError;
        return value;
    }

    pub fn updateSnapshotJson(self: ApiClient, allocator: std.mem.Allocator, params_json: ?[]const u8) ![]u8 {
        const value = try utils.takeString(
            allocator,
            c.corsa_api_client_update_snapshot_json(
                self.handle,
                utils.toRef(params_json orelse ""),
            ),
        );
        if (value.len == 0) return error.CorsaFfiError;
        return value;
    }

    pub fn getSourceFile(
        self: ApiClient,
        allocator: std.mem.Allocator,
        snapshot: []const u8,
        project: []const u8,
        file: []const u8,
    ) !?[]u8 {
        return utils.takeOptionalBytes(
            allocator,
            c.corsa_api_client_get_source_file(
                self.handle,
                utils.toRef(snapshot),
                utils.toRef(project),
                utils.toRef(file),
            ),
        );
    }

    pub fn getStringTypeJson(
        self: ApiClient,
        allocator: std.mem.Allocator,
        snapshot: []const u8,
        project: []const u8,
    ) ![]u8 {
        const value = try utils.takeString(
            allocator,
            c.corsa_api_client_get_string_type_json(
                self.handle,
                utils.toRef(snapshot),
                utils.toRef(project),
            ),
        );
        if (value.len == 0) return error.CorsaFfiError;
        return value;
    }

    pub fn getTypeAtPositionJson(
        self: ApiClient,
        allocator: std.mem.Allocator,
        snapshot: []const u8,
        project: []const u8,
        file: []const u8,
        position: u32,
    ) ![]u8 {
        const value = try utils.takeString(
            allocator,
            c.corsa_api_client_get_type_at_position_json(
                self.handle,
                utils.toRef(snapshot),
                utils.toRef(project),
                utils.toRef(file),
                position,
            ),
        );
        if (value.len == 0) return error.CorsaFfiError;
        return value;
    }

    pub fn getSymbolAtPositionJson(
        self: ApiClient,
        allocator: std.mem.Allocator,
        snapshot: []const u8,
        project: []const u8,
        file: []const u8,
        position: u32,
    ) ![]u8 {
        const value = try utils.takeString(
            allocator,
            c.corsa_api_client_get_symbol_at_position_json(
                self.handle,
                utils.toRef(snapshot),
                utils.toRef(project),
                utils.toRef(file),
                position,
            ),
        );
        if (value.len == 0) return error.CorsaFfiError;
        return value;
    }

    pub fn getTypeArgumentsJson(
        self: ApiClient,
        allocator: std.mem.Allocator,
        snapshot: []const u8,
        project: []const u8,
        type_handle: []const u8,
        object_flags: u32,
    ) ![]u8 {
        const value = try utils.takeString(
            allocator,
            c.corsa_api_client_get_type_arguments_json(
                self.handle,
                utils.toRef(snapshot),
                utils.toRef(project),
                utils.toRef(type_handle),
                object_flags,
            ),
        );
        if (value.len == 0) return error.CorsaFfiError;
        return value;
    }

    pub fn getTypeOfSymbolJson(
        self: ApiClient,
        allocator: std.mem.Allocator,
        snapshot: []const u8,
        project: []const u8,
        symbol: []const u8,
    ) ![]u8 {
        const value = try utils.takeString(
            allocator,
            c.corsa_api_client_get_type_of_symbol_json(
                self.handle,
                utils.toRef(snapshot),
                utils.toRef(project),
                utils.toRef(symbol),
            ),
        );
        if (value.len == 0) return error.CorsaFfiError;
        return value;
    }

    pub fn getDeclaredTypeOfSymbolJson(
        self: ApiClient,
        allocator: std.mem.Allocator,
        snapshot: []const u8,
        project: []const u8,
        symbol: []const u8,
    ) ![]u8 {
        const value = try utils.takeString(
            allocator,
            c.corsa_api_client_get_declared_type_of_symbol_json(
                self.handle,
                utils.toRef(snapshot),
                utils.toRef(project),
                utils.toRef(symbol),
            ),
        );
        if (value.len == 0) return error.CorsaFfiError;
        return value;
    }

    pub fn typeToString(
        self: ApiClient,
        allocator: std.mem.Allocator,
        snapshot: []const u8,
        project: []const u8,
        type_handle: []const u8,
        location: ?[]const u8,
        flags: ?i32,
    ) ![]u8 {
        const value = try utils.takeString(
            allocator,
            c.corsa_api_client_type_to_string(
                self.handle,
                utils.toRef(snapshot),
                utils.toRef(project),
                utils.toRef(type_handle),
                utils.toRef(location orelse ""),
                flags orelse -1,
            ),
        );
        if (value.len == 0) return error.CorsaFfiError;
        return value;
    }

    pub fn callJson(
        self: ApiClient,
        allocator: std.mem.Allocator,
        method: []const u8,
        params_json: ?[]const u8,
    ) ![]u8 {
        const value = try utils.takeString(
            allocator,
            c.corsa_api_client_call_json(
                self.handle,
                utils.toRef(method),
                utils.toRef(params_json orelse ""),
            ),
        );
        if (value.len == 0) return error.CorsaFfiError;
        return value;
    }

    pub fn callBinary(
        self: ApiClient,
        allocator: std.mem.Allocator,
        method: []const u8,
        params_json: ?[]const u8,
    ) !?[]u8 {
        return utils.takeOptionalBytes(
            allocator,
            c.corsa_api_client_call_binary(
                self.handle,
                utils.toRef(method),
                utils.toRef(params_json orelse ""),
            ),
        );
    }

    pub fn releaseHandle(self: ApiClient, handle: []const u8) !void {
        if (!c.corsa_api_client_release_handle(self.handle, utils.toRef(handle))) {
            return error.CorsaFfiError;
        }
    }
};

pub fn takeLastError(allocator: std.mem.Allocator) ![]u8 {
    return utils.takeString(allocator, c.corsa_error_message_take());
}
