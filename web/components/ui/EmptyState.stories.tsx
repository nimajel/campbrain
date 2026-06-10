import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import EmptyState from './EmptyState';

const meta = {
  title: 'UI/EmptyState',
  component: EmptyState,
  args: { children: 'No openings found yet.' },
} satisfies Meta<typeof EmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const WithLink: Story = {
  render: () => (
    <EmptyState>
      No alerts configured. <a href="/alerts">Create your first alert →</a>
    </EmptyState>
  ),
};
