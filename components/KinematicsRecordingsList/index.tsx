"use client";

import { TrashIcon, XMarkIcon } from "@heroicons/react/24/outline";
import type { CanvasKeypointName } from "@/interfaces/pose";
import { formatJointName } from "@/utils/joint";

interface Recording {
  id: number;
  duration: number;
  joints: CanvasKeypointName[];
}

interface Props {
  recordings: Recording[];
  onDelete: (id: number) => void;
  onSend: () => void;
  onClose: () => void;
}

function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60).toString().padStart(2, "0");
  const r = (s % 60).toString().padStart(2, "0");
  return `${m}:${r}`;
}

export default function KinematicsRecordingsList({
  recordings,
  onDelete,
  onSend,
  onClose,
}: Props) {
  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex flex-col justify-end">
      <div className="bg-black rounded-t-2xl flex flex-col max-h-[75vh]">
        <div className="shrink-0 flex items-center justify-between px-4 py-3">
          <h2 className="font-display text-white text-base">
            Grabaciones <span className="opacity-50 font-normal">({recordings.length})</span>
          </h2>
          <button onClick={onClose} className="p-1 -mr-1">
            <XMarkIcon className="h-5 w-5 text-white/50" />
          </button>
        </div>

        <div className="overflow-y-auto px-4 pb-2 flex flex-col gap-2">
          {recordings.length === 0 && (
            <p className="text-white/40 text-sm py-4 text-center">No hay grabaciones guardadas</p>
          )}
          {recordings.map((r, i) => (
            <div key={r.id} className="flex items-center justify-between rounded-md bg-white/5 px-3 py-2">
              <div className="flex flex-col">
                <span className="text-white text-sm font-mono">
                  Grabación {i + 1} · {fmtDuration(r.duration)}
                </span>
                <span className="text-white/50 text-xs">
                  {r.joints.map(formatJointName).join(", ")}
                </span>
              </div>
              <button onClick={() => onDelete(r.id)} className="p-1">
                <TrashIcon className="h-4 w-4 text-white/50" />
              </button>
            </div>
          ))}
        </div>

        <div className="shrink-0 flex gap-3 px-4 py-4">
          <button
            onClick={onClose}
            className="flex-1 py-3 rounded-md text-sm text-white/60 border border-white/20 active:bg-white/5"
          >
            Cerrar
          </button>
          <button
            onClick={onSend}
            disabled={recordings.length === 0}
            className="flex-1 py-3 rounded-md text-sm text-white font-medium active:opacity-80 disabled:opacity-40"
            style={{ background: "#5dadec" }}
          >
            Enviar al informe
          </button>
        </div>
      </div>
    </div>
  );
}
