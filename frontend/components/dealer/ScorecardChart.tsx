"use client";

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

interface ScorecardChartProps {
  data: Array<{ date: string; winRate: number; completion: number }>;
}

export default function ScorecardChart({ data }: ScorecardChartProps) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data}>
        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip />
        <Line type="monotone" dataKey="winRate" stroke="#0B5FD1" strokeWidth={2} dot={false} name="Win Rate %" />
        <Line type="monotone" dataKey="completion" stroke="#10b981" strokeWidth={2} dot={false} name="Completion %" />
      </LineChart>
    </ResponsiveContainer>
  );
}
