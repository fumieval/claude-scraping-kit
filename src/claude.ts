import Anthropic from "@anthropic-ai/sdk";
import type {
  MessageParam,
  ToolResultBlockParam,
  TextBlockParam,
  ToolUseBlockParam,
  Tool,
  RawMessageStreamEvent,
  MessageCreateParamsBase,
} from "@anthropic-ai/sdk/resources/messages.mjs";
import { z, type ZodSchema } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

function zodToInputSchema<T>(schema: z.ZodSchema<T>): Tool.InputSchema {
  const jsonSchema = zodToJsonSchema(schema, "input").definitions?.input;
  if (!jsonSchema) {
    throw new Error("Failed to convert Zod schema to JSON schema");
  }
  return jsonSchema as Tool.InputSchema;
}

/**
 * A client for interacting with Anthropic's Claude AI model, supporting streaming responses and tool uses.
 * 
 * @class
 * @example
 * ```typescript
 * const client = new ClaudeClient({
 *   model: "anthropic.claude-3-5-haiku-latest",
 *   max_tokens: 4096
 * });
 * ```
 */
export class ClaudeClient {
  client: Anthropic;
  options: Omit<MessageCreateParamsBase, "messages">;
  tools: Tool[];
  toolHandlers: Map<string, (input: unknown) => Promise<string>>;

  constructor(options: Partial<MessageCreateParamsBase>) {
    this.options = {
      model: "anthropic.claude-3-5-sonnet-latest",
      max_tokens: 8192,
    };
    Object.assign(this.options, options);
    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
    this.tools = [];
    this.toolHandlers = new Map();
  }

  /**
   * System prompt which provides instruction and context to the model.
   * See https://docs.anthropic.com/en/docs/system-prompts for more information.
   */
  system(prompt: string){
    this.options.system = prompt;
  }

  private addTool(tool: Tool, handler: (input: unknown) => Promise<string>) {
    this.tools.push(tool);
    this.toolHandlers.set(tool.name, handler);
  }

  /**
   * Attach a tool which may be invoked during the conversation.
   * 
   * @example
   * ```typescript
   * client.addZodTool("roll_dice",
   *    z.object({ sides: z.number() }).describe("Roll a dice with the given number of sides"),
   *    async ({ sides }) => {
   *      return Math.floor(Math.random() * sides) + 1;
   *    });
   * ```
  */
  addZodTool<T>(
    name: string,
    schema: ZodSchema<T>,
    handler: (input: T) => Promise<string>
  ) {
    this.addTool(
      {
        name,
        input_schema: zodToInputSchema(schema),
        description: schema.description,
      },
      async (input) => {
        return handler(schema.parse(input));
      }
    );
  }

  private async createStream(
    messages: MessageParam[],
    options?: Partial<MessageCreateParamsBase>
  ): Promise<AsyncIterable<RawMessageStreamEvent>> {
    const newOptions = { ...this.options, ...options };
      return await this.client.messages.create({
        ...newOptions,
        messages,
        tools: this.tools,
        tool_choice: this.tools.length > 0 ? { type: "auto" } : undefined,
        stream: true,
      });
  }

  /**
   * Generate a stream of responses from the model.
   * 
   * @example
   * ```typescript
   * for await (const chunk of client.stream([{ role: "user", content: "Hello, Claude!" }])) {
   *   process.stdout.write(chunk);
   * }
   * ```
   * 
   * @param messages 
   * @param options 
   */
  async *stream(
    messages: MessageParam[],
    options?: Partial<MessageCreateParamsBase>
  ): AsyncGenerator<string> {
    // the outer loop handles iteration of the tool uses
    while (true) {
      let response = await this.createStream(messages, options);
      let pendingBlock: TextBlockParam | ToolUseBlockParam | undefined;
      let responseBlocks: Array<TextBlockParam | ToolUseBlockParam> = [];
      let pendingText = "";

      for await (const chunk of response) {
        switch (chunk.type) {
          case "content_block_start":
            pendingBlock = chunk.content_block;
            break;
          case "content_block_stop":
            if (pendingBlock === undefined) {
              throw new Error("Unexpected content_block_stop");
            }
            if (pendingBlock.type === "text") {
              pendingBlock.text = pendingText;
              yield "\n";
            } else {
              // when the input is {}, we get an empty string
              if (pendingText === "") {
                pendingBlock.input = {};
              } else {
                pendingBlock.input = JSON.parse(pendingText);
              }
            }
            pendingText = "";
            responseBlocks.push(pendingBlock);
            break;
          case "content_block_delta":
            if (chunk.delta.type === "input_json_delta") {
              pendingText += chunk.delta.partial_json;
            } else {
              pendingText += chunk.delta.text;
              yield chunk.delta.text;
            }
        }
      }
      messages.push({ role: "assistant", content: responseBlocks });

      let resultBlocks: ToolResultBlockParam[] = [];

      for (const block of responseBlocks) {
        if (block.type === "tool_use") {
          const handler = this.toolHandlers.get(block.name);
          if (handler === undefined) {
            throw new Error(`No handler for tool ${block.name}`);
          }
          try {
            const toolResult = await handler(block.input);
            resultBlocks.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: toolResult,
            });
          } catch (error) {
            if (error instanceof Error) {
              resultBlocks.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: error.message,
                is_error: true,
              });
            } else {
              throw error;
            }
          }
        }
      }

      if (resultBlocks.length == 0) {
        break;
      }
      messages.push({ role: "user", content: resultBlocks });
    }
  }
}
