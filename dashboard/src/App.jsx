import Layout from './components/Layout'
import KPICards from './components/KPICards'
import ProposalsChart from './components/ProposalsChart'
import CategoryChart from './components/CategoryChart'
import StatusPieChart from './components/StatusPieChart'
import ScoreChart from './components/ScoreChart'
import ProjectsTable from './components/ProjectsTable'
import RetryQueue from './components/RetryQueue'
import LogsTimeline from './components/LogsTimeline'
import { useStats } from './hooks/useStats'

export default function App() {
  const stats = useStats()

  return (
    <Layout>
      <div className="space-y-6">
        {/* KPI Cards */}
        <KPICards stats={stats} />

        {/* Charts Row 1 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <ProposalsChart />
          <CategoryChart />
        </div>

        {/* Charts Row 2 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <StatusPieChart />
          <ScoreChart />
        </div>

        {/* Projects Table */}
        <ProjectsTable />

        {/* Retry Queue */}
        <RetryQueue />

        {/* Logs */}
        <LogsTimeline />
      </div>
    </Layout>
  )
}
