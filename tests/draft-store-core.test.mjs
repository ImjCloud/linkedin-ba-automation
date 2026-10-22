import test from 'node:test';
import assert from 'node:assert/strict';
import { createDraftStore } from '../lib/draft-store-core.ts';

function createMockRedis() {
  const values = new Map();
  const lists = new Map();

  return {
    values,
    lists,

    async get(key) {
      const value = values.get(key);
      if (value === undefined) return null;
      return typeof value === 'string' ? JSON.parse(value) : value;
    },

    async lrange(key, start, stop) {
      return (lists.get(key) ?? []).slice(start, stop + 1);
    },

    async eval(script, keys, args) {
      if (script.includes('-- create-saved-draft')) {
        const [recordKey, indexKey] = keys;
        const [recordJson, id, maxItems] = args;

        if (values.has(recordKey)) return 0;

        values.set(recordKey, recordJson);

        const index = lists.get(indexKey) ?? [];
        index.unshift(id);
        lists.set(indexKey, index.slice(0, Number(maxItems)));

        return 1;
      }

      if (script.includes('-- update-saved-draft')) {
        const [recordKey] = keys;
        const [updatesJson, updatedAt] = args;
        const currentJson = values.get(recordKey);

        if (currentJson === undefined) return null;

        const record = JSON.parse(currentJson);
        const updates = JSON.parse(updatesJson);
        Object.assign(record, updates);
        record.updated_at = updatedAt;

        const encoded = JSON.stringify(record);
        values.set(recordKey, encoded);
        return encoded;
      }

      if (script.includes('-- delete-saved-draft')) {
        const [recordKey, indexKey] = keys;
        const [id] = args;

        if (!values.has(recordKey)) return 0;

        values.delete(recordKey);
        const index = lists.get(indexKey) ?? [];
        lists.set(indexKey, index.filter((item) => item !== id));
        return 1;
      }

      throw new Error('Unexpected script passed to mock Redis.');
    },
  };
}

function sampleInput(topic = 'Requirements elicitation') {
  return {
    topic,
    text: 'A business analyst should validate requirements with stakeholders.',
    sources: [{ title: 'Example source', url: 'https://example.com' }],
    reviewStatus: 'Not reviewed',
    checks: { passed: true, reasons: [] },
  };
}

test('creates a draft and adds its ID to the index', async () => {
  const redis = createMockRedis();
  const store = createDraftStore(() => redis);

  const draft = await store.createSavedDraft(sampleInput());

  assert.ok(draft.id);
  assert.equal(draft.topic, 'Requirements elicitation');
  assert.ok(draft.created_at);
  assert.equal(draft.updated_at, draft.created_at);
  assert.deepEqual(await store.getSavedDraft(draft.id), draft);
  assert.deepEqual(
    await redis.lrange('linkedin:drafts:index', 0, 99),
    [draft.id],
  );
});

test('updates an existing draft and preserves its ID and creation time', async () => {
  const redis = createMockRedis();
  const store = createDraftStore(() => redis);
  const original = await store.createSavedDraft(sampleInput());

  const updated = await store.updateSavedDraft(original.id, {
    ...sampleInput('Acceptance criteria'),
    reviewStatus: 'Approved locally',
  });

  assert.ok(updated);
  assert.equal(updated.id, original.id);
  assert.equal(updated.created_at, original.created_at);
  assert.equal(updated.topic, 'Acceptance criteria');
  assert.equal(updated.reviewStatus, 'Approved locally');
  assert.deepEqual(await store.getSavedDraft(original.id), updated);
});

test('returns null when asked to update a missing draft', async () => {
  const store = createDraftStore(() => createMockRedis());

  const result = await store.updateSavedDraft('missing-id', {
    ...sampleInput(),
  });

  assert.equal(result, null);
});

test('keeps the index limited to the newest 100 drafts', async () => {
  const redis = createMockRedis();
  const store = createDraftStore(() => redis);

  const created = [];
  for (let i = 0; i < 105; i++) {
    created.push(await store.createSavedDraft(sampleInput(`Topic ${i}`)));
  }

  const index = await redis.lrange('linkedin:drafts:index', 0, 99);

  assert.equal(index.length, 100);
  assert.equal(index[0], created[104].id);
  assert.equal(index[99], created[5].id);
  assert.equal((await store.listSavedDrafts()).length, 100);
});

test('deletes a draft record and removes its ID from the index', async () => {
  const redis = createMockRedis();
  const store = createDraftStore(() => redis);
  const draft = await store.createSavedDraft(sampleInput());

  const deleted = await store.deleteSavedDraft(draft.id);

  assert.equal(deleted, true);
  assert.equal(await store.getSavedDraft(draft.id), null);
  assert.deepEqual(
    await redis.lrange('linkedin:drafts:index', 0, 99),
    [],
  );
});

test('returns false when asked to delete a missing draft', async () => {
  const redis = createMockRedis();
  const store = createDraftStore(() => redis);

  assert.equal(await store.deleteSavedDraft('missing-id'), false);
});

test('uses atomic Redis scripts for creation, updates and deletion', async () => {
  const scripts = [];
  const redis = createMockRedis();
  const originalEval = redis.eval.bind(redis);

  redis.eval = async (script, keys, args) => {
    scripts.push(script);
    return originalEval(script, keys, args);
  };

  const store = createDraftStore(() => redis);
  const draft = await store.createSavedDraft(sampleInput());
  await store.updateSavedDraft(draft.id, sampleInput('Updated topic'));
  await store.deleteSavedDraft(draft.id);

  assert.equal(scripts.length, 3);
  assert.match(scripts[0], /SET.*NX/s);
  assert.match(scripts[0], /LPUSH/);
  assert.match(scripts[0], /LTRIM/);
  assert.match(scripts[1], /redis\.call\('GET'/);
  assert.match(scripts[1], /redis\.call\('SET'/);
  assert.match(scripts[2], /redis\.call\('DEL'/);
  assert.match(scripts[2], /redis\.call\('LREM'/);
});


// EDGE_CASE_TESTS_20261022

test('rejects a draft creation when Redis cannot reserve a unique ID', async () => {
  const redis = createMockRedis();
  redis.eval = async (script) => {
    if (script.includes('-- create-saved-draft')) return 0;
    throw new Error('Unexpected script passed to mock Redis.');
  };

  const store = createDraftStore(() => redis);

  await assert.rejects(
    store.createSavedDraft(sampleInput()),
    /Could not reserve a unique draft identifier/,
  );
  assert.equal(redis.values.size, 0);
});

test('deletion removes every occurrence of the draft ID from the index', async () => {
  const redis = createMockRedis();
  const store = createDraftStore(() => redis);
  const draft = await store.createSavedDraft(sampleInput());

  redis.lists.set('linkedin:drafts:index', [
    draft.id,
    'another-draft-id',
    draft.id,
    draft.id,
  ]);

  assert.equal(await store.deleteSavedDraft(draft.id), true);
  assert.equal(await store.getSavedDraft(draft.id), null);
  assert.deepEqual(
    await redis.lrange('linkedin:drafts:index', 0, 99),
    ['another-draft-id'],
  );
});

test('rejects malformed JSON returned for an updated draft', async () => {
  const redis = createMockRedis();
  const store = createDraftStore(() => redis);
  const draft = await store.createSavedDraft(sampleInput());
  const originalEval = redis.eval.bind(redis);

  redis.eval = async (script, keys, args) => {
    if (script.includes('-- update-saved-draft')) {
      return '{malformed-json';
    }
    return originalEval(script, keys, args);
  };

  await assert.rejects(
    store.updateSavedDraft(draft.id, {
      ...sampleInput('Updated topic'),
    }),
    SyntaxError,
  );
});

test('guards draft creation against an unexpected Redis index type', async () => {
  const redis = createMockRedis();
  redis.values.set('linkedin:drafts:index', 'not-a-list');

  let capturedScript = '';
  const originalEval = redis.eval.bind(redis);

  redis.eval = async (script, keys, args) => {
    if (script.includes('-- create-saved-draft')) {
      capturedScript = script;

      // Simulate Redis TYPE returning a non-list index.
      if (redis.values.has(keys[1])) {
        throw new Error('Draft index has an unexpected Redis type.');
      }
    }

    return originalEval(script, keys, args);
  };

  const store = createDraftStore(() => redis);

  await assert.rejects(
    store.createSavedDraft(sampleInput()),
    /Draft index has an unexpected Redis type/,
  );

  assert.match(capturedScript, /redis\.call\('TYPE', KEYS\[2\]\)/);
  assert.match(capturedScript, /redis\.error_reply/);
  assert.equal(redis.values.get('linkedin:drafts:index'), 'not-a-list');
});
