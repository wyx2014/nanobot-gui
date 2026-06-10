import type { ToolCall, TokenUsage, Message, StreamEvent } from '../../types';
import type { LLMAdapter } from '../llm/adapter';
import { executeAnyTool, toolResultToString } from '../tools/registry';
import { useChatStore } from '../../stores/chatStore';
import { useSettingsStore, getEffectiveModel } from '../../stores/settingsStore';
import { useTaskExecutionStore } from '../../stores/taskExecutionStore';
import { createLoopDetectionState, detectToolCallLoop, recordToolCall, recordToolCallOutcome, type LoopDetectionState } from '../agent/toolLoopDetection';
import { withRetry } from '../agent/retry';
import type { AgentSession, ExecutionContext, EngineOptions, TurnResult } from './types';
import { ContextEngine } from './context';
import { truncateIfOversized } from '../context/toolResultTruncation';
import { ipc } from '@/lib/ipc-factory';
import { drainQueuedInputs } from '../agent/userInputQueue';
import { emitHook, type PreToolCallEvent } from '../agent/lifecycleHooks';
import { setComputerUseBatchMode, setSkipAutoScreenshot } from '../tools/builtins';
import { notifyTaskCompleted, notifyTaskError } from '../../utils/notifications';

export class ExecutionEngine {
  private loopDetectionState: LoopDetectionState = createLoopDetectionState();
  private turnCount = 0;
  private ctx: ExecutionContext;
  private options: EngineOptions;

  constructor(ctx: ExecutionContext, options: EngineOptions = {}) {
    this.ctx = ctx;
    this.options = options;
  }

  public async run(route: any, _initialHistory: Message[]): Promise<TurnResult> {
    const maxTurns = this.options.maxTurns ?? 100;
    const { session, adapter }: { session: AgentSession; adapter: LLMAdapter } = this.ctx;
    const chatStore = useChatStore.getState(); // Get chatStore here for setAgentStatus

    const contextEngine = new ContextEngine(session.conversationId, adapter);

    // [New] Emit agentStart hook
    await emitHook({
      type: 'agentStart',
      timestamp: Date.now(),
      conversationId: session.conversationId,
      agentName: route.name ?? 'ruyi',
      loopId: session.loopId,
    });

    while (this.turnCount < maxTurns) {
      if (session.abortController.signal.aborted) return { stopReason: 'aborted' };
      
      const turnMsg = `[Engine] STARTING Turn ${this.turnCount + 1}`;
      console.log(turnMsg);
      ipc.invoke('log_to_main', { level: 'info', message: turnMsg });

      // [New] Drain queued inputs (mid-task user messages)
      drainQueuedInputs(session.conversationId);

      // [New] Emit turnStart hook
      await emitHook({
        type: 'turnStart',
        timestamp: Date.now(),
        conversationId: session.conversationId,
        turnNumber: this.turnCount + 1,
        maxTurns,
      });

      chatStore.setAgentStatus('thinking');
      this.turnCount++;

      // Create assistant message placeholder
      const assistantMsgId = this.generateId();
      useChatStore.getState().addMessage(session.conversationId, {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        isStreaming: true,
        toolCalls: [],
        loopId: session.loopId,
      });

      try {
        const turn = await this.executeTurn(route, assistantMsgId, contextEngine);
        const turnEndMsg = `[Engine] FINISHED Turn ${this.turnCount} reason=${turn.stopReason}`;
        console.log(turnEndMsg);
        ipc.invoke('log_to_main', { level: 'info', message: turnEndMsg });

        if (turn.stopReason !== 'end_turn') {
          // [New] Emit agentEnd hook
          await emitHook({
            type: 'agentEnd',
            timestamp: Date.now(),
            conversationId: session.conversationId,
            agentName: route.name ?? 'ruyi',
            loopId: session.loopId,
            reason: turn.stopReason,
          });

          // [New] Notify UI on completion
          if (turn.stopReason === 'delegate_complete') {
            const convTitle = useChatStore.getState().conversations[session.conversationId]?.title ?? '任务';
            notifyTaskCompleted(convTitle);
          }
          return turn;
        }
      } catch (err) {
        const turnErrLog = `[Engine] ERROR in Turn ${this.turnCount}: ${String(err)}`;
        console.error(turnErrLog);
        ipc.invoke('log_to_main', { level: 'error', message: turnErrLog });
        
        // [New] Notify UI on error
        const convTitle = useChatStore.getState().conversations[session.conversationId]?.title ?? '任务';
        notifyTaskError(convTitle);
        
        return { stopReason: 'error', error: err instanceof Error ? err.message : String(err) };
      }
    }

    // [New] Max turns reached
    const convTitle = useChatStore.getState().conversations[session.conversationId]?.title ?? '任务';
    notifyTaskCompleted(convTitle);
    return { stopReason: 'max_turns' };
  }

  private async executeTurn(route: any, assistantMsgId: string, contextEngine: ContextEngine): Promise<TurnResult> {
    const { session, adapter, eventRouter } = this.ctx;
    const chatStore = useChatStore.getState();
    const settings = useSettingsStore.getState();

    // 1. Prepare Prompt
    const { preparedMessages, effectiveSystemPrompt, tools, inputValidators } = await contextEngine.buildEffectivePrompt(
      route,
      this.getBaseSystemPrompt(),
      session.history,
      this.turnCount,
      {
        maxOutputTokens: settings.enableThinking ? 16384 : (settings.maxOutputTokens ?? 8192),
        contextWindowSize: settings.contextWindowSize ?? 200000,
        signal: session.abortController.signal,
      }
    );

    // 2. LLM Chat
    let collectedToolCalls: (ToolCall & { isExecuting: boolean; startTime: number; hidden?: boolean })[] = [];
    let collectedThinking = '';
    let finalUsage: TokenUsage | undefined;

    const chatOptions = {
      model: getEffectiveModel(settings),
      apiKey: settings.apiKey,
      baseUrl: settings.baseUrl || undefined,
      systemPrompt: effectiveSystemPrompt,
      tools: tools.length > 0 ? tools : undefined,
      maxTokens: settings.enableThinking ? 16384 : (settings.maxOutputTokens ?? 8192),
      signal: session.abortController.signal,
      temperature: settings.temperature,
      enableThinking: settings.enableThinking,
      thinkingBudget: settings.thinkingBudget,
    };

    const toolCallIdToStepId = new Map<string, string>();
    const eventHandler = (event: StreamEvent) => {
      switch (event.type) {
        case 'thinking':
          collectedThinking += event.thinking;
          chatStore.updateMessageThinking(session.conversationId, collectedThinking);
          break;
        case 'text':
          chatStore.appendToLastMessage(session.conversationId, event.text);
          break;
        case 'tool_use':
          // Deduplicate based on tool call ID
          const existingTool = collectedToolCalls.find(tc => tc.id === event.id);
          if (existingTool) {
            existingTool.input = event.input;
            break;
          }

          // Special handling for report_plan - update TaskExecutionStore and hide from UI
          if (event.name === 'report_plan') {
            const steps = (event.input as { steps?: string[] })?.steps;
            if (steps && steps.length > 0) {
              const plannedSteps = steps.map((desc, i) => ({
                index: i + 1,
                description: desc,
                status: 'pending' as const,
              }));
              useTaskExecutionStore.getState().setPlannedSteps(session.loopId, plannedSteps);
            }
            collectedToolCalls.push({
              id: event.id,
              name: event.name,
              input: event.input,
              isExecuting: true,
              startTime: Date.now(),
              hidden: true,
            });
            break;
          }

          collectedToolCalls.push({
            id: event.id,
            name: event.name,
            input: event.input,
            isExecuting: true,
            startTime: Date.now()
          });
          chatStore.setAgentStatus('tool-calling', event.name);
          
          // Event routing for UI steps
          const stepId = eventRouter.createStepForToolUse(
             session.loopId, 
             { toolName: event.name, toolInput: event.input as Record<string, unknown> }, 
             event.id
          );
          if (stepId) {
            toolCallIdToStepId.set(event.id, stepId);
            
            // Auto-link to next pending planned step
            const currentExec = useTaskExecutionStore.getState().getExecutionByLoopId(session.loopId);
            if (currentExec) {
              const hasRunning = currentExec.plannedSteps.some(s => s.status === 'running');
              if (!hasRunning) {
                const nextPending = currentExec.plannedSteps.find(s => s.status === 'pending');
                if (nextPending) {
                  useTaskExecutionStore.getState().linkPlannedStep(currentExec.id, nextPending.index, stepId);
                  useTaskExecutionStore.getState().updatePlannedStepStatus(currentExec.id, nextPending.index, 'running');
                }
              }
            }
          }
          break;
        case 'usage':
          finalUsage = event.usage;
          chatStore.setCurrentUsage(event.usage);
          break;
        case 'done':
          break;
      }
    };

    try {
      await withRetry(() => adapter.chat(preparedMessages, chatOptions, eventHandler), { maxRetries: 3 }, session.abortController.signal);
    } catch (err) {
      return { stopReason: 'error', error: String(err) };
    }

    if (finalUsage) {
      chatStore.updateMessageUsage(session.conversationId, finalUsage);
    }

    // Set assistant message to finished streaming if NO tools
    if (collectedToolCalls.length === 0) {
      chatStore.finishStreaming(session.conversationId);
    } else {
      // Sync tool calls to the assistant message bubble for UI visibility
      useChatStore.setState((state: any) => {
        const msg = state.conversations[session.conversationId]?.messages.find(
          (m: any) => m.id === assistantMsgId
        );
        if (msg) {
          msg.toolCalls = collectedToolCalls;
          msg.isStreaming = false; // Turn off streaming pulse
        }
      });
    }

    // 3. Execute Tools
    if (collectedToolCalls.length > 0) {
      const results = await this.executeToolBatch(collectedToolCalls, inputValidators, toolCallIdToStepId, assistantMsgId);
      chatStore.setAgentStatus('thinking');
      
      // Update session history with assistant message
      const finalToolCalls = collectedToolCalls.map(tc => {
        const res = results.find(r => r.toolCallId === tc.id);
        return {
          id: tc.id,
          name: tc.name,
          input: tc.input,
          result: res?.result,
          resultContent: res?.resultContent, // Persist multi-modal data in history
        };
      });

      const lastMsg = chatStore.conversations[session.conversationId].messages.find(m => m.id === assistantMsgId);
      console.log('[AgentV2:Engine] Turn complete. StopReason=end_turn. LLM Response:', lastMsg?.content || '(Empty)');
      
      session.history.push({
        id: assistantMsgId,
        role: 'assistant',
        content: lastMsg?.content || '',
        thinking: collectedThinking || undefined,
        toolCalls: finalToolCalls,
        timestamp: Date.now(),
      });

      return { stopReason: 'end_turn' };
    }

    // No tool calls, turn ended naturally
    const lastMsg = chatStore.conversations[session.conversationId].messages.find(m => m.id === assistantMsgId);
    session.history.push({
      id: assistantMsgId,
      role: 'assistant',
      content: lastMsg?.content || '',
      thinking: collectedThinking || undefined,
      timestamp: Date.now(),
    });

    return { stopReason: 'delegate_complete' };
  }

  private async executeToolBatch(
    toolCalls: (ToolCall & { id: string })[], 
    validators: Map<string, (input: any) => boolean>,
    toolCallIdToStepId: Map<string, string>,
    assistantMsgId: string
  ): Promise<any[]> {
    const { commandConfirmCallback, filePermissionCallback } = this.ctx;
    const settings = useSettingsStore.getState();
    const eventRouter = this.ctx.eventRouter;
    const loopId = this.ctx.session.loopId;
    const conversationId = this.ctx.session.conversationId;

    // [New] Sequential execution for computer use
    const hasComputerTool = toolCalls.some(tc => tc.name === 'computer');

    const executeSingle = async (tc: (ToolCall & { id: string; hidden?: boolean })) => {
      if (validators.has(tc.name) && !validators.get(tc.name)!(tc.input)) {
        const result = `Error: Input validation failed for tool ${tc.name}`;
        return { toolCallId: tc.id, result };
      }

      // [New] Emit preToolCall hook
      const preEvent = await emitHook({
        type: 'preToolCall',
        timestamp: Date.now(),
        conversationId,
        toolName: tc.name,
        toolInput: tc.input as Record<string, unknown>,
      } as PreToolCallEvent);

      if (preEvent.blocked) {
        return { toolCallId: tc.id, result: '[Blocked by system hook]' };
      }
      const effectiveInput = preEvent.modifiedInput ?? tc.input;

      // ── Loop Detection ──
      const loopCheck = detectToolCallLoop(this.loopDetectionState, tc.name, effectiveInput);
      if (loopCheck.stuck && loopCheck.level === 'critical') {
        const result = `Error: Loop detected: ${loopCheck.message}`;
        return { toolCallId: tc.id, result };
      }
      recordToolCall(this.loopDetectionState, tc.name, effectiveInput, tc.id);

      const startTime = Date.now();
      try {
        const rawResult = await executeAnyTool(
          tc.name,
          effectiveInput as Record<string, unknown>,
          commandConfirmCallback,
          filePermissionCallback
        );
        const durationMs = Date.now() - startTime;
        
        // Truncate if oversized using shared utility
        const { text: resultString } = truncateIfOversized(
          toolResultToString(rawResult), 
          settings.contextWindowSize ?? 200000
        );
        const resultContent = typeof rawResult !== 'string' ? rawResult : undefined;
        
        // Mark step as ended in UI (EventRouter)
        const stepId = toolCallIdToStepId.get(tc.id);
        if (stepId) {
          await eventRouter.route({
            type: 'step-end',
            loopId,
            stepId,
            result: resultString,
            resultContent,
            toolCallId: tc.id
          });

          // [New] Update linked planned step status
          const currentExec = useTaskExecutionStore.getState().getExecutionByLoopId(loopId);
          if (currentExec) {
            const linkedPlanned = currentExec.plannedSteps.find(s => s.linkedStepId === stepId);
            if (linkedPlanned) {
              useTaskExecutionStore.getState().updatePlannedStepStatus(currentExec.id, linkedPlanned.index, 'completed');
            }
          }
        }

        // Real-time update to message bubble tool result (ChatStore)
        const chatStoreAction = useChatStore.getState();
        chatStoreAction.updateToolCall(conversationId, assistantMsgId, tc.id, resultString, resultContent, false);

        recordToolCallOutcome(this.loopDetectionState, {
          toolName: tc.name,
          toolParams: effectiveInput,
          toolCallId: tc.id,
          result: resultString
        });
        
        // [New] Emit postToolCall hook
        await emitHook({
          type: 'postToolCall',
          timestamp: Date.now(),
          conversationId,
          toolName: tc.name,
          toolInput: effectiveInput as Record<string, unknown>,
          result: resultString,
          error: false,
          durationMs,
        });

        return { toolCallId: tc.id, result: resultString, resultContent };
      } catch (err) {
        const durationMs = Date.now() - startTime;
        const errorMessage = `Error: ${String(err)}`;
        
        const stepId = toolCallIdToStepId.get(tc.id);
        if (stepId) {
          await eventRouter.route({
            type: 'step-error',
            loopId,
            stepId,
            error: errorMessage,
            toolCallId: tc.id
          });

          // [New] Update linked planned step status
          const currentExec = useTaskExecutionStore.getState().getExecutionByLoopId(loopId);
          if (currentExec) {
            const linkedPlanned = currentExec.plannedSteps.find(s => s.linkedStepId === stepId);
            if (linkedPlanned) {
              useTaskExecutionStore.getState().updatePlannedStepStatus(currentExec.id, linkedPlanned.index, 'error');
            }
          }
        }

        // Real-time update to message bubble (Error state)
        const chatStoreAction = useChatStore.getState();
        chatStoreAction.updateToolCall(conversationId, assistantMsgId, tc.id, errorMessage, undefined, true);

        recordToolCallOutcome(this.loopDetectionState, {
          toolName: tc.name,
          toolParams: effectiveInput,
          toolCallId: tc.id,
          error: errorMessage
        });
        
        // [New] Emit postToolCall hook (error case)
        await emitHook({
          type: 'postToolCall',
          timestamp: Date.now(),
          conversationId,
          toolName: tc.name,
          toolInput: effectiveInput as Record<string, unknown>,
          result: errorMessage,
          error: true,
          durationMs,
        });

        return { toolCallId: tc.id, result: errorMessage };
      }
    };

    if (hasComputerTool) {
      // Sequential Computer Use Batch Mode
      try { await ipc.invoke('window_hide'); } catch { /* ignore */ }
      await new Promise(r => setTimeout(r, 200));
      setComputerUseBatchMode(true);
      
      const results: any[] = [];
      try {
        for (let i = 0; i < toolCalls.length; i++) {
          const tc = toolCalls[i];
          const hasMoreComputer = toolCalls.slice(i + 1).some(t => t.name === 'computer');
          setSkipAutoScreenshot(tc.name === 'computer' && hasMoreComputer);
          results.push(await executeSingle(tc));
        }
      } finally {
        setSkipAutoScreenshot(false);
        setComputerUseBatchMode(false);
        try { await ipc.invoke('window_show'); } catch { /* ignore */ }
      }
      return results;
    } else {
      // Parallel execution
      return Promise.all(toolCalls.map(executeSingle));
    }
  }

  private getBaseSystemPrompt(): string {
    return this.options.systemPrompt || '你叫太资如意，是一个专业靠谱的桌面助手。回复友好简洁。';
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
  }
}
