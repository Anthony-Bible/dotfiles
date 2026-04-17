---
paths:
  - "**/*.go"
---

# Golang Core Guidelines

When writing Go code, follow these foundational standards to ensure idiomatic, safe, and performant systems:

- **Error Handling**: 
  - Always check errors immediately.
  - Wrap errors with context using `fmt.Errorf("...: %w", err)`.
  - Use `errors.Is` and `errors.As` for error comparisons.
- **Concurrency & Context**: 
  - Always pass `context.Context` to functions performing I/O or long-running operations.
  - Never leak goroutines; ensure they have a clear termination path.
  - Prefer `sync.Mutex` or `sync.RWMutex` for simple shared state.
- **Interfaces**: "Accept interfaces, return structs". 
  - Define interfaces in the package where they are *consumed*, not where they are implemented.
- **Collections**: Use `make([]T, 0, cap)` when the final size or capacity is known to avoid reallocations.
- **Resource Management**: Immediately `defer` resource cleanup (e.g., `f.Close()`, `resp.Body.Close()`, `mu.Unlock()`) after a successful acquisition.
- **Project Structure**: 
  - Use `internal/` for packages not intended for public use.
  - Keep `cmd/` for application entry points.
- **Standard Library First**: Prioritize the standard library (e.g., `slices`, `maps`, `cmp`, `os`) over external dependencies whenever possible.
- **Naming**: Use idiomatic Go naming conventions (e.g., `ID` instead of `Id`, `URL` instead of `Url`).
- **Documentation**: All exported types, functions, and variables MUST have descriptive comments in the format `// Name does something...`.
- **Structured Logging**: Use `log/slog` for all application-wide logging.
