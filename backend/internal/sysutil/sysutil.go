// Package sysutil mirrors the Python backend's subprocess helper: run a
// command with a timeout, returning (rc, stripped stdout, stripped stderr),
// with rc 127 for missing binaries and 124 for timeouts.
package sysutil

import (
	"context"
	"errors"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

// Result carries the exit code and trimmed output streams.
type Result struct {
	Code   int
	Stdout string
	Stderr string
}

// Runner executes commands; tests inject fakes.
type Runner interface {
	Run(name string, args []string, timeout time.Duration) Result
}

// RealRunner shells out with exec.CommandContext.
type RealRunner struct{}

// Run executes the command.
func (RealRunner) Run(name string, args []string, timeout time.Duration) Result {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, name, args...)
	var stdout, stderr strings.Builder
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	code := exitCode(err)
	return Result{
		Code:   code,
		Stdout: strings.TrimSpace(stdout.String()),
		Stderr: strings.TrimSpace(stderr.String()),
	}
}

func exitCode(err error) int {
	if err == nil {
		return 0
	}
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		return exitErr.ExitCode()
	}
	if errors.Is(err, exec.ErrNotFound) || errors.Is(err, context.DeadlineExceeded) {
		if errors.Is(err, context.DeadlineExceeded) {
			return 124
		}
		return 127
	}
	// LookError wraps ErrNotFound in newer Go versions.
	var lookErr *exec.Error
	if errors.As(err, &lookErr) {
		return 127
	}
	return 1
}

// Default is the process runner.
var Default Runner = RealRunner{}

// Logf writes a timestamped line to stdout, mirroring the Python log().
func Logf(format string, args ...any) {
	fmt.Printf("[%s] %s\n", time.Now().Format("15:04:05"), fmt.Sprintf(format, args...))
}

// Run executes with the default runner and returns the tuple form the
// handlers use.
func Run(name string, args []string, timeout time.Duration) (int, string, string) {
	r := Default.Run(name, args, timeout)
	return r.Code, r.Stdout, r.Stderr
}
