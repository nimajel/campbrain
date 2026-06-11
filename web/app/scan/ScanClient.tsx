'use client';

import { useState } from 'react';
import type { ScanResultJSON, DailySiteStatus } from '../../../src/types/scanner';
import type { Target } from '../../../src/config/schemas';
import type { LatestScanSummary, AvailabilityHitRecord } from '../../lib/state';

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

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
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

function HitHistoryPanel({ hits }: { hits: AvailabilityHitRecord[] }) {
  if (hits.length === 0) return null;
  return (
    <div style={{ marginBottom: 32 }}>
      <h2 style={{ color: 'var(--yellow)', marginBottom: 12 }}>📋 Hit History ({hits.length})</h2>
      <table>
        <thead>
          <tr>
            <th>Arrival</th>
            <th>Departure</th>
            <th>N</th>
            <th>Site</th>
            <th>First seen</th>
            <th>Last seen</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {hits.map((h) => (
            <tr key={`${h.targetId}|${h.siteName}|${h.arrivalDate}|${h.departureDate}`}>
              <td>{h.arrivalDate}</td>
              <td>{h.departureDate}</td>
              <td>{h.nights}</td>
              <td style={{ fontSize: 12 }}>{h.siteName}</td>
              <td style={{ fontSize: 12, color: 'var(--muted)' }}>{relativeTime(h.firstSeenAt)}</td>
              <td style={{ fontSize: 12, color: 'var(--muted)' }}>{relativeTime(h.lastSeenAt)}</td>
              <td>
                {h.bookingUrl && (
                  <a href={h.bookingUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
                    Book →
                  </a>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SavedScanPanel({ scan }: { scan: LatestScanSummary }) {
  const [expanded, setExpanded] = useState(false);
  const matches = scan.results.filter((r) => r.hits.length > 0);

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Last scan</span>
          <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 12 }}>
            {relativeTime(scan.scannedAt)} · {scan.candidatesScanned} candidates ·{' '}
            <span style={{ color: scan.matchCount > 0 ? 'var(--green)' : 'var(--muted)' }}>
              {scan.matchCount > 0 ? `🎯 ${scan.matchCount} match${scan.matchCount !== 1 ? 'es' : ''}` : 'no matches'}
            </span>
          </span>
        </div>
        <button
          className="btn"
          style={{ fontSize: 12 }}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Hide results' : 'Show results'}
        </button>
      </div>

      {expanded && (
        <div style={{ marginTop: 16 }}>
          {matches.length > 0 && (
            <>
              <h2 style={{ color: 'var(--green)', marginBottom: 12 }}>🎯 Matches</h2>
              {matches.map((r) => (
                <ResultRow key={`${r.candidate.arrivalDate}-${r.candidate.nights}`} result={r} />
              ))}
            </>
          )}
          {scan.results.filter((r) => r.hits.length === 0).length > 0 && (
            <details style={{ marginTop: 8 }}>
              <summary style={{ fontSize: 13, color: 'var(--muted)', cursor: 'pointer' }}>
                {scan.results.filter((r) => r.hits.length === 0).length} non-matching candidates
              </summary>
              <div style={{ marginTop: 8 }}>
                {scan.results.filter((r) => r.hits.length === 0).map((r) => (
                  <ResultRow key={`${r.candidate.arrivalDate}-${r.candidate.nights}`} result={r} />
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

export default function ScanClient({
  targets,
  selectedTargetId,
  initialSavedScan,
  initialHits,
}: {
  targets: Target[];
  selectedTargetId?: string;
  initialSavedScan?: LatestScanSummary;
  initialHits: AvailabilityHitRecord[];
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
            <label style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>Target:</span>
              <select
                value={targetId}
                onChange={(e) => {
                  setTargetId(e.target.value);
                  setState('idle');
                  setData(null);
                }}
                style={{ fontSize: 13, width: 'auto' }}
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

      {/* Hit history (from server-loaded state) */}
      <HitHistoryPanel hits={initialHits} />

      {/* Saved last scan */}
      {initialSavedScan && state === 'idle' && (
        <SavedScanPanel scan={initialSavedScan} />
      )}

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

      {/* Fresh scan results */}
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
              <h2 style={{ color: 'var(--muted)', fontWeight: 400, marginTop: matches.length > 0 ? 24 : 0 }}>
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
