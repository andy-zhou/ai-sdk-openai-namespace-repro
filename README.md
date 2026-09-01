# AI SDK OpenAI namespace repro

Reproduces `ai@7.0.66` sending a namespace in the first OpenAI request, then
dropping it from the replayed `function_call` in the second request.

## Run

```sh
npm install
npm test
```

No API key or network request is required. Fake `fetch` implementations capture
both requests serialized by `@ai-sdk/openai@4.0.42`.

## What happens

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

Request 1 contains:

```json
{
  "type": "namespace",
  "name": "company_draft_payroll"
}
```

Request 2 contains the replayed call without `namespace`:

```json
{
  "type": "function_call",
  "call_id": "call_1",
  "name": "create_company_off_cycle_draft_payroll",
  "arguments": "{}"
}
```

The script exits with status 1 when the bug is reproduced.
