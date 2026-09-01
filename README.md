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
`callProviderMetadata` when rebuilding the function call, so the replayed call
has no namespace.

## Run

```sh
npm install
npm test
```

No API key or network request is required after installing dependencies. The
mock model emits the same provider metadata that the OpenAI Responses provider
returns for a namespaced function call.

On the affected version, the command prints:

```json
{
  "originalNamespace": "company_draft_payroll",
  "uiResultNamespace": "company_draft_payroll"
}
```

`uiCallNamespace` and `replayedNamespace` are `undefined`, so JSON omits them
and the process exits with status 1. A fixed version should retain both values
as `company_draft_payroll` and exit successfully.

## Why it matters

OpenAI requires a replayed `function_call` to include its original `namespace`.
Once this history is persisted and resumed—for example, after a tool approval—
OpenAI rejects the request because the function does not exist in the default
namespace.
