package main

import (
	"path/filepath"
	"strconv"
	"strings"
)

type ResolveResult struct {
	Found bool   `json:"found"`
	Path  string `json:"path,omitempty"`
	Line  int    `json:"line,omitempty"`
}

var probeExts = []string{
	".js", ".ts", ".tsx", ".jsx", ".mjs", ".cjs",
	".go", ".py", ".rs", ".java", ".c", ".h", ".cpp", ".hpp", ".cc",
	".json", ".css", ".html", ".md", ".yaml", ".yml",
}

var probeIndexes = []string{
	"/index.js", "/index.ts", "/index.tsx", "/index.jsx",
	"/__init__.py", "/main.go", "/mod.rs",
}

// resolveTarget attempts to resolve a referenced path from a source file into
// an indexed workspace path.
func resolveTarget(ix *Index, fromRel, target string) ResolveResult {
	target = strings.TrimSpace(target)
	if idx := strings.Index(target, "]("); idx >= 0 {
		target = strings.TrimSuffix(target[idx+2:], ")")
	}
	target = strings.Trim(target, `"'`+"`"+`<>()[]`)
	target = strings.TrimSpace(target)
	if target == "" || strings.HasPrefix(target, "http://") || strings.HasPrefix(target, "https://") || strings.HasPrefix(target, "mailto:") {
		return ResolveResult{Found: false}
	}

	line := 0
	// Extract line reference if present, e.g. "foo/bar.go:42" or "foo/bar.md#L42"
	if idx := strings.LastIndexByte(target, ':'); idx > 0 {
		if l, err := strconv.Atoi(target[idx+1:]); err == nil && l > 0 {
			line = l
			target = target[:idx]
		}
	} else if idx := strings.LastIndex(target, "#L"); idx > 0 {
		if l, err := strconv.Atoi(target[idx+2:]); err == nil && l > 0 {
			line = l
			target = target[:idx]
		}
	} else if idx := strings.LastIndexByte(target, '#'); idx > 0 {
		// Drop heading anchor if not a line number, e.g. "README.md#installation"
		target = target[:idx]
	}

	target = filepath.ToSlash(filepath.Clean(target))
	target = strings.TrimPrefix(target, "/")

	fromDir := ""
	if fromRel != "" {
		fromDir = filepath.ToSlash(filepath.Dir(fromRel))
		if fromDir == "." {
			fromDir = ""
		}
	}

	var candidates []string
	if strings.HasPrefix(target, "./") || strings.HasPrefix(target, "../") {
		// Strictly relative to fromDir
		p := target
		if fromDir != "" {
			p = fromDir + "/" + target
		}
		candidates = append(candidates, filepath.ToSlash(filepath.Clean(p)))
	} else {
		// Try relative to fromDir first (e.g. #include "utils.h" or import "./sub")
		if fromDir != "" {
			candidates = append(candidates, filepath.ToSlash(filepath.Clean(fromDir+"/"+target)))
		}
		// Then try workspace-root relative (e.g. docs/guide.md or web/style.css)
		candidates = append(candidates, target)
	}

	for _, cand := range candidates {
		cand = strings.TrimPrefix(cand, "/")
		if cand == "" || strings.HasPrefix(cand, "..") {
			continue
		}
		// 1. Direct match
		if ix.HasFile(cand) {
			return ResolveResult{Found: true, Path: cand, Line: line}
		}
		// 2. Extension probes
		for _, ext := range probeExts {
			withExt := cand + ext
			if ix.HasFile(withExt) {
				return ResolveResult{Found: true, Path: withExt, Line: line}
			}
		}
		// 3. Directory index probes
		for _, idxFile := range probeIndexes {
			withIndex := cand + idxFile
			if ix.HasFile(withIndex) {
				return ResolveResult{Found: true, Path: withIndex, Line: line}
			}
		}
	}

	return ResolveResult{Found: false}
}
