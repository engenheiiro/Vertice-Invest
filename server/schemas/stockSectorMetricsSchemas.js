import { z } from 'zod';
import { STOCK_ARCHETYPES } from '../config/stockCalibration.js';

const percentage = z.number().finite().min(-500).max(1000);
const nonNegativePercentage = z.number().finite().min(0).max(1000);

const provenanceShape = {
  asOf: z.coerce.date(),
  collectedAt: z.coerce.date().optional(),
  source: z.string().trim().min(2).max(120),
  sourceDocument: z.string().url().max(2048),
  supportingDocuments: z.array(z.string().url().max(2048)).max(10).optional(),
  methodologyVersion: z.string().trim().min(2).max(80),
};

export const BankSectorMetricsSchema = z.object({
  archetype: z.literal(STOCK_ARCHETYPES.BANK),
  ...provenanceShape,
  roeTtm: percentage,
  earningsGrowth: percentage,
  delinquencyRatio: nonNegativePercentage.max(100),
  problemAssetsRatio: nonNegativePercentage.max(100).optional(),
  capitalRatio: nonNegativePercentage.max(100),
  capitalPrincipalRatio: nonNegativePercentage.max(100).optional(),
  operatingCostRatio: nonNegativePercentage.max(200),
  creditCost: percentage.optional(),
  coverageRatio: nonNegativePercentage.optional(),
  liquidityCoverage: nonNegativePercentage.optional(),
  controlType: z.enum(['PRIVATE', 'STATE_DIRECT', 'STATE_INDIRECT', 'DISPERSED']).optional(),
}).strict();

export const InsurerSectorMetricsSchema = z.object({
  archetype: z.literal(STOCK_ARCHETYPES.INSURER),
  ...provenanceShape,
  recurringEarningsGrowth: percentage,
  solvencyRatio: nonNegativePercentage,
  combinedRatio: nonNegativePercentage.max(500),
  claimsRatio: nonNegativePercentage.max(500).optional(),
  premiumGrowth: percentage.optional(),
}).strict();

export const FinancialHoldingSectorMetricsSchema = z.object({
  archetype: z.literal(STOCK_ARCHETYPES.FINANCIAL_HOLDING),
  ...provenanceShape,
  recurringEarningsGrowth: percentage,
  cashRemittanceCoverage: nonNegativePercentage,
  capitalAdequacy: nonNegativePercentage,
  distributionConcentration: nonNegativePercentage.max(100).optional(),
  controlType: z.enum(['PRIVATE', 'STATE_DIRECT', 'STATE_INDIRECT', 'DISPERSED']),
}).strict();

export const InsuranceBrokerSectorMetricsSchema = z.object({
  archetype: z.literal(STOCK_ARCHETYPES.INSURANCE_BROKER),
  ...provenanceShape,
  recurringEarningsGrowth: percentage,
  commissionRevenueGrowth: percentage,
  partnerConcentration: nonNegativePercentage.max(100).optional(),
}).strict();

export const InsuranceHoldingDistributorMetricsSchema = z.object({
  archetype: z.literal(STOCK_ARCHETYPES.INSURANCE_HOLDING_DISTRIBUTOR),
  ...provenanceShape,
  recurringEarningsGrowth: percentage,
  investeeCapitalAdequacy: nonNegativePercentage.optional(),
  distributionRevenueGrowth: percentage,
  distributionConcentration: nonNegativePercentage.max(100).optional(),
  controlType: z.enum(['PRIVATE', 'STATE_DIRECT', 'STATE_INDIRECT', 'DISPERSED']),
}).strict();

export const DiversifiedHoldingMetricsSchema = z.object({
  archetype: z.literal(STOCK_ARCHETYPES.DIVERSIFIED_HOLDING),
  ...provenanceShape,
  recurringEarningsGrowth: percentage,
  cashRemittanceCoverage: nonNegativePercentage,
  distributionConcentration: nonNegativePercentage.max(100).optional(),
  controlType: z.enum(['PRIVATE', 'STATE_DIRECT', 'STATE_INDIRECT', 'DISPERSED']),
}).strict();

export const OilGasProducerMetricsSchema = z.object({
  archetype: z.literal(STOCK_ARCHETYPES.OIL_GAS_PRODUCER),
  ...provenanceShape,
  productionKboed: z.number().finite().positive().optional(),
  productionGrowth: percentage,
  liftingCostUsdBoe: z.number().finite().positive().max(200),
  liftingCostAsOf: z.coerce.date().optional(),
  liftingCostBasis: z.enum(['REPORTED', 'EX_LEASES']),
  ebitdaMargin: percentage.min(-100).max(100),
  ebitdaBasis: z.enum(['REPORTED', 'ADJUSTED', 'ADJUSTED_EX_IFRS16']),
  netDebtEbitda: z.number().finite().min(-10).max(20),
  freeCashFlowMargin: percentage.min(-500).max(500).optional(),
  provedReserveLifeYears: z.number().finite().positive().max(100).optional(),
  reserveReplacementRatio: nonNegativePercentage.max(2000).optional(),
  reserveBasis: z.enum(['SEC_1P', 'SPE_1P']).optional(),
  controlType: z.enum(['PRIVATE', 'STATE_DIRECT', 'STATE_INDIRECT', 'DISPERSED']),
}).strict();

export const StockSectorMetricsSchema = z.discriminatedUnion('archetype', [
  BankSectorMetricsSchema,
  InsurerSectorMetricsSchema,
  InsuranceBrokerSectorMetricsSchema,
  FinancialHoldingSectorMetricsSchema,
  InsuranceHoldingDistributorMetricsSchema,
  DiversifiedHoldingMetricsSchema,
  OilGasProducerMetricsSchema,
]);

export const validateStockSectorMetrics = payload => StockSectorMetricsSchema.parse(payload);
