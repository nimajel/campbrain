import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import Badge from './Badge';

const meta = {
  title: 'UI/Badge',
  component: Badge,
  args: { tone: 'green', children: 'Available' },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Green: Story = {};
export const Red: Story = { args: { tone: 'red', children: 'Unavailable' } };
export const Blue: Story = { args: { tone: 'blue', children: 'california-parks' } };
export const Gray: Story = { args: { tone: 'gray', children: 'walk-up' } };
export const Match: Story = { args: { tone: 'match', children: 'Site #4' } };
export const AllTones: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <Badge tone="green">green</Badge>
      <Badge tone="red">red</Badge>
      <Badge tone="blue">blue</Badge>
      <Badge tone="gray">gray</Badge>
      <Badge tone="match">match</Badge>
    </div>
  ),
};
