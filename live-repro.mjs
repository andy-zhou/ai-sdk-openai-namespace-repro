import { createOpenAI } from '@ai-sdk/openai';
import { generateText, tool } from 'ai';
import { z } from 'zod';

if (!process.env.OPENAI_API_KEY) {
  throw new Error('Set OPENAI_API_KEY before running the live reproduction.');
}

const modelName = process.env.OPENAI_MODEL ?? 'gpt-5.4';
const namespace = 'namespace_repro';
const toolName = 'create_repro_widget';

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
  description: 'Create a reproduction widget.',
  inputSchema: z.object({ requiredValue: z.string() }),
  providerOptions: {
    openai: {
      deferLoading: true,
      namespace: {
        description: 'Tools used by the namespace reproduction.',
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
    'Use tool search to load and call create_repro_widget with requiredValue set to x.',
};

const firstResult = await generateText({
  ...sharedOptions,
  messages: [firstUserMessage],
  toolChoice: 'required',
});

const issuedCall = firstResult.toolCalls.find(call => call.toolName === toolName);
if (!issuedCall) {
  throw new Error(`OpenAI did not issue the expected ${toolName} call.`);
}

const stripOnlyNamespace = part => {
  if (part.type !== 'tool-call' || part.toolName !== toolName) return part;

  const stripped = structuredClone(part);
  for (const metadataKey of ['providerOptions', 'providerMetadata']) {
    const openaiMetadata = stripped[metadataKey]?.openai;
    if (openaiMetadata) delete openaiMetadata.namespace;
  }

  return stripped;
};

const brokenAssistantMessages = firstResult.response.messages.map(message => ({
  ...message,
  content: Array.isArray(message.content)
    ? message.content.map(stripOnlyNamespace)
    : message.content,
}));

const history = [
  firstUserMessage,
  ...brokenAssistantMessages,
  {
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId: issuedCall.toolCallId,
        toolName,
        output: { type: 'text', value: 'created' },
      },
    ],
  },
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
  response1FunctionCallNamespace:
    issuedCall.providerMetadata?.openai?.namespace ?? null,
  request2FunctionCall: request2FunctionCall ?? null,
  openAIResponse: {
    statusCode: upstreamError?.statusCode ?? null,
    message: errorMessage,
  },
};

console.log(JSON.stringify(observed, null, 2));

const verified =
  request1Namespace === namespace &&
  issuedCall.providerMetadata?.openai?.namespace === namespace &&
  request2FunctionCall != null &&
  request2FunctionCall.namespace == null &&
  upstreamError?.statusCode === 400 &&
  errorMessage?.includes('Missing namespace for function_call');

if (!verified) {
  console.error('\nLive reproduction did not produce the expected rejection.');
  process.exitCode = 1;
} else {
  console.log(
    '\nVERIFIED: request 2 omitted only the historical call namespace, and OpenAI rejected it.',
  );
}
