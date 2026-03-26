import React from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';

function Sparkline({ data = [], positive = true }) {
  if (!data.length) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const w = 80;
  const h = 28;
  const points = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * h}`).join(' ');
  const color = positive ? '#22c55e' : '#ef4444';

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="flex-shrink-0">
      <polyline fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" points={points} />
    </svg>
  );
}

export default function MetricCard({ title, value, subtitle, trend, trendData, icon: Icon, color = 'text-slate-900' }) {
  const trendPositive = trend != null && trend >= 0;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col justify-between">
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="w-4 h-4 text-slate-400" />}
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">{title}</p>
        </div>
        {trendData && <Sparkline data={trendData} positive={trendPositive} />}
      </div>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <div className="flex items-center justify-between mt-1">
        {subtitle && <p className="text-xs text-slate-400">{subtitle}</p>}
        {trend != null && (
          <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${trendPositive ? 'text-green-600' : 'text-red-500'}`}>
            {trendPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {Math.abs(trend).toFixed(1)}%
          </span>
        )}
      </div>
    </div>
  );
}
