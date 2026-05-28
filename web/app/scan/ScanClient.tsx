'use client';

import { useState } from 'react';
import type { ScanResultJSON } from '../../lib/scanner';
import type { DailySiteStatus } from '../../../src/types/scanner';
import type { Target } from '../../../src/config/schemas';

type ScanApiResponse = {
  targetId: string;
  targetName: string;
  results: ScanResultJSON[];
};

function statusCell(s: string) {
  if (s === 'available')   return <span className="avail-available">✓</span>;
  if (s === 'unavailable') return <span className="avail-unavailable">✗</span>;
  return <span className="avail-unknown">?</span>;
}

function ResultRow({ result }: { result: ScanResultJSON }) {
  const isMatch = result.hits.length > 0;
  const statusEntries = result.statusBySite
    ? (Object.entries(result.statusBySite) as [string, DailySiteStatus[]][])
    : [];
  const sampleDates = statusEntries[0]?.[1]?.map((ds) => ds.date) ?? [];

  return (
    <div
      className="card"
      style={{ marginBottom: 12, borderColor: isMatch ? 'var(--green)' : 'var(--border)' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <span style={{ fontWeight: 600 }}>
          {result.candidate.arrivalDate} → {result.candidate.endDate}
        </span>
        <span style={{ color: 'var(--muted)', fontSize: 12 }}>({result.candidate.nights}N)</span>
        {isMatch && <span className="badge badge-match">MATCH</span>}
      </div>

      <div className="source-link" style={{ marginBottom: 8 }}>
        <span style={{ color: 'var(--muted)' }}>Source: </span>
        <a href={result.sourceUrl} target="_blank" rel="noreferrer">{result.sourceUrl}</a>
      </div>

      {result.bookingUrl && (
        <div style={{ marginBottom: 12 }}>
          <a
            href={result.bookingUrl}
            target="_blank"
            rel="noreferrer"
            className="btn btn-primary"
            style={{ fontSize: 12, padding: '6px 12px' }}
          >
            📅 Book at ReserveCalifornia
          </a>
        </div>
      )}

      {statusEntries.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Site</th>
              {sampleDates.map((d) => <th key={d}>{d.slice(5)}</th>)}
            </tr>
          </thead>
          <tbody>
            {statusEntries.map(([site, statuses]) => (
              <tr key={site}>
                <td style={{ fontSize: 12 }}>{site}</td>
                {statuses.map((ds) => (
                  <td key={ds.date} style={{ textAlign: 'center' }}>
                    {statusCell(ds.status)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {!isMatch && result.parsingNotes && (
        <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 8 }}>
          {result.parsingNotes}
        </div>
      )}
    </div>
  );
}

export default function ScanClient({
  targets,
  selectedTargetId,
}: {
  targets: Target[];
  selectedTargetId?: string;
}) {
  const [targetId, setTargetId] = useState(selectedTargetId ?? targets[0]?.id ?? '');
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [data, setData] = useState<ScanApiResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  const selectedTarget = targets.find((t) => t.id === targetId);

  async function handleRunScan() {
    if (!targetId) return;
    setState('loading');
    setData(null);
    setErrorMsg('');
    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetId, maxCandidates: 9 }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      setData((await res.json()) as ScanApiResponse);
      setState('done');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setState('error');
    }
  }

  const matches    = data?.results.filter((r) => r.hits.length > 0) ?? [];
  const nonMatches = data?.results.filter((r) => r.hits.length === 0) ?? [];

  return (
    <div>
      {/* Target selector */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {targets.length > 1 && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>Target:</span>
              <select
                value={targetId}
                onChange={(e) => {
                  setTargetId(e.target.value);
                  setState('idle');
                  setData(null);
                }}
                style={{ fontSize: 13 }}
              >
                {targets.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </label>
          )}

          {selectedTarget && (
            <div style={{ fontSize: 13, color: 'var(--muted)', flex: 1 }}>
              {selectedTarget.parkName} · {selectedTarget.campgroundName}
              {' · '}{selectedTarget.acceptableSites.join(', ')}
            </div>
          )}
        </div>
      </div>

      {/* Scan controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <button
          className="btn btn-primary"
          onClick={() => { void handleRunScan(); }}
          disabled={state === 'loading' || !targetId}
        >
          {state === 'loading' ? '⏳ Scanning…' : '🔍 Run Scan'}
        </button>
        {state === 'loading' && (
          <span className="scan-status">
            Checking upcoming weekends against ReserveCalifornia…
          </span>
        )}
        {state === 'error' && (
          <span className="scan-status scan-error">{errorMsg}</span>
        )}
      </div>

      {state === 'idle' && (
        <div className="empty">
          Click "Run Scan" to check upcoming availability.
        </div>
      )}

      {state === 'done' && data && (
        <>
          <div style={{ marginBottom: 20, fontSize: 13, color: 'var(--muted)' }}>
            Scanned{' '}
            <strong style={{ color: 'var(--text)' }}>{data.results.length}</strong>{' '}
            candidates for{' '}
            <strong style={{ color: 'var(--text)' }}>{data.targetName}</strong>
            {' · '}
            <strong style={{ color: matches.length > 0 ? 'var(--green)' : 'var(--red)' }}>
              {matches.length} match{matches.length !== 1 ? 'es' : ''}
            </strong>
          </div>

          {matches.length > 0 && (
            <>
              <h2 style={{ color: 'var(--green)' }}>🎯 Matches</h2>
              {matches.map((r) => (
                <ResultRow
                  key={`${r.candidate.arrivalDate}-${r.candidate.nights}`}
                  result={r}
                />
              ))}
            </>
          )}

          {nonMatches.length > 0 && (
            <>
              <h2
                style={{
                  color: 'var(--muted)',
                  fontWeight: 400,
                  marginTop: matches.length > 0 ? 24 : 0,
                }}
              >
                No matches ({nonMatches.length})
              </h2>
              {nonMatches.map((r) => (
                <ResultRow
                  key={`${r.candidate.arrivalDate}-${r.candidate.nights}`}
                  result={r}
                />
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}
