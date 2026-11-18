import { useEffect, useRef, useState } from 'react';
import { downloadBlob } from '../export/exporters';
import { serializeProject } from '../model/project';
import { useAppStore } from '../store/useAppStore';
import { ConnectForm } from './ConnectForm';
import { ChevronIcon } from './icons';
import { ObjectList } from './ObjectList';
import { QuickInput } from './QuickInput';
import { SolidForm } from './SolidForm';

function projectFileName(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `空間向量繪圖_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.json`;
}

/** Side panel (bottom sheet on narrow screens) with input, project files and the object list. */
export function ObjectPanel() {
  const objectCount = useAppStore((s) => s.scene.objects.length);
  const hasObjects = objectCount > 0;
  const [collapsed, setCollapsed] = useState(false);
  const clearScene = useAppStore((s) => s.clearScene);
  const loadProjectText = useAppStore((s) => s.loadProjectText);
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileMsg, setFileMsgState] = useState<{ ok: boolean; text: string } | null>(null);
  // The open/save message belongs to the drawing it was shown for: the next edit clears it.
  const scene = useAppStore((s) => s.scene);
  const msgScene = useRef<unknown>(null);
  const setFileMsg = (m: { ok: boolean; text: string } | null) => {
    msgScene.current = useAppStore.getState().scene;
    setFileMsgState(m);
  };
  useEffect(() => {
    if (scene !== msgScene.current) setFileMsgState(null);
  }, [scene]);
  const storageStatus = useAppStore((s) => s.storageStatus);
  const externalChange = useAppStore((s) => s.externalChange);
  const reloadFromStorage = useAppStore((s) => s.reloadFromStorage);
  const keepThisTab = useAppStore((s) => s.keepThisTab);
  const storageNotice = useAppStore((s) => s.storageNotice);
  const dismissStorageNotice = useAppStore((s) => s.dismissStorageNotice);

  // ---- draggable bottom sheet: drag the handle to any height between "collapsed" and the CSS max ----
  const panelRef = useRef<HTMLElement>(null);
  const [sheetH, setSheetH] = useState<number | null>(null);
  const dragRef = useRef<{ id: number; startY: number; startH: number; moved: boolean } | null>(null);
  const HANDLE_H = 48;
  // Dragging the handle may raise the sheet well above its default height (long object lists); the drawing
  // keeps a strip at the top. Same limit as .panel.has-custom-height in styles.css.
  const maxSheetH = () => window.innerHeight * 0.78;

  const onHandleDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const h = panelRef.current?.getBoundingClientRect().height ?? HANDLE_H;
    dragRef.current = { id: e.pointerId, startY: e.clientY, startH: h, moved: false };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };
  const onHandleMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    const dy = d.startY - e.clientY;
    if (!d.moved && Math.abs(dy) < 5) return;
    d.moved = true;
    const h = Math.max(HANDLE_H, Math.min(maxSheetH(), d.startH + dy));
    setCollapsed(false);
    setSheetH(h);
  };
  const onHandleUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    dragRef.current = null;
    if (!d.moved) {
      setCollapsed((c) => !c); // plain tap keeps the old open/close toggle
      return;
    }
    // Released near the bottom: snap to collapsed. Otherwise stay exactly where it was let go.
    if ((sheetH ?? HANDLE_H) <= HANDLE_H + 12) {
      setCollapsed(true);
      setSheetH(null);
    }
  };

  const save = () => {
    const { scene, view } = useAppStore.getState();
    const name = projectFileName();
    downloadBlob(new Blob([serializeProject(scene, view)], { type: 'application/json' }), name);
    setFileMsg({ ok: true, text: `已儲存 ${name}` });
  };

  const open = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 5_000_000) {
      setFileMsg({ ok: false, text: '檔案太大，不像是本工具的專案檔' });
      return;
    }
    const r = loadProjectText(await file.text());
    setFileMsg(r.ok ? { ok: true, text: `${r.message ?? '已開啟'}（可按復原回到開啟前）` } : { ok: false, text: r.error });
  };

  return (
    <aside
      ref={panelRef}
      className={`panel${collapsed ? ' is-collapsed' : ''}${sheetH !== null && !collapsed ? ' has-custom-height' : ''}`}
      style={sheetH !== null ? ({ '--sheet-h': `${sheetH}px` } as React.CSSProperties) : undefined}
      aria-label="輸入與物件"
    >
      {/* Only visible in the stacked phone / portrait-iPad layout (see styles.css). Drag to resize, tap to toggle. */}
      <button
        type="button"
        className="panel-handle"
        aria-expanded={!collapsed}
        aria-controls="panel-body"
        onPointerDown={onHandleDown}
        onPointerMove={onHandleMove}
        onPointerUp={onHandleUp}
        onPointerCancel={() => (dragRef.current = null)}
        onClick={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setCollapsed((c) => !c);
          }
        }}
      >
        輸入與物件
        <span className="panel-handle-count">{objectCount} 個物件</span>
        <span className="visually-hidden">{collapsed ? '（點一下展開）' : '（點一下收合，讓圖變大）'}</span>
        <ChevronIcon up={collapsed} />
      </button>
      <div className="panel-body" id="panel-body">
        <QuickInput />
        <ConnectForm />
        <SolidForm />
        <div className="panel-heading">
          <h2 className="panel-title">物件</h2>
          <div className="panel-actions">
            <button type="button" className="btn btn-small btn-ghost" onClick={() => fileRef.current?.click()} title="開啟之前儲存的 .json 專案檔">
              開啟
            </button>
            <button type="button" className="btn btn-small btn-ghost" onClick={save} title="把目前的圖存成 .json 專案檔，之後可再開啟編輯">
              儲存
            </button>
            {hasObjects && (
              <button
                type="button"
                className="btn btn-small btn-ghost"
                onClick={() => {
                  if (window.confirm('確定要清除所有物件嗎？（可按復原救回）')) clearScene();
                }}
              >
                全部清除
              </button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              void open(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>
        {fileMsg && (
          <p className={`feedback ${fileMsg.ok ? 'is-ok' : 'is-error'}`} role="status">
            {fileMsg.text}
          </p>
        )}
        {storageNotice && (
          <div className="tab-conflict" role="alert">
            <p>{storageNotice}</p>
            <div className="tab-conflict-actions">
              <button type="button" className="btn btn-small btn-ghost" onClick={dismissStorageNotice}>
                知道了
              </button>
            </div>
          </div>
        )}
        {externalChange && (
          <div className="tab-conflict" role="alert">
            <p>另一個分頁更新了這份作品，這個分頁已暫停自動儲存。</p>
            <div className="tab-conflict-actions">
              <button type="button" className="btn btn-small btn-primary" onClick={reloadFromStorage}>
                載入最新
              </button>
              <button type="button" className="btn btn-small btn-ghost" onClick={keepThisTab}>
                保留目前分頁
              </button>
            </div>
          </div>
        )}
        {storageStatus === 'ok' ? (
          <p className="autosave-note">會自動存在這台裝置的瀏覽器中；要換裝置請用「儲存」。</p>
        ) : (
          <p className="autosave-note is-error" role="alert">
            無法自動儲存（瀏覽器封鎖儲存或空間已滿），請按「儲存」下載 .json 備份。
          </p>
        )}
        <ObjectList />
      </div>
    </aside>
  );
}
