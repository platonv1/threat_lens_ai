export type Severity = "info" | "medium" | "high";

export interface Finding {
  check: string;
  message: string;
  severity: Severity;
}

export interface ScanResponse {
  id: number;
  scan_type: string;
  input_text: string;
  risk_score: number;
  verdict: string;
  ai_summary: string;
  findings: Finding[];
  created_at: string;
}
