#!/bin/bash
# Parallel Test Runner for Nexus
# Runs independent unit tests in parallel for faster feedback

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_DIR="$SCRIPT_DIR/tests"
RESULTS_DIR="/tmp/nexus-test-results-$(date +%s)"
mkdir -p "$RESULTS_DIR"

# Test suites
UNIT_TESTS=(
    "test-api-health.sh"
    "test-database-mode.sh"
    "test-project-crud.sh"
    "test-task-crud.sh"
    "test-auth-flow.sh"
    "test-relay-connectivity.sh"
)

INTEGRATION_TESTS=(
    "test-device-auth-flow.sh"
    "test-task-execution.sh"
    "test-realtime-events.sh"
)

E2E_TESTS=(
    "test-e2e-workflow.sh"
)

# Logging
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

# Run a single test
run_test() {
    local test_file="$1"
    local result_file="$RESULTS_DIR/$test_file.result"

    echo -e "${BLUE}Running:${NC} $test_file"

    if [ -f "$TEST_DIR/$test_file" ]; then
        if bash "$TEST_DIR/$test_file" > "$result_file" 2>&1; then
            echo "PASS" > "$result_file.status"
            echo -e "${GREEN}✓ PASS:${NC} $test_file"
            return 0
        else
            echo "FAIL" > "$result_file.status"
            echo -e "${RED}✗ FAIL:${NC} $test_file"
            return 1
        fi
    else
        echo "SKIP" > "$result_file.status"
        echo -e "${YELLOW}⊘ SKIP:${NC} $test_file (not found)"
        return 0
    fi
}

# Run tests in parallel
run_parallel() {
    local tests=("$@")
    local pids=()

    for test in "${tests[@]}"; do
        run_test "$test" &
        pids+=($!)
    done

    # Wait for all tests to complete
    local failed=0
    for pid in "${pids[@]}"; do
        if ! wait "$pid"; then
            ((failed++))
        fi
    done

    return $failed
}

# Run tests sequentially
run_sequential() {
    local tests=("$@")
    local failed=0

    for test in "${tests[@]}"; do
        if ! run_test "$test"; then
            ((failed++))
        fi
    done

    return $failed
}

# Print summary
print_summary() {
    echo ""
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}Test Summary${NC}"
    echo -e "${BLUE}========================================${NC}"

    local total=0
    local passed=0
    local failed=0
    local skipped=0

    for result in "$RESULTS_DIR"/*.status; do
        if [ -f "$result" ]; then
            ((total++))
            status=$(cat "$result")
            case $status in
                PASS) ((passed++)) ;;
                FAIL) ((failed++)) ;;
                SKIP) ((skipped++)) ;;
            esac
        fi
    done

    echo -e "Total:   $total"
    echo -e "${GREEN}Passed:  $passed${NC}"
    echo -e "${RED}Failed:  $failed${NC}"
    echo -e "${YELLOW}Skipped: $skipped${NC}"

    if [ $failed -gt 0 ]; then
        echo ""
        echo -e "${RED}Failed tests:${NC}"
        for result in "$RESULTS_DIR"/*.status; do
            if [ "$(cat "$result")" = "FAIL" ]; then
                test_name=$(basename "$result" .status)
                echo -e "  - $test_name"
                echo -e "    ${YELLOW}Output:${NC}"
                head -20 "$RESULTS_DIR/$test_name" | sed 's/^/      /'
            fi
        done
    fi

    echo ""
    echo -e "${BLUE}========================================${NC}"

    if [ $failed -gt 0 ]; then
        return 1
    else
        return 0
    fi
}

# Usage
usage() {
    cat <<EOF
Usage: $0 [OPTIONS]

Run Nexus test suites

OPTIONS:
    -u, --unit          Run unit tests only (parallel)
    -i, --integration   Run integration tests only (sequential)
    -e, --e2e           Run end-to-end tests only (sequential)
    -a, --all           Run all tests (default)
    -p, --parallel      Run all tests in parallel (may cause race conditions)
    -s, --sequential    Run all tests sequentially
    -h, --help          Show this help message

EXAMPLES:
    $0                  # Run all tests (unit parallel, integration/e2e sequential)
    $0 --unit           # Run only unit tests in parallel
    $0 --e2e            # Run only end-to-end workflow test
    $0 --sequential     # Run all tests one by one

EOF
}

# Main
main() {
    local mode="all"
    local parallel_mode="smart"  # smart, all, none

    while [[ $# -gt 0 ]]; do
        case $1 in
            -u|--unit)
                mode="unit"
                shift
                ;;
            -i|--integration)
                mode="integration"
                shift
                ;;
            -e|--e2e)
                mode="e2e"
                shift
                ;;
            -a|--all)
                mode="all"
                shift
                ;;
            -p|--parallel)
                parallel_mode="all"
                shift
                ;;
            -s|--sequential)
                parallel_mode="none"
                shift
                ;;
            -h|--help)
                usage
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                usage
                exit 1
                ;;
        esac
    done

    log_info "Nexus Test Runner"
    log_info "Mode: $mode | Parallel: $parallel_mode"
    log_info "Results dir: $RESULTS_DIR"
    echo ""

    local exit_code=0

    case $mode in
        unit)
            log_info "Running unit tests in parallel..."
            if [ "$parallel_mode" = "none" ]; then
                run_sequential "${UNIT_TESTS[@]}" || exit_code=$?
            else
                run_parallel "${UNIT_TESTS[@]}" || exit_code=$?
            fi
            ;;
        integration)
            log_info "Running integration tests sequentially..."
            run_sequential "${INTEGRATION_TESTS[@]}" || exit_code=$?
            ;;
        e2e)
            log_info "Running end-to-end tests..."
            run_sequential "${E2E_TESTS[@]}" || exit_code=$?
            ;;
        all)
            if [ "$parallel_mode" = "all" ]; then
                log_info "Running ALL tests in parallel..."
                run_parallel "${UNIT_TESTS[@]}" "${INTEGRATION_TESTS[@]}" "${E2E_TESTS[@]}" || exit_code=$?
            elif [ "$parallel_mode" = "none" ]; then
                log_info "Running ALL tests sequentially..."
                run_sequential "${UNIT_TESTS[@]}" "${INTEGRATION_TESTS[@]}" "${E2E_TESTS[@]}" || exit_code=$?
            else
                log_info "Running unit tests in parallel, others sequentially..."
                run_parallel "${UNIT_TESTS[@]}" || exit_code=$?
                run_sequential "${INTEGRATION_TESTS[@]}" || ((exit_code+=$?))
                run_sequential "${E2E_TESTS[@]}" || ((exit_code+=$?))
            fi
            ;;
    esac

    print_summary || exit_code=$?

    log_info "Test run complete"
    exit $exit_code
}

main "$@"
