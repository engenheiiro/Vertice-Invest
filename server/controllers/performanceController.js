import { getPerformanceSnapshot } from '../utils/performanceMetrics.js';

/** GET /api/admin/performance-metrics — snapshot agregado, sem PII/query strings. */
export const getPerformanceMetrics = (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(getPerformanceSnapshot());
};
