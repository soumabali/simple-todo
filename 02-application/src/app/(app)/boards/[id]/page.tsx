"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { BoardView } from "@/components/board-view";

export type BoardData = {
  board: { id: string; name: string; color: string; description: string | null };
  statuses: { id: string; name: string; color: string; position: string; isDone: boolean; wipLimit: number | null }[];
  tasks: {
    id: string;
    title: string;
    description: string | null;
    statusId: string;
    priority: number;
    startDate: string | null;
    dueDate: string | null;
    dueTime: string | null;
    remindOnStart: boolean;
    remindersMuted: boolean;
    remindLeadMinutes: number | null;
    progress: number;
    position: string;
    completedAt: string | null;
  }[];
  labels: { id: string; name: string; color: string }[];
  subtasks: { id: string; taskId: string; title: string; isDone: boolean; position: string }[];
  taskLabels: { taskId: string; labelId: string }[];
};

export default function BoardPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const id = params.id;

  // PRD F-5.4 (view toggle in URL) and F-6.6 (notification deep link ?task=).
  const viewParam = searchParams.get("view");
  const initialView = viewParam === "gantt" || viewParam === "list" ? viewParam : "board";
  const initialTaskId = searchParams.get("task");

  const { data, isLoading, error } = useQuery({
    queryKey: ["board", id],
    queryFn: () => api<BoardData>(`/api/boards/${id}`),
  });

  if (isLoading) {
    return (
      <div className="p-6" style={{ color: "var(--muted)" }}>
        Loading board…
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="p-6" style={{ color: "var(--danger)" }}>
        Board not found.
      </div>
    );
  }

  return <BoardView data={data} initialView={initialView} initialTaskId={initialTaskId} />;
}
