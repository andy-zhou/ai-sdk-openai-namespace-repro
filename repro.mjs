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

const namespace = 'widget_tools';
const toolName = 'create_widget';
const providerMetadata = {
  openai: {
    itemId: 'fc_1',
    namespace,
  },
};

const namespacedTool = tool({
  description: 'Create a synthetic widget.',
  inputSchema: z.object({
    widgetData: z.object({}),
    widgetType: z.string(),
  }),
  execute: async () => ({ ok: true }),
  providerOptions: {
    openai: {
      deferLoading: true,
      namespace: {
        description: 'Synthetic widget tools.',
        name: namespace,
      },
    },
  },
});

// Capture request 1. It correctly sends the tool inside an OpenAI namespace.
let firstOpenAIRequestBody;
const firstOpenAI = createOpenAI({
  apiKey: 'not-used',
  fetch: async (_url, init) => {
    firstOpenAIRequestBody = JSON.parse(init.body);
    return new Response(JSON.stringify({ error: { message: 'request captured' } }), {
      headers: { 'content-type': 'application/json' },
      status: 400,
    });
  },
});

try {
  await generateText({
    model: firstOpenAI.responses('gpt-5.4'),
    prompt: 'Create a widget.',
    tools: {
      [toolName]: namespacedTool,
      tool_search: firstOpenAI.tools.toolSearch(),
    },
    maxRetries: 0,
  });
} catch {
  // Expected: the fake fetch returns 400 after capturing the serialized body.
}

const firstRequestNamespaceTool = firstOpenAIRequestBody?.tools?.find(
  item => item.type === 'namespace',
);

// The mock model returns an invalid namespaced function call, matching the live
// input-validation path. No OpenAI API key or network request is needed.
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
  messages: [{ role: 'user', content: 'Create a widget.' }],
  tools: {
    [toolName]: namespacedTool,
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

// Capture request 2 after the invalid call has passed through UI-message state.
let secondOpenAIRequestBody;
const secondOpenAI = createOpenAI({
  apiKey: 'not-used',
  fetch: async (_url, init) => {
    secondOpenAIRequestBody = JSON.parse(init.body);
    return new Response(JSON.stringify({ error: { message: 'request captured' } }), {
      headers: { 'content-type': 'application/json' },
      status: 400,
    });
  },
});

try {
  await generateText({
    model: secondOpenAI.responses('gpt-5.4'),
    messages: replayedMessages,
    maxRetries: 0,
  });
} catch {
  // Expected: the fake fetch returns 400 after capturing the serialized body.
}

const secondRequestFunctionCall = secondOpenAIRequestBody?.input?.find(
  item => item.type === 'function_call',
);

const observed = {
  request1ToolNamespace: firstRequestNamespaceTool?.name ?? null,
  response1FunctionCallNamespace: providerMetadata.openai.namespace,
  persistedUICallNamespace: toolPart.callProviderMetadata?.openai?.namespace ?? null,
  persistedUIResultNamespace: toolPart.resultProviderMetadata?.openai?.namespace ?? null,
  replayedModelCallNamespace:
    replayedToolCall?.providerOptions?.openai?.namespace ?? null,
  request2FunctionCallNamespace: secondRequestFunctionCall?.namespace ?? null,
};

console.log('Namespace across the two-request round trip:');
console.log(JSON.stringify(observed, null, 2));
console.log('\nRequest 1 namespace tool sent to OpenAI:');
console.log(JSON.stringify(firstRequestNamespaceTool, null, 2));
console.log('\nRequest 2 replayed function_call sent to OpenAI:');
console.log(JSON.stringify(secondRequestFunctionCall, null, 2));

if (
  observed.request1ToolNamespace !== namespace ||
  observed.response1FunctionCallNamespace !== namespace ||
  observed.persistedUICallNamespace !== namespace ||
  observed.replayedModelCallNamespace !== namespace ||
  observed.request2FunctionCallNamespace !== namespace
) {
  console.log(
    '\nBUG REPRODUCED: request 1 has the namespace, but request 2 drops it from the replayed function_call.',
  );
  process.exitCode = 1;
} else {
  console.log('\nThe namespace survived the UI-message round trip; this version is fixed.');
}
