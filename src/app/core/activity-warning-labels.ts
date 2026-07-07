export const ACTIVITY_WARNING_TYPE_LABELS: Record<string, string> = {
  TRANSACTION_RULE: 'Transaction rule',
  WALLET_REPUTATION: 'Wallet reputation',
};

export function activityWarningTypeLabel(type?: string | null): string {
  if (!type) return '-';
  return ACTIVITY_WARNING_TYPE_LABELS[type] ?? prettyActivityWarningType(type);
}

function prettyActivityWarningType(type: string): string {
  const normalized = type.toLowerCase().replace(/_/g, ' ');
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}
