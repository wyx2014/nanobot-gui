import { describe, it, expect, beforeEach } from 'vitest';
import { useTaskExecutionStore } from './taskExecutionStore';

describe('taskExecutionStore', () => {
  beforeEach(() => {
    useTaskExecutionStore.setState({
      executions: {},
      activeExecutionId: null,
      loopIdIndex: {},
    });
  });

  // ── Planned Steps: linkPlannedStep & updatePlannedStepStatus ──
  describe('planned step linking', () => {
    it('links a planned step to an execution step and sets status to running', () => {
      const store = useTaskExecutionStore.getState();
      const exec = store.createExecution('conv-1', 'loop-1');

      // Set planned steps (simulating report_plan)
      store.setPlannedSteps(exec.id, [
        { index: 1, description: '扫描桌面文件', status: 'pending' },
        { index: 2, description: '识别发票', status: 'pending' },
        { index: 3, description: '移动发票', status: 'pending' },
      ]);

      // Link first planned step to an execution step
      store.linkPlannedStep(exec.id, 1, 'step-abc');

      const updated = useTaskExecutionStore.getState().executions[exec.id];
      expect(updated.plannedSteps[0].linkedStepId).toBe('step-abc');
      expect(updated.plannedSteps[0].status).toBe('running');
      // Other steps remain pending
      expect(updated.plannedSteps[1].status).toBe('pending');
      expect(updated.plannedSteps[2].status).toBe('pending');
    });

    it('updates linked planned step status to completed', () => {
      const store = useTaskExecutionStore.getState();
      const exec = store.createExecution('conv-1', 'loop-1');

      store.setPlannedSteps(exec.id, [
        { index: 1, description: '扫描桌面文件', status: 'pending' },
        { index: 2, description: '识别发票', status: 'pending' },
      ]);

      // Link and then complete
      store.linkPlannedStep(exec.id, 1, 'step-abc');
      store.updatePlannedStepStatus(exec.id, 1, 'completed');

      const updated = useTaskExecutionStore.getState().executions[exec.id];
      expect(updated.plannedSteps[0].status).toBe('completed');
      expect(updated.plannedSteps[0].linkedStepId).toBe('step-abc');
    });

    it('updates linked planned step status to error', () => {
      const store = useTaskExecutionStore.getState();
      const exec = store.createExecution('conv-1', 'loop-1');

      store.setPlannedSteps(exec.id, [
        { index: 1, description: '扫描桌面文件', status: 'pending' },
      ]);

      store.linkPlannedStep(exec.id, 1, 'step-abc');
      store.updatePlannedStepStatus(exec.id, 1, 'error');

      const updated = useTaskExecutionStore.getState().executions[exec.id];
      expect(updated.plannedSteps[0].status).toBe('error');
    });
  });

  // ── Auto-linking simulation (mimics agentLoop behavior) ──
  describe('planned step auto-linking flow', () => {
    it('simulates the full auto-linking lifecycle: pending → running → completed', () => {
      const store = useTaskExecutionStore.getState();
      const exec = store.createExecution('conv-1', 'loop-1');

      // report_plan sets planned steps
      store.setPlannedSteps(exec.id, [
        { index: 1, description: '扫描桌面文件', status: 'pending' },
        { index: 2, description: '识别发票', status: 'pending' },
        { index: 3, description: '创建文件夹', status: 'pending' },
      ]);

      // --- Tool 1 starts: auto-link to next pending step ---
      const state1 = useTaskExecutionStore.getState().executions[exec.id];
      const nextPending1 = state1.plannedSteps.find(s => s.status === 'pending');
      expect(nextPending1?.index).toBe(1);

      useTaskExecutionStore.getState().linkPlannedStep(exec.id, nextPending1!.index, 'step-1');
      useTaskExecutionStore.getState().updatePlannedStepStatus(exec.id, nextPending1!.index, 'running');

      // Verify step 1 is running
      let current = useTaskExecutionStore.getState().executions[exec.id];
      expect(current.plannedSteps[0].status).toBe('running');
      expect(current.plannedSteps[1].status).toBe('pending');

      // --- Tool 1 completes ---
      const linked1 = current.plannedSteps.find(s => s.linkedStepId === 'step-1');
      expect(linked1).toBeDefined();
      useTaskExecutionStore.getState().updatePlannedStepStatus(exec.id, linked1!.index, 'completed');

      current = useTaskExecutionStore.getState().executions[exec.id];
      expect(current.plannedSteps[0].status).toBe('completed');

      // --- Tool 2 starts: auto-link to next pending step (should be step 2) ---
      const state2 = useTaskExecutionStore.getState().executions[exec.id];
      const nextPending2 = state2.plannedSteps.find(s => s.status === 'pending');
      expect(nextPending2?.index).toBe(2);

      useTaskExecutionStore.getState().linkPlannedStep(exec.id, nextPending2!.index, 'step-2');
      useTaskExecutionStore.getState().updatePlannedStepStatus(exec.id, nextPending2!.index, 'running');

      current = useTaskExecutionStore.getState().executions[exec.id];
      expect(current.plannedSteps[1].status).toBe('running');

      // --- Tool 2 completes ---
      const linked2 = current.plannedSteps.find(s => s.linkedStepId === 'step-2');
      useTaskExecutionStore.getState().updatePlannedStepStatus(exec.id, linked2!.index, 'completed');

      // --- Tool 3 starts and completes ---
      const state3 = useTaskExecutionStore.getState().executions[exec.id];
      const nextPending3 = state3.plannedSteps.find(s => s.status === 'pending');
      expect(nextPending3?.index).toBe(3);

      useTaskExecutionStore.getState().linkPlannedStep(exec.id, nextPending3!.index, 'step-3');
      useTaskExecutionStore.getState().updatePlannedStepStatus(exec.id, nextPending3!.index, 'completed');

      // All steps completed
      const final = useTaskExecutionStore.getState().executions[exec.id];
      expect(final.plannedSteps.every(s => s.status === 'completed')).toBe(true);
      expect(final.plannedSteps.map(s => s.linkedStepId)).toEqual(['step-1', 'step-2', 'step-3']);
    });

    it('handles error in the middle of auto-linking flow', () => {
      const store = useTaskExecutionStore.getState();
      const exec = store.createExecution('conv-1', 'loop-1');

      store.setPlannedSteps(exec.id, [
        { index: 1, description: '扫描桌面文件', status: 'pending' },
        { index: 2, description: '识别发票', status: 'pending' },
      ]);

      // Step 1: link, run, complete
      useTaskExecutionStore.getState().linkPlannedStep(exec.id, 1, 'step-1');
      useTaskExecutionStore.getState().updatePlannedStepStatus(exec.id, 1, 'completed');

      // Step 2: link, run, ERROR
      useTaskExecutionStore.getState().linkPlannedStep(exec.id, 2, 'step-2');
      useTaskExecutionStore.getState().updatePlannedStepStatus(exec.id, 2, 'error');

      const final = useTaskExecutionStore.getState().executions[exec.id];
      expect(final.plannedSteps[0].status).toBe('completed');
      expect(final.plannedSteps[1].status).toBe('error');
    });

    it('does not link when no planned steps exist', () => {
      const store = useTaskExecutionStore.getState();
      const exec = store.createExecution('conv-1', 'loop-1');

      // No planned steps set — simulate the agentLoop auto-link check
      const state = useTaskExecutionStore.getState().executions[exec.id];
      const nextPending = state.plannedSteps.find(s => s.status === 'pending');
      expect(nextPending).toBeUndefined();
    });

    it('does not link when all planned steps are already completed', () => {
      const store = useTaskExecutionStore.getState();
      const exec = store.createExecution('conv-1', 'loop-1');

      store.setPlannedSteps(exec.id, [
        { index: 1, description: '扫描桌面文件', status: 'pending' },
      ]);

      // Complete the only step
      useTaskExecutionStore.getState().linkPlannedStep(exec.id, 1, 'step-1');
      useTaskExecutionStore.getState().updatePlannedStepStatus(exec.id, 1, 'completed');

      // Now try to find next pending — should be undefined
      const state = useTaskExecutionStore.getState().executions[exec.id];
      const nextPending = state.plannedSteps.find(s => s.status === 'pending');
      expect(nextPending).toBeUndefined();
    });
  });

  // ── completeExecution auto-completes remaining planned steps ──
  describe('completeExecution planned step cleanup', () => {
    it('marks remaining pending/running planned steps as completed when execution completes', () => {
      const store = useTaskExecutionStore.getState();
      const exec = store.createExecution('conv-1', 'loop-1');

      store.setPlannedSteps(exec.id, [
        { index: 1, description: '步骤1', status: 'completed' },
        { index: 2, description: '步骤2', status: 'running' },
        { index: 3, description: '步骤3', status: 'pending' },
      ]);

      store.completeExecution(exec.id);

      const final = useTaskExecutionStore.getState().executions[exec.id];
      expect(final.plannedSteps[0].status).toBe('completed');
      expect(final.plannedSteps[1].status).toBe('completed');
      expect(final.plannedSteps[2].status).toBe('completed');
      expect(final.status).toBe('completed');
    });
  });
});
