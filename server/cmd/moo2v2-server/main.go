// Command moo2v2-server is the game's standalone server: the generic
// lobbylink lobby (linked in as a library via the lobbyserver package) plus
// moo2v2's play-by-mail endpoints under /pbm/.
//
// Lobby configuration precedence: built-in defaults < --config TOML file
// (lobbylink's full schema) < the CLI flags below. Play by mail is enabled by
// --pbm-config (JSON: {"password", "data_dir", "lock_ttl_seconds"}); without
// it this behaves like the stock p2p-lobby-server.
package main

import (
	"context"
	"flag"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/danielrh/lobbylink/lobbyserver"
	"github.com/danielrh/moo2v2/server/pbm"
)

// version is stamped by the build: -ldflags "-X main.version=...".
var version = "dev"

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "moo2v2-server:", err)
		os.Exit(1)
	}
}

// listFlag accumulates repeatable, comma-separable string flags.
type listFlag []string

func (l *listFlag) String() string { return strings.Join(*l, ",") }
func (l *listFlag) Set(v string) error {
	for _, part := range strings.Split(v, ",") {
		if p := strings.TrimSpace(part); p != "" {
			*l = append(*l, p)
		}
	}
	return nil
}

func run() error {
	fs := flag.NewFlagSet("moo2v2-server", flag.ExitOnError)
	configPath := fs.String("config", "", "path to a lobbylink TOML config file")
	listenHTTP := fs.String("listen-http", "", "plain HTTP listen address, e.g. 127.0.0.1:8787")
	listenHTTPS := fs.String("listen-https", "", "HTTPS listen address, e.g. :4443")
	cert := fs.String("cert", "", "TLS certificate (fullchain.pem)")
	key := fs.String("key", "", "TLS private key (privkey.pem)")
	publicURL := fs.String("public-url", "", "public base URL, e.g. https://example.com:4443")
	var allowedOrigins listFlag
	fs.Var(&allowedOrigins, "allowed-origin", "allowed WebSocket/CORS origin (repeatable or comma-separated)")
	logLevel := fs.String("log-level", "", "debug|info|warn|error")
	pbmConfig := fs.String("pbm-config", "", "enable play-by-mail endpoints: path to a JSON config {password, data_dir, lock_ttl_seconds}")
	showVersion := fs.Bool("version", false, "print version and exit")
	if err := fs.Parse(os.Args[1:]); err != nil {
		return err
	}
	if *showVersion {
		fmt.Println(version)
		return nil
	}

	cfg, err := lobbyserver.LoadConfig(*configPath)
	if err != nil {
		return err
	}
	// Apply only flags the user actually set, so config-file values survive.
	fs.Visit(func(f *flag.Flag) {
		switch f.Name {
		case "listen-http":
			cfg.SetListenHTTP(*listenHTTP)
		case "listen-https", "cert", "key":
			cfg.SetListenHTTPS(*listenHTTPS, *cert, *key)
		case "public-url":
			cfg.SetPublicURL(*publicURL)
		case "allowed-origin":
			cfg.SetAllowedOrigins(allowedOrigins)
		case "log-level":
			cfg.SetLogLevel(*logLevel)
		}
	})

	srv, err := lobbyserver.New(cfg, version)
	if err != nil {
		return err
	}

	root := http.Handler(srv.Handler())
	if *pbmConfig != "" {
		p, err := pbm.Load(*pbmConfig, cfg.AllowedOrigins(), srv.Logger())
		if err != nil {
			return err
		}
		root = p.Wrap(root)
		srv.Logger().Info("play-by-mail enabled", "config", *pbmConfig)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	return srv.Run(ctx, root)
}
