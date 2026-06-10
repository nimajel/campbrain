import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import ProviderBadge from './ProviderBadge';

const meta = {
  title: 'Components/ProviderBadge',
  component: ProviderBadge,
  args: { providerId: 'california-parks' },
} satisfies Meta<typeof ProviderBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const CaliforniaParks: Story = {};
export const RecreationGov: Story = { args: { providerId: 'recreation-gov' } };
export const UnknownProvider: Story = {
  name: 'Unknown provider (renders nothing)',
  render: () => (
    <div style={{ border: '1px dashed var(--border)', padding: 8, fontSize: 11, color: 'var(--muted)' }}>
      Component renders null: <ProviderBadge providerId="unknown" />
    </div>
  ),
};
export const WithStyleOverride: Story = {
  args: { providerId: 'california-parks', style: { fontSize: 9 } },
};
