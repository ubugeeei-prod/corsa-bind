package corsautils

/*
#cgo CFLAGS: -I${SRCDIR}/../../c/corsa_ffi/include
#cgo LDFLAGS: -L${SRCDIR}/../../../../target/debug -lcorsa_ffi
#include "corsa_utils.h"
*/
import "C"

import (
	"encoding/json"
	"unsafe"
)

type ApiMode string

const (
	ApiModeJSONRPC ApiMode = "jsonrpc"
	ApiModeMsgpack ApiMode = "msgpack"
)

type ApiClientOptions struct {
	Executable                 string  `json:"executable"`
	Cwd                        string  `json:"cwd,omitempty"`
	Mode                       ApiMode `json:"mode,omitempty"`
	RequestTimeoutMs           uint64  `json:"requestTimeoutMs,omitempty"`
	ShutdownTimeoutMs          uint64  `json:"shutdownTimeoutMs,omitempty"`
	OutboundCapacity           int     `json:"outboundCapacity,omitempty"`
	AllowUnstableUpstreamCalls bool    `json:"allowUnstableUpstreamCalls,omitempty"`
}

type ApiClient struct {
	ptr *C.CorsaTsgoApiClient
}

func NewApiClient(options ApiClientOptions) (*ApiClient, error) {
	optionsJSON, err := json.Marshal(options)
	if err != nil {
		return nil, err
	}
	return NewApiClientFromJSON(string(optionsJSON))
}

func NewApiClientFromJSON(optionsJSON string) (*ApiClient, error) {
	value := newBorrowedString(optionsJSON)
	defer value.free()
	ptr := C.corsa_tsgo_api_client_spawn(value.ref)
	if ptr == nil {
		return nil, takeError()
	}
	return &ApiClient{ptr: ptr}, nil
}

func (value *ApiClient) Close() error {
	if value == nil || value.ptr == nil {
		return nil
	}
	ptr := value.ptr
	value.ptr = nil
	ok := bool(C.corsa_tsgo_api_client_close(ptr))
	C.corsa_tsgo_api_client_free(ptr)
	if !ok {
		return takeError()
	}
	return nil
}

func (value *ApiClient) InitializeJSON() (string, error) {
	return takeCheckedString(C.corsa_tsgo_api_client_initialize_json(value.ptr))
}

func (value *ApiClient) ParseConfigFileJSON(file string) (string, error) {
	fileValue := newBorrowedString(file)
	defer fileValue.free()
	return takeCheckedString(C.corsa_tsgo_api_client_parse_config_file_json(value.ptr, fileValue.ref))
}

func (value *ApiClient) UpdateSnapshotJSON(paramsJSON string) (string, error) {
	paramsValue := newBorrowedString(paramsJSON)
	defer paramsValue.free()
	return takeCheckedString(C.corsa_tsgo_api_client_update_snapshot_json(value.ptr, paramsValue.ref))
}

func (value *ApiClient) GetSourceFile(snapshot string, project string, file string) ([]byte, error) {
	snapshotValue := newBorrowedString(snapshot)
	defer snapshotValue.free()
	projectValue := newBorrowedString(project)
	defer projectValue.free()
	fileValue := newBorrowedString(file)
	defer fileValue.free()
	payload, status := takeBytes(C.corsa_tsgo_api_client_get_source_file(
		value.ptr,
		snapshotValue.ref,
		projectValue.ref,
		fileValue.ref,
	))
	switch status {
	case C.CORSA_RESULT_SOME:
		return payload, nil
	case C.CORSA_RESULT_NONE:
		return nil, nil
	default:
		return nil, takeError()
	}
}

func (value *ApiClient) GetStringTypeJSON(snapshot string, project string) (string, error) {
	snapshotValue := newBorrowedString(snapshot)
	defer snapshotValue.free()
	projectValue := newBorrowedString(project)
	defer projectValue.free()
	return takeCheckedString(C.corsa_tsgo_api_client_get_string_type_json(value.ptr, snapshotValue.ref, projectValue.ref))
}

func (value *ApiClient) GetTypeAtPositionJSON(snapshot string, project string, file string, position uint32) (string, error) {
	snapshotValue := newBorrowedString(snapshot)
	defer snapshotValue.free()
	projectValue := newBorrowedString(project)
	defer projectValue.free()
	fileValue := newBorrowedString(file)
	defer fileValue.free()
	return takeCheckedString(C.corsa_tsgo_api_client_get_type_at_position_json(
		value.ptr,
		snapshotValue.ref,
		projectValue.ref,
		fileValue.ref,
		C.uint32_t(position),
	))
}

func (value *ApiClient) GetSymbolAtPositionJSON(snapshot string, project string, file string, position uint32) (string, error) {
	snapshotValue := newBorrowedString(snapshot)
	defer snapshotValue.free()
	projectValue := newBorrowedString(project)
	defer projectValue.free()
	fileValue := newBorrowedString(file)
	defer fileValue.free()
	return takeCheckedString(C.corsa_tsgo_api_client_get_symbol_at_position_json(
		value.ptr,
		snapshotValue.ref,
		projectValue.ref,
		fileValue.ref,
		C.uint32_t(position),
	))
}

func (value *ApiClient) GetTypeArgumentsJSON(snapshot string, project string, typeHandle string, objectFlags uint32) (string, error) {
	snapshotValue := newBorrowedString(snapshot)
	defer snapshotValue.free()
	projectValue := newBorrowedString(project)
	defer projectValue.free()
	typeValue := newBorrowedString(typeHandle)
	defer typeValue.free()
	return takeCheckedString(C.corsa_tsgo_api_client_get_type_arguments_json(
		value.ptr,
		snapshotValue.ref,
		projectValue.ref,
		typeValue.ref,
		C.uint32_t(objectFlags),
	))
}

func (value *ApiClient) GetTypeOfSymbolJSON(snapshot string, project string, symbol string) (string, error) {
	snapshotValue := newBorrowedString(snapshot)
	defer snapshotValue.free()
	projectValue := newBorrowedString(project)
	defer projectValue.free()
	symbolValue := newBorrowedString(symbol)
	defer symbolValue.free()
	return takeCheckedString(C.corsa_tsgo_api_client_get_type_of_symbol_json(
		value.ptr,
		snapshotValue.ref,
		projectValue.ref,
		symbolValue.ref,
	))
}

func (value *ApiClient) GetDeclaredTypeOfSymbolJSON(snapshot string, project string, symbol string) (string, error) {
	snapshotValue := newBorrowedString(snapshot)
	defer snapshotValue.free()
	projectValue := newBorrowedString(project)
	defer projectValue.free()
	symbolValue := newBorrowedString(symbol)
	defer symbolValue.free()
	return takeCheckedString(C.corsa_tsgo_api_client_get_declared_type_of_symbol_json(
		value.ptr,
		snapshotValue.ref,
		projectValue.ref,
		symbolValue.ref,
	))
}

func (value *ApiClient) TypeToString(snapshot string, project string, typeHandle string, location *string, flags *int32) (string, error) {
	snapshotValue := newBorrowedString(snapshot)
	defer snapshotValue.free()
	projectValue := newBorrowedString(project)
	defer projectValue.free()
	typeValue := newBorrowedString(typeHandle)
	defer typeValue.free()
	locationValue := optionalBorrowedString(location)
	defer locationValue.free()
	nativeFlags := C.int32_t(-1)
	if flags != nil {
		nativeFlags = C.int32_t(*flags)
	}
	return takeCheckedString(C.corsa_tsgo_api_client_type_to_string(
		value.ptr,
		snapshotValue.ref,
		projectValue.ref,
		typeValue.ref,
		locationValue.ref,
		nativeFlags,
	))
}

func (value *ApiClient) CallJSON(method string, paramsJSON string) (string, error) {
	methodValue := newBorrowedString(method)
	defer methodValue.free()
	paramsValue := newBorrowedString(paramsJSON)
	defer paramsValue.free()
	return takeCheckedString(C.corsa_tsgo_api_client_call_json(value.ptr, methodValue.ref, paramsValue.ref))
}

func (value *ApiClient) CallBinary(method string, paramsJSON string) ([]byte, error) {
	methodValue := newBorrowedString(method)
	defer methodValue.free()
	paramsValue := newBorrowedString(paramsJSON)
	defer paramsValue.free()
	payload, status := takeBytes(C.corsa_tsgo_api_client_call_binary(value.ptr, methodValue.ref, paramsValue.ref))
	switch status {
	case C.CORSA_RESULT_SOME:
		return payload, nil
	case C.CORSA_RESULT_NONE:
		return nil, nil
	default:
		return nil, takeError()
	}
}

func (value *ApiClient) ReleaseHandle(handle string) error {
	handleValue := newBorrowedString(handle)
	defer handleValue.free()
	if !bool(C.corsa_tsgo_api_client_release_handle(value.ptr, handleValue.ref)) {
		return takeError()
	}
	return nil
}

func optionalBorrowedString(value *string) borrowedString {
	if value == nil {
		return borrowedString{}
	}
	return newBorrowedString(*value)
}

func takeBytes(value C.CorsaBytes) ([]byte, C.CorsaResultStatus) {
	defer C.corsa_bytes_free(value)
	if value.status != C.CORSA_RESULT_SOME {
		return nil, value.status
	}
	if value.ptr == nil || value.len == 0 {
		return make([]byte, 0), value.status
	}
	return C.GoBytes(unsafe.Pointer(value.ptr), C.int(value.len)), value.status
}

func takeCheckedString(value C.CorsaString) (string, error) {
	text := takeString(value)
	if text != "" {
		return text, nil
	}
	if err := takeError(); err != nil {
		return "", err
	}
	return "", nil
}
