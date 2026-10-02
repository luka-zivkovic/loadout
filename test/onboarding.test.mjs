import test from 'node:test';
import assert from 'node:assert/strict';
import { hasComparableSetups, nextWorkspaceStep } from '../dist/onboarding.js';

const pi = (revision, workflowId = 'review') => ({ revision, workflowId, harness: { kind: 'pi' } });

test('one-time setup sharing completes onboarding without activity collection', () => {
  assert.equal(nextWorkspaceStep({ deviceReady: false, setupCount: 0 }), 'connect-device');
  assert.equal(nextWorkspaceStep({ deviceReady: true, setupCount: 0 }), 'publish-setup');
  assert.equal(nextWorkspaceStep({ deviceReady: true, setupCount: 1 }), null);
});

test('comparable setups require distinct revisions with the same harness and workflow', () => {
  assert.equal(hasComparableSetups([pi('a'), pi('b')]), true);
  assert.equal(hasComparableSetups([pi('a'), { ...pi('b'), workflowId: 'docs' }]), false);
  assert.equal(hasComparableSetups([pi('a'), { ...pi('b'), harness: { kind: 'codex' } }]), false);
  assert.equal(hasComparableSetups([pi('a'), pi('a')]), false);
});
