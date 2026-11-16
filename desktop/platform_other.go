//go:build !windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"runtime"
)

func findBrowser() string {
	for _, name := range []string{"microsoft-edge", "google-chrome", "chromium", "chromium-browser", "brave-browser"} {
		if p, err := exec.LookPath(name); err == nil {
			return p
		}
	}
	return ""
}

func openDefault(url string) {
	if runtime.GOOS == "darwin" {
		_ = exec.Command("open", url).Start()
		return
	}
	_ = exec.Command("xdg-open", url).Start()
}

func holdOpen(url string) {
	fmt.Println("Gauss is open in your browser at", url, "— press Ctrl+C to stop.")
	waitForInterrupt()
}

func fatal(msg string) {
	fmt.Fprintln(os.Stderr, "gauss:", msg)
	os.Exit(1)
}
