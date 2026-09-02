# AI SDK OpenAI namespace repro

Live, synthetic reproduction of a namespace-loss bug in `ai@7.0.66`.

1. Request 1 loads `widget_tools` and OpenAI returns the invalid namespaced call
   `create_widget({})`.
2. AI SDK converts the validation failure to `output-error`, storing the
   namespace in `resultProviderMetadata` instead of `callProviderMetadata`.
3. `convertToModelMessages` replays the call without the namespace.
4. Request 2 fails before OpenAI can answer the next user message.

Request 2 contains this inconsistent history:

```json
[
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

OpenAI returns:

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

The test uses real AI SDK and OpenAI round trips. It uses no mocks, manual
history edits, production data, or production tools.
