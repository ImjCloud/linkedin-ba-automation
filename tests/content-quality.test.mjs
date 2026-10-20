import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDraft } from '../lib/content-quality.ts';

const text = (
  'Business analysis connects operational problems to measurable outcomes. ' +
  'Teams can map the current process, identify delays, validate stakeholder needs, ' +
  'and agree on a baseline before changing a workflow. Clear acceptance criteria ' +
  'help delivery teams test the proposed change, while operational measures show ' +
  'whether the intervention improved the process. '
).repeat(2);

const sources = [
  { title: 'Source One', url: 'https://example.com/one' },
  { title: 'Source Two', url: 'https://example.org/two' },
];

test('accepts a valid mock draft', () => {
  const result = validateDraft('Workflow automation', text, sources);
  assert.equal(text.length >= 500 && text.length <= 3000, true);
  assert.equal(result.passed, true, result.reasons.join('; '));
});

test('rejects a draft with too few HTTPS sources', () => {
  const result = validateDraft('Workflow automation', text, sources.slice(0, 1));
  assert.equal(result.passed, false);
  assert.ok(result.reasons.some((reason) => reason.includes('Fewer than two HTTPS sources')));
});

test('rejects a vague topic', () => {
  assert.equal(validateDraft('AI', text, sources).passed, false);
});

test('rejects a suspected first-person claim', () => {
  const result = validateDraft('Workflow automation', text + ' I led this project.', sources);
  assert.ok(result.reasons.some((reason) => reason.includes('first-person')));
});

test('rejects an absolute claim', () => {
  const result = validateDraft('Workflow automation', text + ' This is guaranteed.', sources);
  assert.ok(result.reasons.some((reason) => reason.includes('absolute')));
});

test('rejects repeated-character anomalies', () => {
  const result = validateDraft('Workflow automation', text + ' AAAAAAAAAA', sources);
  assert.ok(result.reasons.some((reason) => reason.includes('Repeated-character')));
});

test('rejects text outside the permitted length', () => {
  assert.equal(validateDraft('Workflow automation', 'Too short.', sources).passed, false);
});
