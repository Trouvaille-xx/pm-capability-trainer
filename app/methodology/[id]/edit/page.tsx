"use client";

import { useParams } from "next/navigation";

import { MethodologyComposer } from "@/components/MethodologyComposer";

/** 改写某个知识点。和新增同一个组件，只是预填 + 保存走 PATCH。 */
export default function EditMethodologyPage() {
  const params = useParams<{ id: string }>();
  return <MethodologyComposer mode="edit" cardId={params.id} />;
}
