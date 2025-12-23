// Cerebras API Types (OpenAI-compatible format)

// Message types
export interface SystemMessage {
  role: "system";
  content: string;
}

export interface UserMessage {
  role: "user";
  content: string | UserContentPart[];
}

export interface UserContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: {
    url: string;
    detail?: "auto" | "low" | "high";
  };
}

export interface AssistantMessage {
  role: "assistant";
  content: string | null;
  tool_calls?: ToolCall[];
}

export interface ToolMessage {
  role: "tool";
  content: string;
  tool_call_id: string;
}

export type ChatMessage = SystemMessage | UserMessage | AssistantMessage | ToolMessage;

// Tool types
export interface FunctionDefinition {
  name: string;
  description?: string;
  parameters?: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    [key: string]: unknown;
  };
  strict?: boolean;
}

export interface Tool {
  type: "function";
  function: FunctionDefinition;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

// Tool choice types
export type ToolChoice = "none" | "auto" | "required" | {
  type: "function";
  function: {
    name: string;
  };
};

// Request type
export interface ChatCompletionsRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  top_p?: number;
  max_completion_tokens?: number;
  stream?: boolean;
  stop?: string | string[];
  seed?: number;
  tools?: Tool[];
  tool_choice?: ToolChoice;
  parallel_tool_calls?: boolean;
}

// Response types
export interface ChatCompletionsResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Choice[];
  usage: Usage;
  time_info?: TimeInfo;
}

export interface Choice {
  index: number;
  message: ResponseMessage;
  finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | null;
}

export interface ResponseMessage {
  role: "assistant";
  content: string | null;
  reasoning?: string;
  tool_calls?: ToolCall[];
}

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface TimeInfo {
  queue_time?: number;
  prompt_time?: number;
  completion_time?: number;
  total_time?: number;
}

// Streaming types
export interface ChatCompletionsChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: ChunkChoice[];
}

export interface ChunkChoice {
  index: number;
  delta: DeltaMessage;
  finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | null;
}

export interface DeltaMessage {
  role?: "assistant";
  content?: string | null;
  tool_calls?: DeltaToolCall[];
}

export interface DeltaToolCall {
  index: number;
  id?: string;
  type?: "function";
  function?: {
    name?: string;
    arguments?: string;
  };
}
