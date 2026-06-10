import type { LLMAdapter, ChatOptions } from './adapter';
import type { Message, StreamEvent } from '../../types';
import { ipc } from '@/lib/ipc-factory';

export class ElectronBridgeAdapter implements LLMAdapter {
  async chat(
    messages: Message[],
    options: ChatOptions,
    onEvent: (event: StreamEvent) => void
  ): Promise<void> {
    interface ToolState {
      id: string;
      name: string;
      inputJson: string;
      emitted: boolean;
    }
    const toolStates = new Map<number, ToolState>();

    return new Promise(async (resolve, reject) => {
      // Setup listener for stream chunks before invoking
      const cleanup = ipc.on('llm:stream-chunk', (eventData: any) => {
        if (eventData.type === 'chunk') {
          const chunk = eventData.data;
          console.log(`[Bridge] Received chunk type=${chunk.type}`, JSON.stringify(chunk));
          
          if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'text_delta') {
                onEvent({ type: 'text', text: chunk.delta.text });
          } else if (chunk.type === 'message_start' && chunk.message?.usage) {
              const usage = chunk.message.usage;
              onEvent({
                type: 'usage',
                usage: {
                  inputTokens: usage.input_tokens || 0,
                  outputTokens: usage.output_tokens || 0
                }
              });
          } else if (chunk.type === 'content_block_start' && chunk.content_block?.type === 'tool_use') {
              const index = chunk.index;
              const toolUse = chunk.content_block;
              console.log(`[Bridge] Tool use start: index=${index}, id=${toolUse.id}, name=${toolUse.name}`);
              
              // Always start with an empty string for the JSON accumulator
              // unless the LLM provided an initial state (rare for streaming)
              let initialJson = '';
              if (toolUse.input && typeof toolUse.input === 'object' && Object.keys(toolUse.input).length > 0) {
                initialJson = JSON.stringify(toolUse.input);
              }

              toolStates.set(index, {
                id: toolUse.id,
                name: toolUse.name,
                inputJson: initialJson,
                emitted: false
              });
              
              // Emit initial state
              onEvent({
                type: 'tool_use',
                id: toolUse.id,
                name: toolUse.name,
                input: toolUse.input || {}
              });
          } else if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'input_json_delta') {
              const index = chunk.index;
              const state = toolStates.get(index);
              if (state) {
                const partial = chunk.delta.partial_json;
                // If it was an empty placeholder object, clear it before appending deltas
                if (state.inputJson === '{}') state.inputJson = '';
                state.inputJson += partial;
                
                // Proactively try to parse and emit update
                try {
                  let cleaned = state.inputJson.trim();
                  if (cleaned && !cleaned.startsWith('{')) cleaned = '{' + cleaned;
                  if (cleaned && !cleaned.endsWith('}')) cleaned = cleaned + '}';
                  if (cleaned) {
                    const input = JSON.parse(cleaned);
                    onEvent({
                      type: 'tool_use',
                      id: state.id,
                      name: state.name,
                      input
                    });
                  }
                } catch (e) {
                  // Partial JSON is often invalid, skip emitting update
                }
              }
          } else if (chunk.type === 'content_block_stop') {
              const index = chunk.index;
              const state = toolStates.get(index);
              if (state && !state.emitted) {
                try {
                  let cleanedJson = state.inputJson.trim();
                  if (cleanedJson && !cleanedJson.startsWith('{')) cleanedJson = '{' + cleanedJson;
                  if (cleanedJson && !cleanedJson.endsWith('}')) cleanedJson = cleanedJson + '}';
                  if (!cleanedJson) cleanedJson = '{}';

                  const input = JSON.parse(cleanedJson);
                  console.log(`[Bridge] Tool block stop: index=${index}, name=${state.name}, successfully parsed JSON`);
                  onEvent({
                    type: 'tool_use',
                    id: state.id,
                    name: state.name,
                    input
                  });
                  state.emitted = true;
                } catch (e) {
                  console.error(`[Bridge] JSON parse failed at stop event for ${state.name}:`, state.inputJson);
                  ipc.invoke('log_to_main', { level: 'error', message: `[Bridge] JSON parse failed for ${state.name}: ${state.inputJson}` });
                  onEvent({
                    type: 'tool_use',
                    id: state.id,
                    name: state.name,
                    input: { error: 'Invalid JSON', raw: state.inputJson }
                  });
                  state.emitted = true;
                }
              }
          } else if (chunk.type === 'content_block_start' && chunk.content_block?.type === 'thinking') {
              onEvent({ type: 'thinking', thinking: '' }); 
          } else if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'thinking_delta') {
              onEvent({ type: 'thinking', thinking: chunk.delta.thinking });
          } else if (chunk.type === 'message_delta' && chunk.delta?.stop_reason) {
              console.log(`[Bridge] message_delta: stop_reason=${chunk.delta.stop_reason}, toolsToEmit=${Array.from(toolStates.values()).filter(s => !s.emitted).length}`);
              // Ensure ALL tools have been emitted before finishing
              for (const [idx, state] of toolStates.entries()) {
                if (!state.emitted) {
                   console.log(`[Bridge] Final emission for tool index ${idx}: ${state.name}`);
                   try {
                     const input = JSON.parse(state.inputJson || '{}');
                     onEvent({
                       type: 'tool_use',
                       id: state.id,
                       name: state.name,
                       input
                     });
                     state.emitted = true;
                   } catch (e) {
                     console.error(`[Bridge] FINAL JSON parse failed for ${state.name}:`, state.inputJson);
                     onEvent({
                       type: 'tool_use',
                       id: state.id,
                       name: state.name,
                       input: { error: 'Failed to parse tool input JSON', raw: state.inputJson }
                     });
                     state.emitted = true;
                   }
                }
              }
              onEvent({ type: 'done', stopReason: chunk.delta.stop_reason });
          }
          // Note: Add tool_use mapping here if needed
        } else if (eventData.type === 'done') {
          cleanup();
          resolve();
        } else if (eventData.type === 'error') {
          cleanup();
          reject(new Error(eventData.message));
        }
      });

      try {
        await ipc.invoke('llm:chat', {
          messages,
          options: {
            model: options.model,
            apiKey: options.apiKey,
            baseUrl: options.baseUrl,
            systemPrompt: options.systemPrompt,
            maxTokens: options.maxTokens,
            temperature: options.temperature,
            topP: options.topP,
            stopSequences: options.stopSequences,
            enableThinking: options.enableThinking,
            thinkingBudget: options.thinkingBudget,
            // Only send tool definitions (schemas), not the execute functions
            tools: options.tools?.map(t => ({
              name: t.name,
              description: t.description,
              input_schema: t.inputSchema
            })),
            tool_choice: options.toolChoice,
            stream: true // Always use stream for better UX
          }
        });
      } catch (err) {
        cleanup();
        reject(err);
      }
    });
  }

  async embed(
    text: string,
    options: ChatOptions
  ): Promise<number[]> {
    return await ipc.invoke('memory:getEmbedding', { 
      text, 
      modelPath: options.embeddingModel 
    });
  }
}
