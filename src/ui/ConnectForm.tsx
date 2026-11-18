import { useState } from 'react';
import { points } from '../model/scene';
import { useAppStore } from '../store/useAppStore';

/** Touch-friendly way to build vector AB / segment / line from two existing points without typing. */
export function ConnectForm() {
  const scene = useAppStore((s) => s.scene);
  const runCommand = useAppStore((s) => s.runCommand);
  const setDrawTool = useAppStore((s) => s.setDrawTool);
  const drawTool = useAppStore((s) => s.drawTool);
  const pts = points(scene);
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [error, setError] = useState('');

  if (pts.length < 2) return null;

  const names = pts.map((p) => p.name);
  const from = names.includes(a) ? a : names[0];
  const to = names.includes(b) && b !== from ? b : names.find((n) => n !== from)!;

  const run = (prefix: string) => {
    const r = runCommand(`${prefix}${from}${to}`);
    setError(r.ok ? '' : r.error);
  };

  return (
    <section className="connect" aria-label="連接兩點">
      <div className="connect-row">
        <label className="connect-label">
          從
          <select className="field select" value={from} onChange={(e) => setA(e.target.value)}>
            {names.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="connect-label">
          到
          <select className="field select" value={to} onChange={(e) => setB(e.target.value)}>
            {names
              .filter((n) => n !== from)
              .map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
          </select>
        </label>
      </div>
      <div className="connect-actions">
        <button type="button" className="btn btn-outline" onClick={() => run('')}>
          向量 {from}
          {to}
        </button>
        <button type="button" className="btn btn-outline" onClick={() => run('線段 ')}>
          線段
        </button>
        <button type="button" className="btn btn-outline" onClick={() => run('直線 ')}>
          直線
        </button>
      </div>
      {/* A plane needs 3+ points, so it is built by tapping them in the 3D view (same as 「▱ 建面」). */}
      <button
        type="button"
        className="btn btn-ghost btn-small connect-plane"
        aria-pressed={drawTool === 'face'}
        onClick={() => setDrawTool('face')}
        title="開啟建面工具：在 3D 畫面依序點選 3 個以上的點；也可輸入「平面 ABC」"
      >
        ▱ 平面：在圖上點選 3 個以上的點
      </button>
      {error && (
        <p className="feedback is-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
