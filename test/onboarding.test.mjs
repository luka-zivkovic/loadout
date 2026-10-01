import test from 'node:test';
import assert from 'node:assert/strict';
import { hasComparableSetups, nextWorkspaceStep } from '../dist/onboarding.js';

const pi = (revision, workflowId = 'review') => ({ revision, workflowId, harness: { kind: 'pi' } });

test('onboarding follows the first-value sequence instead of offering unavailable trials', () => {
  assert.equal(nextWorkspaceStep({ deviceReady: false, setupCount: 0, runCount: 0, comparable: false, pendingTrialCount: 0 }), 'connect-device');
  assert.equal(nextWorkspaceStep({ deviceReady: true, setupCount: 0, runCount: 0, comparable: false, pendingTrialCount: 0 }), 'publish-setup');
  assert.equal(nextWorkspaceStep({ deviceReady: true, setupCount: 1, runCount: 0, comparable: false, pendingTrialCount: 1 }), 'continue-trial');
  assert.equal(nextWorkspaceStep({ deviceReady: true, setupCount: 1, runCount: 0, comparable: false, pendingTrialCount: 0 }), 'measure-run');
  assert.equal(nextWorkspaceStep({ deviceReady: true, setupCount: 1, runCount: 1, comparable: false, pendingTrialCount: 0 }), 'publish-comparable');
  assert.equal(nextWorkspaceStep({ deviceReady: true, setupCount: 2, runCount: 1, comparable: true, pendingTrialCount: 0 }), 'start-trial');
});

test('comparable setups require distinct revisions with the same harness and workflow', () => {
  assert.equal(hasComparableSetups([pi('a'), pi('b')]), true);
  assert.equal(hasComparableSetups([pi('a'), { ...pi('b'), workflowId: 'docs' }]), false);
  assert.equal(hasComparableSetups([pi('a'), { ...pi('b'), harness: { kind: 'codex' } }]), false);
  assert.equal(hasComparableSetups([pi('a'), pi('a')]), false);
});
