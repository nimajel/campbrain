import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import KVList, { KVRow } from './KVList';
import StatusDot from './StatusDot';

const meta = {
  title: 'UI/KVList',
  component: KVList,
  args: {
    items: [
      { key: 'Provider', value: 'california-parks' },
      { key: 'Park', value: 'Riverbend SP' },
      { key: 'Window opens', value: '2026-07-01 8:00 AM PT' },
    ],
  },
} satisfies Meta<typeof KVList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const WithRichLabels: Story = {
  render: () => (
    <>
      <KVRow label={<><StatusDot tone="green" /> Client ID</>}>configured</KVRow>
      <KVRow label={<><StatusDot tone="red" /> Client secret</>}>missing</KVRow>
    </>
  ),
};
