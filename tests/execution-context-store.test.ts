import { describe, it, expect, beforeEach } from 'vitest';
import { executionContextStore } from '../server/lib/execution-context-store';

describe('executionContextStore', () => {
  // Clean up between tests by removing known test entries
  const testIds: string[] = [];

  async function registerTestCtx(id: string, userId = 'user-1') {
    testIds.push(id);
    await executionContextStore.register({
      executionId: id,
      projectId: 'proj-1',
      nodeId: 'node-1',
      userId,
      machineId: 'machine-1',
    });
  }

  beforeEach(() => {
    for (const id of testIds) executionContextStore.remove(id);
    testIds.length = 0;
  });

  it('registers and retrieves an execution context', async () => {
    await registerTestCtx('exec-1');
    const ctx = executionContextStore.get('exec-1');
    expect(ctx).toBeDefined();
    expect(ctx!.executionId).toBe('exec-1');
    expect(ctx!.userId).toBe('user-1');
    expect(ctx!.createdAt).toBeGreaterThan(0);
  });

  it('returns undefined for unknown execution', () => {
    expect(executionContextStore.get('nonexistent')).toBeUndefined();
  });

  it('removes an execution context', async () => {
    await registerTestCtx('exec-2');
    expect(executionContextStore.get('exec-2')).toBeDefined();
    executionContextStore.remove('exec-2');
    expect(executionContextStore.get('exec-2')).toBeUndefined();
  });

  it('getUserIdForTask returns userId', async () => {
    await registerTestCtx('exec-3', 'user-abc');
    expect(executionContextStore.getUserIdForTask('exec-3')).toBe('user-abc');
  });

  it('getUserIdForTask returns undefined for unknown task', () => {
    expect(executionContextStore.getUserIdForTask('unknown')).toBeUndefined();
  });

  it('tracks size correctly', async () => {
    const before = executionContextStore.size;
    await registerTestCtx('exec-size-1');
    await registerTestCtx('exec-size-2');
    expect(executionContextStore.size).toBe(before + 2);
    executionContextStore.remove('exec-size-1');
    expect(executionContextStore.size).toBe(before + 1);
  });

  it('createdAt is set automatically', async () => {
    const before = Date.now();
    await registerTestCtx('exec-time');
    const ctx = executionContextStore.get('exec-time');
    expect(ctx!.createdAt).toBeGreaterThanOrEqual(before);
    expect(ctx!.createdAt).toBeLessThanOrEqual(Date.now());
  });
});
