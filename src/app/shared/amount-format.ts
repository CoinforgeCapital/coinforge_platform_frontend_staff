type DisplayAmount = string | number | null | undefined;

function formatDecimal(value: DisplayAmount, maximumFractionDigits: number, fallback: string): string {
  if (value === null || value === undefined || value === '') return fallback;

  const raw = String(value).trim();
  const parsed = Number(raw.replace(/,/g, ''));
  if (!Number.isFinite(parsed)) return raw;

  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits,
  }).format(parsed);
}

export function formatFiatAmount(value: DisplayAmount, fallback = '-'): string {
  return formatDecimal(value, 2, fallback);
}

export function formatCryptoAmount(value: DisplayAmount, fallback = '-'): string {
  return formatDecimal(value, 6, fallback);
}

export function formatAmountByField(field: string, value: DisplayAmount, fallback = '-'): string | null {
  const key = field.replace(/[^a-z0-9]/gi, '').toLowerCase();

  if (key.includes('amountreceive') || key.includes('cryptoamount')) {
    return formatCryptoAmount(value, fallback);
  }

  if (
    key.includes('amountsent') ||
    key.includes('amounteur') ||
    key.includes('triggereur') ||
    key.includes('thresholdamount') ||
    key.includes('totalamount') ||
    key.includes('priceatmoment') ||
    key.includes('price') ||
    key.includes('fiat') && key.includes('limit')
  ) {
    return formatFiatAmount(value, fallback);
  }

  return null;
}
