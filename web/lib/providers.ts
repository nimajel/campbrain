export interface ProviderBadgeConfig {
  label: string;
  color: 'green' | 'blue' | 'orange' | 'purple';
}

export const PROVIDER_BADGES: Record<string, ProviderBadgeConfig> = {
  'california-parks': { label: 'CA State Parks', color: 'green' },
  'recreation-gov':   { label: 'Recreation.gov', color: 'blue' },
};
