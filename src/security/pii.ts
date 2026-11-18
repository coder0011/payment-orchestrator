import type { CardData, SanitizedCardData } from '../domain/entities.js';

export class PiiService {
  /**
   * Masks a credit/debit card PAN preserving the first 6 (BIN) and last 4 digits.
   * Format: 424242******4242
   */
  static maskCardNumber(cardNumber: string): string {
    const cleaned = cardNumber.replace(/\D/g, '');
    if (cleaned.length < 10) {
      return '*'.repeat(cleaned.length);
    }
    const bin = cleaned.slice(0, 6);
    const last4 = cleaned.slice(-4);
    const maskedMiddle = '*'.repeat(cleaned.length - 10);
    return `${bin}${maskedMiddle}${last4}`;
  }

  /**
   * Extracts the 6-digit Bank Identification Number (BIN)
   */
  static extractBin(cardNumber: string): string {
    const cleaned = cardNumber.replace(/\D/g, '');
    return cleaned.slice(0, 6);
  }

  /**
   * Extracts the last 4 digits of the card
   */
  static extractLast4(cardNumber: string): string {
    const cleaned = cardNumber.replace(/\D/g, '');
    return cleaned.slice(-4);
  }

  /**
   * Sanitizes card payload for storage or logging.
   * Completely strips the CVV from memory and returns a safe representation.
   */
  static sanitizeCard(card: CardData): SanitizedCardData {
    return {
      maskedNumber: this.maskCardNumber(card.number),
      bin: this.extractBin(card.number),
      last4: this.extractLast4(card.number),
      expMonth: card.expMonth,
      expYear: card.expYear,
      holderName: card.holderName,
    };
  }

  /**
   * Validates card number using the standard Luhn algorithm (Mod 10).
   */
  static validateLuhn(cardNumber: string): boolean {
    const cleaned = cardNumber.replace(/\D/g, '');
    if (cleaned.length < 12 || cleaned.length > 19) {
      return false;
    }

    let sum = 0;
    let shouldDouble = false;

    for (let i = cleaned.length - 1; i >= 0; i--) {
      const char = cleaned.charAt(i);
      let digit = parseInt(char, 10);

      if (shouldDouble) {
        digit *= 2;
        if (digit > 9) {
          digit -= 9;
        }
      }

      sum += digit;
      shouldDouble = !shouldDouble;
    }

    return sum % 10 === 0;
  }
}
