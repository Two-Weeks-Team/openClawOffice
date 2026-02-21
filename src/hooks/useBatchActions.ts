import { useEffect, useMemo, useRef, useState } from "react";
import {
  loadBatchActionState,
  persistBatchActionState,
  type BatchActionState,
} from "../lib/entity-batch-actions";

export function useBatchActions() {
  const [batchActionState, setBatchActionState] = useState<BatchActionState>(loadBatchActionState);
  const hasHydratedRef = useRef(false);

  useEffect(() => {
    if (!hasHydratedRef.current) {
      hasHydratedRef.current = true;
      return;
    }
    persistBatchActionState(batchActionState);
  }, [batchActionState]);

  const pinnedEntityIdSet = useMemo(
    () => new Set(batchActionState.pinnedEntityIds),
    [batchActionState.pinnedEntityIds],
  );

  const watchedEntityIdSet = useMemo(
    () => new Set(batchActionState.watchedEntityIds),
    [batchActionState.watchedEntityIds],
  );

  const mutedEntityIdSet = useMemo(
    () => new Set(batchActionState.mutedEntityIds),
    [batchActionState.mutedEntityIds],
  );

  return {
    batchActionState,
    setBatchActionState,
    pinnedEntityIdSet,
    watchedEntityIdSet,
    mutedEntityIdSet,
  };
}
