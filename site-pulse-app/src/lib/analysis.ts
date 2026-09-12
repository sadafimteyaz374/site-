export interface ActionItem {
  id: number;
  task: string;
  owner: string;
  status: string;
  deadline: string;
  context: string;
  steps: string[];
  impact: string;
}

export interface AnalysisResult {
  riskLevel: string;
  riskScore: number;
  financialImpact: string;
  summary: string;
  actionItems: ActionItem[];
}

export function generateAnalysis(text: string, ownerFallback: string): AnalysisResult {
  const isSafety =
    text.toLowerCase().includes('emergency') ||
    text.toLowerCase().includes('crane') ||
    text.toLowerCase().includes('safety') ||
    text.toLowerCase().includes('urgent');

  return {
    riskLevel: isSafety ? 'CRITICAL' : 'WARNING',
    riskScore: isSafety ? 92 : 78,
    financialImpact: text.match(/\$[\d,]+(\/day|\/hour)?/)?.[0] || '$8,500',
    summary: text,
    actionItems: [
      {
        id: 1,
        task: 'Review Extracted Source Content',
        owner: ownerFallback || 'Site Supervisor',
        status: 'PENDING',
        deadline: 'Immediate',
        context: text,
        steps: [
          'Analyze extracted target data.',
          'Identify key operational insights and risk indicators.',
        ],
        impact: 'Ensures quick synthesis of documentation.',
      },
    ],
  };
}
