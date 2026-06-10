import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import Input from './Input';

const meta = {
  title: 'UI/Input',
  component: Input,
  args: { placeholder: 'City, address, or zip' },
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const WithLabel: Story = {
  args: { label: 'Alert name', placeholder: 'Riverbend Ridge weekends' },
};
export const DateInput: Story = { args: { type: 'date' } };
