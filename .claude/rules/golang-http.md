---
paths:
  - "**/*.go"
---

# Golang HTTP Guidelines

When building web servers or HTTP clients in Go, adhere to the following standards:

- **Routing (Go 1.22+):** Always use the enhanced `net/http` multiplexer syntax.
  - Define methods and path parameters directly in `HandleFunc`: `mux.HandleFunc("GET /users/{id}", handleGetUser)`.
  - Avoid third-party routers (like `gorilla/mux`, `chi`, or `httprouter`) unless specific features are required that the standard library does not support.
- **Framework Minimalism:** Do not use heavy web frameworks (e.g., Gin, Echo, Fiber) for new services unless explicitly requested. The standard library is powerful enough for most use cases.
- **Middleware:** Implement middleware using the standard `func(http.Handler) http.Handler` pattern to maintain ecosystem compatibility.
- **Production-Ready Servers:** Always configure explicit timeouts on `http.Server` (e.g., `ReadHeaderTimeout`, `IdleTimeout`) to prevent resource exhaustion and "slowloris" attacks.
- **Body Management:** Always check for errors when decoding request bodies and close response bodies immediately using `defer`.
- **Status Codes:** Use explicit `http.Status*` constants instead of magic numbers.
- **Error Responses:** Use a consistent error response format (e.g., JSON) and avoid leaking internal error details to the client in production.
