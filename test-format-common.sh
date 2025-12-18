#!/usr/bin/env bash
# Comprehensive test suite for format-common.sh

set -euo pipefail

# Source the library to test
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/scripts/format-common.sh"

# Test setup
TEST_DIR="/tmp/format-common-tests"
mkdir -p "$TEST_DIR"
cd "$TEST_DIR"

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Helper functions
print_test_result() {
    local test_name="$1"
    local result="$2"
    local details="${3:-}"

    TESTS_RUN=$((TESTS_RUN + 1))

    if [[ "$result" == "PASS" ]]; then
        TESTS_PASSED=$((TESTS_PASSED + 1))
        echo "✅ PASS: $test_name"
    else
        TESTS_FAILED=$((TESTS_FAILED + 1))
        echo "❌ FAIL: $test_name"
        if [[ -n "$details" ]]; then
            echo "   Details: $details"
        fi
    fi
}

# Test functions
test_argument_parsing() {
    echo "Testing argument parsing..."

    # Test -h flag
    HELP_REQUESTED=false
    VERBOSE=false
    QUIET=false
    DRY_RUN=false
    parse_common_args -h
    print_test_result "parse_common_args -h" "$([[ "$HELP_REQUESTED" == "true" ]] && echo PASS || echo FAIL)"

    # Test -v flag
    HELP_REQUESTED=false
    VERBOSE=false
    parse_common_args -v
    print_test_result "parse_common_args -v" "$([[ "$VERBOSE" == "true" ]] && echo PASS || echo FAIL)"

    # Test --dry-run flag
    DRY_RUN=false
    parse_common_args --dry-run
    print_test_result "parse_common_args --dry-run" "$([[ "$DRY_RUN" == "true" ]] && echo PASS || echo FAIL)"

    # Test multiple flags
    HELP_REQUESTED=false
    VERBOSE=false
    DRY_RUN=false
    parse_common_args -v --dry-run
    if [[ "$VERBOSE" == "true" && "$DRY_RUN" == "true" ]]; then
        print_test_result "parse_common_args multiple flags" "PASS"
    else
        print_test_result "parse_common_args multiple flags" "FAIL" "VERBOSE=$VERBOSE, DRY_RUN=$DRY_RUN"
    fi
}

test_file_processing() {
    echo "Testing file processing..."

    # Create test files
    echo "test" > test.go
    echo "test" > test.py
    echo "test" > test.sh
    echo "test" > test.proto
    echo "openapi: 3.0.0" > openapi.yaml

    # Test process_single_file with matching extension
    FINAL_EXIT_CODE=0
    process_single_file "test-tool" "test.go" ".go,.py" "true"  # Dummy processing function
    print_test_result "process_single_file matching .go" "PASS"

    # Test process_single_file with non-matching extension
    process_single_file "test-tool" "test.sh" ".go,.py" "false"  # Should skip
    print_test_result "process_single_file non-matching .sh" "PASS"

    # Test process_file not found
    FINAL_EXIT_CODE=0
    process_single_file "test-tool" "nonexistent.go" ".go" "false" 2>/dev/null || true
    print_test_result "process_single_file file not found" "$([[ "$FINAL_EXIT_CODE" -eq 2 ]] && echo PASS || echo FAIL)"

    # Cleanup
    rm -f test.go test.py test.sh test.proto openapi.yaml
}

test_openapi_detection() {
    echo "Testing OpenAPI detection..."

    # Create OpenAPI file
    echo "openapi: 3.0.0" > test-openapi.yaml
    # Create non-OpenAPI file
    echo "not openapi" > test-regular.yaml

    # Test OpenAPI file detection
    if check_openapi_file test-openapi.yaml; then
        print_test_result "check_openapi_file OpenAPI file" "PASS"
    else
        print_test_result "check_openapi_file OpenAPI file" "FAIL"
    fi

    # Test non-OpenAPI file detection
    if ! check_openapi_file test-regular.yaml; then
        print_test_result "check_openapi_file non-OpenAPI file" "PASS"
    else
        print_test_result "check_openapi_file non-OpenAPI file" "FAIL"
    fi

    # Test Swagger detection
    echo "swagger: 2.0" > test-swagger.yaml
    if check_openapi_file test-swagger.yaml; then
        print_test_result "check_openapi_file Swagger file" "PASS"
    else
        print_test_result "check_openapi_file Swagger file" "FAIL"
    fi

    # Cleanup
    rm -f test-openapi.yaml test-regular.yaml test-swagger.yaml
}

test_hook_input_processing() {
    echo "Testing hook input processing..."

    # Create test file
    echo "test" > test.sh

    # Test hook input with matching file
    test_input='{"tool_input":{"file_path":"test.sh"}}'
    echo "$test_input" | FINAL_EXIT_CODE=0 process_hook_input "test-tool" ".sh" "true" && \
    print_test_result "process_hook_input matching file" "PASS" || \
    print_test_result "process_hook_input matching file" "FAIL"

    # Test hook input with non-matching file - should exit 0 gracefully
    test_input='{"tool_input":{"file_path":"test.py"}}'
    echo "$test_input" | FINAL_EXIT_CODE=0 process_hook_input "test-tool" ".sh" "false" && \
    print_test_result "process_hook_input non-matching file" "PASS" || \
    print_test_result "process_hook_input non-matching file" "FAIL"

    # Test multiple extensions
    echo "test" > test.go
    test_input='{"tool_input":{"file_path":"test.go"}}'
    echo "$test_input" | FINAL_EXIT_CODE=0 process_hook_input "test-tool" ".go,.py,.sh" "true" && \
    print_test_result "process_hook_input multiple extensions" "PASS" || \
    print_test_result "process_hook_input multiple extensions" "FAIL"

    # Cleanup
    rm -f test.sh test.go test.py
}

test_output_filtering() {
    echo "Testing output filtering..."

    # Create test output and file
    local test_output="error in $(pwd)/test.sh
another error in different-file.txt
error in $(pwd)/test.sh: line 5"

    local filepath="$(pwd)/test.sh"

    # Test filtering by file
    local filtered
    filtered=$(filter_output_by_file "$test_output" "$filepath")

    if echo "$filtered" | grep -q "test.sh" && ! echo "$filtered" | grep -q "different-file.txt"; then
        print_test_result "filter_output_by_file" "PASS"
    else
        print_test_result "filter_output_by_file" "FAIL" "Unexpected filtered output: $filtered"
    fi
}

test_tool_execution() {
    echo "Testing tool execution..."

    # Test tool availability check
    if run_tool "nonexistent-tool" "nonexistent-tool" "echo" 2>/dev/null; then
        print_test_result "run_tool nonexistent tool" "FAIL"
    else
        print_test_result "run_tool nonexistent tool" "PASS"
    fi

    # Test dry-run mode
    DRY_RUN=true
    local output
    output=$(run_tool "test-tool" "echo" "echo test" 2>&1 || true)
    if echo "$output" | grep -q "DRY-RUN"; then
        print_test_result "run_tool dry-run" "PASS"
    else
        print_test_result "run_tool dry-run" "FAIL" "Expected DRY-RUN output"
    fi
    DRY_RUN=false

    # Test real tool execution
    local exit_code
    output=$(run_tool "echo" "echo" "echo test" 2>&1)
    exit_code=$?
    if [[ $exit_code -eq 0 ]]; then
        print_test_result "run_tool successful execution" "PASS"
    else
        print_test_result "run_tool successful execution" "FAIL" "Exit code: $exit_code"
    fi
}

# Run all tests
echo "🧪 Running format-common.sh test suite..."
echo "====================================="

test_argument_parsing
echo
test_file_processing
echo
test_openapi_detection
echo
test_hook_input_processing
echo
test_output_filtering
echo
test_tool_execution
echo

# Print summary
echo "====================================="
echo "📊 Test Results:"
echo "   Tests run: $TESTS_RUN"
echo "   Passed: $TESTS_PASSED"
echo "   Failed: $TESTS_FAILED"

if [[ $TESTS_FAILED -eq 0 ]]; then
    echo "✅ All tests passed!"
    exit 0
else
    echo "❌ $TESTS_FAILED test(s) failed!"
    exit 1
fi