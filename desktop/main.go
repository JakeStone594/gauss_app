// Gauss for the desktop: one executable that carries the web app (web/) and shows it.
//
// It serves the embedded files on 127.0.0.1 and opens them in a chromeless browser window
// (Edge or Chrome in "app mode"), or in the default browser if neither is installed, and exits
// when that window closes. Nothing is sent anywhere: the server listens on the loopback address
// only, and the mathematics runs inside the page (web/engine.js).
//
//	gauss.exe                 open the app
//	gauss.exe --port 8765     listen on a fixed port instead of a free one
//	gauss.exe --no-browser    only serve, print the address (for testing); Ctrl+C stops it
//	gauss.exe --version
package main

import (
	"embed"
	"flag"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
)

//go:embed web
var webFS embed.FS

// Set by tools/build-windows.sh through -ldflags "-X main.version=…".
var version = "dev"

func main() {
	port := flag.Int("port", 0, "port to listen on (default: any free port)")
	noBrowser := flag.Bool("no-browser", false, "only start the server and print its address")
	showVersion := flag.Bool("version", false, "print the version and exit")
	flag.Parse()
	if *showVersion {
		fmt.Println("Gauss", version)
		return
	}

	sub, err := fs.Sub(webFS, "web")
	if err != nil {
		fatal("the embedded app files are missing: " + err.Error())
	}
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", *port))
	if err != nil {
		fatal(fmt.Sprintf("cannot listen on 127.0.0.1:%d — %v", *port, err))
	}
	url := fmt.Sprintf("http://127.0.0.1:%d/", ln.Addr().(*net.TCPAddr).Port)
	srv := &http.Server{Handler: noStore(http.FileServer(http.FS(sub)))}
	go srv.Serve(ln)
	fmt.Println("Gauss", version, "at", url)

	if *noBrowser {
		waitForInterrupt()
		return
	}
	if cmd := appWindow(url); cmd != nil {
		cmd.Wait() // the window is the app: when it closes, so does the server
		return
	}
	openDefault(url)
	holdOpen(url)
}

// noStore keeps a browser from showing a stale copy after the executable is updated.
func noStore(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		h.ServeHTTP(w, r)
	})
}

// appWindow opens url in a chromeless browser window and returns its process, or nil when
// no suitable browser is installed. The window gets a profile of its own under the temp
// directory, which also guarantees it runs as its own process — so Wait() really returns when
// the window closes, instead of when the browser hands the URL to an instance already running.
func appWindow(url string) *exec.Cmd {
	exe := findBrowser()
	if exe == "" {
		return nil
	}
	profile := filepath.Join(os.TempDir(), "gauss-app-browser")
	cmd := exec.Command(exe,
		"--app="+url, "--window-size=1180,900", "--user-data-dir="+profile,
		"--no-first-run", "--no-default-browser-check", "--disable-features=Translate")
	if err := cmd.Start(); err != nil {
		return nil
	}
	return cmd
}

func waitForInterrupt() {
	c := make(chan os.Signal, 1)
	signal.Notify(c, os.Interrupt)
	<-c
}
