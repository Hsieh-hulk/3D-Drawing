import { useState } from 'react';
import { evaluate } from '../model/expr';
import type { SolidTemplate } from '../model/scene';
import { TEMPLATES, templateSpec } from '../model/solids';
import { useAppStore } from '../store/useAppStore';

/** Inserts a solid template; vertices become ordinary named points. */
export function SolidForm() {
  const addSolid = useAppStore((s) => s.addSolid);
  const [template, setTemplate] = useState<SolidTemplate>('cube');
  const [values, setValues] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const spec = templateSpec(template);

  const submit = () => {
    const params: Record<string, number> = {};
    for (const p of spec.params) {
      const src = values[`${template}.${p.key}`] ?? String(p.default);
      const r = evaluate(src);
      if (!r.ok) {
        setFeedback({ ok: false, text: `${p.label}：${r.error}` });
        return;
      }
      params[p.key] = r.value;
    }
    const r = addSolid(template, params);
    setFeedback(r.ok ? { ok: true, text: r.message ?? '完成' } : { ok: false, text: r.error });
  };

  return (
    <details className="solid-form">
      <summary>幾何體模板</summary>
      <div className="solid-body">
        <label className="solid-row">
          <span className="solid-label">類型</span>
          <select
            className="field select"
            value={template}
            onChange={(e) => {
              setTemplate(e.target.value as SolidTemplate);
              setFeedback(null);
            }}
          >
            {TEMPLATES.map((t) => (
              <option key={t.template} value={t.template}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <div className="solid-params">
          {spec.params.map((p) => {
            const key = `${template}.${p.key}`;
            return (
              <label key={key} className="solid-param">
                <span className="solid-label">{p.label}</span>
                <input
                  className="field"
                  value={values[key] ?? String(p.default)}
                  onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
                  inputMode="decimal"
                  autoComplete="off"
                />
              </label>
            );
          })}
        </div>
        <button type="button" className="btn btn-primary solid-submit" onClick={submit}>
          加入{spec.label.split('（')[0]}
        </button>
        <p className="solid-hint">一角放在原點，頂點自動命名，可再用來畫向量或平面。</p>
        <p className={`feedback ${feedback ? (feedback.ok ? 'is-ok' : 'is-error') : ''}`} aria-live="polite">
          {feedback?.text ?? ''}
        </p>
      </div>
    </details>
  );
}
