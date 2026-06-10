import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import StatusDot from './StatusDot';

const meta = {
  title: 'UI/StatusDot',
  component: StatusDot,
  args: { tone: 'green' },
} satisfies Meta<typeof StatusDot>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Green: Story = {};
export const AllTones: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span><StatusDot tone="green" /> enabled / available</span>
      <span><StatusDot tone="red" /> error / unavailable</span>
      <span><StatusDot tone="gray" /> disabled / unknown</span>
      <span><StatusDot tone="yellow" /> pending</span>
    </div>
  ),
};
