"use client";

import { useCallback, useEffect, type ReactNode } from "react";

/**
 * 居中弹窗。
 *
 * 用途：表单类内容（新建 / 编辑知识点、记录，改密码等）。
 * 这类内容应该「打断-完成-离开」，用弹窗最直接。
 *
 * 不要用它装长文阅读类内容——那种东西值得一个独立页面，
 * 有 URL、能后退、能收藏。之前用侧边抽屉装详情，是设计上的偷懒。
 */
export function Modal({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
  width = 620,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onKey]);

  if (!open) return null;

  return (
    <div className="modal-root">
      <div className="modal-scrim" onClick={onClose} />

      <div
        className="modal"
        style={{ maxWidth: width }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="modal-head">
          <div className="modal-title-wrap">
            <h2 className="modal-title">{title}</h2>
            {subtitle ? <div className="modal-sub">{subtitle}</div> : null}
          </div>
          <button
            className="btn btn-sm btn-ghost modal-close"
            onClick={onClose}
            aria-label="关闭"
            title="关闭（Esc）"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinecap="round"
              width={16}
              height={16}
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        <div className="modal-body">{children}</div>

        {footer ? <footer className="modal-foot">{footer}</footer> : null}
      </div>
    </div>
  );
}

/**
 * 确认弹窗。危险操作（删除、重置）用它，不要用 window.confirm——
 * 原生弹窗样式不可控、会阻塞主线程，而且在中文环境下按钮是「确定/取消」的英文系统样式。
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmText = "确认删除",
  cancelText = "取消",
  danger = true,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      width={440}
      footer={
        <>
          <div className="spacer" />
          <button className="btn" onClick={onCancel} disabled={busy}>
            {cancelText}
          </button>
          <button
            className={danger ? "btn btn-danger" : "btn btn-primary"}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "处理中…" : confirmText}
          </button>
        </>
      }
    >
      <p className="modal-message">{message}</p>
    </Modal>
  );
}
