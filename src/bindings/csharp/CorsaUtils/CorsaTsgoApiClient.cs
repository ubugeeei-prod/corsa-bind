using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Corsa.Utils;

public sealed class CorsaTsgoApiClientOptions
{
    public required string Executable { get; init; }
    public string? Cwd { get; init; }
    public string? Mode { get; init; }
    public ulong? RequestTimeoutMs { get; init; }
    public ulong? ShutdownTimeoutMs { get; init; }
    public int? OutboundCapacity { get; init; }
    public bool? AllowUnstableUpstreamCalls { get; init; }
}

public sealed class CorsaTsgoApiClient : IDisposable
{
    private const string LibraryName = "corsa_ffi";
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private nint _handle;

    [StructLayout(LayoutKind.Sequential)]
    private readonly struct CorsaStrRef(nint ptr, nuint len)
    {
        public readonly nint Ptr = ptr;
        public readonly nuint Len = len;
    }

    [StructLayout(LayoutKind.Sequential)]
    private readonly struct CorsaString
    {
        public readonly nint Ptr;
        public readonly nuint Len;
    }

    [StructLayout(LayoutKind.Sequential)]
    private readonly struct CorsaBytes
    {
        public readonly nint Ptr;
        public readonly nuint Len;
        [MarshalAs(UnmanagedType.I1)]
        public readonly bool Present;
        public readonly CorsaResultStatus Status;
    }

    private enum CorsaResultStatus
    {
        Error = 0,
        None = 1,
        Some = 2,
    }

    [DllImport(LibraryName, EntryPoint = "corsa_error_message_take")]
    private static extern CorsaString TakeErrorMessageNative();
    [DllImport(LibraryName, EntryPoint = "corsa_tsgo_api_client_spawn")]
    private static extern nint SpawnNative(CorsaStrRef optionsJson);
    [DllImport(LibraryName, EntryPoint = "corsa_tsgo_api_client_initialize_json")]
    private static extern CorsaString InitializeJsonNative(nint value);
    [DllImport(LibraryName, EntryPoint = "corsa_tsgo_api_client_parse_config_file_json")]
    private static extern CorsaString ParseConfigFileJsonNative(nint value, CorsaStrRef file);
    [DllImport(LibraryName, EntryPoint = "corsa_tsgo_api_client_update_snapshot_json")]
    private static extern CorsaString UpdateSnapshotJsonNative(nint value, CorsaStrRef paramsJson);
    [DllImport(LibraryName, EntryPoint = "corsa_tsgo_api_client_get_source_file")]
    private static extern CorsaBytes GetSourceFileNative(nint value, CorsaStrRef snapshot, CorsaStrRef project, CorsaStrRef file);
    [DllImport(LibraryName, EntryPoint = "corsa_tsgo_api_client_get_string_type_json")]
    private static extern CorsaString GetStringTypeJsonNative(nint value, CorsaStrRef snapshot, CorsaStrRef project);
    [DllImport(LibraryName, EntryPoint = "corsa_tsgo_api_client_type_to_string")]
    private static extern CorsaString TypeToStringNative(
        nint value,
        CorsaStrRef snapshot,
        CorsaStrRef project,
        CorsaStrRef typeHandle,
        CorsaStrRef location,
        int flags);
    [DllImport(LibraryName, EntryPoint = "corsa_tsgo_api_client_call_json")]
    private static extern CorsaString CallJsonNative(nint value, CorsaStrRef method, CorsaStrRef paramsJson);
    [DllImport(LibraryName, EntryPoint = "corsa_tsgo_api_client_call_binary")]
    private static extern CorsaBytes CallBinaryNative(nint value, CorsaStrRef method, CorsaStrRef paramsJson);
    [DllImport(LibraryName, EntryPoint = "corsa_tsgo_api_client_release_handle")]
    [return: MarshalAs(UnmanagedType.I1)]
    private static extern bool ReleaseHandleNative(nint value, CorsaStrRef handle);
    [DllImport(LibraryName, EntryPoint = "corsa_tsgo_api_client_close")]
    [return: MarshalAs(UnmanagedType.I1)]
    private static extern bool CloseNative(nint value);
    [DllImport(LibraryName, EntryPoint = "corsa_tsgo_api_client_free")]
    private static extern void FreeNative(nint value);
    [DllImport(LibraryName, EntryPoint = "corsa_utils_string_free")]
    private static extern void FreeString(CorsaString value);
    [DllImport(LibraryName, EntryPoint = "corsa_bytes_free")]
    private static extern void FreeBytes(CorsaBytes value);

    private CorsaTsgoApiClient(nint handle) => _handle = handle;

    public static CorsaTsgoApiClient Spawn(CorsaTsgoApiClientOptions options) =>
        SpawnJson(JsonSerializer.Serialize(options, JsonOptions));

    public static CorsaTsgoApiClient SpawnJson(string optionsJson)
    {
        using var value = Utf8Input.FromString(optionsJson);
        var handle = SpawnNative(value.Ref);
        return handle == 0 ? throw CreateException() : new CorsaTsgoApiClient(handle);
    }

    public string InitializeJson() => TakeCheckedString(InitializeJsonNative(_handle));

    public string ParseConfigFileJson(string file)
    {
        using var value = Utf8Input.FromString(file);
        return TakeCheckedString(ParseConfigFileJsonNative(_handle, value.Ref));
    }

    public string UpdateSnapshotJson(string? paramsJson = null)
    {
        using var value = Utf8Input.FromString(paramsJson);
        return TakeCheckedString(UpdateSnapshotJsonNative(_handle, value.Ref));
    }

    public byte[]? GetSourceFile(string snapshot, string project, string file)
    {
        using var snapshotValue = Utf8Input.FromString(snapshot);
        using var projectValue = Utf8Input.FromString(project);
        using var fileValue = Utf8Input.FromString(file);
        return TakeOptionalBytes(GetSourceFileNative(_handle, snapshotValue.Ref, projectValue.Ref, fileValue.Ref));
    }

    public string GetStringTypeJson(string snapshot, string project)
    {
        using var snapshotValue = Utf8Input.FromString(snapshot);
        using var projectValue = Utf8Input.FromString(project);
        return TakeCheckedString(GetStringTypeJsonNative(_handle, snapshotValue.Ref, projectValue.Ref));
    }

    public string TypeToString(
        string snapshot,
        string project,
        string typeHandle,
        string? location = null,
        int? flags = null)
    {
        using var snapshotValue = Utf8Input.FromString(snapshot);
        using var projectValue = Utf8Input.FromString(project);
        using var typeValue = Utf8Input.FromString(typeHandle);
        using var locationValue = Utf8Input.FromString(location);
        return TakeCheckedString(TypeToStringNative(
            _handle,
            snapshotValue.Ref,
            projectValue.Ref,
            typeValue.Ref,
            locationValue.Ref,
            flags ?? -1));
    }

    public string CallJson(string method, string? paramsJson = null)
    {
        using var methodValue = Utf8Input.FromString(method);
        using var paramsValue = Utf8Input.FromString(paramsJson);
        return TakeCheckedString(CallJsonNative(_handle, methodValue.Ref, paramsValue.Ref));
    }

    public byte[]? CallBinary(string method, string? paramsJson = null)
    {
        using var methodValue = Utf8Input.FromString(method);
        using var paramsValue = Utf8Input.FromString(paramsJson);
        return TakeOptionalBytes(CallBinaryNative(_handle, methodValue.Ref, paramsValue.Ref));
    }

    public void ReleaseHandle(string handle)
    {
        using var value = Utf8Input.FromString(handle);
        if (!ReleaseHandleNative(_handle, value.Ref))
        {
            throw CreateException();
        }
    }

    public void Close()
    {
        if (_handle == 0)
        {
            return;
        }
        var handle = _handle;
        _handle = 0;
        var ok = CloseNative(handle);
        FreeNative(handle);
        if (!ok)
        {
            throw CreateException();
        }
    }

    public void Dispose()
    {
        if (_handle != 0)
        {
            var handle = _handle;
            _handle = 0;
            _ = CloseNative(handle);
            FreeNative(handle);
        }
        GC.SuppressFinalize(this);
    }

    private static string TakeCheckedString(CorsaString value)
    {
        var text = TakeString(value);
        if (text.Length != 0)
        {
            return text;
        }
        var error = TakeString(TakeErrorMessageNative());
        return error.Length != 0 ? throw new InvalidOperationException(error) : text;
    }

    private static byte[]? TakeOptionalBytes(CorsaBytes value)
    {
        var status = value.Status;
        try
        {
            if (status == CorsaResultStatus.None)
            {
                return null;
            }
            if (status != CorsaResultStatus.Some)
            {
                var error = TakeString(TakeErrorMessageNative());
                return error.Length != 0 ? throw new InvalidOperationException(error) : null;
            }
            if (value.Ptr == 0 || value.Len == 0)
            {
                return [];
            }
            var result = new byte[checked((int)value.Len)];
            Marshal.Copy(value.Ptr, result, 0, result.Length);
            return result;
        }
        finally
        {
            FreeBytes(value);
        }
    }

    private static string TakeString(CorsaString value)
    {
        try
        {
            return value.Ptr == 0 || value.Len == 0
                ? string.Empty
                : unsafe { Encoding.UTF8.GetString((byte*)value.Ptr, checked((int)value.Len)) };
        }
        finally
        {
            FreeString(value);
        }
    }

    private static Exception CreateException()
    {
        var message = TakeString(TakeErrorMessageNative());
        return new InvalidOperationException(message.Length == 0 ? "corsa ffi error" : message);
    }

    private sealed class Utf8Input(nint buffer, nuint length) : IDisposable
    {
        public CorsaStrRef Ref { get; } = new(buffer, length);

        public static Utf8Input FromString(string? value)
        {
            if (string.IsNullOrEmpty(value))
            {
                return new Utf8Input(0, 0);
            }
            var bytes = Encoding.UTF8.GetBytes(value);
            var buffer = Marshal.AllocHGlobal(bytes.Length);
            Marshal.Copy(bytes, 0, buffer, bytes.Length);
            return new Utf8Input(buffer, (nuint)bytes.Length);
        }

        public void Dispose()
        {
            if (buffer != 0)
            {
                Marshal.FreeHGlobal(buffer);
            }
        }
    }
}
