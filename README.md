# AI SDK OpenAI namespace repro

Reproduces `ai@7.0.66` dropping an OpenAI function-call namespace after invalid
tool input is converted to a UI message and replayed.

## Run

```sh
npm install
npm test
```

No API key or network request is required. A mock model creates the invalid
namespaced call, and a fake `fetch` captures the request serialized by
`@ai-sdk/openai@4.0.42`.

The namespace is incorrectly stored as result metadata and is missing from the
replayed call:

```json
{
  "namespaceFromProvider": "company_draft_payroll",
  "namespaceOnUICall": null,
  "namespaceOnUIResult": "company_draft_payroll",
  "namespaceOnReplayedModelCall": null,
  "namespaceInOpenAIRequest": null
}
```

The resulting OpenAI payload has no `namespace`:

```json
{
  "type": "function_call",
  "call_id": "call_1",
  "name": "create_company_off_cycle_draft_payroll",
  "arguments": "{}"
}
```

The script exits with status 1 when the bug is reproduced.
