# AI SDK OpenAI namespace round-trip reproduction

This is a deterministic reproduction of provider metadata being lost when a
namespaced OpenAI function call has invalid tool input.

The model call begins with:

```json
{
  "openai": {
    "itemId": "fc_1",
    "namespace": "company_draft_payroll"
  }
}
```

AI SDK converts the invalid call into a UI tool part with state `output-error`.
In `ai@7.0.66`, the namespace lands in `resultProviderMetadata` instead of
`callProviderMetadata`. `convertToModelMessages` only reads
`callProviderMetadata` when rebuilding the function call. The repro then uses
`@ai-sdk/openai@4.0.42` with a fake `fetch` to capture the actual OpenAI request
body, proving that the serialized `function_call` has no `namespace`.

## Run

```sh
npm install
npm test
```

No API key or network request is required after installing dependencies. The
mock model emits the same provider metadata that the OpenAI Responses provider
returns for a namespaced function call, and the fake `fetch` captures the
outbound request locally.

On the affected version, the command prints:

```json
{
  "namespaceFromProvider": "company_draft_payroll",
  "namespaceOnUICall": null,
  "namespaceOnUIResult": "company_draft_payroll",
  "namespaceOnReplayedModelCall": null,
  "namespaceInOpenAIRequest": null
}
```

It also prints the exact `function_call` serialized by `@ai-sdk/openai`:

```json
{
  "type": "function_call",
  "call_id": "call_1",
  "name": "create_company_off_cycle_draft_payroll",
  "arguments": "{}"
}
```

The missing `namespace` property is the failure. A fixed version should retain
`company_draft_payroll` through every stage, include it in this payload, and
exit successfully.

## Why it matters

OpenAI requires a replayed `function_call` to include its original `namespace`.
Once this history is persisted and resumed—for example, after a tool approval—
OpenAI rejects the request because the function does not exist in the default
namespace.
