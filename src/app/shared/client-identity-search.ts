import { StaffPersonalData } from '../services/api.service';

export interface ClientIdentitySearchable {
  email?: string | null;
  personalData?: StaffPersonalData | null;
}

export function clientIdentitySearchText(client: ClientIdentitySearchable | null | undefined): string {
  const personalData = client?.personalData;
  const name = String(personalData?.name ?? '').trim();
  const surname = String(personalData?.surname ?? '').trim();
  return [
    client?.email,
    name,
    surname,
    [name, surname].filter(Boolean).join(' '),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function matchesClientIdentity(client: ClientIdentitySearchable, query: string): boolean {
  const term = query.trim().toLowerCase();
  return !term || clientIdentitySearchText(client).includes(term);
}
