import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import SectionTitle from './SectionTitle';

const meta = {
  title: 'UI/SectionTitle',
  component: SectionTitle,
  args: { title: 'Notification channels' },
} satisfies Meta<typeof SectionTitle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const WithDescription: Story = {
  args: { title: 'Discover campgrounds', desc: 'Search the ReserveCalifornia catalog by park name.' },
};
