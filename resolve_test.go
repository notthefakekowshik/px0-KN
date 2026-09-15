package main

import (
	"testing"
)

func TestHasFile(t *testing.T) {
	ix := NewIndex("/workspace")
	ix.files = []FileEntry{
		{Path: "README.md", Name: "README.md"},
		{Path: "cmd/px0/main.go", Name: "main.go"},
		{Path: "web/app.js", Name: "app.js"},
		{Path: "web/src/state.js", Name: "state.js"},
	}

	if !ix.HasFile("README.md") {
		t.Errorf("expected README.md to be found")
	}
	if !ix.HasFile("web/src/state.js") {
		t.Errorf("expected web/src/state.js to be found")
	}
	if !ix.HasFile("/web/src/state.js") {
		t.Errorf("expected leading slash to be normalized")
	}
	if ix.HasFile("nonexistent.go") {
		t.Errorf("expected nonexistent.go to not be found")
	}
}

func TestResolveImportTarget(t *testing.T) {
	ix := NewIndex("/workspace")
	ix.files = []FileEntry{
		{Path: "README.md", Name: "README.md"},
		{Path: "docs/architecture.md", Name: "architecture.md"},
		{Path: "pkg/models/user.go", Name: "user.go"},
		{Path: "web/app.js", Name: "app.js"},
		{Path: "web/src/cursor.js", Name: "cursor.js"},
		{Path: "web/src/state.js", Name: "state.js"},
		{Path: "web/src/utils/index.js", Name: "index.js"},
	}

	tests := []struct {
		name     string
		from     string
		target   string
		wantOK   bool
		wantPath string
		wantLine int
	}{
		{
			name:     "relative sibling import",
			from:     "web/src/cursor.js",
			target:   "./state.js",
			wantOK:   true,
			wantPath: "web/src/state.js",
		},
		{
			name:     "relative parent import",
			from:     "web/src/cursor.js",
			target:   "../app.js",
			wantOK:   true,
			wantPath: "web/app.js",
		},
		{
			name:     "relative without extension",
			from:     "web/src/cursor.js",
			target:   "./state",
			wantOK:   true,
			wantPath: "web/src/state.js",
		},
		{
			name:     "relative index resolution",
			from:     "web/src/cursor.js",
			target:   "./utils",
			wantOK:   true,
			wantPath: "web/src/utils/index.js",
		},
		{
			name:     "root relative with line number",
			from:     "web/src/cursor.js",
			target:   "docs/architecture.md:42",
			wantOK:   true,
			wantPath: "docs/architecture.md",
			wantLine: 42,
		},
		{
			name:     "markdown anchor with line",
			from:     "README.md",
			target:   "docs/architecture.md#L99",
			wantOK:   true,
			wantPath: "docs/architecture.md",
			wantLine: 99,
		},
		{
			name:     "markdown heading anchor",
			from:     "README.md",
			target:   "docs/architecture.md#design-principles",
			wantOK:   true,
			wantPath: "docs/architecture.md",
			wantLine: 0,
		},
		{
			name:     "quoted target with brackets",
			from:     "README.md",
			target:   `[Architecture](docs/architecture.md)`,
			wantOK:   true,
			wantPath: "docs/architecture.md",
		},
		{
			name:     "ignore external url",
			from:     "README.md",
			target:   "https://github.com/foo/bar",
			wantOK:   false,
		},
		{
			name:     "directory traversal rejection",
			from:     "README.md",
			target:   "../../etc/passwd",
			wantOK:   false,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			res := resolveImportTarget(ix, tc.from, tc.target)
			if res.Found != tc.wantOK {
				t.Fatalf("resolveImportTarget(%q, %q) found = %v, want %v", tc.from, tc.target, res.Found, tc.wantOK)
			}
			if tc.wantOK {
				if res.Path != tc.wantPath {
					t.Errorf("path = %q, want %q", res.Path, tc.wantPath)
				}
				if res.Line != tc.wantLine {
					t.Errorf("line = %d, want %d", res.Line, tc.wantLine)
				}
			}
		})
	}
}

func BenchmarkResolveImportTarget(b *testing.B) {
	ix := &Index{
		files: []FileEntry{
			{Path: "README.md", Name: "README.md"},
			{Path: "docs/architecture.md", Name: "architecture.md"},
			{Path: "web/src/cursor.js", Name: "cursor.js"},
			{Path: "web/src/state.js", Name: "state.js"},
			{Path: "web/src/utils/index.js", Name: "index.js"},
		},
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = resolveImportTarget(ix, "web/src/cursor.js", "./state")
	}
}
