-- ================================================
-- WORKANA AUTOPILOT PRO — Migración de Base de Datos
-- Ejecutar en Supabase SQL Editor
-- ================================================

-- Fase 1: Campos parseados en workana_projects
ALTER TABLE workana_projects
  ADD COLUMN IF NOT EXISTS budget_min NUMERIC,
  ADD COLUMN IF NOT EXISTS budget_max NUMERIC,
  ADD COLUMN IF NOT EXISTS budget_currency TEXT DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS budget_type TEXT,
  ADD COLUMN IF NOT EXISTS proposals_count_parsed INTEGER,
  ADD COLUMN IF NOT EXISTS client_rating_parsed NUMERIC(3,2),
  ADD COLUMN IF NOT EXISTS client_projects_posted INTEGER,
  ADD COLUMN IF NOT EXISTS client_hire_rate NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS win_probability NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS response_time_hours NUMERIC,
  ADD COLUMN IF NOT EXISTS proposal_variant TEXT;

-- Fase 1: Campos en workana_proposals
ALTER TABLE workana_proposals
  ADD COLUMN IF NOT EXISTS proposal_variant TEXT,
  ADD COLUMN IF NOT EXISTS word_count INTEGER,
  ADD COLUMN IF NOT EXISTS tone TEXT,
  ADD COLUMN IF NOT EXISTS pricing_strategy TEXT;

-- Índices para consultas frecuentes
CREATE INDEX IF NOT EXISTS idx_projects_win_prob ON workana_projects(win_probability DESC) WHERE status IN ('new', 'proposal_generated');
CREATE INDEX IF NOT EXISTS idx_projects_outcome ON workana_projects(outcome) WHERE outcome IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_projects_budget_range ON workana_projects(budget_min, budget_max) WHERE budget_min IS NOT NULL;

-- Vista: Conversión enriquecida v2 (security_invoker para respetar RLS)
CREATE OR REPLACE VIEW workana_conversion_stats_v2
WITH (security_invoker = true) AS
SELECT
  category,
  COUNT(*) FILTER (WHERE status IN ('sent', 'applied')) AS total_sent,
  COUNT(*) FILTER (WHERE outcome = 'won') AS won,
  COUNT(*) FILTER (WHERE outcome = 'lost') AS lost,
  COUNT(*) FILTER (WHERE outcome = 'no_response') AS no_response,
  COUNT(*) FILTER (WHERE client_responded = true) AS responded,
  ROUND(100.0 * COUNT(*) FILTER (WHERE outcome = 'won') /
    NULLIF(COUNT(*) FILTER (WHERE status IN ('sent', 'applied')), 0), 1) AS win_rate_pct,
  ROUND(100.0 * COUNT(*) FILTER (WHERE client_responded = true) /
    NULLIF(COUNT(*) FILTER (WHERE status IN ('sent', 'applied')), 0), 1) AS response_rate_pct,
  ROUND(AVG(budget_min) FILTER (WHERE outcome = 'won'), 0) AS avg_budget_won,
  ROUND(AVG(budget_min) FILTER (WHERE outcome = 'lost'), 0) AS avg_budget_lost,
  ROUND(AVG(proposals_count) FILTER (WHERE outcome = 'won'), 0) AS avg_proposals_when_won,
  ROUND(AVG(relevance_score) FILTER (WHERE outcome = 'won'), 0) AS avg_score_when_won
FROM workana_projects
WHERE status IN ('sent', 'applied', 'won', 'lost')
GROUP BY category;

-- Vista: Patrones de propuestas ganadoras (security_invoker para respetar RLS)
CREATE OR REPLACE VIEW workana_winning_patterns
WITH (security_invoker = true) AS
SELECT
  p.category,
  pr.tone,
  pr.word_count,
  pr.budget_suggested,
  pr.delivery_days,
  pr.pricing_strategy,
  pr.proposal_variant,
  p.proposals_count,
  p.budget_min,
  p.client_rating_parsed,
  p.client_verified,
  p.outcome
FROM workana_projects p
JOIN workana_proposals pr ON pr.project_id = p.id
WHERE p.outcome IN ('won', 'lost')
ORDER BY p.updated_at DESC
LIMIT 100;

-- Vista: Resultados A/B Testing (security_invoker para respetar RLS)
CREATE OR REPLACE VIEW workana_ab_results
WITH (security_invoker = true) AS
SELECT
  pr.proposal_variant,
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE p.outcome = 'won') AS won,
  COUNT(*) FILTER (WHERE p.client_responded = true) AS responded,
  ROUND(100.0 * COUNT(*) FILTER (WHERE p.outcome = 'won') / NULLIF(COUNT(*), 0), 1) AS win_rate,
  ROUND(100.0 * COUNT(*) FILTER (WHERE p.client_responded = true) / NULLIF(COUNT(*), 0), 1) AS response_rate,
  ROUND(AVG(pr.budget_suggested), 0) AS avg_budget,
  ROUND(AVG(pr.word_count), 0) AS avg_words
FROM workana_projects p
JOIN workana_proposals pr ON pr.project_id = p.id
WHERE p.status IN ('sent', 'applied', 'won', 'lost')
  AND pr.proposal_variant IS NOT NULL
GROUP BY pr.proposal_variant;
