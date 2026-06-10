import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import Button from './Button';

const meta = {
  title: 'UI/Button',
  component: Button,
  args: { children: 'Button' },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Bare: Story = {};
export const Primary: Story = { args: { variant: 'primary', children: '+ New alert' } };
export const Ghost: Story = { args: { variant: 'ghost' } };
export const Slate: Story = { args: { variant: 'slate' } };
export const Danger: Story = { args: { variant: 'danger', children: 'Delete' } };
export const Success: Story = { args: { variant: 'success', children: 'Saved' } };
export const Small: Story = { args: { variant: 'ghost', size: 'sm', children: 'Manage →' } };
export const Disabled: Story = { args: { variant: 'primary', disabled: true } };
export const AsLink: Story = {
  args: { variant: 'primary', size: 'sm', href: 'https://www.parks.ca.gov', children: 'Book' },
};
export const AllVariants: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <Button>bare</Button>
      <Button variant="primary">primary</Button>
      <Button variant="ghost">ghost</Button>
      <Button variant="slate">slate</Button>
      <Button variant="danger">danger</Button>
      <Button variant="success">success</Button>
      <Button variant="primary" size="sm">primary sm</Button>
      <Button variant="primary" disabled>disabled</Button>
    </div>
  ),
};
