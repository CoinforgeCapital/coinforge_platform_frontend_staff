export const ACTIVITY_WARNING_TYPE_LABELS: Record<string, string> = {
  SINGLE: 'Single transaction limit',
  SINGLE_100K: 'Large single transaction',
  ALL_50k: 'Total volume over 50k',
  ALL_100k: 'Total volume over 100k',
  THREE_TRANSACTION_24H: 'Three transactions in 24h',
  WALLET_REPUTATION: 'Wallet reputation',
  SANCTIONS_MATCH: 'Sanctions match',
  HIGH_RISK_WALLET_EXPOSURE: 'High-risk wallet exposure',
  MIXER_OBFUSCATION_EXPOSURE: 'Mixer or obfuscation exposure',
  THIRD_PARTY_FIAT_FUNDING: 'Third-party fiat funding',
  THIRD_PARTY_FIAT_PAYOUT: 'Third-party fiat payout',
  SAME_BANK_ACCOUNT_MULTIPLE_CUSTOMERS: 'Same bank account used by multiple customers',
  SAME_WALLET_MULTIPLE_CUSTOMERS: 'Same wallet used by multiple customers',
  MULTIPLE_FIAT_SOURCES_ONE_WALLET: 'Multiple fiat sources to one wallet',
  MULTIPLE_WALLETS_ONE_FIAT_ACCOUNT: 'Multiple wallets to one fiat account',
  STRUCTURING_BELOW_THRESHOLDS: 'Structuring below thresholds',
  HIGH_VALUE_NEW_CUSTOMER: 'High-value new customer transaction',
  ACTIVITY_INCONSISTENT_PROFILE: 'Activity inconsistent with customer profile',
  UNUSUAL_TRANSACTION_VELOCITY: 'Unusual transaction velocity',
  RAPID_REPEATED_WALLET_CHANGES: 'Rapid repeated wallet changes',
  HIGH_RISK_JURISDICTION: 'High-risk jurisdiction indicator',
  VPN_PROXY_TOR_LOCATION_MISMATCH: 'VPN, proxy, TOR, or location mismatch',
  CRYPTO_FIAT_RISKY_SOURCE_WALLET: 'Crypto-to-fiat from risky source wallet',
  FIAT_CRYPTO_RISKY_DESTINATION_WALLET: 'Fiat-to-crypto to risky destination wallet',
  PRIVACY_COIN_HIGH_ANONYMITY: 'Privacy coin or high-anonymity asset use',
  CHAIN_HOPPING_ASSET_HOPPING: 'Chain-hopping or asset-hopping',
  BRIDGE_EXPOSURE: 'Bridge exposure',
  TRAVEL_RULE_INFO_MISSING: 'Travel Rule information missing or incomplete',
  COUNTERPARTY_VASP_HIGH_RISK: 'Counterparty CASP/VASP high risk',
  PAYMENT_REVERSAL_AFTER_CRYPTO: 'Payment reversal after crypto delivery',
  REPEATED_CANCELLED_FAILED_PAYMENTS: 'Repeated cancelled or failed payment attempts',
  DORMANT_CUSTOMER_REACTIVATION: 'Dormant customer reactivation',
  REPEATED_ALERTS_SAME_CUSTOMER: 'Repeated alerts on same customer',
  SOURCE_OF_FUNDS_NOT_SUPPORTED: 'Source of funds not supported',
};

export function activityWarningTypeLabel(type?: string | null): string {
  if (!type) return '-';
  return ACTIVITY_WARNING_TYPE_LABELS[type] ?? prettyActivityWarningType(type);
}

function prettyActivityWarningType(type: string): string {
  const normalized = type.toLowerCase().replace(/_/g, ' ');
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}
