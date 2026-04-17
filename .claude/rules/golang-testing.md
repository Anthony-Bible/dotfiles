---
paths:
  - "**/*_test.go"
---

# Golang Testing Guidelines

When writing tests in Go, focus on robust, maintainable, and idiomatic test suites:

- **Contract-Based Testing:** Always test the **contract** and public behavior of your packages.
  - Avoid testing internal implementation details or unexported fields unless absolutely necessary. This prevents brittle tests that break during refactoring.
  - Focus on verifying that for a given input, the expected output or state change is achieved.
- **Table-Driven Tests:** Utilize table-driven tests for multiple test cases within a single test function.
  - Leverage `t.Run()` for sub-tests to provide clear, actionable failure messages and simplify debugging.
- **Teardown & Cleanup:** Use `t.Cleanup()` for reliable resource cleanup (e.g., closing connections, deleting temporary files, stopping servers). This ensures teardown happens even if the test fails or panics.
- **Time-Dependent Tests:** Use the `testing/synctest` package for tests that involve time (e.g., timeouts, tickers, background loops, or delayed execution).
  - **Virtual Clock:** `synctest` provides a virtual clock and an isolated "bubble" that advances time instantly when all goroutines are blocked. This eliminates the need for flaky `time.Sleep()` calls with real-world durations.
  - **Deterministic Testing:** Use `synctest.Test()` to wrap test logic that depends on time. This ensures that background routines triggered by timers complete before assertions are run.
  - **Instant Execution:** Prefer `synctest` over mocking clock interfaces or using long `time.Sleep()` durations. It allows testing hour-long intervals in milliseconds without refactoring production code.
- **Idiomatic Assertions:** Prefer the standard `testing` package for assertions.
  - Use simple `if got != want { t.Errorf(...) }` for most checks to keep tests idiomatic.
  - Avoid third-party assertion libraries (like `stretchr/testify`) unless they are already the project's established standard.
- **Parallelism:** Explicitly call `t.Parallel()` in tests that do not have shared state to speed up the test suite's execution.
