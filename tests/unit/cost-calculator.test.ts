import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { adyenConnector } from '../../src/connectors/adyen.connector.js';
import { razorpayConnector } from '../../src/connectors/razorpay.connector.js';
import { stripeConnector } from '../../src/connectors/stripe.connector.js';

describe('Unit: Cost Calculation & Fee Modeling', () => {
  it('calculates Stripe domestic fee correctly for USD 100', () => {
    const quote = stripeConnector.quoteFee({
      amount: 100,
      currency: 'USD',
      cardBin: '424242',
      billingCountry: 'US',
      merchantCountry: 'US',
    });

    // Stripe USD: fixed 0.30 + (100 * 0.029 = 2.90) + 0 FX = 3.20
    assert.equal(quote.feeBreakdown.fixed, 0.3);
    assert.equal(quote.feeBreakdown.percentage, 2.9);
    assert.equal(quote.feeBreakdown.fxMarkup, 0);
    assert.equal(quote.feeBreakdown.total, 3.2);
  });

  it('calculates Stripe cross-border fee correctly including FX markup', () => {
    const quote = stripeConnector.quoteFee({
      amount: 100,
      currency: 'USD',
      cardBin: '424242',
      billingCountry: 'GB', // Cross-border
      merchantCountry: 'US',
    });

    // Fixed 0.30 + percentage 2.90 + FX (100 * 0.01 = 1.00) = 4.20
    assert.equal(quote.feeBreakdown.fixed, 0.3);
    assert.equal(quote.feeBreakdown.percentage, 2.9);
    assert.equal(quote.feeBreakdown.fxMarkup, 1.0);
    assert.equal(quote.feeBreakdown.total, 4.2);
  });

  it('calculates Adyen Interchange++ fee correctly (cheaper than Stripe for USD 100)', () => {
    const quote = adyenConnector.quoteFee({
      amount: 100,
      currency: 'USD',
      cardBin: '424242',
      billingCountry: 'US',
      merchantCountry: 'US',
    });

    // Adyen: fixed 0.11 + percentage (100 * 0.011 = 1.10) + 0 FX = 1.21
    assert.equal(quote.feeBreakdown.fixed, 0.11);
    assert.equal(quote.feeBreakdown.percentage, 1.1);
    assert.equal(quote.feeBreakdown.fxMarkup, 0);
    assert.equal(quote.feeBreakdown.total, 1.21);
    assert.ok(quote.feeBreakdown.total < 3.2, 'Adyen should be cheaper than Stripe for standard USD');
  });

  it('applies Razorpay fee cap correctly for large transactions', () => {
    const quote = razorpayConnector.quoteFee({
      amount: 5000,
      currency: 'INR',
      cardBin: '607080',
      billingCountry: 'IN',
      merchantCountry: 'IN',
    });

    // 5000 * 2% = 100, but capped at 20 INR
    assert.equal(quote.feeBreakdown.fixed, 0);
    assert.equal(quote.feeBreakdown.percentage, 20); // Capped
    assert.equal(quote.feeBreakdown.total, 20);
  });
});
