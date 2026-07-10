package pbm

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func newTestServer(t *testing.T) (*Server, *httptest.Server, *time.Time) {
	t.Helper()
	now := time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC)
	s := New("hunter2", t.TempDir(), 2*time.Minute, []string{"http://localhost:5173"}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	s.SetNow(func() time.Time { return now })
	ts := httptest.NewServer(s.Wrap(http.NotFoundHandler()))
	t.Cleanup(ts.Close)
	return s, ts, &now
}

func call(t *testing.T, method, url, token string, body any) (*http.Response, map[string]any) {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&buf).Encode(body); err != nil {
			t.Fatal(err)
		}
	}
	req, err := http.NewRequest(method, url, &buf)
	if err != nil {
		t.Fatal(err)
	}
	if token != "" {
		req.Header.Set("X-PBM-Auth", token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var out map[string]any
	raw, _ := io.ReadAll(resp.Body)
	_ = json.Unmarshal(raw, &out)
	return resp, out
}

func login(t *testing.T, ts *httptest.Server) string {
	t.Helper()
	resp, out := call(t, "POST", ts.URL+"/pbm/login", "", map[string]string{"password": "hunter2"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("login: %d", resp.StatusCode)
	}
	return out["token"].(string)
}

func TestLoginAndAuth(t *testing.T) {
	_, ts, _ := newTestServer(t)

	resp, _ := call(t, "POST", ts.URL+"/pbm/login", "", map[string]string{"password": "wrong"})
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("wrong password: got %d, want 403", resp.StatusCode)
	}

	resp, out := call(t, "POST", ts.URL+"/pbm/login", "", map[string]string{"password": "hunter2"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("login: got %d, want 200", resp.StatusCode)
	}
	token := out["token"].(string)
	if token == "" {
		t.Fatal("no token")
	}
	// the cookie is set for same-origin clients
	found := false
	for _, c := range resp.Cookies() {
		if c.Name == "pbm_auth" && c.Value == token {
			found = true
		}
	}
	if !found {
		t.Fatal("pbm_auth cookie not set")
	}

	// endpoints refuse without a token, work with the header
	resp, _ = call(t, "GET", ts.URL+"/pbm/rooms", "", nil)
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("no token: got %d, want 401", resp.StatusCode)
	}
	resp, _ = call(t, "GET", ts.URL+"/pbm/rooms", token, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("with token: got %d, want 200", resp.StatusCode)
	}
}

func TestUploadDownloadRoundtrip(t *testing.T) {
	_, ts, _ := newTestServer(t)
	token := login(t, ts)
	save := base64.StdEncoding.EncodeToString([]byte("MOO2SAVE-binary-bytes"))

	// first upload creates the room (no lock needed) and grants the lock
	resp, _ := call(t, "POST", ts.URL+"/pbm/rooms/GAME1/save", token, map[string]any{
		"name": "alice", "save": save, "turn": 5, "committed": []int{0},
		"players": []map[string]any{{"id": 0, "name": "alice"}, {"id": 1, "name": "bob"}},
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("create upload: got %d", resp.StatusCode)
	}

	resp, out := call(t, "GET", ts.URL+"/pbm/rooms/GAME1", token, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("download: got %d", resp.StatusCode)
	}
	if out["save"].(string) != save {
		t.Fatal("save bytes did not roundtrip")
	}
	meta := out["meta"].(map[string]any)
	if meta["turn"].(float64) != 5 || meta["updatedBy"].(string) != "alice" {
		t.Fatalf("bad meta: %v", meta)
	}
	if lock := out["lock"].(map[string]any); lock["holder"].(string) != "alice" {
		t.Fatalf("creator should hold the lock: %v", out["lock"])
	}

	// bob cannot upload while alice holds the lock
	resp, _ = call(t, "POST", ts.URL+"/pbm/rooms/GAME1/save", token, map[string]any{
		"name": "bob", "save": save, "turn": 5, "committed": []int{0, 1},
	})
	if resp.StatusCode != http.StatusLocked {
		t.Fatalf("upload without lock: got %d, want 423", resp.StatusCode)
	}

	// rooms list shows the game
	resp2, _ := call(t, "GET", ts.URL+"/pbm/rooms", token, nil)
	if resp2.StatusCode != http.StatusOK {
		t.Fatalf("rooms: got %d", resp2.StatusCode)
	}

	resp, _ = call(t, "GET", ts.URL+"/pbm/rooms/NOPE", token, nil)
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("missing room: got %d, want 404", resp.StatusCode)
	}
}

func TestLockLifecycle(t *testing.T) {
	_, ts, now := newTestServer(t)
	token := login(t, ts)

	// alice takes the lock; bob is told who has it
	resp, _ := call(t, "POST", ts.URL+"/pbm/rooms/GAME2/lock", token, map[string]string{"name": "alice"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("lock: got %d", resp.StatusCode)
	}
	resp, out := call(t, "POST", ts.URL+"/pbm/rooms/GAME2/lock", token, map[string]string{"name": "bob"})
	if resp.StatusCode != http.StatusLocked {
		t.Fatalf("second lock: got %d, want 423", resp.StatusCode)
	}
	if out["holder"].(string) != "alice" {
		t.Fatalf("holder: %v", out["holder"])
	}

	// alice renews (heartbeat); release frees it for bob
	resp, _ = call(t, "POST", ts.URL+"/pbm/rooms/GAME2/lock", token, map[string]string{"name": "alice"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("renew: got %d", resp.StatusCode)
	}
	resp, _ = call(t, "DELETE", ts.URL+"/pbm/rooms/GAME2/lock", token, map[string]string{"name": "alice"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("unlock: got %d", resp.StatusCode)
	}
	resp, _ = call(t, "POST", ts.URL+"/pbm/rooms/GAME2/lock", token, map[string]string{"name": "bob"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("lock after release: got %d", resp.StatusCode)
	}

	// a vanished player times out: advance the clock past the TTL
	*now = now.Add(3 * time.Minute)
	resp, _ = call(t, "POST", ts.URL+"/pbm/rooms/GAME2/lock", token, map[string]string{"name": "carol"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("lock after expiry: got %d", resp.StatusCode)
	}
}

func TestSeatProtection(t *testing.T) {
	_, ts, _ := newTestServer(t)
	token := login(t, ts)

	resp, _ := call(t, "POST", ts.URL+"/pbm/rooms/GAME3/protect", token,
		map[string]string{"playerName": "Alice", "password": "sekrit"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("protect: got %d", resp.StatusCode)
	}

	// locking to play Alice requires her password (honor-level check)
	resp, _ = call(t, "POST", ts.URL+"/pbm/rooms/GAME3/lock", token,
		map[string]string{"name": "mallory", "playerName": "alice", "playerPassword": "guess"})
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("wrong seat password: got %d, want 403", resp.StatusCode)
	}
	resp, _ = call(t, "POST", ts.URL+"/pbm/rooms/GAME3/lock", token,
		map[string]string{"name": "alice", "playerName": "Alice", "playerPassword": "sekrit"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("right seat password: got %d", resp.StatusCode)
	}

	// changing the password needs the old one
	resp, _ = call(t, "POST", ts.URL+"/pbm/rooms/GAME3/protect", token,
		map[string]string{"playerName": "alice", "password": "new", "oldPassword": "wrong"})
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("change with wrong old: got %d, want 403", resp.StatusCode)
	}
	resp, _ = call(t, "POST", ts.URL+"/pbm/rooms/GAME3/protect", token,
		map[string]string{"playerName": "alice", "password": "", "oldPassword": "sekrit"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("clear with right old: got %d", resp.StatusCode)
	}
	// unprotected again: any lock succeeds
	resp, _ = call(t, "DELETE", ts.URL+"/pbm/rooms/GAME3/lock", token, map[string]string{"name": "alice"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("unlock: got %d", resp.StatusCode)
	}
	resp, _ = call(t, "POST", ts.URL+"/pbm/rooms/GAME3/lock", token,
		map[string]string{"name": "bob", "playerName": "alice", "playerPassword": ""})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("lock after clearing protection: got %d", resp.StatusCode)
	}
}

func TestBadRoomCode(t *testing.T) {
	_, ts, _ := newTestServer(t)
	token := login(t, ts)
	resp, _ := call(t, "GET", ts.URL+"/pbm/rooms/..%2Fetc", token, nil)
	if resp.StatusCode != http.StatusBadRequest && resp.StatusCode != http.StatusNotFound {
		t.Fatalf("traversal code: got %d, want 400/404", resp.StatusCode)
	}
}
