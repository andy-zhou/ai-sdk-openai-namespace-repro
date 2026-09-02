# AI SDK OpenAI namespace repro

Live synthetic reproduction of `ai@7.0.66` dropping a function-call namespace
between two OpenAI requests. All names and data are fictional.

The scenario uses a deferred `widget_tools.create_widget` function whose schema
requires `widgetData` and `widgetType`:

1. Request 1 sends the `widget_tools` namespace.
2. OpenAI returns an invalid `create_widget({})` call with
   `namespace: "widget_tools"`.
3. Local validation fails, and the UI-message round trip stores the namespace as
   result metadata instead of call metadata.
4. Request 2 replays the historical function call without `namespace`.
5. OpenAI rejects the request before answering the next user turn.

Relevant request-2 history (reasoning items omitted):

```json
[
  {
    "role": "user",
    "content": "Use tool search to load create_widget, then call it with exactly {}."
  },
  { "type": "tool_search_call" },
  {
    "type": "tool_search_output",
    "tools": [{ "type": "namespace", "name": "widget_tools" }]
  },
  {
    "type": "function_call",
    "name": "create_widget",
    "arguments": "{}"
  },
  { "type": "function_call_output", "output": "input validation failed" },
  { "role": "user", "content": "Now answer continued." }
]
```

The `tool_search_output` still says the function belongs to `widget_tools`, but
the historical `function_call` no longer carries that namespace. OpenAI returns:

```text
400 Missing namespace for function_call 'create_widget'. It does not exist in
the default namespace. Round-trip the model's function_call item with its
namespace field included.
```

## Run

```sh
npm install
OPENAI_API_KEY=... npm test
```

The script performs the complete flow through AI SDK and OpenAI. It does not use
mocks or manually edit the history: the namespace is lost by the real
UI-message round trip before AI SDK serializes request 2.
