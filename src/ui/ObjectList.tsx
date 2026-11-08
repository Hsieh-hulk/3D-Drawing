import { useEffect, useRef, useState, type ReactNode } from 'react';
import { formatNumber } from '../model/expr';
import {
  FILL_PALETTE,
  dependentsOf,
  findPoint,
  objectName,
  planeLabel,
  planes,
  points,
  segmentLabel,
  segments,
  solids,
  solidTitle,
  vectorComponents,
  vectorLabel,
  vectors,
  type PlaneObj,
  type PointObj,
  type SceneObject,
  type SolidObj,
} from '../model/scene';
import { useAppStore, type ActionResult } from '../store/useAppStore';
import { EyeIcon, EyeOffIcon, GuidesIcon, TrashIcon } from './icons';

/** Text field that commits on blur/Enter, keeps invalid drafts visible with an error, and reverts on Escape. */
function CommitField(props: {
  value: string;
  label: string;
  className?: string;
  onCommit: (v: string) => ActionResult;
  onError: (msg: string) => void;
}) {
  const { value, label, className, onCommit, onError } = props;
  const [draft, setDraft] = useState(value);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setDraft(value);
    setInvalid(false);
  }, [value]);

  const commit = () => {
    if (draft === value) return;
    const r = onCommit(draft);
    setInvalid(!r.ok);
    onError(r.ok ? '' : r.error);
  };

  return (
    <input
      className={`field ${className ?? ''}`}
      value={draft}
      aria-label={label}
      aria-invalid={invalid}
      autoCapitalize="off"
      autoCorrect="off"
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setDraft(value);
          setInvalid(false);
          onError('');
        }
      }}
    />
  );
}

function RowActions({ obj }: { obj: SceneObject }) {
  const scene = useAppStore((s) => s.scene);
  const updateObject = useAppStore((s) => s.updateObject);
  const removeObject = useAppStore((s) => s.removeObject);
  const name = objectName(scene, obj);

  const remove = () => {
    if (obj.kind === 'point') {
      const deps = dependentsOf(scene, obj.id);
      if (deps.length > 0 && !window.confirm(`刪除${name}也會一併刪除以它建立的 ${deps.length} 個物件，確定嗎？`)) {
        return;
      }
    }
    if (obj.kind === 'solid' && !window.confirm(`刪除${name}及其頂點（仍被其他物件使用的頂點會保留），確定嗎？`)) {
      return;
    }
    removeObject(obj.id);
  };

  return (
    <div className="row-actions">
      {obj.kind === 'point' && <GuidesToggle p={obj} />}
      <button
        type="button"
        className="icon-btn"
        aria-label={obj.visible ? `隱藏 ${name}` : `顯示 ${name}`}
        aria-pressed={!obj.visible}
        onClick={(e) => {
          e.stopPropagation();
          updateObject(obj.id, { visible: !obj.visible });
        }}
      >
        {obj.visible ? <EyeIcon /> : <EyeOffIcon />}
      </button>
      <button
        type="button"
        className="icon-btn icon-btn--danger"
        aria-label={`刪除 ${name}`}
        onClick={(e) => {
          e.stopPropagation();
          remove();
        }}
      >
        <TrashIcon />
      </button>
    </div>
  );
}

function GuidesToggle({ p }: { p: PointObj }) {
  const togglePointGuides = useAppStore((s) => s.togglePointGuides);
  return (
    <button
      type="button"
      className="icon-btn"
      aria-label={`${p.guides ? '隱藏' : '顯示'}點 ${p.name} 的垂足輔助線`}
      aria-pressed={!!p.guides}
      title="垂足輔助線"
      onClick={(e) => {
        e.stopPropagation();
        togglePointGuides(p.id);
      }}
    >
      <GuidesIcon />
    </button>
  );
}

function Row({ obj, children }: { obj: SceneObject; children: ReactNode }) {
  const selectedId = useAppStore((s) => s.selectedId);
  const select = useAppStore((s) => s.select);
  const selected = selectedId === obj.id;
  const ref = useRef<HTMLLIElement>(null);
  // Selecting in the 3D view reveals the matching row in the list.
  useEffect(() => {
    if (selected && ref.current && !ref.current.contains(document.activeElement)) {
      ref.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [selected]);
  return (
    <li
      ref={ref}
      className={`obj-row${selected ? ' is-selected' : ''}${obj.visible ? '' : ' is-hidden'}`}
      onClick={(e) => {
        // Editing a field selects the row but never toggles it off.
        const fromControl = (e.target as HTMLElement).closest('input, select, button');
        select(fromControl ? obj.id : selected ? null : obj.id);
      }}
    >
      {children}
    </li>
  );
}

function PointRow({ p }: { p: PointObj }) {
  const updatePointCoord = useAppStore((s) => s.updatePointCoord);
  const renamePoint = useAppStore((s) => s.renamePoint);
  const [error, setError] = useState('');
  return (
    <Row obj={p}>
      <div className="row-head">
        <span className="swatch" style={{ background: p.color }} aria-hidden="true" />
        <CommitField
          className="name-field"
          value={p.name}
          label={`點 ${p.name} 的名稱`}
          onCommit={(v) => renamePoint(p.id, v)}
          onError={setError}
        />
        <RowActions obj={p} />
      </div>
      <div className="coord-row">
        {(['x', 'y', 'z'] as const).map((axis, i) => (
          <label key={axis} className={`coord coord--${axis}`}>
            <span className="coord-axis">{axis}</span>
            <CommitField
              className="coord-field"
              value={p.coords[i].src}
              label={`點 ${p.name} 的 ${axis} 座標`}
              onCommit={(v) => updatePointCoord(p.id, i as 0 | 1 | 2, v)}
              onError={(msg) => setError(msg ? `${axis} 座標：${msg}` : '')}
            />
          </label>
        ))}
      </div>
      {error && (
        <p className="feedback is-error" role="alert">
          {error}
        </p>
      )}
    </Row>
  );
}

/** Row of colour swatches plus a custom colour input; `allowNone` adds a "no fill" choice. */
function ColorPicker(props: { value: string | null; label: string; allowNone?: boolean; onChange: (c: string | null) => void }) {
  const { value, label, allowNone, onChange } = props;
  const current = value?.toLowerCase() ?? null;
  return (
    <div className="color-picker" role="group" aria-label={label}>
      {allowNone && (
        <button
          type="button"
          className="color-chip color-chip--none"
          aria-label="不填色"
          aria-pressed={current === null}
          title="不填色"
          onClick={() => onChange(null)}
        />
      )}
      {FILL_PALETTE.map((c) => (
        <button
          key={c}
          type="button"
          className="color-chip"
          style={{ background: c }}
          aria-label={`顏色 ${c}`}
          aria-pressed={current === c}
          onClick={() => onChange(c)}
        />
      ))}
      <label className="color-chip color-chip--custom" title="自訂顏色">
        <span className="visually-hidden">自訂顏色</span>
        <input type="color" value={value ?? '#5b8def'} onChange={(e) => onChange(e.target.value)} />
      </label>
    </div>
  );
}

function PlaneRow({ pl }: { pl: PlaneObj }) {
  const scene = useAppStore((s) => s.scene);
  const selected = useAppStore((s) => s.selectedId === pl.id);
  const updateObject = useAppStore((s) => s.updateObject);
  const label = planeLabel(scene, pl);
  return (
    <Row obj={pl}>
      <div className="row-head">
        <span className="swatch swatch--square" style={{ background: pl.color, opacity: 0.6 }} aria-hidden="true" />
        <span className="obj-label">平面 {label}</span>
        <RowActions obj={pl} />
      </div>
      {selected && <ColorPicker value={pl.color} label={`平面 ${label} 的顏色`} onChange={(c) => c && updateObject(pl.id, { color: c })} />}
    </Row>
  );
}

function SolidRow({ s }: { s: SolidObj }) {
  const scene = useAppStore((st) => st.scene);
  const selected = useAppStore((st) => st.selectedId === s.id);
  const setSolidFaceColor = useAppStore((st) => st.setSolidFaceColor);
  const colored = s.faceColors?.filter(Boolean).length ?? 0;
  const faceName = (f: number[]) => f.map((i) => findPoint(scene, s.vertexIds[i])?.name ?? '?').join('');
  const paintAll = (c: string | null) => setSolidFaceColor(s.id, 'all', c);
  return (
    <Row obj={s}>
      <div className="row-head">
        <span className="swatch swatch--square" style={{ background: s.color }} aria-hidden="true" />
        <span className="obj-label">
          {solidTitle(scene, s)}
          {colored > 0 && <span className="obj-meta">　{colored} 面上色</span>}
        </span>
        <RowActions obj={s} />
      </div>
      {selected && (
        <div className="face-colors">
          <div className="face-color-row">
            <span className="face-name">全部面</span>
            <ColorPicker value={null} label="全部面的顏色" allowNone onChange={paintAll} />
          </div>
          {s.faces.map((f, i) => (
            <div key={i} className="face-color-row">
              <span className="face-name">面 {faceName(f)}</span>
              <ColorPicker
                value={s.faceColors?.[i] ?? null}
                label={`面 ${faceName(f)} 的顏色`}
                allowNone
                onChange={(c) => setSolidFaceColor(s.id, i, c)}
              />
            </div>
          ))}
        </div>
      )}
    </Row>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  if (count === 0) return null;
  return (
    <section className="obj-section">
      <h3 className="obj-section-title">
        {title} <span className="count">{count}</span>
      </h3>
      <ul className="obj-list">{children}</ul>
    </section>
  );
}

export function ObjectList() {
  const scene = useAppStore((s) => s.scene);
  const setSegmentInfinite = useAppStore((s) => s.setSegmentInfinite);
  const pts = points(scene);
  const vecs = vectors(scene);
  const segs = segments(scene);
  const sols = solids(scene);
  const pls = planes(scene);

  if (scene.objects.length === 0) {
    return (
      <div className="panel-empty">
        <p>尚未加入任何物件。</p>
        <p className="panel-empty-sub">在上方輸入 A(1, 2, 3) 後按「新增」，就會畫出點 A。</p>
      </div>
    );
  }

  return (
    <>
      <Section title="幾何體" count={sols.length}>
        {sols.map((s) => (
          <SolidRow key={s.id} s={s} />
        ))}
      </Section>

      <Section title="平面" count={pls.length}>
        {pls.map((pl) => (
          <PlaneRow key={pl.id} pl={pl} />
        ))}
      </Section>

      <Section title="點" count={pts.length}>
        {pts.map((p) => (
          <PointRow key={p.id} p={p} />
        ))}
      </Section>

      <Section title="向量" count={vecs.length}>
        {vecs.map((v) => {
          const comps = vectorComponents(scene, v);
          return (
            <Row key={v.id} obj={v}>
              <div className="row-head">
                <span className="swatch" style={{ background: v.color }} aria-hidden="true" />
                <span className="obj-label">
                  <span className="vec-name" style={{ color: v.color }}>
                    {vectorLabel(scene, v)}
                  </span>
                  <span className="obj-meta">
                    {comps ? `= (${comps.map(formatNumber).join(', ')})` : ''}
                    {comps && comps.every((c) => Math.abs(c) < 1e-9) ? '　零向量' : ''}
                  </span>
                </span>
                <RowActions obj={v} />
              </div>
            </Row>
          );
        })}
      </Section>

      <Section title="線段／直線" count={segs.length}>
        {segs.map((s) => (
          <Row key={s.id} obj={s}>
            <div className="row-head">
              <span className="swatch" style={{ background: s.color }} aria-hidden="true" />
              <span className="obj-label">
                {s.infinite ? '直線' : '線段'} {segmentLabel(scene, s)}
              </span>
              <button
                type="button"
                className="btn btn-small"
                onClick={(e) => {
                  e.stopPropagation();
                  setSegmentInfinite(s.id, !s.infinite);
                }}
              >
                改為{s.infinite ? '線段' : '直線'}
              </button>
              <RowActions obj={s} />
            </div>
          </Row>
        ))}
      </Section>
    </>
  );
}
