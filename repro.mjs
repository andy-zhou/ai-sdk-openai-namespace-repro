import { createOpenAI } from '@ai-sdk/openai';
import {
  convertToModelMessages,
  generateText,
  readUIMessageStream,
  streamText,
  tool,
} from 'ai';
import { MockLanguageModelV4, simulateReadableStream } from 'ai/test';
import { z } from 'zod';

const namespace = 'company_draft_payroll';
const toolName = 'create_company_off_cycle_draft_payroll';
const providerMetadata = {
  openai: {
    itemId: 'fc_1',
    namespace,
  },
};

// The mock model returns a namespaced function call whose input does not match
// the local tool schema. No OpenAI API key or network request is needed.
const model = new MockLanguageModelV4({
  doStream: async () => ({
    stream: simulateReadableStream({
      chunks: [
        {
          type: 'tool-call',
          toolCallId: 'call_1',
          toolName,
          input: '{}',
          providerMetadata,
        },
        {
          type: 'finish',
          finishReason: { raw: undefined, unified: 'tool-calls' },
          usage: {
            inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 1, text: 0, reasoning: 0 },
            raw: undefined,
          },
        },
      ],
    }),
  }),
});

const result = streamText({
  model,
  messages: [{ role: 'user', content: 'Create an off-cycle payroll.' }],
  tools: {
    [toolName]: tool({
      description: 'Create an off-cycle payroll.',
      inputSchema: z.object({
        draftPayrollData: z.object({}),
        offCycleType: z.string(),
      }),
      execute: async () => ({ ok: true }),
    }),
  },
});

let uiMessage;
for await (const snapshot of readUIMessageStream({
  stream: result.toUIMessageStream(),
})) {
  uiMessage = snapshot;
}

if (!uiMessage) {
  throw new Error('The UI message stream produced no message.');
}

const toolPart = uiMessage.parts.find(part => part.type.startsWith('tool-'));
if (!toolPart) {
  throw new Error('The UI message contains no tool part.');
}

const replayedMessages = await convertToModelMessages([uiMessage]);
const replayedToolCall = replayedMessages
  .flatMap(message => (Array.isArray(message.content) ? message.content : []))
  .find(part => part.type === 'tool-call');

// Capture the actual request body produced by @ai-sdk/openai. The fake fetch
// prevents a network request; its response only exists to stop generateText.
let openAIRequestBody;
const openai = createOpenAI({
  apiKey: 'not-used',
  fetch: async (_url, init) => {
    openAIRequestBody = JSON.parse(init.body);
    return new Response(JSON.stringify({ error: { message: 'request captured' } }), {
      headers: { 'content-type': 'application/json' },
      status: 400,
    });
  },
});

try {
  await generateText({
    model: openai.responses('gpt-5.4'),
    messages: replayedMessages,
    maxRetries: 0,
  });
} catch {
  // Expected: the fake fetch returns 400 after capturing the serialized body.
}

const outboundFunctionCall = openAIRequestBody?.input?.find(
  item => item.type === 'function_call',
);

const observed = {
  namespaceFromProvider: providerMetadata.openai.namespace,
  namespaceOnUICall: toolPart.callProviderMetadata?.openai?.namespace ?? null,
  namespaceOnUIResult: toolPart.resultProviderMetadata?.openai?.namespace ?? null,
  namespaceOnReplayedModelCall:
    replayedToolCall?.providerOptions?.openai?.namespace ?? null,
  namespaceInOpenAIRequest: outboundFunctionCall?.namespace ?? null,
};

console.log('Namespace at each stage:');
console.log(JSON.stringify(observed, null, 2));
console.log('\nActual function_call serialized for OpenAI:');
console.log(JSON.stringify(outboundFunctionCall, null, 2));

if (
  observed.namespaceOnUICall !== namespace ||
  observed.namespaceOnReplayedModelCall !== namespace ||
  observed.namespaceInOpenAIRequest !== namespace
) {
  console.log(
    '\nBUG REPRODUCED: the function_call sent back to OpenAI has no namespace.',
  );
  process.exitCode = 1;
} else {
  console.log('\nThe namespace survived the UI-message round trip; this version is fixed.');
}
