import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import PageHeader from './PageHeader';

const meta = {
  title: 'UI/PageHeader',
  component: PageHeader,
  args: { title: 'Dashboard', subtitle: 'Campsite availability monitoring' },
} satisfies Meta<typeof PageHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const TitleOnly: Story = { args: { title: 'Settings', subtitle: undefined } };
