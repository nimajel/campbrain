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
export const UnknownProviderRendersNothing: Story = { args: { providerId: 'unknown' } };
