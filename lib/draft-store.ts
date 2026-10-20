import { getRedis } from '@/lib/redis';
import {
  createDraftStore,
  type DraftRedis,
} from '@/lib/draft-store-core';

export type {
  DraftReviewStatus,
  SavedDraft,
  DraftUpdates,
} from '@/lib/draft-store-core';

const store = createDraftStore(
  () => getRedis() as unknown as DraftRedis,
);

export const draftKey = (id: string) =>
  `linkedin:drafts:${id}`;

export const getSavedDraft = store.getSavedDraft;
export const listSavedDrafts = store.listSavedDrafts;
export const createSavedDraft = store.createSavedDraft;
export const updateSavedDraft = store.updateSavedDraft;

export const deleteSavedDraft = store.deleteSavedDraft;
