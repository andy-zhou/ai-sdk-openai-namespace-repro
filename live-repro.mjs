import { createOpenAI } from '@ai-sdk/openai';
import {
  convertToModelMessages,
  generateText,
  readUIMessageStream,
  streamText,
  tool,
} from 'ai';
import { z } from 'zod';

if (!process.env.OPENAI_API_KEY) {
  throw new Error('Set OPENAI_API_KEY before running the live reproduction.');
}

const modelName = process.env.OPENAI_MODEL ?? 'gpt-5.4';
const namespace = 'widget_tools';
const toolName = 'create_widget';

let requestNumber = 0;
let firstRequestBody;
let secondRequestBody;

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  fetch: async (url, init) => {
    requestNumber += 1;
    const body = JSON.parse(init.body);

    if (requestNumber === 1) firstRequestBody = body;
    if (requestNumber === 2) secondRequestBody = body;

    return globalThis.fetch(url, init);
  },
});

const namespacedTool = tool({
  description: 'Create a synthetic widget.',
  inputSchema: z.object({
    widgetData: z.object({}),
    widgetType: z.string(),
  }),
  strict: false,
  execute: async () => ({ created: true }),
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

const tools = {
  [toolName]: namespacedTool,
  tool_search: openai.tools.toolSearch(),
};

const sharedOptions = {
  model: openai.responses(modelName),
  tools,
  providerOptions: { openai: { store: false } },
  maxRetries: 0,
};

const firstUserMessage = {
  role: 'user',
  content:
    'Use tool search to load create_widget, then call it with exactly {}. Do not provide its required fields; this is an input-validation test.',
};

const firstResult = streamText({
  ...sharedOptions,
  messages: [firstUserMessage],
  toolChoice: 'required',
});

let uiMessage;
for await (const snapshot of readUIMessageStream({
  stream: firstResult.toUIMessageStream(),
})) {
  uiMessage = snapshot;
}

if (!uiMessage) {
  throw new Error('The first OpenAI response produced no UI message.');
}

const toolPart = uiMessage.parts.find(
  part => part.type === `tool-${toolName}` || part.toolName === toolName,
);
if (!toolPart) {
  throw new Error(`OpenAI did not issue the expected ${toolName} call.`);
}

const replayedMessages = await convertToModelMessages([uiMessage]);
const replayedToolCall = replayedMessages
  .flatMap(message => (Array.isArray(message.content) ? message.content : []))
  .find(part => part.type === 'tool-call' && part.toolName === toolName);

const history = [
  firstUserMessage,
  ...replayedMessages,
  { role: 'user', content: 'Now answer continued.' },
];

let upstreamError;
try {
  await generateText({
    ...sharedOptions,
    messages: history,
    toolChoice: 'auto',
  });
} catch (error) {
  upstreamError = error;
}

const request1Namespace = firstRequestBody?.tools?.find(
  item => item.type === 'namespace',
)?.name;
const request2FunctionCall = secondRequestBody?.input?.find(
  item => item.type === 'function_call' && item.name === toolName,
);
const errorMessage = upstreamError?.message ?? null;

const observed = {
  model: modelName,
  request1ToolNamespace: request1Namespace ?? null,
  uiCallNamespace: toolPart.callProviderMetadata?.openai?.namespace ?? null,
  uiResultNamespace: toolPart.resultProviderMetadata?.openai?.namespace ?? null,
  replayedModelCallNamespace:
    replayedToolCall?.providerOptions?.openai?.namespace ?? null,
  request2FunctionCall: request2FunctionCall ?? null,
  openAIResponse: {
    statusCode: upstreamError?.statusCode ?? null,
    message: errorMessage,
  },
};

console.log(JSON.stringify(observed, null, 2));

const verified =
  request1Namespace === namespace &&
  toolPart.callProviderMetadata?.openai?.namespace == null &&
  toolPart.resultProviderMetadata?.openai?.namespace === namespace &&
  replayedToolCall?.providerOptions?.openai?.namespace == null &&
  request2FunctionCall != null &&
  request2FunctionCall.namespace == null &&
  upstreamError?.statusCode === 400 &&
  errorMessage?.includes('Missing namespace for function_call');

if (!verified) {
  console.error('\nLive round trip did not reproduce the expected failure.');
  process.exitCode = 1;
} else {
  console.log(
    '\nVERIFIED: the real OpenAI call lost its namespace during the AI SDK UI-message round trip, and request 2 was rejected.',
  );
}
