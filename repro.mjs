import { convertToModelMessages, readUIMessageStream, streamText, tool } from 'ai';
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

const observed = {
  originalNamespace: providerMetadata.openai.namespace,
  uiCallNamespace: toolPart.callProviderMetadata?.openai?.namespace,
  uiResultNamespace: toolPart.resultProviderMetadata?.openai?.namespace,
  replayedNamespace: replayedToolCall?.providerOptions?.openai?.namespace,
};

console.log(JSON.stringify(observed, null, 2));

if (
  observed.uiCallNamespace !== namespace ||
  observed.replayedNamespace !== namespace
) {
  console.error(
    '\nBUG REPRODUCED: the invalid tool call moves the namespace to resultProviderMetadata, then drops it while rebuilding the model history.',
  );
  process.exitCode = 1;
} else {
  console.log('\nThe namespace survived the UI-message round trip; this version is fixed.');
}
