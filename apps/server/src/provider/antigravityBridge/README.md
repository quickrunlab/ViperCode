# ViperCode Antigravity bridge

`vipercode_antigravity_bridge.py` is the Python process ViperCode spawns to
drive the [`google-antigravity`](https://github.com/google-antigravity/antigravity-sdk-python)
SDK. The Node side (`AntigravityDriver`) talks to it over stdio using the
newline-delimited JSON protocol defined in
[`../antigravityBridgeProtocol.ts`](../antigravityBridgeProtocol.ts) and
supervises it via [`../antigravityBridgeProcess.ts`](../antigravityBridgeProcess.ts).

## Protocol

- One JSON object per line. Requests in on **stdin**, events out on **stdout**.
- Diagnostics go to **stderr** only — anything non-protocol on stdout would
  corrupt the stream.
- Requests carry a correlation `id`; the bridge replies with a `response` event
  echoing that `id`.

Implemented without third-party imports:

| Request      | Behavior                                                      |
| ------------ | ------------------------------------------------------------- |
| `initialize` | Returns `{ protocolVersion }`.                                |
| `probe`      | Returns `{ sdkAvailable, sdkVersion, python }` for status UI. |

Session methods lazily import `google.antigravity` and drive the live SDK:

- `start_session`
- `send_turn`
- `interrupt_turn`
- `respond_to_request`
- `respond_to_user_input`
- `read_thread`
- `stop_session`

`rollback_thread` returns a structured unsupported error because the installed
SDK build does not expose checkpoints.

`start_session` accepts `authMode`, `gcpProject`, and `gcpLocation`. The default
auth mode is `google-oauth`, which maps to SDK Vertex/ADC configuration:
`LocalAgentConfig(vertex=True, project=..., location=...)`. `api-key` mode is
available as an explicit fallback and relies on `GEMINI_API_KEY`.

## Requirements

- Python 3.9+ (stdlib only for the transport/probe).
- `pip install google-antigravity` for session functionality (probe reports
  availability without it).

## Manual smoke test

```bash
printf '%s\n' '{"id":"1","type":"initialize"}' '{"id":"2","type":"probe"}' \
  | python vipercode_antigravity_bridge.py
```

Expect two `response` lines on stdout; the `probe` response reports whether the
SDK is importable in the active interpreter.
