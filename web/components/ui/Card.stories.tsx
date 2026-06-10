import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import Card from './Card';
import Button from './Button';

const meta = {
  title: 'UI/Card',
  component: Card,
  args: { children: 'Card content' },
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const WithActions: Story = {
  render: () => (
    <Card
      actions={
        <>
          <Button variant="ghost" size="sm">Edit</Button>
          <Button variant="danger" size="sm">Delete</Button>
        </>
      }
    >
      <h3 style={{ margin: 0 }}>Angel Island weekends</h3>
      <p style={{ margin: '8px 0 0', color: 'var(--muted)', fontSize: 13 }}>
        Angel Island SP · Ridge Sites · Sites: 4, 5, 6
      </p>
    </Card>
  ),
};
export const Dimmed: Story = { args: { style: { opacity: 0.6 }, children: 'Disabled alert card' } };
