import type {
  SessionActivitySummaryBatchInput,
  SessionActivitySummaryBatchResult,
} from "../config/sessions/activity-summary-source.types.js";
import { ACTIVITY_SUMMARY_FORMAT_REVISION } from "../config/sessions/activity-summary.js";

type Batch = NonNullable<SessionActivitySummaryBatchResult>;

export const ACTIVITY_SUMMARY_MAX_BYTES = 128 * 1024;
/** Messages a single recap call may read; older unread messages are skipped. */
export const ACTIVITY_SUMMARY_MAX_BATCH_MESSAGES = 64;

/** The worker and complete actor replica apply the same incremental summary policy. */
export function selectActivitySummaryBatch(params: {
  previous: SessionActivitySummaryBatchInput["previous"];
  snapshot: Batch["snapshot"];
  watermark: Batch["watermark"];
  isOnActivePath: (entryId: string) => boolean;
  readPage: (
    start: number,
    count: number,
    includeEarlier?: boolean,
  ) => Batch["page"] & { hasOversizedMessages?: boolean };
}): Batch {
  const { snapshot, watermark } = params;
  let previous = params.previous;
  if (
    previous &&
    (previous.generation !== (snapshot.snapshot.generation ?? null) ||
      previous.coveredMessages > snapshot.totalMessages ||
      (previous.leafEntryId && !params.isOnActivePath(previous.leafEntryId)))
  ) {
    previous = undefined;
  }
  // Local: a recap only reads the most recent batch. When more messages than one
  // batch arrived since the last recap, the older ones are skipped (and reported
  // as omitted) instead of being walked one batch per refresh interval.
  const backlog = snapshot.totalMessages - (previous?.coveredMessages ?? 0);
  const skipped = backlog > ACTIVITY_SUMMARY_MAX_BATCH_MESSAGES;
  const covered = skipped
    ? snapshot.totalMessages - ACTIVITY_SUMMARY_MAX_BATCH_MESSAGES
    : (previous?.coveredMessages ?? 0);
  let batchSize = Math.min(ACTIVITY_SUMMARY_MAX_BATCH_MESSAGES, snapshot.totalMessages - covered);
  const earlierOmission =
    previous?.omittedContent &&
    (previous.formatRevision === ACTIVITY_SUMMARY_FORMAT_REVISION ||
      params.readPage(covered, 0, true).hasOversizedMessages);
  let page = params.readPage(covered, batchSize);
  while (batchSize > 1 && page.events.length < page.scannedMessages) {
    batchSize = Math.max(1, Math.floor(batchSize / 2));
    page = params.readPage(covered, batchSize);
  }
  // Shrinking leaves only individually oversized omissions; recheck legacy flags by role.
  return {
    previous,
    snapshot,
    watermark,
    covered,
    page,
    omitted: skipped || earlierOmission === true || page.hasOversizedMessages === true,
  };
}
