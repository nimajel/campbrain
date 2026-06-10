import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import StatCard from './StatCard';

const meta = {
  title: 'UI/StatCard',
  component: StatCard,
  args: { label: 'Active alerts', value: 3 },
} satisfies Meta<typeof StatCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Highlighted: Story = {
  args: { label: 'Current matches', value: 12, valueStyle: { color: 'var(--green)' } },
};
export const StatGrid: Story = {
  render: () => (
    <div className="grid-3">
      <StatCard label="Active alerts" value={<>3<span style={{ fontSize: 14, color: 'var(--muted)', fontWeight: 400 }}>/5</span></>} />
      <StatCard label="Current matches" value={12} valueStyle={{ color: 'var(--green)' }} />
      <StatCard label="Total hits recorded" value={48} />
    </div>
  ),
};
