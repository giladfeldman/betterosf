"use client";

import { useEffect } from "react";
import { recordView, type FavoriteRef } from "@/lib/favorites";

export function RecordView({ refEntry }: { refEntry: FavoriteRef }) {
  useEffect(() => {
    recordView(refEntry);
  }, [refEntry]);
  return null;
}
