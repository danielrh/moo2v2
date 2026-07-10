module github.com/danielrh/moo2v2/server

go 1.26.4

// lobbylink is linked in as a library through its public lobbyserver package
// (pinned to a published commit, so this module builds standalone).
// Hacking on both repos at once? Point a local workspace at your checkout —
// go.work files are gitignored:
//   go work init . && go work use ../../lobbylink
require github.com/danielrh/lobbylink v0.0.0-20260710025148-97f3efdc88bd

require github.com/coder/websocket v1.8.15 // indirect
