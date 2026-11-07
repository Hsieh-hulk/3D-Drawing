import { useState } from 'react';
import { points } from '../model/scene';
import { useAppStore } from '../store/useAppStore';

/** Touch-friendly way to build vector AB / segment / line from two existing points without typing. */
export function ConnectForm() {
  const scene = useAppStore((s) => s.scene);
  const runCommand = useAppStore((s) => s.runCommand);
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
      {error && (
        <p className="feedback is-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
