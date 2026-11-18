import type { ConnectorId, Currency } from '../domain/entities.js';

export interface ConnectorPricingConfig {
  fixedFee: Record<Currency, number>;
  percentageRate: number; // e.g. 0.029 = 2.9%
  percentageFeeCap?: Record<Currency, number>;
  crossBorderMarkupRate: number; // e.g. 0.01 = 1%
  supportedCurrencies: readonly Currency[];
  supportedCountries: readonly string[]; // 'GLOBAL' or ISO country codes
  baselineSuccessRate: number; // e.g. 0.99
  simulatedLatencyMs: number;
}

export const CONNECTORS_CONFIG: Record<ConnectorId, ConnectorPricingConfig> = {
  stripe: {
    fixedFee: {
      USD: 0.30,
      EUR: 0.25,
      GBP: 0.20,
      INR: 2.00,
    },
    percentageRate: 0.029, // 2.9%
    crossBorderMarkupRate: 0.010, // 1.0%
    supportedCurrencies: ['USD', 'EUR', 'GBP', 'INR'],
    supportedCountries: ['GLOBAL'],
    baselineSuccessRate: 0.992,
    simulatedLatencyMs: 30,
  },
  adyen: {
    fixedFee: {
      USD: 0.11,
      EUR: 0.10,
      GBP: 0.09,
      INR: 1.50,
    },
    percentageRate: 0.011, // 1.1% (Interchange++)
    crossBorderMarkupRate: 0.008, // 0.8%
    supportedCurrencies: ['USD', 'EUR', 'GBP', 'INR'],
    supportedCountries: ['US', 'GB', 'DE', 'FR', 'NL', 'CA', 'AU', 'IN'],
    baselineSuccessRate: 0.965,
    simulatedLatencyMs: 35,
  },
  razorpay: {
    fixedFee: {
      USD: 0.00,
      EUR: 0.00,
      GBP: 0.00,
      INR: 0.00,
    },
    percentageRate: 0.020, // 2.0%
    percentageFeeCap: {
      INR: 20.00,
      USD: 2.50,
      EUR: 2.30,
      GBP: 2.00,
    },
    crossBorderMarkupRate: 0.020, // 2.0%
    supportedCurrencies: ['INR', 'USD', 'EUR'],
    supportedCountries: ['IN', 'SG', 'US', 'AE'],
    baselineSuccessRate: 0.940,
    simulatedLatencyMs: 25,
  },
};
