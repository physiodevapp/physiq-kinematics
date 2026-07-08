"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  XMarkIcon,
} from "@heroicons/react/24/outline";
import type { CanvasKeypointName } from "@/interfaces/pose";
import type { KinematicsPayload } from "@/interfaces/kinematics";
import { groupJointNames } from "@/utils/joint";
import { clearSession, readSession, writeSession } from "@/utils/session";

interface Recording {
  id: number;
  startedAt: number;
  duration: number;
  joints: CanvasKeypointName[];
}

interface Props {
  recordings: Recording[];
  sentRecordings: KinematicsPayload[];
  onDelete: (id: number) => void;
  onDeleteSent?: (index: number) => void;
  onOpen: (index: number) => void;
  onOpenSent: (index: number) => void;
  onSend: () => void;
  onClose: () => void;
  defaultTab?: "draft" | "sent";
}

function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60).toString().padStart(2, "0");
  const r = (s % 60).toString().padStart(2, "0");
  return `${m}:${r}`;
}


export default function KinematicsRecordingsList({
  recordings,
  sentRecordings,
  onDelete,
  onDeleteSent,
  onOpen,
  onOpenSent,
  onSend,
  onClose,
  defaultTab = "draft",
}: Props) {
  const [tab, setTab] = useState<"draft" | "sent">(defaultTab);

  const [patient, setPatient] = useState("");
  const [patientInput, setPatientInput] = useState("");
  const [showSessionPanel, setShowSessionPanel] = useState(false);
  const [clearConfirm, setClearConfirm] = useState(false);

  const [showTranslateBanner, setShowTranslateBanner] = useState(false);
  const translateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(0);

  const isInIframe =
    typeof window !== "undefined" && window.self !== window.top;

  const handleGoHome = useCallback(() => {
    window.parent.postMessage({ type: "PHYSIQ_GO_HOME" }, "*");
  }, []);

  useEffect(() => {
    readSession().then((s) => {
      if (s?.patient) setPatient(s.patient);
    });
    const ch = new BroadcastChannel("physiq-session");
    ch.onmessage = (e) => {
      if (e.data?.type === "SESSION_PATIENT") setPatient(e.data.patient ?? "");
      else if (e.data?.type === "SESSION_CLEAR") setPatient("");
    };
    return () => ch.close();
  }, []);

  const handlePatientSave = async () => {
    const trimmed = patientInput.trim();
    setPatient(trimmed);
    await writeSession({ patient: trimmed });
    const ch = new BroadcastChannel("physiq-session");
    ch.postMessage({ type: "SESSION_PATIENT", patient: trimmed });
    ch.close();
  };

  const handleClearSession = async () => {
    await clearSession();
    const ch = new BroadcastChannel("physiq-session");
    ch.postMessage({ type: "SESSION_CLEAR" });
    ch.close();
    setPatient("");
    setClearConfirm(false);
    setShowSessionPanel(false);
  };

  const handleOpenSessionPanel = () => {
    setPatientInput(patient);
    setClearConfirm(false);
    setShowSessionPanel(true);
  };

  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setHeaderHeight(el.offsetHeight));
    observer.observe(el);
    setHeaderHeight(el.offsetHeight);
    return () => observer.disconnect();
  }, []);

  const handleTranslate = () => {
    setShowTranslateBanner(true);
    if (translateTimerRef.current) clearTimeout(translateTimerRef.current);
    translateTimerRef.current = setTimeout(
      () => setShowTranslateBanner(false),
      4000
    );
  };

  const hideTranslateBanner = () => {
    if (translateTimerRef.current) clearTimeout(translateTimerRef.current);
    setShowTranslateBanner(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ background: "#0a0d12" }}
    >
      {/* ── Satellite header ── */}
      <div
        ref={headerRef}
        className="shrink-0 flex items-center justify-between px-6 relative z-10"
        style={{ height: 64, borderBottom: "1px solid #232d45" }}
      >
        <h2 className="font-display text-white text-[1.1rem] min-[480px]:text-[1.2rem] min-[769px]:text-[1.5rem] inline-flex items-center gap-1.5" style={{ letterSpacing: "-0.5px" }}>
          {isInIframe && (
            <span
              className="animate-hub-back-hint transition-opacity duration-150 hover:opacity-100 cursor-pointer"
              style={{ opacity: 0.55 }}
              onClick={handleGoHome}
            >
              ‹
            </span>
          )}
          <span
            className={
              isInIframe
                ? "cursor-pointer transition-opacity duration-150 hover:opacity-75"
                : ""
            }
            onClick={isInIframe ? handleGoHome : undefined}
          >
            Physi
            <span
              style={{
                background: "linear-gradient(135deg,#4f9cf9,#38d9a9)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              Q
            </span>
          </span>
          <span className="opacity-50 font-normal">—</span>
          <span style={{ color: "#5dadec" }}>Kinematics</span>
        </h2>

        <div className="flex items-center gap-3">
          <button
            onClick={handleOpenSessionPanel}
            className="flex items-center justify-center transition-colors"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: patient ? "#5dadec" : "#5a6e8a",
              padding: "6px",
              flexShrink: 0,
            }}
            aria-label="Sesión"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-6 8-6s8 2 8 6"/>
            </svg>
          </button>
          <button
            onClick={handleTranslate}
            className="flex items-center justify-center transition-colors"
            style={{
              background: "transparent",
              border: "none",
              color: "#5a6e8a",
              cursor: "pointer",
              padding: "4px 8px",
              borderRadius: 6,
            }}
            aria-label="View in English"
            title="Long-press or right-click → Translate to English"
          >
            🌐
          </button>
        </div>
      </div>

      {/* ── Translate banner — slides from behind header ── */}
      {headerHeight > 0 && (
        <div
          className="absolute left-0 right-0 flex items-center gap-2 px-4 border-b border-white/10"
          style={{
            top: headerHeight,
            zIndex: 5,
            height: 40,
            background: "#111620",
            transform: showTranslateBanner ? "translateY(0)" : "translateY(-100%)",
            opacity: showTranslateBanner ? 1 : 0,
            transition: "transform 0.25s ease, opacity 0.25s ease",
          }}
        >
          <span className="text-sm">🌐</span>
          <span className="text-white/60 text-xs flex-1">
            Long-press or right-click → Translate to English
          </span>
          <button
            onClick={hideTranslateBanner}
            className="text-white/40 text-base leading-none active:opacity-70"
          >
            ✕
          </button>
        </div>
      )}

      {/* Spacer — pushes sub-header down in sync with the translate banner */}
      <div
        className="shrink-0"
        style={{
          height: showTranslateBanner ? 40 : 0,
          transition: "height 0.25s ease",
        }}
      />

      {/* ── Sub-header: back + tab switcher ── */}
      <div
        className="shrink-0 flex items-center justify-between px-4 py-3"
        style={{ borderBottom: "1px solid #232d45" }}
      >
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 active:opacity-70 transition-opacity"
          style={{
            color: "#8aa4bc",
            border: "1px solid #232d45",
            background: "transparent",
            borderRadius: 8,
            padding: "5px 10px",
            fontFamily: "'DM Mono', monospace",
            fontSize: "11px",
            flexShrink: 0,
            whiteSpace: "nowrap",
          }}
        >
          <span className="leading-none">←</span>
          <span>Cámara</span>
        </button>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setTab("draft")}
            className="transition-colors font-medium"
            style={{
              padding: "5px 13px",
              borderRadius: 20,
              fontSize: "0.72rem",
              fontWeight: 500,
              ...(tab === "draft"
                ? { background: "#5dadec", color: "#0a0d12", border: "1px solid #5dadec" }
                : { color: "#8aa4bc", border: "1px solid #232d45", background: "#111620" }),
            }}
          >
            Borradores
            {recordings.length > 0 && (
              <span className="ml-1 opacity-70">({recordings.length})</span>
            )}
          </button>
          <button
            onClick={() => setTab("sent")}
            className="transition-colors font-medium"
            style={{
              padding: "5px 13px",
              borderRadius: 20,
              fontSize: "0.72rem",
              fontWeight: 500,
              ...(tab === "sent"
                ? { background: "#5dadec", color: "#0a0d12", border: "1px solid #5dadec" }
                : { color: "#8aa4bc", border: "1px solid #232d45", background: "#111620" }),
            }}
          >
            Guardadas
            {sentRecordings.length > 0 && (
              <span className="ml-1 opacity-70">({sentRecordings.length})</span>
            )}
          </button>
        </div>
      </div>

      {/* ── Recordings grid ── */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {tab === "draft" ? (
          recordings.length === 0 ? (
            <p
              className="text-center py-12 text-sm"
              style={{ color: "rgba(255,255,255,0.3)" }}
            >
              No hay borradores guardados
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-2.5">
              {recordings.map((r, i) => (
                <div
                  key={r.id}
                  className="relative flex flex-col gap-1.5 overflow-hidden rounded-2xl cursor-pointer active:opacity-80 transition-opacity animate-fade-up"
                  style={{
                    padding: "18px 16px",
                    background: "#111620",
                    border: "1px solid #232d45",
                    animationDelay: `${i * 40}ms`,
                  }}
                  onClick={() => onOpen(i)}
                >
                  <div
                    className="absolute top-0 left-0 right-0"
                    style={{ height: 2, background: "#5dadec", opacity: 0.6 }}
                  />
                  <span
                    className="text-sm font-medium leading-tight"
                    style={{ color: "#e8edf5" }}
                  >
                    Grabación {i + 1}
                  </span>
                  <span
                    className="font-mono-dm text-[10px] uppercase tracking-wide"
                    style={{ color: "#5a6e8a" }}
                  >
                    Borrador
                  </span>
                  <div className="flex-1 mt-0.5 flex flex-col gap-0.5">
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5" style={{ color: "#5dadec" }}>
                      {groupJointNames(r.joints).map((label) => (
                        <span key={label} className="font-mono-dm text-xs">{label}</span>
                      ))}
                    </div>
                    <div className="flex items-center justify-between mt-0.5">
                      <span className="font-mono-dm text-xs" style={{ color: "#5a6e8a" }}>
                        {fmtDuration(r.duration)}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete(r.id);
                        }}
                        className="active:opacity-70 transition-opacity"
                        style={{ color: "#5a6e8a" }}
                      >
                        <XMarkIcon className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : sentRecordings.length === 0 ? (
          <p
            className="text-center py-12 text-sm"
            style={{ color: "rgba(255,255,255,0.3)" }}
          >
            No hay grabaciones guardadas
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2.5">
            {sentRecordings.map((r, i) => (
              <div
                key={r.startedAt}
                className="relative flex flex-col gap-1.5 overflow-hidden rounded-2xl cursor-pointer active:opacity-80 transition-opacity animate-fade-up"
                style={{
                  padding: "18px 16px",
                  background: "#111620",
                  border: "1px solid #232d45",
                  animationDelay: `${i * 40}ms`,
                }}
                onClick={() => onOpenSent(i)}
              >
                <div
                  className="absolute top-0 left-0 right-0"
                  style={{ height: 2, background: "#5dadec", opacity: 1 }}
                />
                <span
                  className="text-sm font-medium leading-tight"
                  style={{ color: "#e8edf5" }}
                >
                  Medición {i + 1}
                </span>
                <span
                  className="font-mono-dm text-[10px] uppercase tracking-wide"
                  style={{ color: "#5a6e8a" }}
                >
                  Guardada
                </span>
                <div className="flex-1 mt-0.5 flex flex-col gap-0.5">
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5" style={{ color: "#5dadec" }}>
                    {groupJointNames(r.joints).map((label) => (
                      <span key={label} className="font-mono-dm text-xs">{label}</span>
                    ))}
                  </div>
                  <div className="flex items-center justify-between mt-0.5">
                    <span className="font-mono-dm text-xs" style={{ color: "#5a6e8a" }}>
                      {fmtDuration(r.duration)}
                    </span>
                    {onDeleteSent && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteSent(i);
                        }}
                        className="active:opacity-70 transition-opacity"
                        style={{ color: "#5a6e8a" }}
                      >
                        <XMarkIcon className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Action bar ── */}
      {tab === "draft" && recordings.length > 0 && (
        <div
          className="shrink-0 flex gap-3 px-4 py-4"
          style={{ borderTop: "1px solid #232d45" }}
        >
          <button
            onClick={onSend}
            className="flex-1 py-3 rounded-md text-sm text-white font-medium active:opacity-80"
            style={{ background: "#5dadec" }}
          >
            Guardar
          </button>
        </div>
      )}

      {/* ── Session panel (bottom sheet) ── */}
      {showSessionPanel && (
        <div className="fixed inset-0 z-[60] flex items-end">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setShowSessionPanel(false)}
          />
          <div
            className="relative w-full rounded-t-2xl px-4 pt-4 pb-10 shadow-2xl"
            style={{
              background: "#111620",
              borderTop: "1px solid rgba(255,255,255,0.1)",
            }}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-white text-base">
                Sesión activa
              </h3>
              <button
                onClick={() => setShowSessionPanel(false)}
                className="text-white/50 active:opacity-70"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <div className="mb-4">
              <label
                className="font-mono-dm text-xs block mb-1.5"
                style={{ color: "rgba(255,255,255,0.4)" }}
              >
                Paciente
              </label>
              <input
                value={patientInput}
                onChange={(e) => setPatientInput(e.target.value)}
                onBlur={handlePatientSave}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                placeholder="Nombre del paciente..."
                className="w-full rounded-md px-3 py-2.5 text-white text-sm outline-none transition-colors"
                style={{
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.15)",
                  caretColor: "#5dadec",
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = "#5dadec";
                }}
              />
            </div>
            {!clearConfirm ? (
              <button
                onClick={() => setClearConfirm(true)}
                className="w-full py-3 rounded-md text-sm active:bg-white/5"
                style={{
                  color: "rgba(255,255,255,0.5)",
                  border: "1px solid rgba(255,255,255,0.2)",
                }}
              >
                Borrar sesión
              </button>
            ) : (
              <div className="flex flex-col gap-3">
                <p
                  className="text-xs text-center"
                  style={{ color: "rgba(255,255,255,0.5)" }}
                >
                  Se borrará la sesión activa de todos los satélites.
                  ¿Confirmar?
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setClearConfirm(false)}
                    className="flex-1 py-3 rounded-md text-sm active:bg-white/5"
                    style={{
                      color: "rgba(255,255,255,0.6)",
                      border: "1px solid rgba(255,255,255,0.2)",
                    }}
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleClearSession}
                    className="flex-1 py-3 rounded-md text-sm text-white font-medium active:opacity-80"
                    style={{ background: "#5dadec" }}
                  >
                    Confirmar
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
