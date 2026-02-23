import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

function metricCards(metrics: {
  totalUsers: number;
  dau: number;
  mau: number;
  dauMauRatioPercent: number;
  weeklyGrowthPercent: number;
}) {
  return [
    {
      label: "Total Users",
      value: metrics.totalUsers.toLocaleString(),
      means: "All registered accounts",
      why: "Market penetration",
    },
    {
      label: "DAU",
      value: metrics.dau.toLocaleString(),
      means: "Daily Active Users",
      why: "Daily habit strength",
    },
    {
      label: "MAU",
      value: metrics.mau.toLocaleString(),
      means: "Monthly Active Users",
      why: "Real usage base",
    },
    {
      label: "DAU / MAU %",
      value: `${metrics.dauMauRatioPercent.toFixed(1)}%`,
      means: "Stickiness ratio",
      why: "Retention quality",
    },
    {
      label: "Weekly Growth %",
      value: `${metrics.weeklyGrowthPercent >= 0 ? "+" : ""}${metrics.weeklyGrowthPercent.toFixed(1)}%`,
      means: "User growth rate",
      why: "Momentum",
    },
  ];
}

export function InvestorDashboard() {
  const metrics = useQuery(api.growth.getInvestorDashboardMetrics);
  const miniPlayerMetrics = useQuery(api.growth.getMiniPlayerGrowthMetrics);

  if (metrics === undefined || miniPlayerMetrics === undefined) {
    return (
      <div className="bg-white rounded-lg shadow-sm border p-6">
        <p className="text-sm text-gray-500">Loading investor dashboard...</p>
      </div>
    );
  }

  const cards = metricCards(metrics);

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-lg shadow-sm border p-6">
        <h2 className="text-2xl font-bold text-gray-900">Investor Dashboard</h2>
        <p className="text-sm text-gray-600 mt-1">
          Top Row: Growth Metrics (headline numbers)
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {cards.map((card) => (
          <article key={card.label} className="bg-white rounded-lg shadow-sm border p-4">
            <p className="text-xs font-semibold tracking-wide text-gray-500 uppercase">{card.label}</p>
            <p className="mt-2 text-2xl font-bold text-gray-900">{card.value}</p>
            <div className="mt-3 space-y-1">
              <p className="text-xs text-gray-600">
                <span className="font-semibold text-gray-700">What it means:</span> {card.means}
              </p>
              <p className="text-xs text-gray-600">
                <span className="font-semibold text-gray-700">Why investors care:</span> {card.why}
              </p>
            </div>
          </article>
        ))}
      </div>

      <div className="bg-white rounded-lg shadow-sm border p-6 space-y-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Mini Player Growth</h3>
          <p className="text-sm text-gray-600">Visitors vs registered users using the mini player</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <article className="rounded-lg border p-4">
            <p className="text-xs font-semibold tracking-wide text-gray-500 uppercase">7d Plays</p>
            <p className="mt-2 text-2xl font-bold text-gray-900">{miniPlayerMetrics.current7d.totalPlays}</p>
            <p className="text-xs text-gray-600 mt-2">
              WoW: {miniPlayerMetrics.growth.playsPercent >= 0 ? "+" : ""}
              {miniPlayerMetrics.growth.playsPercent.toFixed(1)}%
            </p>
          </article>
          <article className="rounded-lg border p-4">
            <p className="text-xs font-semibold tracking-wide text-gray-500 uppercase">7d Visitors</p>
            <p className="mt-2 text-2xl font-bold text-gray-900">{miniPlayerMetrics.current7d.uniqueVisitors}</p>
            <p className="text-xs text-gray-600 mt-2">
              WoW: {miniPlayerMetrics.growth.visitorsPercent >= 0 ? "+" : ""}
              {miniPlayerMetrics.growth.visitorsPercent.toFixed(1)}%
            </p>
          </article>
          <article className="rounded-lg border p-4">
            <p className="text-xs font-semibold tracking-wide text-gray-500 uppercase">7d Registered Users</p>
            <p className="mt-2 text-2xl font-bold text-gray-900">{miniPlayerMetrics.current7d.uniqueUsers}</p>
            <p className="text-xs text-gray-600 mt-2">
              WoW: {miniPlayerMetrics.growth.usersPercent >= 0 ? "+" : ""}
              {miniPlayerMetrics.growth.usersPercent.toFixed(1)}%
            </p>
          </article>
          <article className="rounded-lg border p-4">
            <p className="text-xs font-semibold tracking-wide text-gray-500 uppercase">30d Unique Listeners</p>
            <p className="mt-2 text-2xl font-bold text-gray-900">{miniPlayerMetrics.last30d.totalUniqueListeners}</p>
            <p className="text-xs text-gray-600 mt-2">
              Visitors: {miniPlayerMetrics.last30d.uniqueVisitors} | Users: {miniPlayerMetrics.last30d.uniqueUsers}
            </p>
          </article>
        </div>
      </div>
    </div>
  );
}
