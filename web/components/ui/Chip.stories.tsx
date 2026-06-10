import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import Chip from './Chip';

const meta = {
  title: 'UI/Chip',
  component: Chip,
  args: { tone: 'green', children: 'fresh' },
} satisfies Meta<typeof Chip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Green: Story = {};
export const Red: Story = { args: { tone: 'red', children: 'error' } };
export const Gray: Story = { args: { tone: 'gray', children: 'stale' } };
export const Yellow: Story = { args: { tone: 'yellow', children: 'pending' } };
