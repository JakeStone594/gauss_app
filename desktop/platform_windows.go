//go:build windows

package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"unsafe"
)

// findBrowser returns Edge or Chrome, whichever is installed — both support --app windows.
func findBrowser() string {
	candidates := []string{
		filepath.Join(os.Getenv("ProgramFiles(x86)"), "Microsoft", "Edge", "Application", "msedge.exe"),
		filepath.Join(os.Getenv("ProgramFiles"), "Microsoft", "Edge", "Application", "msedge.exe"),
		filepath.Join(os.Getenv("ProgramFiles"), "Google", "Chrome", "Application", "chrome.exe"),
		filepath.Join(os.Getenv("ProgramFiles(x86)"), "Google", "Chrome", "Application", "chrome.exe"),
		filepath.Join(os.Getenv("LocalAppData"), "Google", "Chrome", "Application", "chrome.exe"),
	}
	for _, p := range candidates {
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			return p
		}
	}
	return ""
}

func openDefault(url string) {
	_ = exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
}

// The executable is built without a console (-H windowsgui), so messages go through a box.
func messageBox(title, text string, flags uintptr) {
	user32 := syscall.NewLazyDLL("user32.dll")
	proc := user32.NewProc("MessageBoxW")
	t, _ := syscall.UTF16PtrFromString(text)
	c, _ := syscall.UTF16PtrFromString(title)
	proc.Call(0, uintptr(unsafe.Pointer(t)), uintptr(unsafe.Pointer(c)), flags)
}

// holdOpen keeps the server alive while the app runs in a browser tab we cannot watch:
// the message box is modal, so closing it ends the program.
func holdOpen(url string) {
	messageBox("Gauss", "Gauss is open in your browser at "+url+"\n\nClose this box to stop it.", 0x40) // MB_ICONINFORMATION
}

func fatal(msg string) {
	messageBox("Gauss", msg, 0x10) // MB_ICONERROR
	os.Exit(1)
}
