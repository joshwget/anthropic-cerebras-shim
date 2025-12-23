// Anthropic Messages API Types

// Content block types
export interface TextBlock {
  type: "text";
  text: string;
}

export interface ImageSource {
  type: "base64" | "url";
  media_type?: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  data?: string;
  url?: string;
}

export interface ImageBlock {
  type: "image";
  source: ImageSource;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string | ContentBlock[];
  is_error?: boolean;
}

export type ContentBlock = TextBlock | ImageBlock | ToolUseBlock | ToolResultBlock;

// Message types
export interface Message {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

// Tool types
export interface ToolInputSchema {
  type: "object";
  properties: Record<string, {
    type: string;
    description?: string;
    enum?: string[];
    items?: unknown;
    [key: string]: unknown;
  }>;
  required?: string[];
  [key: string]: unknown;
}

export interface Tool {
  name: string;
  description?: string;
  input_schema: ToolInputSchema;
}

// Tool choice types
export interface ToolChoiceAuto {
  type: "auto";
  disable_parallel_tool_use?: boolean;
}

export interface ToolChoiceAny {
  type: "any";
  disable_parallel_tool_use?: boolean;
}

export interface ToolChoiceTool {
  type: "tool";
  name: string;
  disable_parallel_tool_use?: boolean;
}

export interface ToolChoiceNone {
  type: "none";
}

export type ToolChoice = ToolChoiceAuto | ToolChoiceAny | ToolChoiceTool | ToolChoiceNone;

// Request type
export interface MessagesRequest {
  model: string;
  max_tokens: number;
  messages: Message[];
  system?: string | TextBlock[];
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop_sequences?: string[];
  stream?: boolean;
  tools?: Tool[];
  tool_choice?: ToolChoice;
  metadata?: {
    user_id?: string;
  };
}

// Response types
export type StopReason = "end_turn" | "max_tokens" | "stop_sequence" | "tool_use";

export interface Usage {
  input_tokens: number;
  output_tokens: number;
}

export interface MessagesResponse {
  id: string;
  type: "message";
  role: "assistant";
  model: string;
  content: ContentBlock[];
  stop_reason: StopReason | null;
  stop_sequence: string | null;
  usage: Usage;
}

// Streaming event types
export interface MessageStartEvent {
  type: "message_start";
  message: Omit<MessagesResponse, "content" | "stop_reason" | "stop_sequence"> & {
    content: [];
    stop_reason: null;
    stop_sequence: null;
  };
}

export interface ContentBlockStartEvent {
  type: "content_block_start";
  index: number;
  content_block: TextBlock | ToolUseBlock;
}

export interface ContentBlockDeltaEvent {
  type: "content_block_delta";
  index: number;
  delta: TextDelta | InputJsonDelta;
}

export interface TextDelta {
  type: "text_delta";
  text: string;
}

export interface InputJsonDelta {
  type: "input_json_delta";
  partial_json: string;
}

export interface ContentBlockStopEvent {
  type: "content_block_stop";
  index: number;
}

export interface MessageDeltaEvent {
  type: "message_delta";
  delta: {
    stop_reason: StopReason;
    stop_sequence: string | null;
  };
  usage: {
    output_tokens: number;
  };
}

export interface MessageStopEvent {
  type: "message_stop";
}

export interface PingEvent {
  type: "ping";
}

export interface ErrorEvent {
  type: "error";
  error: {
    type: string;
    message: string;
  };
}

export type StreamEvent =
  | MessageStartEvent
  | ContentBlockStartEvent
  | ContentBlockDeltaEvent
  | ContentBlockStopEvent
  | MessageDeltaEvent
  | MessageStopEvent
  | PingEvent
  | ErrorEvent;
