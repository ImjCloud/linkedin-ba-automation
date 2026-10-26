import { randomUUID } from 'node:crypto';
import type { DraftSource } from '@/lib/content-quality';

export type DraftReviewStatus =
  | 'Not reviewed'
  | 'Approved locally'
  | 'Returned for revision';

export type SavedDraft = {
  id: string;
  topic: string;
  text: string;
  sources: DraftSource[];
  reviewStatus: DraftReviewStatus;
  checks: { passed: boolean; reasons: string[] };
  created_at: string;
  updated_at: string;
};

export type DraftUpdates = Pick<
  SavedDraft,
  'topic' | 'text' | 'sources' | 'reviewStatus' | 'checks'
>;

export interface DraftRedis {
  get<T = unknown>(key: string): Promise<T | null>;
  lrange<T = unknown>(key: string, start: number, stop: number): Promise<T[]>;
  eval<T = unknown>(script: string, keys: string[], args: string[]): Promise<T>;
}

const DRAFT_PREFIX = 'linkedin:drafts:';
const DRAFT_INDEX = 'linkedin:drafts:index';
const MAX_DRAFTS = 100;

export function draftKey(id: string): string {
  return `${DRAFT_PREFIX}${id}`;
}

const CREATE_DRAFT_SCRIPT = `
-- create-saved-draft
local indexType = redis.call('TYPE', KEYS[2]).ok
if indexType ~= 'none' and indexType ~= 'list' then
  return redis.error_reply('Draft index has an unexpected Redis type.')
end

local saved = redis.call('SET', KEYS[1], ARGV[1], 'NX')
if not saved then
  return 0
end

redis.call('LPUSH', KEYS[2], ARGV[2])
redis.call('LTRIM', KEYS[2], 0, tonumber(ARGV[3]) - 1)
return 1
`;

const UPDATE_DRAFT_SCRIPT = `
-- update-saved-draft
local current = redis.call('GET', KEYS[1])
if not current then
  return nil
end
local record = cjson.decode(current)
local status = record.publishStatus or 'not_published'
if status == 'publishing' or status == 'published' or status == 'manual_review_required' then
  return '__draft_protected__'
end
local updates = cjson.decode(ARGV[1])
for key, value in pairs(updates) do
  record[key] = value
end
record.updated_at = ARGV[2]
local encoded = cjson.encode(record)
redis.call('SET', KEYS[1], encoded)
return encoded
`;

const DELETE_DRAFT_SCRIPT = `
-- delete-saved-draft
local current = redis.call('GET', KEYS[1])
if not current then
  return 0
end
local record = cjson.decode(current)
local status = record.publishStatus or 'not_published'
if status == 'publishing' or status == 'published' or status == 'manual_review_required' then
  return -1
end
redis.call('DEL', KEYS[1])
redis.call('LREM', KEYS[2], 0, ARGV[1])
return 1
`;

function decodeRecord(value: unknown): SavedDraft | null {
  if (value === null || value === undefined) return null;

  const decoded = typeof value === 'string' ? JSON.parse(value) : value;
  if (!decoded || typeof decoded !== 'object') {
    throw new Error('Redis returned an invalid draft record.');
  }

  return decoded as SavedDraft;
}

export function createDraftStore(getRedis: () => DraftRedis) {
  async function getSavedDraft(id: string): Promise<SavedDraft | null> {
    return getRedis().get<SavedDraft>(draftKey(id));
  }

  async function listSavedDrafts(): Promise<SavedDraft[]> {
    const redis = getRedis();
    const ids = await redis.lrange<string>(DRAFT_INDEX, 0, MAX_DRAFTS - 1);

    if (!Array.isArray(ids) || ids.length === 0) return [];

    const records = await Promise.all(
      ids.map((id) => redis.get<SavedDraft>(draftKey(id))),
    );

    return records.filter((record): record is SavedDraft => record !== null);
  }

  async function createSavedDraft(
    input: Omit<SavedDraft, 'id' | 'created_at' | 'updated_at'>,
  ): Promise<SavedDraft> {
    const now = new Date().toISOString();
    const record: SavedDraft = {
      ...input,
      id: randomUUID(),
      created_at: now,
      updated_at: now,
    };

    const result = await getRedis().eval<number>(
      CREATE_DRAFT_SCRIPT,
      [draftKey(record.id), DRAFT_INDEX],
      [JSON.stringify(record), record.id, String(MAX_DRAFTS)],
    );

    if (Number(result) !== 1) {
      throw new Error('Could not reserve a unique draft identifier.');
    }

    return record;
  }

  async function updateSavedDraft(
    id: string,
    updates: DraftUpdates,
  ): Promise<SavedDraft | null> {
    const result = await getRedis().eval<unknown>(
      UPDATE_DRAFT_SCRIPT,
      [draftKey(id)],
      [JSON.stringify(updates), new Date().toISOString()],
    );

    if (result === '__draft_protected__') {
      throw new Error('DRAFT_PROTECTED');
    }
    return decodeRecord(result);
  }

  async function deleteSavedDraft(id: string): Promise<boolean> {
    const result = await getRedis().eval<number>(
      DELETE_DRAFT_SCRIPT,
      [draftKey(id), DRAFT_INDEX],
      [id],
    );
    if (Number(result) === -1) {
      throw new Error('DRAFT_PROTECTED');
    }
    return Number(result) === 1;
  }

  return {
    getSavedDraft,
    listSavedDrafts,
    createSavedDraft,
    updateSavedDraft,
    deleteSavedDraft,
  };
}
