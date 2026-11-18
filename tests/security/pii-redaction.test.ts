import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PiiService } from '../../src/security/pii.js';

describe('Security: PCI-DSS Cardholder Data Masking & Validation', () => {
  const sampleCard = {
    number: '4242424242424242',
    expMonth: 12,
    expYear: 2028,
    cvv: '123',
    holderName: 'Jane Doe',
  };

  it('masks card PAN preserving first 6 (BIN) and last 4 digits', () => {
    const masked = PiiService.maskCardNumber(sampleCard.number);
    assert.equal(masked, '424242******4242');
  });

  it('extracts BIN and Last4 accurately', () => {
    assert.equal(PiiService.extractBin(sampleCard.number), '424242');
    assert.equal(PiiService.extractLast4(sampleCard.number), '4242');
  });

  it('sanitizes card object by stripping CVV completely', () => {
    const sanitized = PiiService.sanitizeCard(sampleCard);

    assert.equal(sanitized.maskedNumber, '424242******4242');
    assert.equal(sanitized.bin, '424242');
    assert.equal(sanitized.last4, '4242');
    assert.equal('cvv' in sanitized, false, 'CVV property must not exist in sanitized card data');
  });

  it('validates card numbers using the standard Luhn algorithm', () => {
    assert.ok(PiiService.validateLuhn('4242424242424242'), 'Valid test card should pass Luhn');
    assert.ok(!PiiService.validateLuhn('4242424242424243'), 'Invalid card checksum should fail Luhn');
    assert.ok(!PiiService.validateLuhn('123'), 'Too short card number should fail');
  });
});
