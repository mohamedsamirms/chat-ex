# TODO

- [x] Harden server (`app.py`) to validate incoming socket payloads (allowed types, size limits, reject XSS-like payloads, block “nuke” keywords, restrict file upload URLs/data).
- [x] Add anti-nuke safeguards: block nuclear-keyword messages; basic rate limits.
- [x] Remove client-side XSS sinks: stop using `innerHTML` with user-controlled content; render via DOM nodes + `textContent`.
- [ ] Ensure GIF/file rendering still works safely.
- [ ] Test: attempt XSS payloads via chat; verify nothing executes and messages are blocked.


