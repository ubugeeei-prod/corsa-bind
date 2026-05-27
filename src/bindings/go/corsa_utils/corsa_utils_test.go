package corsautils

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestUtilsBindings(t *testing.T) {
	if got := ClassifyTypeText("Promise<string> | null"); got != "nullish" {
		t.Fatalf("classify = %q", got)
	}
	split := SplitTypeText("string | Promise<any>")
	if len(split) != 2 || split[1] != "Promise<any>" {
		t.Fatalf("split = %#v", split)
	}
	if !IsErrorLikeTypeTexts([]string{"TypeError"}, nil) {
		t.Fatal("expected error-like detection")
	}
	if !HasUnsafeAnyFlow([]string{"Promise<any>"}, []string{"Promise<string>"}) {
		t.Fatal("expected unsafe any flow detection")
	}
}

func TestVirtualDocumentBindings(t *testing.T) {
	document, err := NewUntitledVirtualDocument("/demo.ts", "typescript", "const value = 1;")
	if err != nil {
		t.Fatalf("new untitled: %v", err)
	}
	defer document.Close()
	if err := document.Splice(0, 14, 0, 15, "2"); err != nil {
		t.Fatalf("splice: %v", err)
	}
	if got := document.Text(); got != "const value = 2;" {
		t.Fatalf("text = %q", got)
	}
	if got := document.Version(); got != 2 {
		t.Fatalf("version = %d", got)
	}
}

func TestApiClientCheckerPositionBindings(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatalf("workspace root: %v", err)
	}
	binary := filepath.Join(root, "target", "debug", "mock_corsa")
	if _, err := os.Stat(binary); err != nil {
		t.Skip("mock_corsa binary is not built")
	}
	client, err := NewApiClient(ApiClientOptions{
		Executable: binary,
		Cwd:        root,
		Mode:       ApiModeJSONRPC,
	})
	if err != nil {
		t.Fatalf("new api client: %v", err)
	}
	defer client.Close()

	snapshotJSON, err := client.UpdateSnapshotJSON(`{"openProject":"/workspace/tsconfig.json"}`)
	if err != nil {
		t.Fatalf("update snapshot: %v", err)
	}
	var snapshot struct {
		Snapshot string `json:"snapshot"`
		Projects []struct {
			ID string `json:"id"`
		} `json:"projects"`
	}
	if err := json.Unmarshal([]byte(snapshotJSON), &snapshot); err != nil {
		t.Fatalf("decode snapshot: %v", err)
	}
	project := snapshot.Projects[0].ID

	typeJSON, err := client.GetTypeAtPositionJSON(snapshot.Snapshot, project, "/workspace/src/index.ts", 1)
	if err != nil {
		t.Fatalf("get type at position: %v", err)
	}
	var typ struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal([]byte(typeJSON), &typ); err != nil {
		t.Fatalf("decode type: %v", err)
	}
	if typ.ID != "t0000000000000001" {
		t.Fatalf("type id = %q", typ.ID)
	}

	symbolJSON, err := client.GetSymbolAtPositionJSON(snapshot.Snapshot, project, "/workspace/src/index.ts", 1)
	if err != nil {
		t.Fatalf("get symbol at position: %v", err)
	}
	var symbol struct {
		Name string `json:"name"`
	}
	if err := json.Unmarshal([]byte(symbolJSON), &symbol); err != nil {
		t.Fatalf("decode symbol: %v", err)
	}
	if symbol.Name != "value" {
		t.Fatalf("symbol name = %q", symbol.Name)
	}
}

func TestApiClientTypeArgumentsBinding(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatalf("workspace root: %v", err)
	}
	binary := filepath.Join(root, "target", "debug", "mock_corsa")
	if _, err := os.Stat(binary); err != nil {
		t.Skip("mock_corsa binary is not built")
	}
	client, err := NewApiClient(ApiClientOptions{
		Executable: binary,
		Cwd:        root,
		Mode:       ApiModeJSONRPC,
	})
	if err != nil {
		t.Fatalf("new api client: %v", err)
	}
	defer client.Close()

	snapshotJSON, err := client.UpdateSnapshotJSON(`{"openProject":"/workspace/tsconfig.json"}`)
	if err != nil {
		t.Fatalf("update snapshot: %v", err)
	}
	var snapshot struct {
		Snapshot string `json:"snapshot"`
		Projects []struct {
			ID string `json:"id"`
		} `json:"projects"`
	}
	if err := json.Unmarshal([]byte(snapshotJSON), &snapshot); err != nil {
		t.Fatalf("decode snapshot: %v", err)
	}
	project := snapshot.Projects[0].ID

	stringTypeJSON, err := client.GetStringTypeJSON(snapshot.Snapshot, project)
	if err != nil {
		t.Fatalf("get string type: %v", err)
	}
	var stringType struct {
		ID          string `json:"id"`
		ObjectFlags uint32 `json:"objectFlags"`
	}
	if err := json.Unmarshal([]byte(stringTypeJSON), &stringType); err != nil {
		t.Fatalf("decode string type: %v", err)
	}

	nonReferenceJSON, err := client.GetTypeArgumentsJSON(snapshot.Snapshot, project, stringType.ID, stringType.ObjectFlags)
	if err != nil {
		t.Fatalf("get non-reference type arguments: %v", err)
	}
	var nonReference []any
	if err := json.Unmarshal([]byte(nonReferenceJSON), &nonReference); err != nil {
		t.Fatalf("decode non-reference type arguments: %v", err)
	}
	if len(nonReference) != 0 {
		t.Fatalf("non-reference type arguments = %#v", nonReference)
	}

	referenceJSON, err := client.GetTypeArgumentsJSON(snapshot.Snapshot, project, stringType.ID, 1<<2)
	if err != nil {
		t.Fatalf("get reference type arguments: %v", err)
	}
	var reference []struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal([]byte(referenceJSON), &reference); err != nil {
		t.Fatalf("decode reference type arguments: %v", err)
	}
	if len(reference) != 1 || reference[0].ID != "t0000000000000001" {
		t.Fatalf("reference type arguments = %#v", reference)
	}
}

func TestApiClientSymbolTypeBindings(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatalf("workspace root: %v", err)
	}
	binary := filepath.Join(root, "target", "debug", "mock_corsa")
	if _, err := os.Stat(binary); err != nil {
		t.Skip("mock_corsa binary is not built")
	}
	client, err := NewApiClient(ApiClientOptions{
		Executable: binary,
		Cwd:        root,
		Mode:       ApiModeJSONRPC,
	})
	if err != nil {
		t.Fatalf("new api client: %v", err)
	}
	defer client.Close()

	snapshotJSON, err := client.UpdateSnapshotJSON(`{"openProject":"/workspace/tsconfig.json"}`)
	if err != nil {
		t.Fatalf("update snapshot: %v", err)
	}
	var snapshot struct {
		Snapshot string `json:"snapshot"`
		Projects []struct {
			ID string `json:"id"`
		} `json:"projects"`
	}
	if err := json.Unmarshal([]byte(snapshotJSON), &snapshot); err != nil {
		t.Fatalf("decode snapshot: %v", err)
	}
	project := snapshot.Projects[0].ID

	symbolJSON, err := client.GetSymbolAtPositionJSON(snapshot.Snapshot, project, "/workspace/src/index.ts", 1)
	if err != nil {
		t.Fatalf("get symbol at position: %v", err)
	}
	var symbol struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	if err := json.Unmarshal([]byte(symbolJSON), &symbol); err != nil {
		t.Fatalf("decode symbol: %v", err)
	}
	if symbol.Name != "value" {
		t.Fatalf("symbol name = %q", symbol.Name)
	}

	symbolTypeJSON, err := client.GetTypeOfSymbolJSON(snapshot.Snapshot, project, symbol.ID)
	if err != nil {
		t.Fatalf("get type of symbol: %v", err)
	}
	var symbolType struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal([]byte(symbolTypeJSON), &symbolType); err != nil {
		t.Fatalf("decode symbol type: %v", err)
	}
	if symbolType.ID != "t0000000000000001" {
		t.Fatalf("symbol type id = %q", symbolType.ID)
	}

	declaredTypeJSON, err := client.GetDeclaredTypeOfSymbolJSON(snapshot.Snapshot, project, symbol.ID)
	if err != nil {
		t.Fatalf("get declared type of symbol: %v", err)
	}
	var declaredType struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal([]byte(declaredTypeJSON), &declaredType); err != nil {
		t.Fatalf("decode declared type: %v", err)
	}
	if declaredType.ID != "t0000000000000001" {
		t.Fatalf("declared type id = %q", declaredType.ID)
	}
}
