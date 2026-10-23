import { AgentActivityPanel } from '@/components/panels/AgentActivityPanel';
import { AgentBriefPanel } from '@/components/panels/AgentBriefPanel';
import { AlertsPanel } from '@/components/panels/AlertsPanel';
import { BreachDisclosurePanel } from '@/components/panels/BreachDisclosurePanel';
import { ChartPanel } from '@/components/panels/ChartPanel';
import { CongressPanel } from '@/components/panels/CongressPanel';
import { ContractsPanel } from '@/components/panels/ContractsPanel';
import { CryptoPanel } from '@/components/panels/CryptoPanel';
import { CVEPipelinePanel } from '@/components/panels/CVEPipelinePanel';

import { EarningsPanel } from '@/components/panels/EarningsPanel';
import { EmailRepliesPanel } from '@/components/panels/EmailRepliesPanel';
import { FedPanel } from '@/components/panels/FedPanel';
import { IncidentAssessmentPanel } from '@/components/panels/IncidentAssessmentPanel';
import { IOCFeedPanel } from '@/components/panels/IOCFeedPanel';
import { KEVAlertsPanel } from '@/components/panels/KEVAlertsPanel';
import { LivestreamPanel, LivestreamPanel2 } from '@/components/panels/LivestreamPanel';
import { MarketsPanel } from '@/components/panels/MarketsPanel';
import { MonitorsPanel } from '@/components/panels/MonitorsPanel';
import { NewsFeedPanel } from '@/components/panels/NewsFeedPanel';
import { NewsPanel } from '@/components/panels/NewsPanel';
import { PatchTrackerPanel } from '@/components/panels/PatchTrackerPanel';
import { PolymarketPanel } from '@/components/panels/PolymarketPanel';
import { PredictionsPanel } from '@/components/panels/PredictionsPanel';
import { RiskSimulationPanel } from '@/components/panels/RiskSimulationPanel';
import { SectorHeatmapPanel } from '@/components/panels/SectorHeatmapPanel';
import { ThreatActorScoresPanel } from '@/components/panels/ThreatActorScoresPanel';
import { TwitterPanel } from '@/components/panels/TwitterPanel';
import { WhalePanel } from '@/components/panels/WhalePanel';
import { XRepliesPanel } from '@/components/panels/XRepliesPanel';
import { YouTubeSearchPanel } from '@/components/panels/YouTubeSearchPanel';
import { AGENT_IDENTITY } from '@/lib/constants/agent-identity';
import type { PanelId } from '@/lib/types';

/* ─── Panel component map ─── */

export const PANEL_COMPONENTS: Partial<Record<PanelId, React.ComponentType>> = {
  markets: MarketsPanel,
  news: NewsPanel,
  heatmap: SectorHeatmapPanel,
  crypto: CryptoPanel,
  agentBrief: AgentBriefPanel,
  agentActivity: AgentActivityPanel,
  congress: CongressPanel,
  whales: WhalePanel,
  polymarket: PolymarketPanel,
  fed: FedPanel,
  earnings: EarningsPanel,
  alerts: AlertsPanel,
  contracts: ContractsPanel,
  monitors: MonitorsPanel,
  chart: ChartPanel,
  livestream: LivestreamPanel,
  livestream2: LivestreamPanel2,
  newsFeed: NewsFeedPanel,
  twitter: TwitterPanel,
  youtubeSearch: YouTubeSearchPanel,
  // AEGIS deep-intel (Phase 4)
  cvePipeline: CVEPipelinePanel,
  threatActorScores: ThreatActorScoresPanel,
  incidentAssessment: IncidentAssessmentPanel,
  riskSimulation: RiskSimulationPanel,
  // Cyber feeds (Phase 4)
  kevAlerts: KEVAlertsPanel,
  iocFeed: IOCFeedPanel,
  patchTracker: PatchTrackerPanel,
  breachDisclosure: BreachDisclosurePanel,
  xReplies: XRepliesPanel,
  emailReplies: EmailRepliesPanel,
  // Forecast (Phase 11.D)
  predictions: PredictionsPanel,
};

/* ─── Categorized panel sections (for channel selector) ─── */

export const PANEL_SECTIONS: { label: string; panelIds: PanelId[] }[] = [
  {
    label: 'AEGIS INTELLIGENCE',
    panelIds: ['cvePipeline', 'threatActorScores', 'incidentAssessment', 'riskSimulation'],
  },
  {
    label: 'CYBER FEEDS',
    panelIds: [
      'kevAlerts',
      'iocFeed',
      'patchTracker',
      'breachDisclosure',
      'xReplies',
      'emailReplies',
    ],
  },
  {
    label: 'FORECAST',
    panelIds: ['predictions'],
  },
  {
    label: 'MARKETS',
    panelIds: ['markets', 'crypto', 'heatmap', 'chart', 'fed', 'earnings'],
  },
  {
    label: 'INTELLIGENCE',
    panelIds: [
      'news',
      'newsFeed',
      'twitter',
      'congress',
      'whales',
      'polymarket',
      'contracts',
      'monitors',
    ],
  },
  {
    label: AGENT_IDENTITY.name.toUpperCase(),
    panelIds: ['agentBrief', 'agentActivity'],
  },
  {
    label: 'MEDIA',
    panelIds: ['alerts', 'livestream', 'livestream2', 'youtubeSearch'],
  },
];
