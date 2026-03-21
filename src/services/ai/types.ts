export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatCompletionOptions = {
  temperature?: number;
  contentFilterPolicyId?: string;
};

export interface ChatProvider {
  readonly name: string;
  chat(
    messages: ChatMessage[],
    options?: ChatCompletionOptions,
  ): Promise<string>;
}
