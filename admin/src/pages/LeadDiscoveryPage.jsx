import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api.js';
import {
  MapPin, Search, Download, Upload, RefreshCw, Globe,
  Phone, Star, ChevronDown, ChevronUp, CheckSquare, Square,
  AlertCircle, TrendingUp, DollarSign, Zap, Filter, X
} from 'lucide-react';

const COUNTRY_OPTIONS = [
  { value: 'UK', label: 'United Kingdom' },
  { value: 'US', label: 'United States' },
  { value: 'IN', label: 'India' },
  { value: 'AU', label: 'Australia' },
  { value: 'CA', label: 'Canada' },
];

const STATUS_COLORS = {
  Qualified: 'bg-green-900 text-green-300',
  Review: 'bg-yellow-900 text-yellow-300',
  Disqualified: 'bg-red-900 text-red-300',
  Imported: 'bg-blue-900 text-blue-300',
};

const FIT_SCORE_COLOR = (score) => {
  if (score >= 70) return 'text-green-400';
  if (score >= 40) return 'text-yellow-400';
  return 'text-red-400';
};

function StatCard({ icon: Icon, label, value, sub, color = 'text-sky-400' }) {
  return (
    <div className="bg-slate-800 rounded-xl p-4 flex items-start gap-3">
      <div className={`w-9 h-9 rounded-lg bg-slate-700 flex items-center justify-center flex-shrink-0 ${color}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div>
        <p className="text-slate-400 text-xs">{label}</p>
        <p className="text-white font-bold text-lg leading-tight">{value}</p>
        {sub && <p className="text-slate-500 text-xs mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function BudgetBar({ used, limit = 10 }) {
  const pct = Math.min((used / limit) * 100, 100);
  const color = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-yellow-500' : 'bg-green-500';
  return (
    <div className="w-full">
      <div className="flex justify-between text-xs text-slate-400 mb-1">
        <span>${used.toFixed(2)} used</span>
        <span>${limit.toFixed(2)} limit</span>
      </div>
      <div className="w-full bg-slate-700 rounded-full h-2">
        <div className={`${color} h-2 rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function LeadDiscoveryPage() {
  // Search form state
  const [query, setQuery] = useState('');
  const [location, setLocation] = useState('');
  const [country, setCountry] = useState('UK');
  const [maxResults, setMaxResults] = useState(20);

  // Data state
  const [stats, setStats] = useState(null);
  const [budget, setBudget] = useState(null);
  const [searches, setSearches] = useState([]);
  const [selectedSearch, setSelectedSearch] = useState(null);
  const [results, setResults] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());

  // UI state
  const [searching, setSearching] = useState(false);
  const [loadingResults, setLoadingResults] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [filterStatus, setFilterStatus] = useState('all');
  const [searchError, setSearchError] = useState(null);
  const [importSuccess, setImportSuccess] = useState(null);
  const [expandedSearch, setExpandedSearch] = useState(null);

  const loadStats = useCallback(async () => {
    try {
      const [s, b, sr] = await Promise.all([
        apiFetch('/api/outreach/discover/stats'),
        apiFetch('/api/outreach/discover/budget'),
        apiFetch('/api/outreach/discover/searches?limit=10'),
      ]);
      setStats(s);
      setBudget(b);
      setSearches(sr?.searches ?? []);
    } catch (e) {
      console.error('Failed to load stats', e);
    }
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!query.trim() || !location.trim()) return;
    setSearching(true);
    setSearchError(null);
    setSelectedIds(new Set());
    setResults([]);
    setSelectedSearch(null);
    try {
      const res = await apiFetch('/api/outreach/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim(), location: location.trim(), country, maxResults }),
      });
      if (res.error) throw new Error(res.error);
      await loadStats();
      // Auto-select the new search
      const newSearchId = res.searchId;
      setExpandedSearch(newSearchId);
      await loadResults(newSearchId);
    } catch (err) {
      setSearchError(err.message ?? 'Search failed. Check your API key and budget.');
    } finally {
      setSearching(false);
    }
  };

  const loadResults = async (searchId) => {
    setLoadingResults(true);
    setSelectedSearch(searchId);
    setSelectedIds(new Set());
    setFilterStatus('all');
    try {
      const res = await apiFetch(`/api/outreach/discover/searches/${searchId}/results`);
      setResults(res?.results ?? []);
    } catch (e) {
      console.error('Failed to load results', e);
    } finally {
      setLoadingResults(false);
    }
  };

  const handleStatusChange = async (resultId, status) => {
    try {
      await apiFetch(`/api/outreach/discover/results/${resultId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qualificationStatus: status }),
      });
      setResults(prev => prev.map(r => r.id === resultId ? { ...r, qualificationStatus: status } : r));
    } catch (e) {
      console.error('Failed to update status', e);
    }
  };

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const visible = filteredResults.map(r => r.id);
    if (visible.every(id => selectedIds.has(id))) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        visible.forEach(id => next.delete(id));
        return next;
      });
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev);
        visible.forEach(id => next.add(id));
        return next;
      });
    }
  };

  const handleImport = async () => {
    if (selectedIds.size === 0) return;
    setImporting(true);
    setImportSuccess(null);
    try {
      const res = await apiFetch('/api/outreach/discover/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resultIds: Array.from(selectedIds) }),
      });
      if (res.error) throw new Error(res.error);
      setImportSuccess(`${res.imported} lead(s) imported to contacts.`);
      setSelectedIds(new Set());
      setResults(prev => prev.map(r => selectedIds.has(r.id) ? { ...r, imported: true, qualificationStatus: 'Imported' } : r));
      await loadStats();
    } catch (err) {
      setSearchError(err.message ?? 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const handleExport = async (format) => {
    if (!selectedSearch) return;
    setExporting(true);
    try {
      const token = localStorage.getItem('ge_crm_token');
      const statusParam = filterStatus !== 'all' ? `&status=${filterStatus}` : '';
      const res = await fetch(
        `/api/outreach/discover/export?searchId=${selectedSearch}&format=${format}${statusParam}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `leads-${selectedSearch.slice(0, 8)}.${format === 'excel' ? 'xlsx' : 'csv'}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Export failed', e);
    } finally {
      setExporting(false);
    }
  };

  const filteredResults = results.filter(r => {
    if (filterStatus === 'all') return true;
    return r.qualificationStatus === filterStatus;
  });

  const allVisibleSelected = filteredResults.length > 0 && filteredResults.every(r => selectedIds.has(r.id));
  const qualifiedCount = results.filter(r => r.qualificationStatus === 'Qualified').length;
  const reviewCount = results.filter(r => r.qualificationStatus === 'Review').length;

  return (
    <div className="flex h-screen bg-slate-950 text-slate-300">
      {/* Left panel - searches list */}
      <div className="w-80 min-w-80 border-r border-slate-800 flex flex-col">
        {/* Header */}
        <div className="px-5 py-5 border-b border-slate-800">
          <div className="flex items-center gap-2 mb-1">
            <MapPin className="w-5 h-5 text-sky-400" />
            <h1 className="text-white font-bold text-lg">Lead Discovery</h1>
          </div>
          <p className="text-slate-500 text-xs">Google Places → Qualified leads</p>
        </div>

        {/* Stats */}
        {stats && (
          <div className="px-4 py-3 border-b border-slate-800 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-slate-800 rounded-lg p-2.5">
                <p className="text-slate-400 text-xs">Discovered</p>
                <p className="text-white font-bold">{stats.totalDiscovered ?? 0}</p>
              </div>
              <div className="bg-slate-800 rounded-lg p-2.5">
                <p className="text-slate-400 text-xs">Imported</p>
                <p className="text-white font-bold">{stats.totalImported ?? 0}</p>
              </div>
              <div className="bg-slate-800 rounded-lg p-2.5">
                <p className="text-slate-400 text-xs">Searches</p>
                <p className="text-white font-bold">{stats.queriesRun ?? 0}</p>
              </div>
              <div className="bg-slate-800 rounded-lg p-2.5">
                <p className="text-slate-400 text-xs">Cost MTD</p>
                <p className="text-white font-bold">${(stats.costThisMonth ?? 0).toFixed(2)}</p>
              </div>
            </div>
            {budget && (
              <div className="bg-slate-800 rounded-lg p-2.5">
                <p className="text-slate-400 text-xs mb-2">Monthly Budget</p>
                <BudgetBar used={parseFloat(budget.costUsd ?? 0)} limit={10} />
              </div>
            )}
          </div>
        )}

        {/* Recent searches */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-4 py-2 flex items-center justify-between">
            <p className="text-slate-500 text-xs font-medium uppercase tracking-wide">Recent Searches</p>
            <button onClick={loadStats} className="text-slate-500 hover:text-slate-300 transition-colors">
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
          {searches.length === 0 && (
            <div className="px-4 py-6 text-center text-slate-600 text-sm">
              No searches yet. Run your first search!
            </div>
          )}
          {searches.map(s => (
            <button
              key={s.id}
              onClick={() => {
                setExpandedSearch(expandedSearch === s.id ? null : s.id);
                if (expandedSearch !== s.id) loadResults(s.id);
              }}
              className={`w-full text-left px-4 py-3 border-b border-slate-800/50 hover:bg-slate-800 transition-colors ${selectedSearch === s.id ? 'bg-slate-800' : ''}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-white text-sm font-medium truncate">{s.query}</p>
                  <p className="text-slate-500 text-xs truncate">{s.location}, {s.country}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sky-400 font-bold text-sm">{s.totalFound}</p>
                  <p className="text-slate-600 text-xs">found</p>
                </div>
              </div>
              <div className="flex items-center gap-3 mt-1.5">
                <span className="text-green-400 text-xs">{s.qualifiedCount} qual.</span>
                <span className="text-blue-400 text-xs">{s.importedCount} imp.</span>
                <span className="text-slate-600 text-xs ml-auto">{new Date(s.createdAt).toLocaleDateString()}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Search form */}
        <div className="px-6 py-5 border-b border-slate-800 bg-slate-900">
          <form onSubmit={handleSearch}>
            <div className="flex items-end gap-3">
              <div className="flex-1 min-w-0">
                <label className="block text-xs text-slate-400 mb-1.5">Business Type / Query</label>
                <input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="e.g. performance marketing agency"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-sky-500"
                  disabled={searching}
                />
              </div>
              <div className="w-48">
                <label className="block text-xs text-slate-400 mb-1.5">City / Location</label>
                <input
                  value={location}
                  onChange={e => setLocation(e.target.value)}
                  placeholder="e.g. London"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-sky-500"
                  disabled={searching}
                />
              </div>
              <div className="w-36">
                <label className="block text-xs text-slate-400 mb-1.5">Country</label>
                <select
                  value={country}
                  onChange={e => setCountry(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-sky-500"
                  disabled={searching}
                >
                  {COUNTRY_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div className="w-28">
                <label className="block text-xs text-slate-400 mb-1.5">Max Results</label>
                <select
                  value={maxResults}
                  onChange={e => setMaxResults(Number(e.target.value))}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-sky-500"
                  disabled={searching}
                >
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={40}>40</option>
                  <option value={60}>60</option>
                </select>
              </div>
              <button
                type="submit"
                disabled={searching || !query.trim() || !location.trim()}
                className="flex items-center gap-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium text-sm px-4 py-2 rounded-lg transition-colors"
              >
                {searching ? (
                  <><RefreshCw className="w-4 h-4 animate-spin" /> Searching…</>
                ) : (
                  <><Search className="w-4 h-4" /> Search</>
                )}
              </button>
            </div>
          </form>

          {searchError && (
            <div className="mt-3 flex items-center gap-2 text-red-400 text-sm bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {searchError}
              <button onClick={() => setSearchError(null)} className="ml-auto"><X className="w-3.5 h-3.5" /></button>
            </div>
          )}

          {importSuccess && (
            <div className="mt-3 flex items-center gap-2 text-green-400 text-sm bg-green-900/20 border border-green-800 rounded-lg px-3 py-2">
              <Zap className="w-4 h-4 flex-shrink-0" />
              {importSuccess}
              <a href="/crm/contacts" className="text-sm text-sky-600 hover:underline ml-2">View in Contacts &rarr;</a>
              <button onClick={() => setImportSuccess(null)} className="ml-auto"><X className="w-3.5 h-3.5" /></button>
            </div>
          )}
        </div>

        {/* Results toolbar */}
        {selectedSearch && (
          <div className="px-6 py-3 border-b border-slate-800 bg-slate-900 flex items-center gap-3">
            {/* Filter tabs */}
            <div className="flex items-center gap-1 bg-slate-800 rounded-lg p-1">
              {['all', 'Qualified', 'Review', 'Disqualified', 'Imported'].map(s => (
                <button
                  key={s}
                  onClick={() => setFilterStatus(s)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${filterStatus === s ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-white'}`}
                >
                  {s === 'all' ? `All (${results.length})` : `${s} (${results.filter(r => r.qualificationStatus === s).length})`}
                </button>
              ))}
            </div>

            <div className="ml-auto flex items-center gap-2">
              {selectedIds.size > 0 && (
                <button
                  onClick={handleImport}
                  disabled={importing}
                  className="flex items-center gap-1.5 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                >
                  {importing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                  Import {selectedIds.size} to Contacts
                </button>
              )}
              <button
                onClick={() => handleExport('excel')}
                disabled={exporting || !selectedSearch}
                className="flex items-center gap-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-300 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                Excel
              </button>
              <button
                onClick={() => handleExport('csv')}
                disabled={exporting || !selectedSearch}
                className="flex items-center gap-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-300 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                CSV
              </button>
            </div>
          </div>
        )}

        {/* Results table */}
        <div className="flex-1 overflow-auto">
          {!selectedSearch && !searching && (
            <div className="flex flex-col items-center justify-center h-full text-center px-6">
              <MapPin className="w-12 h-12 text-slate-700 mb-4" />
              <h2 className="text-white font-semibold text-lg mb-2">Discover Leads with Google Places</h2>
              <p className="text-slate-500 text-sm max-w-md">
                Search for businesses by type and location. We'll score each result by website, phone, rating, and reviews to help you identify the best prospects.
              </p>
              <div className="mt-6 grid grid-cols-3 gap-4 text-left max-w-lg">
                <div className="bg-slate-800 rounded-xl p-3">
                  <Globe className="w-5 h-5 text-sky-400 mb-2" />
                  <p className="text-white text-xs font-medium">Website</p>
                  <p className="text-slate-500 text-xs">+25 pts</p>
                </div>
                <div className="bg-slate-800 rounded-xl p-3">
                  <Phone className="w-5 h-5 text-green-400 mb-2" />
                  <p className="text-white text-xs font-medium">Phone</p>
                  <p className="text-slate-500 text-xs">+15 pts</p>
                </div>
                <div className="bg-slate-800 rounded-xl p-3">
                  <Star className="w-5 h-5 text-yellow-400 mb-2" />
                  <p className="text-white text-xs font-medium">Rating + Reviews</p>
                  <p className="text-slate-500 text-xs">+45 pts</p>
                </div>
              </div>
            </div>
          )}

          {searching && (
            <div className="flex flex-col items-center justify-center h-full">
              <RefreshCw className="w-8 h-8 text-sky-400 animate-spin mb-4" />
              <p className="text-white font-medium">Searching Google Places…</p>
              <p className="text-slate-500 text-sm mt-1">Fetching details for each result</p>
            </div>
          )}

          {loadingResults && !searching && (
            <div className="flex items-center justify-center h-32">
              <RefreshCw className="w-5 h-5 text-sky-400 animate-spin" />
            </div>
          )}

          {!searching && !loadingResults && selectedSearch && filteredResults.length > 0 && (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-900 z-10">
                <tr className="border-b border-slate-800">
                  <th className="px-4 py-3 text-left w-10">
                    <button onClick={toggleSelectAll}>
                      {allVisibleSelected
                        ? <CheckSquare className="w-4 h-4 text-sky-400" />
                        : <Square className="w-4 h-4 text-slate-600" />}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left text-slate-400 font-medium text-xs uppercase tracking-wide">Company</th>
                  <th className="px-4 py-3 text-left text-slate-400 font-medium text-xs uppercase tracking-wide">Website</th>
                  <th className="px-4 py-3 text-left text-slate-400 font-medium text-xs uppercase tracking-wide">Phone</th>
                  <th className="px-4 py-3 text-left text-slate-400 font-medium text-xs uppercase tracking-wide">Rating</th>
                  <th className="px-4 py-3 text-center text-slate-400 font-medium text-xs uppercase tracking-wide">Fit Score</th>
                  <th className="px-4 py-3 text-center text-slate-400 font-medium text-xs uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3 text-left text-slate-400 font-medium text-xs uppercase tracking-wide">Address</th>
                </tr>
              </thead>
              <tbody>
                {filteredResults.map(r => (
                  <tr key={r.id} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors">
                    <td className="px-4 py-3">
                      <button onClick={() => toggleSelect(r.id)}>
                        {selectedIds.has(r.id)
                          ? <CheckSquare className="w-4 h-4 text-sky-400" />
                          : <Square className="w-4 h-4 text-slate-600" />}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-white font-medium leading-tight">{r.companyName}</p>
                      {r.imported && (
                        <span className="text-blue-400 text-xs">imported</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {r.websiteUrl ? (
                        <a
                          href={r.websiteUrl.startsWith('http') ? r.websiteUrl : `https://${r.websiteUrl}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sky-400 hover:text-sky-300 text-xs truncate max-w-[140px] block"
                        >
                          {r.websiteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                        </a>
                      ) : (
                        <span className="text-slate-600 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-300">
                      {r.phoneNumber ?? <span className="text-slate-600">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {r.rating ? (
                        <div className="flex items-center gap-1">
                          <Star className="w-3 h-3 text-yellow-400" />
                          <span className="text-slate-300 text-xs">{r.rating}</span>
                          <span className="text-slate-600 text-xs">({r.reviewCount})</span>
                        </div>
                      ) : (
                        <span className="text-slate-600 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`font-bold text-sm ${FIT_SCORE_COLOR(r.fitScore)}`}>
                        {r.fitScore}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <select
                        value={r.qualificationStatus}
                        onChange={e => handleStatusChange(r.id, e.target.value)}
                        disabled={r.imported}
                        className={`text-xs rounded-full px-2 py-0.5 border-0 cursor-pointer font-medium ${STATUS_COLORS[r.qualificationStatus] ?? 'bg-slate-700 text-slate-300'} focus:outline-none disabled:cursor-default`}
                      >
                        <option value="Qualified">Qualified</option>
                        <option value="Review">Review</option>
                        <option value="Disqualified">Disqualified</option>
                        {r.imported && <option value="Imported">Imported</option>}
                      </select>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500 max-w-[200px] truncate">
                      {r.address ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {!searching && !loadingResults && selectedSearch && filteredResults.length === 0 && results.length > 0 && (
            <div className="flex flex-col items-center justify-center h-32 text-slate-500 text-sm">
              No results match the current filter.
            </div>
          )}

          {!searching && !loadingResults && selectedSearch && results.length === 0 && (
            <div className="flex flex-col items-center justify-center h-32 text-slate-500 text-sm">
              No results found for this search.
            </div>
          )}
        </div>

        {/* Footer summary bar when results loaded */}
        {selectedSearch && results.length > 0 && (
          <div className="px-6 py-3 border-t border-slate-800 bg-slate-900 flex items-center gap-6 text-xs">
            <span className="text-slate-400">{results.length} total</span>
            <span className="text-green-400">{qualifiedCount} qualified</span>
            <span className="text-yellow-400">{reviewCount} to review</span>
            <span className="text-blue-400">{results.filter(r => r.imported).length} imported</span>
            {selectedIds.size > 0 && (
              <span className="text-sky-400 font-medium ml-auto">{selectedIds.size} selected</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
