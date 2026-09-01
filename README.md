# AI SDK OpenAI namespace repro

Shows `ai@7.0.66` sending a namespace in request 1, then dropping it from the
historical `function_call` in request 2.

## Deterministic reproduction

```sh
npm install
npm test
```

No API key is needed. The test captures both serialized requests:

1. Request 1 correctly sends the tool in the `company_draft_payroll` namespace.
2. The model returns an invalid function call with that namespace.
3. AI SDK stores the namespace as result metadata instead of call metadata.
4. Request 2 replays the function call without its namespace.

```json
{
  "request1ToolNamespace": "company_draft_payroll",
  "response1FunctionCallNamespace": "company_draft_payroll",
  "persistedUICallNamespace": null,
  "persistedUIResultNamespace": "company_draft_payroll",
  "replayedModelCallNamespace": null,
  "request2FunctionCallNamespace": null
}
```

The script exits with status 1 when the bug is reproduced.

## Live OpenAI rejection

```sh
OPENAI_API_KEY=... npm run live
```

This uses hosted `tool_search` and a deferred namespace. Request 1 gets a real,
valid namespaced call from OpenAI. Request 2 keeps its arguments and later user
turn unchanged, but removes the historical call's namespace. OpenAI returns:

```text
400 Missing namespace for function_call 'create_repro_widget'. It does not exist
in the default namespace. Round-trip the model's function_call item with its
namespace field included.
```
